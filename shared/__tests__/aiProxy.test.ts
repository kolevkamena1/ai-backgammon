import {
  DEV_POLICY,
  PRODUCTION_POLICY,
  classifyTarget,
  handleProxyRequest,
  isPrivateHost,
  parseAllowedHosts,
  type ProxyEnvelope,
  type ProxyFetch,
  type ProxyIncomingRequest,
  type ProxyPolicy,
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
    for (const host of ['api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com']) {
      expect(policy(host).ok).toBe(true)
    }
  })

  it('rejects suffix look-alikes and unknown hosts', () => {
    expect(policy('api.openai.com.attacker.test').ok).toBe(false)
    expect(policy('openai.com').ok).toBe(false)
    expect(policy('evil.example').ok).toBe(false)
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
})
