import {
  PRODUCTION_POLICY,
  handleProxyRequest,
  parseAllowedHosts,
  type ProxyPolicy,
  type ProxyStream,
} from '../../../shared/aiProxy.ts'

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
 * Turn the core's structural stream into one the runtime will accept as a response body.
 *
 * Required, not cosmetic: the Pages runtime brand-checks `ReadableStream`, so a duck-typed
 * `{ getReader() }` object handed to `new Response(...)` is coerced to the string
 * `"[object Object]"` rather than rejected. Measured, not guessed — that is exactly what the first
 * end-to-end probe of this route returned. Pumping through the global constructor produces a real
 * stream and keeps the core free of any runtime's types.
 */
function toBrandedStream(stream: ProxyStream): ReadableStream<Uint8Array> {
  const reader = stream.getReader()

  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      const chunk = await reader.read()

      if (chunk.done === true) {
        controller.close()
        return
      }
      if (chunk.value !== undefined) {
        controller.enqueue(chunk.value)
      }
    },
    cancel(reason: unknown): void {
      // Fire-and-forget: the runtime only cares that the source let go of the upstream, and a reader
      // that rejects on cancel must not turn into an unhandled rejection inside a stream callback.
      void reader.cancel(reason)
    },
  })
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

  // A streamed outcome is a byte-by-byte pass-through: the client receives the provider's chunks as
  // they arrive and nothing is held in Function memory. The cast at the boundary exists because
  // `shared/aiProxy.ts` types the stream structurally — the module is compiled against two different
  // global `ReadableStream`s and naming either there would mean something different in each.
  if (outcome.stream !== undefined && outcome.stream !== null) {
    return new Response(toBrandedStream(outcome.stream), {
      status: outcome.status,
      headers: outcome.headers,
    })
  }

  return new Response(outcome.body, { status: outcome.status, headers: outcome.headers })
}
