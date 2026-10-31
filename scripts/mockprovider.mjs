/**
 * A stand-in OpenAI-compatible provider for the opt-in relay suite
 * (`src/utils/__tests__/aiProxy.e2e.test.ts`) and for driving `/api/ai-proxy` by hand with curl.
 *
 * Start it with `npm run mock:provider`. It binds to 127.0.0.1:4111 by default (MOCK_PROVIDER_HOST,
 * MOCK_PROVIDER_PORT and MOCK_PROVIDER_KEY override that), which keeps it off the Windows firewall
 * prompt and off the LAN.
 *
 * It is a development tool and nothing more: never imported by the app, never bundled into `dist/`,
 * never typechecked (`tsconfig.app.json` includes only `src`, `tsconfig.node.json` only the Vite
 * config, `shared/` and `functions/`) and never deployed. That separation is also why it logs with
 * `console` directly - the `src/lib/logger.ts` wrapper belongs to the browser bundle.
 *
 * Two behaviours are deliberately modelled on a real gateway, because they are the reason the relay
 * exists at all:
 *   - it sends **no CORS headers**, exactly like DashScope, so a direct browser call cannot succeed
 *     and only a same-origin relay can carry this traffic;
 *   - it authenticates by header rather than by URL, so a wrong key is answered the way a provider
 *     answers it: 401 with an OpenAI-shaped error body.
 *
 * Every buffered chat reply is `{"choice": 1}` - the first entry of the legal-move menu. That makes the
 * AI-vs-AI end-to-end game deterministic and guaranteed to reach a bear-off with no dependence on a
 * real model's opinion. A reply asked for with `stream: true` is the same choice plus an explanation,
 * sent as OpenAI-compatible SSE in small mid-token pieces, paced at `MOCK_STREAM_DELAY_MS`; `?thinking=1`
 * prepends a `reasoning_content` phase and `?stall=N` hangs after N pieces so a client's idle timeout
 * has something real to fire on.
 *
 * Credentials never leave this process: `Authorization` is compared and then dropped, and the log
 * line for a request carries the path, the status and the model name only.
 */
import { createServer } from 'node:http'

const HOST = process.env.MOCK_PROVIDER_HOST ?? '127.0.0.1'
const PORT = Number(process.env.MOCK_PROVIDER_PORT ?? 4111)
/** The only key this mock accepts; the relay e2e suite sends exactly this one. */
const API_KEY = process.env.MOCK_PROVIDER_KEY ?? 'sk-e2e-not-a-real-key'
const MAX_BODY_BYTES = 1024 * 1024

/** Same shape `src/lib/logger.ts` masks on, reused here so no credential can be echoed. */
const SECRET_SHAPED = /api[-_]?key|authorization|token|secret|password/i

function respond(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)

  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body over the mock limit'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

function authorized(req) {
  return (req.headers.authorization ?? '') === `Bearer ${API_KEY}`
}

/** Report a header by value, except for credential-shaped ones, which are reported by length. */
function redact(name, value) {
  return SECRET_SHAPED.test(name) ? `<${Buffer.byteLength(String(value))} bytes present>` : String(value)
}

function receivedHeaders(req) {
  const out = {}

  for (const [name, value] of Object.entries(req.headers)) {
    out[name] = Array.isArray(value) ? value.map((entry) => redact(name, entry)) : redact(name, value)
  }

  return out
}

function completion(parsed) {
  return {
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof parsed.model === 'string' ? parsed.model : 'mock-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '{"choice": 1}' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 4, total_tokens: 5 },
  }
}

/**
 * The reply cut the way a real model streams it: mid-token, so `{"exp` and `lanation"` can land in
 * separate events. Anything that parses a streamed answer has to survive exactly this, and a mock
 * that sent the whole object in one chunk would prove nothing about the parser.
 */
const STREAM_PIECES = [
  '{"ex', 'planation": "', 'I make my five-point', ' to shut Black in."', ', "cho', 'ice": ', '1', '}',
]

function sseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function streamChunk(parsed, delta, finishReason = null) {
  return {
    id: `chatcmpl-mock-stream-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: typeof parsed.model === 'string' ? parsed.model : 'mock-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    usage: null,
  }
}

/**
 * OpenAI-compatible SSE, matching what DashScope's compatible mode sends: incremental
 * `choices[0].delta.content`, an optional `reasoning_content` phase first, a final chunk with
 * `finish_reason: "stop"`, then - only when the caller asked for it - one chunk carrying `usage`
 * with an empty `choices` array, and last `data: [DONE]`.
 *
 * `MOCK_STREAM_DELAY_MS` paces it. `?thinking=1` adds the reasoning phase; `?stall=N` stops after
 * N content events and leaves the socket open, which is the only way to drive a client's idle
 * timeout from this mock.
 */
function streamCompletion(res, req, parsed, query) {
  const delay = Number(process.env.MOCK_STREAM_DELAY_MS ?? 60)
  const stall = Number(query.get('stall') ?? 0)

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'transfer-encoding': 'chunked',
  })

  const events = []

  if (query.has('thinking')) {
    for (const piece of ['Counting pips... ', 'White is ahead. ']) {
      events.push(streamChunk(parsed, { reasoning_content: piece }))
    }
  }

  STREAM_PIECES.forEach((piece, index) => {
    if (stall > 0 && index >= stall) {
      return
    }
    events.push(streamChunk(parsed, { content: piece }))
  })
  events.push(streamChunk(parsed, { content: '' }, 'stop'))

  if (stall > 0) {
    // Never closed on purpose: an idle timeout has to be what ends this, not the mock.
    console.log(`${String(req.url)} -> stalled after ${stall} content events, stream left open`)
    return new Promise(() => {})
  }

  if (parsed?.stream_options?.include_usage === true) {
    events.push({
      ...streamChunk(parsed, {}),
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: STREAM_PIECES.length, total_tokens: 7 },
    })
  }

  return new Promise((resolve) => {
    let index = 0

    const tick = () => {
      if (index >= events.length) {
        res.write('data: [DONE]\n\n')
        res.end()
        resolve()
        return
      }
      res.write(sseFrame(events[index]))
      index += 1
      setTimeout(tick, delay)
    }

    tick()
  })
}

/** Pure routing: returns what to answer, plus one credential-free line to log about it. */
function route({ method, path, raw, req }) {
  if (path === '/health') {
    return { status: 200, payload: { ok: true }, note: 'ready' }
  }

  if (path === '/v1/chat/completions') {
    if (method !== 'POST') {
      return { status: 405, payload: { error: { message: 'Use POST.' } }, note: 'wrong method' }
    }
    if (!authorized(req)) {
      return {
        status: 401,
        payload: {
          error: { message: 'Invalid API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' },
        },
        note: 'rejected the key',
      }
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { status: 400, payload: { error: { message: 'Body was not JSON.' } }, note: 'unparseable body' }
    }

    // The client asks for SSE by putting `stream: true` in the provider body, which the relay
    // forwards verbatim - so this is the switch the whole D0 probe turns on.
    if (parsed?.stream === true) {
      return {
        stream: true,
        parsed,
        note: `streaming model=${String(parsed.model ?? '')} pieces=${STREAM_PIECES.length}`,
      }
    }

    return {
      status: 200,
      payload: completion(parsed),
      note: `model=${String(parsed?.model ?? '')} messages=${Array.isArray(parsed?.messages) ? parsed.messages.length : 0}`,
    }
  }

  // Shows what the relay actually forwarded, which is the request-header allowlist proven end to end.
  if (path === '/v1/echo') {
    return {
      status: 200,
      payload: { method, headers: receivedHeaders(req), body: raw },
      note: 'echoed',
    }
  }

  // Proves `retry-after` survives the relay, which is why the client can honour a 429.
  if (path === '/v1/rate-limited') {
    return {
      status: 429,
      payload: { error: { message: 'Too many requests.' } },
      headers: { 'retry-after': '3' },
      note: 'rate limited',
    }
  }

  // The relay must refuse to follow this rather than hop on to another path.
  if (path === '/v1/redirect') {
    return {
      status: 302,
      payload: { redirected: true },
      headers: { location: '/v1/chat/completions' },
      note: 'sent a redirect',
    }
  }

  return { status: 404, payload: { error: { message: `No mock route for ${path}` } }, note: 'unknown path' }
}

const server = createServer((req, res) => {
  const method = req.method ?? 'GET'
  const url = new URL(String(req.url ?? '/'), `http://127.0.0.1:${PORT}`)
  const path = url.pathname

  readBody(req)
    .then((raw) => {
      const outcome = route({ method, path, raw, req, query: url.searchParams })
      const status = outcome.stream === true ? 200 : outcome.status
      console.log(`${method} ${path} -> ${status}${outcome.note ? ` (${outcome.note})` : ''}`)

      if (outcome.stream === true) {
        void streamCompletion(res, req, outcome.parsed, url.searchParams)
        return
      }

      respond(res, outcome.status, outcome.payload, outcome.headers)
    })
    .catch(() => {
      console.log(`${method} ${path} -> 413 (body over ${MAX_BODY_BYTES} bytes)`)
      respond(res, 413, { error: { message: 'Mock provider: request body too large.' } })
    })
})

// No CORS headers anywhere in the handler, on purpose: this mock is reachable only through the relay.
server.listen(PORT, HOST, () => {
  console.log(`mock provider listening on http://${HOST}:${PORT}/v1/chat/completions`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}

