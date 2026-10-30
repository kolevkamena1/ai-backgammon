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
}

export interface ProxyPolicy {
  /** Exact hostnames (lower-case, no ports). Empty list + `allowPrivateTargets` = anything. */
  readonly allowedHosts: readonly string[]
  /** Dev only: permits loopback/private hosts and plain http. A browser could reach those itself. */
  readonly allowPrivateTargets: boolean
  readonly timeoutMs: number
  readonly maxRequestBytes: number
  readonly maxResponseBytes: number
}

/** A finished response, expressed without committing to `Response` from any one runtime. */
export interface ProxyOutcome {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
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

export const PRODUCTION_POLICY: ProxyPolicy = {
  allowedHosts: DEFAULT_ALLOWED_HOSTS,
  allowPrivateTargets: false,
  timeoutMs: RELAY_TIMEOUT_MS,
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
 */
const RELAY_REQUEST_HEADERS: readonly string[] = [
  'authorization',
  'content-type',
  'x-api-key',
  'x-goog-api-key',
  'anthropic-version',
  'anthropic-dangerous-direct-browser-access',
]

const defaultFetch: ProxyFetch = (url, init) => globalThis.fetch(url, init)

function jsonRejection(status: number, code: ProxyRejectCode, message: string): ProxyOutcome {
  return {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': NO_STORE, 'x-ai-proxy-error': code },
    body: JSON.stringify({ error: { code, message } }),
  }
}

function relayOutcome(status: number, headers: ProxyUpstreamResponse['headers'], body: string): ProxyOutcome {
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

  return { status, headers: out, body }
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

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return jsonRejection(400, 'bad-request', 'The request body could not be read.')
  }

  if (raw.length > policy.maxRequestBytes) {
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

  const target = classifyTarget(targetUrl, policy)
  if (target.ok === false) {
    return jsonRejection(403, 'target-not-allowed', target.reason)
  }

  const headers = readEnvelopeHeaders((rawHeaders ?? {}) as Record<string, unknown>)
  const signal = AbortSignal.timeout(policy.timeoutMs)

  let upstream: ProxyUpstreamResponse
  try {
    upstream = await fetchImpl(target.url.toString(), { method: 'POST', headers, body, redirect: 'manual', signal })
  } catch {
    // Only the signal matters: whether it aborted (timeout) or the socket failed.
    const timedOut = signal.aborted
    // No logging here: this module is bundled for the edge, where the app logger does not exist,
    // and the reason string could be echoed into a response. The outcome's code is the signal.
    return timedOut
      ? jsonRejection(504, 'gateway-timeout', `The provider did not answer within ${Math.round(policy.timeoutMs / 1000)}s.`)
      : jsonRejection(502, 'bad-gateway', 'The provider could not be reached from the proxy.')
  }

  // Following a redirect would let an allowlisted host hop to an internal one.
  if (upstream.status >= 300 && upstream.status < 400) {
    return jsonRejection(403, 'target-not-allowed', 'The provider responded with a redirect, which the proxy will not follow.')
  }

  let text: string
  try {
    text = await upstream.text()
  } catch {
    return jsonRejection(502, 'bad-gateway', 'The provider response body could not be read.')
  }

  if (text.length > policy.maxResponseBytes) {
    return jsonRejection(413, 'response-too-large', 'The provider response was too large to relay.')
  }

  return relayOutcome(upstream.status, upstream.headers, text)
}
