import {
  DEFAULT_ALLOWED_HOSTS,
  DEV_POLICY,
  PRODUCTION_POLICY,
  capStream,
  classifyTarget,
  handleProxyRequest,
  isPrivateHost,
  parseAllowedHosts,
  type ProxyEnvelope,
  type ProxyFetch,
  type ProxyIncomingRequest,
  type ProxyPolicy,
  type ProxyStream,
  type ProxyUpstreamInit,
  type ProxyUpstreamResponse,
} from '../aiProxy.ts'
import { describe, expect, it } from 'vitest'

const SECRET = 'sk-secret-should-never-leak'

function request(input: { method?: string; contentType?: string | null; body: string }): ProxyIncomingRequest {
  return {
    method: input.method ?? 'POST',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? (input.contentType ?? 'application/json') : null,
    },
    text: async () => input.body,
  }
}

function envelope(overrides: Partial<ProxyEnvelope> = {}): string {
  return JSON.stringify({
    targetUrl: 'https://api.openai.com/v1/chat/completions',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: '{"model":"gpt-4o-mini"}',
    ...overrides,
  })
}

interface UpstreamCall {
  url: string
  init: ProxyUpstreamInit
}

function upstream(respond: (call: UpstreamCall, index: number) => ProxyUpstreamResponse) {
  const calls: UpstreamCall[] = []
  const fetchImpl: ProxyFetch = async (url, init) => {
    const call = { url, init }
    calls.push(call)
    return respond(call, calls.length - 1)
  }

  return { calls, fetchImpl }
}

function reply(input: { status?: number; headers?: Record<string, string>; text?: string; unreadable?: boolean }): ProxyUpstreamResponse {
  return {
    status: input.status ?? 200,
    headers: { get: (name: string) => input.headers?.[name.toLowerCase()] ?? null },
    text: async () => {
      if (input.unreadable) {
        throw new Error('body read failed')
      }
      return input.text ?? '{"ok":true}'
    },
  }
}

/**
 * A streaming upstream: the body is handed over as a chunk sequence, and the test keeps the counters
 * the buffered fake cannot give - how many chunks the relay actually pulled, and whether it cancelled.
 */
function streamOf(chunks: (string | Uint8Array)[]): {
  stream: ProxyStream
  pulled: () => number
  cancelled: () => boolean
} {
  const bytes = chunks.map((chunk) =>
    typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
  )
  const counter = { index: 0, pulled: 0, cancelled: false }

  return {
    pulled: () => counter.pulled,
    cancelled: () => counter.cancelled,
    stream: {
      getReader: () => ({
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (counter.index >= bytes.length) {
            return { done: true }
          }
          const value = bytes[counter.index]
          counter.index += 1
          counter.pulled += 1
          return { done: false, value }
        },
        async cancel(): Promise<void> {
          counter.cancelled = true
        },
      }),
    },
  }
}

function streamedReply(
  chunks: (string | Uint8Array)[],
  input: { status?: number; contentType?: string } = {},
): { response: ProxyUpstreamResponse; pulled: () => number; cancelled: () => boolean } {
  const stream = streamOf(chunks)

  return {
    pulled: stream.pulled,
    cancelled: stream.cancelled,
    response: {
      status: input.status ?? 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type' ? (input.contentType ?? 'text/event-stream') : null,
      },
      body: stream.stream,
      text: async () => chunks.join(''),
    },
  }
}

/** Everything a caller can read out of an outcome stream, plus how many chunks it took. */
async function drain(stream: ProxyStream): Promise<{ text: string; chunks: number }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let chunks = 0

  for (;;) {
    const chunk = await reader.read()
    if (chunk.done === true) {
      return { text, chunks }
    }
    chunks += 1
    text += decoder.decode(chunk.value ?? new Uint8Array(0), { stream: true })
  }
}

const relay = (body: string, fetchImpl: ProxyFetch, policy: ProxyPolicy = PRODUCTION_POLICY, method = 'POST') =>
  handleProxyRequest(request({ body, method }), policy, fetchImpl)

describe('relay happy path', () => {
  it('fetches the target with the envelope headers and returns the body verbatim', async () => {
    const spy = upstream(() => reply({ text: '{"choices":[{"text":"hi"}]}' }))
    const outcome = await relay(envelope(), spy.fetchImpl)

    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect(spy.calls[0].init.headers.authorization).toBe(`Bearer ${SECRET}`)
    expect(spy.calls[0].init.body).toBe('{"model":"gpt-4o-mini"}')
    expect(spy.calls[0].init.redirect).toBe('manual')

    expect(outcome.status).toBe(200)
    expect(outcome.body).toBe('{"choices":[{"text":"hi"}]}')
    expect(outcome.headers['x-ai-proxy-error']).toBeUndefined()
  })

  it('forwards only the headers a provider needs', async () => {
    const spy = upstream(() => reply({}))
    await relay(
      envelope({
        headers: {
          authorization: `Bearer ${SECRET}`,
          'x-api-key': 'anthropic-key',
          'anthropic-version': '2023-06-01',
          cookie: 'session=hijacked',
          host: 'evil.example',
          'x-ai-proxy-error': 'forged',
        },
      }),
      spy.fetchImpl,
    )

    const sent = spy.calls[0].init.headers
    expect(sent.authorization).toBe(`Bearer ${SECRET}`)
    expect(sent['x-api-key']).toBe('anthropic-key')
    expect(sent['anthropic-version']).toBe('2023-06-01')
    expect(sent.cookie).toBeUndefined()
    expect(sent.host).toBeUndefined()
    expect(sent['x-ai-proxy-error']).toBeUndefined()
    expect(sent['content-type']).toBe('application/json')
  })

  it('forwards an allowlisted header whatever case the caller used', async () => {
    const spy = upstream(() => reply({}))
    await relay(
      envelope({
        headers: {
          Authorization: `Bearer ${SECRET}`,
          'Content-Type': 'application/json',
          'X-Api-Key': 'anthropic-key',
          'X-Goog-Api-Key': 'google-key',
          'ANTHROPIC-VERSION': '2023-06-01',
        },
      }),
      spy.fetchImpl,
    )

    const sent = spy.calls[0].init.headers
    // These lookups used to be case-sensitive: a capitalised key was dropped in silence and the
    // provider answered "You didn't provide an API key" for a perfectly valid credential.
    expect(sent.authorization).toBe(`Bearer ${SECRET}`)
    expect(sent['x-api-key']).toBe('anthropic-key')
    expect(sent['x-goog-api-key']).toBe('google-key')
    expect(sent['anthropic-version']).toBe('2023-06-01')
    // Everything upstream is in the canonical lower-case form, which HTTP/2 requires anyway. Order
    // follows the envelope's own key order, so compare the set rather than the sequence.
    expect(sent.Authorization).toBeUndefined()
    expect(Object.keys(sent).sort()).toEqual([
      'anthropic-version',
      'authorization',
      'content-type',
      'x-api-key',
      'x-goog-api-key',
    ])
  })

  it('still drops a header that is not allowlisted, in every case', async () => {
    const spy = upstream(() => reply({}))
    await relay(
      envelope({
        headers: {
          Cookie: 'session=hijacked',
          COOKIE: 'session=also-hijacked',
          'X-Forwarded-For': '10.0.0.1',
          HOST: 'evil.example',
          'X-AI-Proxy-Error': 'forged',
          // A computed key really is an own property, so it survives JSON.stringify and JSON.parse.
          ['__proto__']: 'polluted',
        },
      }),
      spy.fetchImpl,
    )

    const sent = spy.calls[0].init.headers
    for (const name of ['cookie', 'x-forwarded-for', 'host', 'x-ai-proxy-error']) {
      expect(sent[name]).toBeUndefined()
    }
    // Reading `__proto__` off a plain object yields the prototype, never undefined, so ownership is
    // the question worth asking: the allowlisted-name check must have refused to assign it.
    expect(Object.hasOwn(sent, '__proto__')).toBe(false)
    // Case-insensitive matching must not have widened the allowlist: the default content type is
    // the only thing that survived, exactly as before.
    expect(Object.keys(sent)).toEqual(['content-type'])
  })

  it('resolves one header written several ways deterministically, last one winning', async () => {
    const spy = upstream(() => reply({}))
    await relay(
      envelope({
        headers: { authorization: 'Bearer first', Authorization: 'Bearer second', AUTHORIZATION: 'Bearer third' },
      }),
      spy.fetchImpl,
    )

    expect(spy.calls[0].init.headers.authorization).toBe('Bearer third')
  })

  it('relays retry-after but strips transport headers', async () => {
    const spy = upstream(() =>
      reply({
        status: 429,
        headers: { 'retry-after': '7', 'set-cookie': 'a=b', 'content-length': '999', 'content-encoding': 'gzip' },
        text: '{"error":"rate limited"}',
      }),
    )
    const outcome = await relay(envelope(), spy.fetchImpl)

    expect(outcome.status).toBe(429)
    expect(outcome.headers['retry-after']).toBe('7')
    expect(outcome.headers['set-cookie']).toBeUndefined()
    expect(outcome.headers['content-length']).toBeUndefined()
    expect(outcome.headers['content-encoding']).toBeUndefined()
    expect(outcome.headers['content-type']).toBe('application/json')
  })

  it('never lets a relayed answer be cached, on either path', async () => {
    const spy = upstream(() => reply({ headers: { 'cache-control': 'public, max-age=600' } }))
    const outcome = await relay(envelope(), spy.fetchImpl)

    // `cache-control` is not in RELAY_RESPONSE_HEADERS, so a provider's own directive cannot survive.
    expect(outcome.headers['cache-control']).toBe('no-store')

    const refusal = await relay(envelope(), upstream(() => reply({})).fetchImpl, PRODUCTION_POLICY, 'GET')
    expect(refusal.headers['cache-control']).toBe('no-store')
  })
})

describe('request guards', () => {
  it('rejects anything but POST without calling upstream', async () => {
    const spy = upstream(() => reply({}))
    const outcome = await relay(envelope(), spy.fetchImpl, PRODUCTION_POLICY, 'GET')
    expect(outcome.status).toBe(405)
    expect(outcome.headers['x-ai-proxy-error']).toBe('method-not-allowed')
    expect(spy.calls).toHaveLength(0)
  })

  it('rejects a non-JSON content type', async () => {
    const spy = upstream(() => reply({}))
    const outcome = await handleProxyRequest(
      request({ body: envelope(), contentType: 'text/plain' }),
      PRODUCTION_POLICY,
      spy.fetchImpl,
    )
    expect(outcome.status).toBe(400)
    expect(spy.calls).toHaveLength(0)
  })

  it('rejects malformed envelopes', async () => {
    for (const body of ['not json at all', '[1,2,3]', 'null', '{}', JSON.stringify({ targetUrl: 5, body: 'x' }), JSON.stringify({ targetUrl: 'https://api.openai.com', headers: 'nope', body: '{}' })]) {
      const spy = upstream(() => reply({}))
      const outcome = await relay(body, spy.fetchImpl)
      expect(outcome.status).toBe(400)
      expect(spy.calls).toHaveLength(0)
    }
  })

  it('caps the envelope size', async () => {
    const spy = upstream(() => reply({}))
    const outcome = await relay(envelope({ body: 'x'.repeat(70 * 1024) }), spy.fetchImpl)
    expect(outcome.status).toBe(413)
    expect(spy.calls).toHaveLength(0)
  })

  it('caps the response size', async () => {
    const spy = upstream(() => reply({ text: 'y'.repeat(1024 * 1024 + 10) }))
    const outcome = await relay(envelope(), spy.fetchImpl)
    expect(outcome.status).toBe(413)
    expect(outcome.headers['x-ai-proxy-error']).toBe('response-too-large')
  })
})

describe('SSRF policy', () => {
  const policy = (host: string) => classifyTarget(`https://${host}/v1/chat/completions`, PRODUCTION_POLICY)

  it('allows exactly the default inference hosts', () => {
    for (const host of ['api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'token-plan.ap-southeast-1.maas.aliyuncs.com']) {
      expect(policy(host).ok).toBe(true)
    }
  })

  it('lists only exact host names, never a wildcard, a URL or an address', () => {
    // `classifyTarget` compares with `includes`, so a `*.maas.aliyuncs.com` entry would silently
    // match nothing at all - and a real wildcard, if the comparison ever changed, would open every
    // tenant in the namespace. Pinning the shape of the data keeps that from arriving by accident.
    for (const host of DEFAULT_ALLOWED_HOSTS) {
      expect(host).toBe(host.toLowerCase())
      expect(host).not.toMatch(/[*\s:/]/)
      expect(host).not.toMatch(/^\d+(\.\d+)+$/)
    }
  })

  it('rejects suffix look-alikes and unknown hosts', () => {
    expect(policy('api.openai.com.attacker.test').ok).toBe(false)
    expect(policy('openai.com').ok).toBe(false)
    expect(policy('evil.example').ok).toBe(false)
    // One allowlisted workspace host must not admit the rest of the namespace it lives in.
    expect(policy('token-plan.ap-southeast-1.maas.aliyuncs.com.attacker.test').ok).toBe(false)
    expect(policy('another-team.ap-southeast-1.maas.aliyuncs.com').ok).toBe(false)
  })

  it('rejects non-https, userinfo, IP literals and metadata ranges in production', () => {
    expect(classifyTarget('http://api.openai.com/v1', PRODUCTION_POLICY).ok).toBe(false)
    expect(classifyTarget('https://user:pw@api.openai.com/v1', PRODUCTION_POLICY).ok).toBe(false)
    expect(classifyTarget('https://1.2.3.4/v1', PRODUCTION_POLICY).ok).toBe(false)
    expect(classifyTarget('https://169.254.169.254/latest/meta-data', PRODUCTION_POLICY).ok).toBe(false)
    expect(classifyTarget('https://[::1]:11434/v1', PRODUCTION_POLICY).ok).toBe(false)
    expect(classifyTarget('/v1/chat/completions', PRODUCTION_POLICY).ok).toBe(false)
    expect(classifyTarget('', PRODUCTION_POLICY).ok).toBe(false)
  })

  it('permits local endpoints in dev, where the proxy runs on a developer laptop', () => {
    expect(classifyTarget('http://localhost:11434/v1/chat/completions', DEV_POLICY).ok).toBe(true)
    expect(classifyTarget('http://127.0.0.1:8000/v1/chat/completions', DEV_POLICY).ok).toBe(true)
    expect(classifyTarget('http://192.168.1.5:8000/v1', DEV_POLICY).ok).toBe(true)
    // still nothing exotic: no credentials, and no garbage
    expect(classifyTarget('http://a:b@localhost:11434/v1', DEV_POLICY).ok).toBe(false)
    expect(classifyTarget('ftp://localhost/v1', DEV_POLICY).ok).toBe(false)
  })

  it('classifies private ranges', () => {
    for (const host of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.12', '169.254.169.254', 'localhost', 'api.localhost', 'fe80::1', 'fc00::1']) {
      expect(isPrivateHost(host)).toBe(true)
    }
    for (const host of ['8.8.8.8', '172.32.0.1', 'api.openai.com', 'example.org']) {
      expect(isPrivateHost(host)).toBe(false)
    }
  })

  it('lets the allowlist be extended by configuration', () => {
    const hosts = parseAllowedHosts('Gateway.Example, https-only-nope ', DEFAULTS())
    expect(hosts).toContain('gateway.example')
    expect(hosts.filter((h) => h === 'api.openai.com')).toHaveLength(1)

    const extended: ProxyPolicy = { ...PRODUCTION_POLICY, allowedHosts: hosts }
    expect(classifyTarget('https://gateway.example/v1/chat', extended).ok).toBe(true)
    expect(classifyTarget('https://gateway.example.evil.test/v1', extended).ok).toBe(false)
  })

  function DEFAULTS() {
    return ['api.openai.com'] as const satisfies readonly string[]
  }
})

describe('upstream failures', () => {
  it('turns an unreachable provider into a 502', async () => {
    const spy = upstream(() => {
      throw new Error('socket hang up')
    })
    const outcome = await relay(envelope(), spy.fetchImpl)
    expect(outcome.status).toBe(502)
    expect(outcome.headers['x-ai-proxy-error']).toBe('bad-gateway')
    expect(outcome.body).not.toContain(SECRET)
  })

  it('turns an unreadable body into a 502', async () => {
    const spy = upstream(() => reply({ unreadable: true }))
    const outcome = await relay(envelope(), spy.fetchImpl)
    expect(outcome.status).toBe(502)
  })

  it('times out on its own clock and says so', async () => {
    const slow: ProxyFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })

    const outcome = await relay(envelope(), slow, { ...PRODUCTION_POLICY, timeoutMs: 10 })
    expect(outcome.status).toBe(504)
    expect(outcome.headers['x-ai-proxy-error']).toBe('gateway-timeout')
  })

  it('refuses a redirect instead of following it', async () => {
    const spy = upstream(() => reply({ status: 302, headers: { location: 'http://169.254.169.254/' } }))
    const outcome = await relay(envelope(), spy.fetchImpl)
    expect(outcome.status).toBe(403)
    expect(spy.calls).toHaveLength(1)
    expect(outcome.body).not.toContain('169.254')
  })

  it('passes provider statuses through without the proxy error marker', async () => {
    for (const status of [400, 401, 403, 404, 429, 500]) {
      const spy = upstream(() => reply({ status, text: `{"provider_status":${status}}` }))
      const outcome = await relay(envelope(), spy.fetchImpl)
      expect(outcome.status).toBe(status)
      expect(outcome.body).toBe(`{"provider_status":${status}}`)
      expect(outcome.headers['x-ai-proxy-error']).toBeUndefined()
    }
  })
})

describe('credential hygiene', () => {
  it('never echoes the key in any rejection', async () => {
    const cases: Array<[string, ProxyPolicy]> = [
      [envelope({ targetUrl: 'https://evil.example/v1' }), PRODUCTION_POLICY],
      [envelope({ targetUrl: 'not a url' }), PRODUCTION_POLICY],
      [envelope({ targetUrl: 'http://localhost:11434/v1' }), PRODUCTION_POLICY],
      ['{}', PRODUCTION_POLICY],
    ]

    for (const [body, policy] of cases) {
      const spy = upstream(() => reply({}))
      const outcome = await relay(body, spy.fetchImpl, policy)
      expect(outcome.status).toBeGreaterThanOrEqual(400)
      expect(outcome.body).not.toContain(SECRET)
      expect(outcome.headers.authorization).toBeUndefined()
    }
  })

  it('still refuses a private host when the caller asks for a stream', async () => {
    // The `stream` flag changes how bytes travel, never where the request goes. If this ever regressed
    // it would turn a public deployment into an SSRF relay for loopback services, which is the whole
    // reason the check sits before the fetch and is not duplicated afterwards.
    const privateTarget = 'http://127.0.0.1:4111/v1/chat/completions'
    const spy = upstream(() => streamedReply(['data: x\n\n']).response)
    const outcome = await relay(
      envelope({ targetUrl: privateTarget, stream: true }),
      spy.fetchImpl,
      PRODUCTION_POLICY,
    )

    expect(outcome.status).toBe(403)
    expect(outcome.headers['x-ai-proxy-error']).toBe('target-not-allowed')
    expect(outcome.stream).toBeUndefined()
    expect(spy.calls).toHaveLength(0)

    // The same envelope is fine in dev, where the whole point is a model running on this machine.
    const dev = upstream(() => streamedReply(['data: x\n\n']).response)
    const allowed = await relay(envelope({ targetUrl: privateTarget, stream: true }), dev.fetchImpl, DEV_POLICY)
    expect(allowed.status).toBe(200)
    expect(allowed.stream).toBeDefined()
  })

  it('rejects a stream flag that is not a boolean, and never sends a request for it', async () => {
    const spy = upstream(() => reply({}))
    const outcome = await relay(envelope({ stream: 'yes' as unknown as boolean }), spy.fetchImpl)

    expect(outcome.status).toBe(400)
    expect(outcome.headers['x-ai-proxy-error']).toBe('bad-request')
    expect(spy.calls).toHaveLength(0)
  })
})

describe('streamed relay', () => {
  const events = ['data: {"choices":[{"delta":{"content":"he"}}]}\n\n', 'data: [DONE]\n\n']

  it('pipes the body through instead of buffering it, and keeps the upstream content type', async () => {
    const fake = streamedReply(events)
    const spy = upstream(() => fake.response)
    const outcome = await relay(envelope({ stream: true }), spy.fetchImpl)

    expect(outcome.status).toBe(200)
    expect(outcome.headers['content-type']).toBe('text/event-stream')
    expect(outcome.headers['cache-control']).toBe('no-store')
    // The bytes are in the stream, not in the string - so nothing accumulates in Function memory.
    expect(outcome.body).toBe('')
    expect(outcome.stream).toBeDefined()

    const drained = await drain(outcome.stream as ProxyStream)
    expect(drained.text).toBe(events.join(''))
    expect(drained.chunks).toBe(2)
  })

  it('leaves a buffered answer buffered when nobody asked for a stream', async () => {
    const fake = streamedReply(events)
    const spy = upstream(() => fake.response)
    const outcome = await relay(envelope(), spy.fetchImpl)

    expect(outcome.stream).toBeUndefined()
    expect(outcome.body).toBe(events.join(''))
  })

  it('streams the body of a gateway that ignored the flag, and lets the client sort out the format', async () => {
    // Some OpenAI-compatible servers answer `stream: true` with ordinary JSON. The relay does not
    // second-guess that: it pipes whatever arrived, and the content type says which one it was.
    const fake = streamedReply(['{"choices":[]}'], { contentType: 'application/json' })
    const spy = upstream(() => fake.response)
    const outcome = await relay(envelope({ stream: true }), spy.fetchImpl)

    expect(outcome.headers['content-type']).toBe('application/json')
    const drained = await drain(outcome.stream as ProxyStream)
    expect(drained.text).toBe('{"choices":[]}')
  })

  it('never streams an error: a provider failure stays a small buffered body', async () => {
    for (const status of [401, 429, 500]) {
      const fake = streamedReply(['{"error":{"message":"provider said no"}}'], { status })
      const spy = upstream(() => fake.response)
      const outcome = await relay(envelope({ stream: true }), spy.fetchImpl)

      // The client maps the status from a response it can read in one piece, and a retry needs
      // `retry-after` - a piped error body would deliver both long after the decision had to be made.
      expect(outcome.stream).toBeUndefined()
      expect(outcome.status).toBe(status)
      expect(outcome.body).toContain('provider said no')
      expect(outcome.headers['content-type']).toBe('text/event-stream')
    }
  })

  it('refuses a redirect rather than streaming its way to another host', async () => {
    const fake = streamedReply(['data: x\n\n'], { status: 302 })
    const spy = upstream(() => fake.response)
    const outcome = await relay(envelope({ stream: true }), spy.fetchImpl)

    expect(outcome.status).toBe(403)
    expect(outcome.headers['x-ai-proxy-error']).toBe('target-not-allowed')
    expect(outcome.stream).toBeUndefined()
  })

  it('counts bytes as they pass and stops at the cap', async () => {
    const big = ['x'.repeat(64), 'y'.repeat(64), 'z'.repeat(64)]
    const source = streamOf(big)
    const drained = await drain(capStream(source.stream, 100))

    // The chunk that would cross the line is dropped rather than clipped: half a UTF-8 sequence or half
    // an SSE frame is worse than nothing, and past the cap the only honest signal left is to end the
    // stream, because the status line and headers were sent a long time ago.
    expect(drained.text).toBe('x'.repeat(64))
    expect(drained.chunks).toBe(1)
    expect(source.pulled()).toBe(2)
  })

  it('cancels the upstream when the cap is crossed, so the provider stops generating', async () => {
    const source = streamOf(['a'.repeat(200), 'b'.repeat(200)])
    await drain(capStream(source.stream, 50))

    expect(source.cancelled()).toBe(true)
  })

  it('gives a streamed exchange a longer ceiling than a buffered one, on both policies', () => {
    // One abort signal covers the whole subrequest including the body, so a buffered ceiling applied to
    // a stream would cut a slow reply off mid-sentence. Both numbers stay above the client's own
    // budgets (see `AI_STREAM_TOTAL_MS`), which keeps the browser the one that gives up first.
    expect(PRODUCTION_POLICY.streamTimeoutMs).toBeGreaterThan(PRODUCTION_POLICY.timeoutMs)
    expect(DEV_POLICY.streamTimeoutMs).toBeGreaterThan(DEV_POLICY.timeoutMs)
    expect(PRODUCTION_POLICY.maxStreamBytes).toBeGreaterThan(PRODUCTION_POLICY.maxResponseBytes)
  })

  it('forwards GET envelopes without a body for model metadata endpoints under the same allowlist', async () => {
    const spy = upstream(() => reply({ text: '{"id":"gpt-4o-mini"}' }))
    const outcome = await handleProxyRequest(
      request({
        body: JSON.stringify({
          targetUrl: 'https://api.openai.com/v1/models/gpt-4o-mini',
          method: 'GET',
          headers: { authorization: `Bearer ${SECRET}` },
        }),
      }),
      PRODUCTION_POLICY,
      spy.fetchImpl,
    )

    expect(outcome.status).toBe(200)
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0].init.method).toBe('GET')
    expect(spy.calls[0].init.body).toBeUndefined()
  })
})
