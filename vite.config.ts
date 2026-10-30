import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
// defineConfig from vitest/config is Vite's, widened with the `test` block, so the alias below
// stays the single source of truth for both the app and the test run.
import { defineConfig, type Plugin } from 'vitest/config'
import { DEV_POLICY, handleProxyRequest, type ProxyIncomingRequest } from './shared/aiProxy.ts'

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
 */
function aiProxyDevMiddleware(): Plugin {
  return {
    name: 'ai-proxy-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(AI_PROXY_PATH, (req, res) => {
        const chunks: Buffer[] = []

        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('error', () => res.end())
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const request: ProxyIncomingRequest = {
            method: req.method ?? 'POST',
            headers: {
              get: (name) => {
                const value = req.headers[name.toLowerCase()]
                return typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? null) : null
              },
            },
            text: async () => raw,
          }

          handleProxyRequest(request, DEV_POLICY)
            .then((outcome) => {
              res.writeHead(outcome.status, outcome.headers)
              res.end(outcome.body)
            })
            .catch(() => {
              res.writeHead(500, { 'content-type': 'application/json', 'x-ai-proxy-error': 'bad-gateway' })
              res.end(JSON.stringify({ error: { code: 'bad-gateway', message: 'The local AI proxy failed.' } }))
            })
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
