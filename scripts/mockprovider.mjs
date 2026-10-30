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
 * Every chat reply is `{"choice": 1}` - the first entry of the legal-move menu. That makes the
 * AI-vs-AI end-to-end game deterministic and guaranteed to reach a bear-off with no dependence on a
 * real model's opinion.
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
  const path = String(req.url ?? '').split('?')[0]

  readBody(req)
    .then((raw) => {
      const outcome = route({ method, path, raw, req })
      console.log(`${method} ${path} -> ${outcome.status}${outcome.note ? ` (${outcome.note})` : ''}`)
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

