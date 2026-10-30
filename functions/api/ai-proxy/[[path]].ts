import { PRODUCTION_POLICY, handleProxyRequest, parseAllowedHosts, type ProxyPolicy } from '../../../shared/aiProxy.ts'

/**
 * Cloudflare Pages Function for `POST /api/ai-proxy`, sharing `shared/aiProxy.ts` with the Vite dev
 * middleware so a provider that works locally also works at the edge.
 *
 * Declared structurally rather than through `@cloudflare/workers-types`: the Pages runtime provides
 * these globals, and keeping that dependency out means `npm run typecheck` covers this file like any
 * other source instead of needing a Workers-specific tsconfig.
 */
interface PagesContext {
  request: Request
  /** Pages binds environment variables (dashboard or `.env`) here, untyped by design. */
  env: Record<string, string | undefined>
}

function policy(env: Record<string, string | undefined>): ProxyPolicy {
  const configured = env.AI_PROXY_ALLOWED_HOSTS

  return configured === undefined
    ? PRODUCTION_POLICY
    : { ...PRODUCTION_POLICY, allowedHosts: parseAllowedHosts(configured) }
}

/**
 * Same-origin by construction: Pages serves the app and this route from one host, so no
 * `Access-Control-Allow-Origin` is emitted anywhere. A wildcard would hand every website the
 * visitor opens a relay for that visitor's own keys.
 */
export const onRequest = async ({ request, env }: PagesContext): Promise<Response> => {
  const outcome = await handleProxyRequest(
    { method: request.method, headers: request.headers, text: () => request.text() },
    policy(env),
  )

  return new Response(outcome.body, { status: outcome.status, headers: outcome.headers })
}
