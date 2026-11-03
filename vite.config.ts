import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
// defineConfig from vitest/config is Vite's, widened with the `test` block, so the alias below
// stays the single source of truth for both the app and the test run.
import { defineConfig, type Plugin } from 'vitest/config'
import { DEV_POLICY, handleProxyRequest, jsonRejection, type ProxyIncomingRequest, type ProxyOutcome } from './shared/aiProxy.ts'

// Must match `functions/api/ai-proxy/[[path]].ts` and `AI_PROXY_PATH` in the AI client.
const AI_PROXY_PATH = '/api/ai-proxy'

/**
 * The envelope carries a per-request `targetUrl`, which a static `server.proxy` entry cannot
 * express: its target is fixed at config time. Mounting the same runtime-agnostic core that the
 * Cloudflare Pages Function uses keeps dev and production answering identically, so a provider
 * that works locally also works at the edge.
 *
 * `apply: 'serve'` restricts this to `npm run dev`: `npm run preview` serves the built bundle
 * without any proxy, so only a deployed Pages site (or `wrangler pages dev`) exercises the
 * production policy.
 *
 * "Answering identically" is load-bearing, not a nice-to-have. `DEV_POLICY` deliberately reaches
 * private hosts and plain `http`, and this port is reachable from every page the developer has open,
 * so the cross-origin guard and the envelope size cap are enforced by the shared core and inherited
 * here — the middleware supplies `url` for the guard and refuses a body mid-upload rather than
 * buffering one. A bug fixed only at the edge would otherwise never show up until a visitor hit it.
 */
function aiProxyDevMiddleware(): Plugin {
  return {
    name: 'ai-proxy-dev',
    apply: 'serve',
    configureServer(server) {
      // The core compares an `Origin` against the URL this relay was addressed at, and a connect
      // middleware sees `req.url` with the mount path already stripped, so the dev origin is rebuilt
      // from the Host header. `server.config.server.https` is the honest source of the scheme —
      // `req.socket.encrypted` is not even declared on a plain `net.Socket`.
      const scheme = server.config.server.https ? 'https' : 'http'

      server.middlewares.use(AI_PROXY_PATH, (req, res) => {
        const chunks: Buffer[] = []
        let received = 0
        let answered = false

        /**
         * Refuse on behalf of the core, once. `res.writeHead` twice is a fatal
         * `ERR_HTTP_HEADERS_SENT` inside Node and the process dies with it, which is why every answer
         * on this socket goes through a flag rather than straight to `res`.
         */
        const rejectEarly = (outcome: ProxyOutcome): void => {
          if (answered) {
            return
          }
          answered = true
          res.writeHead(outcome.status, outcome.headers)
          res.end(outcome.body)
        }

        req.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk))
          received += chunk.length
          if (received > DEV_POLICY.maxRequestBytes) {
            // Stop reading rather than buffer to the end. The core caps the envelope at 64 KB, but it
            // can only measure a body it has already fully read, and an unbounded accumulation here is
            // a memory DoS on the developer's own machine. `jsonRejection` is exported from the core so
            // this refusal is byte-identical to the one the edge would produce.
            rejectEarly(jsonRejection(413, 'request-too-large', 'The request envelope is too large.'))
            req.destroy()
          }
        })
        req.on('error', () => {
          // Abandoned upload: ours after the cap above, or the client's. When it is ours, the refusal
          // is already on its way and touching `res` again would be the fatal double-write.
          if (!answered) {
            res.end()
          }
        })
        req.on('end', () => {
          if (answered) {
            return
          }
          const raw = Buffer.concat(chunks).toString('utf8')
          const request: ProxyIncomingRequest = {
            method: req.method ?? 'POST',
            url: `${scheme}://${req.headers.host ?? 'localhost'}${req.url ?? ''}`,
            headers: {
              get: (name) => {
                const value = req.headers[name.toLowerCase()]
                return typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? null) : null
              },
            },
            text: async () => raw,
          }

          // Safety net above all three branches. `res.writeHead` twice is a fatal `ERR_HTTP_HEADERS_SENT`
          // inside Node, and the process dies with it - which is exactly how the first live probe of the
          // streaming branch took the dev server down. Any late failure on a response that has already
          // answered therefore destroys the socket instead of answering it again.
          const failLate = (): void => {
            if (res.headersSent || res.writableEnded) {
              res.destroy()
              return
            }
            res.writeHead(500, {
              'content-type': 'application/json',
              'cache-control': 'no-store',
              'x-ai-proxy-error': 'bad-gateway',
            })
            res.end(JSON.stringify({ error: { code: 'bad-gateway', message: 'The local AI proxy failed.' } }))
          }

          handleProxyRequest(request, DEV_POLICY)
            .then((outcome) => {
              const stream = outcome.stream

              if (stream !== undefined && stream !== null) {
                // The streaming branch mirrors the Pages Function: bytes go straight to the socket, so
                // `npm run dev` and production behave alike and a stream bug can never be dev-only.
                //
                // Pumped by hand rather than with `Readable.fromWeb(...).pipe(res)`, because the core's
                // stream is a structural `{ getReader() }` and Node brand-checks its streams just like
                // workerd does. Piping also brings a `close` event that races the end of the response;
                // writing directly keeps every exit path in this one function.
                res.writeHead(outcome.status, outcome.headers)
                res.flushHeaders()

                const reader = stream.getReader()
                const stopPulling = (): void => {
                  // Stopping the pull is what ends the upstream request: a player who closes the tab must
                  // not leave a model generating into a socket nobody will read.
                  try {
                    void Promise.resolve(reader.cancel('dev relay: client stopped reading')).catch(() => undefined)
                  } catch {
                    // A reader the runtime already closed has nothing left to cancel.
                  }
                }

                const pump = async (): Promise<void> => {
                  for (;;) {
                    const chunk = await reader.read()

                    if (chunk.done === true) {
                      break
                    }
                    if (chunk.value === undefined) {
                      continue
                    }
                    // Respect backpressure, or a fast provider outruns a slow client.
                    if (!res.write(chunk.value)) {
                      await new Promise<void>((resolve) => res.once('drain', () => resolve()))
                    }
                  }
                  res.end()
                }

                pump().catch(() => {
                  stopPulling()
                  res.destroy()
                })
                res.once('close', () => {
                  if (!res.writableFinished) {
                    stopPulling()
                  }
                })
                return
              }

              res.writeHead(outcome.status, outcome.headers)
              res.end(outcome.body)
            })
            .catch(failLate)
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Cloudflare Pages serves this site from the root of `<project>.pages.dev` (or a custom
  // domain), so asset URLs must stay absolute. A relative base ('./') would break once the
  // `public/_redirects` SPA fallback serves index.html for an unknown deep link, because
  // './assets/...' would resolve against the fake path segment instead of the site root.
  base: '/',
  plugins: [react(), tailwindcss(), aiProxyDevMiddleware()],
  resolve: {
    // Mirrors "paths" in tsconfig.app.json so `tsc -b` and Vite agree on '@/...'.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
  test: {
    // The rules engine is pure, so no DOM environment (and no jsdom dependency) is needed.
    environment: 'node',
    // `shared/` holds the proxy core, which runs in Node and at the edge. Both suites are plain TS.
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts'],
  },
})
