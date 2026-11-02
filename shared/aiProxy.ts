/**
 * The CORS-relay core, shared by two runtimes:
 *
 *   - `vite.config.ts` mounts it as a dev-server middleware on `/api/ai-proxy`;
 *   - `functions/api/ai-proxy/[[path]].ts` mounts it as a Cloudflare Pages Function.
 *
 * It is deliberately runtime-agnostic: no `node:*` imports, no Workers types, no SDKs. Both
 * callers hand in a structural request object and adapt the returned `ProxyOutcome` to their own
 * response type, which is also what makes the whole thing unit-testable with an injected `fetch`.
 *
 * Security stance: the client is a browser the user controls, and the key is theirs, so passing
 * `Authorization` through is fine. What is NOT fine is fetching an arbitrary `targetUrl`: this
 * endpoint is public, so without the allowlist below it would be an open SSRF relay that anyone
 * could drive through this project's Cloudflare account. Hence: https-only, exact-host allowlist,
 * no userinfo, no IP literals, redirects never followed, size caps, and no credential logging.
 */

/** Envelope the client POSTs: what to fetch, with which headers, and what to send. */
export interface ProxyEnvelope {
  targetUrl: string
  headers: Record<string, string>
  body: string
  /**
   * Ask the relay to pipe the upstream body through instead of buffering it. Optional and strictly
   * boolean: it changes only how the response travels, never where the request goes, so it cannot
   * move a byte past `classifyTarget`'s allowlist.
   */
  stream?: boolean
}

export interface ProxyPolicy {
  /** Exact hostnames (lower-case, no ports). Empty list + `allowPrivateTargets` = anything. */
  readonly allowedHosts: readonly string[]
  /** Dev only: permits loopback/private hosts and plain http. A browser could reach those itself. */
  readonly allowPrivateTargets: boolean
  readonly timeoutMs: number
  /**
   * Wall-clock ceiling for a streamed exchange, which has to outlast `timeoutMs`: one abort signal
   * covers the whole subrequest including the body, so a buffered 65 s ceiling would cut a long
   * answer off mid-sentence. Chosen to stay above the client's own streaming budget
   * (`AI_STREAM_TOTAL_MS` in `src/utils/aiClient.ts`), keeping the ordering the client relies on.
   */
  readonly streamTimeoutMs: number
  /** Cap on a streamed body. Generous because piping it costs the relay no memory at all. */
  readonly maxStreamBytes: number
  readonly maxRequestBytes: number
  readonly maxResponseBytes: number
}

/**
 * A readable byte stream, declared structurally on purpose. `shared/` is compiled by
 * `tsconfig.node.json` (`types: node`, no DOM lib) *and* pulled into the app program through
 * `src/utils/__tests__/aiClient.test.ts` (`lib: DOM`) — and in the node program the global
 * `ReadableStream` is `@types/node`'s legacy `EventEmitter`-flavoured one, not the web stream. Naming
 * either here would typecheck in one program and mean something else in the other.
 */
export interface ProxyStreamChunk {
  readonly done: boolean
  readonly value?: Uint8Array
}

export interface ProxyStreamReader {
  read(): Promise<ProxyStreamChunk>
  cancel(reason?: unknown): unknown
}

export interface ProxyStream {
  /** A web stream hands out one reader at a time; each mount reads its outcome exactly once. */
  getReader(): ProxyStreamReader
}

/** A finished response, expressed without committing to `Response` from any one runtime. */
export interface ProxyOutcome {
  readonly status: number
  readonly headers: Record<string, string>
  /**
   * The buffered body. Empty when `stream` is set — the bytes are on their way instead, which is why
   * this stays a string rather than becoming an optional field two mounts have to discriminate.
   */
  readonly body: string
  /** Present only when the client asked for a stream and the upstream answered with a body. */
  readonly stream?: ProxyStream
}

/** The slice of the incoming request the core reads. */
export interface ProxyIncomingRequest {
  readonly method: string
  readonly headers: { get(name: string): string | null }
  text(): Promise<string>
}

export interface ProxyUpstreamInit {
  method: 'POST'
  headers: Record<string, string>
  body: string
  redirect: 'manual'
  signal?: AbortSignal
}

export interface ProxyUpstreamResponse {
  readonly status: number
  readonly headers: { get(name: string): string | null }
  /** Every runtime that can stream supplies one; the buffered path never looks at it. */
  readonly body?: ProxyStream | null
  text(): Promise<string>
}

export type ProxyFetch = (url: string, init: ProxyUpstreamInit) => Promise<ProxyUpstreamResponse>

/** Where the relay refused, in machine-readable form. Surfaced to the client as `proxy-blocked`. */
export type ProxyRejectCode =
  | 'bad-request'
  | 'method-not-allowed'
  | 'target-not-allowed'
  | 'request-too-large'
  | 'response-too-large'
  | 'bad-gateway'
  | 'gateway-timeout'

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  // Alibaba DashScope, China and International regions. Both are the OpenAI-compatible path.
  'dashscope.aliyuncs.com',
  'dashscope-intl.aliyuncs.com',
  // Model Studio workspace hosts (`<name>.<region>.maas.aliyuncs.com`), which newer accounts are
  // pointed at instead of the two above. This is one exact host, deliberately not a suffix: the
  // allowlist is the only thing stopping a public Function from becoming an SSRF relay, and other
  // tenants have their own hosts - that is what AI_PROXY_ALLOWED_HOSTS exists for.
  'token-plan.ap-southeast-1.maas.aliyuncs.com',
]

const KB = 1024

/**
 * How long the relay waits for a provider before giving up. This has to sit **above** the client's
 * `AI_TIMEOUT_MS` (`src/utils/aiClient.ts`): if the relay aborts first, the player is told the proxy
 * failed when the browser was still perfectly willing to wait, and the provider's own answer - which
 * may be a 429 carrying a `Retry-After` - is thrown away. 5 s of headroom.
 *
 * 65 s is comfortably affordable at the edge: Cloudflare documents no hard wall-clock limit on an
 * incoming HTTP request while the client stays connected, and awaiting a subrequest costs no CPU
 * time, so a slow reasoning model does not bump into the CPU quota.
 */
const RELAY_TIMEOUT_MS = 65_000

/**
 * A streamed exchange gets a longer ceiling than a buffered one, because the same abort signal also
 * covers the body: at 65 s a reply that keeps trickling would be cut off mid-sentence. 90 s still
 * stays above the client's `AI_STREAM_TOTAL_MS`, so the browser is the one that gives up first.
 */
const RELAY_STREAM_TIMEOUT_MS = 90_000

/**
 * The streamed cap is four times the buffered one, and larger costs nothing: buffered bytes had to be
 * held in memory to be measured, piped bytes do not. SSE framing also repeats the envelope around
 * every fragment, so a few hundred short deltas are already hundreds of kilobytes on the wire.
 */
const MAX_STREAM_BYTES = 4 * KB * KB

export const PRODUCTION_POLICY: ProxyPolicy = {
  allowedHosts: DEFAULT_ALLOWED_HOSTS,
  allowPrivateTargets: false,
  timeoutMs: RELAY_TIMEOUT_MS,
  streamTimeoutMs: RELAY_STREAM_TIMEOUT_MS,
  maxStreamBytes: MAX_STREAM_BYTES,
  maxRequestBytes: 64 * KB,
  maxResponseBytes: KB * KB,
}

/**
 * Dev is the user's own machine, already reachable from their browser, so the host list is not a
 * security boundary here. The same generous ceiling also means a local model that needs 40 s to load
 * a model into memory never turns into a proxy failure stacked on top of a client failure.
 */
export const DEV_POLICY: ProxyPolicy = {
  allowedHosts: DEFAULT_ALLOWED_HOSTS,
  allowPrivateTargets: true,
  timeoutMs: RELAY_TIMEOUT_MS,
  streamTimeoutMs: RELAY_STREAM_TIMEOUT_MS,
  maxStreamBytes: MAX_STREAM_BYTES,
  maxRequestBytes: 64 * KB,
  maxResponseBytes: KB * KB,
}

/** Only these headers are relayed back. Notably `retry-after`, which the AI client reads. */
const RELAY_RESPONSE_HEADERS: readonly string[] = ['content-type', 'retry-after', 'x-request-id']

/**
 * A relayed answer can be a provider 401 or 429 that describes an account, so nothing here may be
 * cached. `public/_headers` cannot do this job: Cloudflare documents that `_headers` rules are not
 * applied to responses generated by Pages Functions, so the header has to ride on the outcome and
 * both mounts inherit it.
 */
const NO_STORE = 'no-store'

/**
 * Headers a caller may ask to be forwarded to the provider. Everything else is dropped.
 * The entries double as the canonical output spelling, so they are kept lower-case: an incoming
 * name is matched after `toLowerCase()`, which is how RFC 9110 says header fields match.
 *
 * `accept` is here because a client asking for SSE has to be able to say so: several OpenAI-compatible
 * gateways only switch to `text/event-stream` when the request asks for it. It is an end-to-end
 * content-negotiation header, carries no credential and cannot influence which host is contacted, so
 * forwarding it does not widen the SSRF surface one inch.
 */
const RELAY_REQUEST_HEADERS: readonly string[] = [
  'authorization',
  'content-type',
  'accept',
  'x-api-key',
  'x-goog-api-key',
  'anthropic-version',
  'anthropic-dangerous-direct-browser-access',
]

const defaultFetch: ProxyFetch = (url, init) => globalThis.fetch(url, init)
const utf8Encoder = new TextEncoder()

function utf8Bytes(text: string): number {
  return utf8Encoder.encode(text).byteLength
}

function jsonRejection(status: number, code: ProxyRejectCode, message: string): ProxyOutcome {
  return {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': NO_STORE, 'x-ai-proxy-error': code },
    body: JSON.stringify({ error: { code, message } }),
  }
}

/**
 * Which response headers survive the relay, plus the two the relay always sets. Split out because a
 * streamed outcome needs exactly the same rules as a buffered one, and a divergence between them
 * would mean a streaming provider response could escape the `no-store` that keeps a keyed answer out
 * of a shared cache.
 */
function relayHeaders(headers: ProxyUpstreamResponse['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of RELAY_RESPONSE_HEADERS) {
    const value = headers.get(name)
    if (value !== null) {
      out[name] = value
    }
  }
  if (out['content-type'] === undefined) {
    out['content-type'] = 'application/json'
  }
  // Set last so a provider's own `cache-control` (not in the relay allowlist) can never survive.
  out['cache-control'] = NO_STORE

  return out
}

function relayOutcome(status: number, headers: ProxyUpstreamResponse['headers'], body: string): ProxyOutcome {
  return { status, headers: relayHeaders(headers), body }
}

/**
 * Count bytes as they pass and stop the stream at the cap, without ever holding the body.
 *
 * Crossing the cap cannot become a `413` any more: the status line and headers are already on the
 * wire by then, so the only honest signal left is to end the stream. The client sees a truncated
 * exchange and fails the turn with `bad-response` rather than playing a half-parsed move — the same
 * outcome the buffered path's 413 produced, one layer down.
 */
export function capStream(inner: ProxyStream, maxBytes: number): ProxyStream {
  return {
    getReader: (): ProxyStreamReader => {
      const reader = inner.getReader()
      let seen = 0
      let finished = false

      return {
        async read(): Promise<ProxyStreamChunk> {
          if (finished) {
            return { done: true }
          }

          const chunk = await reader.read()
          const bytes = chunk.value?.byteLength ?? 0
          seen += bytes

          if (seen > maxBytes) {
            finished = true
            // Do not leave the upstream running behind a stream nobody will read again.
            void reader.cancel('proxy response over the relay limit')
            return { done: true }
          }

          if (chunk.done === true) {
            finished = true
          }

          return { done: chunk.done === true, value: chunk.value }
        },
        cancel: (reason?: unknown): unknown => reader.cancel(reason),
      }
    },
  }
}

function relayStreamOutcome(
  status: number,
  headers: ProxyUpstreamResponse['headers'],
  stream: ProxyStream,
  maxBytes: number,
): ProxyOutcome {
  return { status, headers: relayHeaders(headers), body: '', stream: capStream(stream, maxBytes) }
}

/** Merges `AI_PROXY_ALLOWED_HOSTS` (comma or space separated) over the defaults. */
export function parseAllowedHosts(raw: string | undefined | null, base: readonly string[] = DEFAULT_ALLOWED_HOSTS): string[] {
  const extra = (raw ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)

  return Array.from(new Set([...base, ...extra]))
}

/** Anything a browser could not sensibly reach, or that smells like a cloud metadata endpoint. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '')

  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '::') {
    return true
  }
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) {
    return true
  }
  // 172.16.0.0 - 172.31.255.255
  const seventeen = /^172\.(\d+)\./.exec(host)
  if (seventeen !== null) {
    const second = Number(seventeen[1])
    return second >= 16 && second <= 31
  }

  // IPv6 unique-local and link-local ranges.
  return /^(f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(host)
}

function isIpLiteral(hostname: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')
}

/**
 * Validate the requested target against the policy. Returns the parsed URL when allowed, or a
 * human-readable reason. Every rejection path is a `target-not-allowed` 403.
 */
export function classifyTarget(
  targetUrl: string,
  policy: ProxyPolicy,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL

  try {
    url = new URL(targetUrl)
  } catch {
    return { ok: false, reason: 'targetUrl is not an absolute URL.' }
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && policy.allowPrivateTargets)) {
    return { ok: false, reason: 'Only https targets are permitted.' }
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, reason: 'Credentials in the target URL are not permitted.' }
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')

  if (hostname.length === 0) {
    return { ok: false, reason: 'The target URL has no host.' }
  }
  if (policy.allowPrivateTargets) {
    return { ok: true, url }
  }
  if (isIpLiteral(hostname) || isPrivateHost(hostname)) {
    return { ok: false, reason: 'Local and private addresses cannot be reached from the edge.' }
  }
  // Exact match only: a suffix check would let `api.openai.com.attacker.test` through.
  if (!policy.allowedHosts.includes(hostname)) {
    return { ok: false, reason: `The host ${hostname} is not in the proxy allowlist.` }
  }

  return { ok: true, url }
}

function readEnvelopeHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}

  // Header field names are case-insensitive, so `Authorization` and `authorization` name the same
  // field and both have to reach the provider. Matching on the raw key silently dropped a
  // capitalised credential, and the provider then reported it as missing. The canonical lower-case
  // form is what goes upstream, because HTTP/2 requires it and it keeps the default check below
  // meaningful. A later duplicate wins, matching plain-object spread semantics.
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase()
    if (!RELAY_REQUEST_HEADERS.includes(name)) {
      continue
    }
    if (typeof value === 'string' && value.length > 0) {
      out[name] = value
    }
  }
  if (out['content-type'] === undefined) {
    out['content-type'] = 'application/json'
  }

  return out
}

/**
 * One proxied request. Never throws: every failure becomes a `ProxyOutcome` carrying
 * `x-ai-proxy-error` so the client can tell a relay refusal apart from a provider response.
 */
export async function handleProxyRequest(
  request: ProxyIncomingRequest,
  policy: ProxyPolicy,
  fetchImpl: ProxyFetch = defaultFetch,
): Promise<ProxyOutcome> {
  if (request.method !== 'POST') {
    return jsonRejection(405, 'method-not-allowed', 'The AI proxy only accepts POST requests.')
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonRejection(400, 'bad-request', 'The AI proxy expects a JSON envelope.')
  }

  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > policy.maxRequestBytes) {
    return jsonRejection(413, 'request-too-large', 'The request envelope is too large.')
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return jsonRejection(400, 'bad-request', 'The request body could not be read.')
  }

  if (utf8Bytes(raw) > policy.maxRequestBytes) {
    return jsonRejection(413, 'request-too-large', 'The request envelope is too large.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return jsonRejection(400, 'bad-request', 'The request envelope is not valid JSON.')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return jsonRejection(400, 'bad-request', 'The request envelope must be an object.')
  }

  const record = parsed as Record<string, unknown>
  const { targetUrl } = record
  const rawHeaders = record.headers
  const { body } = record

  if (typeof targetUrl !== 'string' || typeof body !== 'string') {
    return jsonRejection(400, 'bad-request', 'The envelope needs string targetUrl and body fields.')
  }
  if (rawHeaders !== undefined && (typeof rawHeaders !== 'object' || rawHeaders === null)) {
    return jsonRejection(400, 'bad-request', 'The envelope headers must be an object of strings.')
  }
  // Validated before the target is even classified: a malformed envelope is a bad request whether or
  // not the host would have been allowed, and the flag is only ever a boolean.
  if (record.stream !== undefined && typeof record.stream !== 'boolean') {
    return jsonRejection(400, 'bad-request', 'The envelope stream flag must be a boolean.')
  }
  const wantsStream = record.stream === true

  const target = classifyTarget(targetUrl, policy)
  if (target.ok === false) {
    return jsonRejection(403, 'target-not-allowed', target.reason)
  }

  const headers = readEnvelopeHeaders((rawHeaders ?? {}) as Record<string, unknown>)
  // One signal covers the whole exchange including the body, so the ceiling has to match the shape of
  // the answer the client is expecting. Decided here, before the fetch, because a signal created after
  // the headers arrive cannot retroactively protect a stream that is already running.
  const activeTimeoutMs = wantsStream ? policy.streamTimeoutMs : policy.timeoutMs
  const signal = AbortSignal.timeout(activeTimeoutMs)

  let upstream: ProxyUpstreamResponse
  try {
    upstream = await fetchImpl(target.url.toString(), { method: 'POST', headers, body, redirect: 'manual', signal })
  } catch {
    // Only the signal matters: whether it aborted (timeout) or the socket failed.
    const timedOut = signal.aborted
    // No logging here: this module is bundled for the edge, where the app logger does not exist,
    // and the reason string could be echoed into a response. The outcome's code is the signal.
    return timedOut
      ? jsonRejection(504, 'gateway-timeout', `The provider did not answer within ${Math.round(activeTimeoutMs / 1000)}s.`)
      : jsonRejection(502, 'bad-gateway', 'The provider could not be reached from the proxy.')
  }

  // Following a redirect would let an allowlisted host hop to an internal one.
  if (upstream.status >= 300 && upstream.status < 400) {
    return jsonRejection(403, 'target-not-allowed', 'The provider responded with a redirect, which the proxy will not follow.')
  }

  // Streamed only for a successful answer the client asked to be streamed, and only when the runtime
  // handed over a body. Errors deliberately stay buffered JSON: the client has to read the status and
  // `retry-after` from a whole response, and a half-streamed 429 would hide the very header the retry
  // policy needs. Not keyed on `content-type` either - some gateways answer a `stream: true` request
  // with ordinary JSON, and piping those bytes is still correct, because the client reads the type.
  const upstreamStream = upstream.body
  const accepted = upstream.status >= 200 && upstream.status < 300
  if (wantsStream && accepted && upstreamStream !== undefined && upstreamStream !== null) {
    return relayStreamOutcome(upstream.status, upstream.headers, upstreamStream, policy.maxStreamBytes)
  }

  let text: string
  try {
    text = await upstream.text()
  } catch {
    return jsonRejection(502, 'bad-gateway', 'The provider response body could not be read.')
  }

  if (utf8Bytes(text) > policy.maxResponseBytes) {
    return jsonRejection(413, 'response-too-large', 'The provider response was too large to relay.')
  }

  return relayOutcome(upstream.status, upstream.headers, text)
}
