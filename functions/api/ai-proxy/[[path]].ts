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
 *
 * Defense-in-depth: cross-origin browser requests (Sec-Fetch-Site: cross-site or mismatched Origin)
 * are rejected to prevent third-party sites from using this endpoint as an open proxy relay.
 */
export const onRequest = async ({ request, env }: PagesContext): Promise<Response> => {
  const origin = request.headers.get('origin')
  const secFetchSite = request.headers.get('sec-fetch-site')

  if (secFetchSite === 'cross-site') {
    return new Response(
      JSON.stringify({ error: { code: 'target-not-allowed', message: 'Cross-origin requests are not permitted.' } }),
      {
        status: 403,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-ai-proxy-error': 'target-not-allowed' },
      },
    )
  }

  // A sandboxed or opaque-origin document sends the literal string "null" here, and the relay must
  // not serve it: every legitimate caller is an ordinary same-origin fetch made by this site's own
  // document, which always sends a concrete Origin. The telemetry sink has to accept "null" because
  // a sendBeacon can arrive that way; the relay has no such excuse, and an opaque origin is exactly
  // the shape a hostile embedder would use to drive this endpoint on someone else's behalf.
  if (origin === 'null') {
    return new Response(
      JSON.stringify({ error: { code: 'target-not-allowed', message: 'An opaque origin is not permitted.' } }),
      {
        status: 403,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-ai-proxy-error': 'target-not-allowed' },
      },
    )
  }

  // `origin === 'null'` never reaches here: it is refused above, so this comparison only has to
  // catch a concrete origin belonging to somebody else.
  if (origin !== null && origin !== '') {
    try {
      if (new URL(origin).host !== new URL(request.url).host) {
        return new Response(
          JSON.stringify({ error: { code: 'target-not-allowed', message: 'Cross-origin requests are not permitted.' } }),
          {
            status: 403,
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-ai-proxy-error': 'target-not-allowed' },
          },
        )
      }
    } catch {
      return new Response(
        JSON.stringify({ error: { code: 'bad-request', message: 'The Origin header is not a valid URL.' } }),
        {
          status: 400,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-ai-proxy-error': 'bad-request' },
        },
      )
    }
  }

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
