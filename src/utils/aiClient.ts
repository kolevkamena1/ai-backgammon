import type { AiCallOptions, AiErrorCode, AiMoveFailure, AiRequestInit, AiResponse, AiResult, FetchLike } from '@/types/ai'
import type { BoardState, DieFace, Move, MoveSource, MoveTarget, PlayerColor } from '@/types/game'
import type { AiDifficulty, AiEngineConfig, AiProvider } from '@/types/settings'
import { logger } from '@/lib/logger'
import { buildMovePrompt } from '@/utils/aiPrompt'
import { POINT_COUNT, getLegalMoves } from '@/utils/gameLogic'
import { difficultyOf, validateEngine } from '@/utils/gameConfig'

/**
 * The inference transport. Provider-agnostic entry point `getAiMove()` routes to one handler per
 * `AiProvider` using the native `fetch` API, and **always resolves**: every failure path (timeout,
 * 401/429, malformed JSON, illegal move) comes back as a typed `AiResult` instead of throwing.
 *
 * It is deliberately not a React module: no hooks, no store, no DOM. `fetchImpl` is injectable so
 * tests never stub globals.
 *
 * Transport shape: every provider call is wrapped in an envelope and posted to the same-origin
 * `/api/ai-proxy` relay (`shared/aiProxy.ts`, served by the Vite middleware in dev and by a Pages
 * Function in production). Providers such as DashScope send no CORS headers, so a direct browser
 * call dies in the preflight before the key is ever sent; relaying it removes that failure and gives
 * one place to enforce which hosts may be reached. The relay passes a provider's status and body
 * through unchanged, so the mapping below still sees real provider answers.
 *
 * Security note: `baseUrl` is honoured **only** for `provider: 'custom'` (see `types/settings.ts`).
 * An OpenAI or Anthropic key is therefore never sent to a host the user did not choose.
 */

/**
 * Must match the Vite middleware mount point and `functions/api/ai-proxy/[[path]].ts`. Relative so
 * it follows whatever origin the app is served from - same-origin is what keeps CORS out of the
 * picture entirely, so no `Access-Control-Allow-Origin` is needed or wanted.
 */
export const AI_PROXY_PATH = '/api/ai-proxy'

/** Tuning knobs, all in one place. */
// The budget for one move, and it covers the single retry too: the abort timer starts before
// `withTransientRetry`, so a request plus its backoff plus the second attempt must all fit inside it.
// Kept below the relay's upstream ceiling (`RELAY_TIMEOUT_MS` in `shared/aiProxy.ts`) so that when a
// turn runs out of time it is the client that says so, with `timeout`, not the proxy.
export const AI_TIMEOUT_MS = 60_000
// 2048, not 220. A reasoning model spends completion tokens on `reasoning_content` before it emits
// the move, and DashScope bills those against this same cap - 220 was exhausted by thinking alone.
// The reply this app actually needs is a short JSON object, so the number is headroom for the model
// to finish, never a target it is expected to approach.
export const AI_MAX_TOKENS = 2048
// Hard asks for two-move lookahead and a written reason for the choice, which is more text than a
// bare move. Thinking stays off at every level (see `chatBody`), so this cap only has to cover the
// reply itself — it is headroom, not a target.
export const AI_MAX_TOKENS_HARD = 4096
/**
 * Sampling heat per level. Medium and Hard stay deterministic at 0, which is what the app has always
 * done; Easy is deliberately loose, because a capable model told to "play casually" and sampled at
 * temperature 0 will still play near-optimally — the words would change nothing.
 */
export const AI_TEMPERATURE: Record<AiDifficulty, number> = {
  easy: 0.8,
  medium: 0,
  hard: 0,
}
/** Reply budget for one level, so the cap and the temperature are chosen from the same place. */
export function budgetFor(difficulty: AiDifficulty): { maxTokens: number; temperature: number } {
  return {
    maxTokens: difficulty === 'hard' ? AI_MAX_TOKENS_HARD : AI_MAX_TOKENS,
    temperature: AI_TEMPERATURE[difficulty],
  }
}
export const AI_MOVE_DELAY_MS = 400
export const AI_TRANSIENT_RETRIES = 1
export const AI_RETRY_BASE_MS = 800
const AI_RETRY_MAX_WAIT_MS = 15_000

const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Used when `AiEngineConfig.model` is empty ("use the provider default"). */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  google: 'gemini-2.0-flash',
  // A custom gateway has no sensible default: the model name is deployment-specific.
  custom: '',
}

function fail(code: AiErrorCode, error: string, retryAfterMs: number | null = null): AiResult {
  return { success: false, error, code, retryAfterMs }
}

function ok(move: Move, choice: number | null): AiResult {
  return { success: true, move, choice }
}

/** Worth another attempt: the request itself was fine, the provider was unavailable or busy. */
export function isTransient(code: AiErrorCode): boolean {
  return code === 'rate-limited' || code === 'server-error' || code === 'network' || code === 'timeout'
}

/**
 * Trailing slashes are stripped, `/chat/completions` is reduced to its root, and a bare host gets
 * `/v1` appended (Ollama, vLLM and LM Studio all expose that path). A URL that already carries a
 * version segment is left alone.
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')

  if (trimmed.length === 0) {
    return ''
  }
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed.replace(/\/chat\/completions$/i, '')
  }

  return /\/v\d+([.-]?\d*)?([a-z]*)$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init)

/** Only the fields this client reads, so a plain object can stand in for `Response` in tests. */
function isResponseShaped(value: unknown): value is AiResponse {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as { ok?: unknown; status?: unknown; headers?: unknown; json?: unknown }
  return (
    typeof candidate.ok === 'boolean' &&
    typeof candidate.status === 'number' &&
    typeof candidate.headers === 'object' &&
    candidate.headers !== null &&
    typeof candidate.json === 'function'
  )
}

/**
 * POSTs JSON and maps transport-level failures. The caller owns the abort signal, so this can tell
 * "the page was abandoned" apart from "the provider was too slow".
 *
 * The provider request travels as the body of an envelope to the same-origin relay, so `url` and
 * `headers` here are what the relay will use upstream - they never touch the network directly.
 */
async function postJson(args: {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  fetchImpl: FetchLike
  signal: AbortSignal
  timedOut: () => boolean
}): Promise<{ data: unknown } | { failure: AiResult }> {
  const envelope = {
    targetUrl: args.url,
    headers: args.headers,
    body: JSON.stringify(args.body),
  }

  const init: AiRequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
    signal: args.signal,
  }

  let response: unknown

  try {
    response = await args.fetchImpl(AI_PROXY_PATH, init)
  } catch (error) {
    if (args.signal.aborted) {
      const timeout = args.timedOut()
      return { failure: fail(timeout ? 'timeout' : 'aborted', timeout ? 'The provider took too long to answer.' : 'The request was cancelled.') }
    }
    // A rejection now means the relay itself was unreachable: in dev the middleware is part of the
    // dev server, in production it is the same origin as the page. Provider CORS cannot be it.
    logger.warn('ai proxy request failed at the network layer', { target: args.url, reason: String(error) })
    return { failure: fail('network', 'Could not reach the AI proxy. Reload the page, then check Settings.') }
  }

  if (!isResponseShaped(response)) {
    return { failure: fail('bad-response', 'The AI proxy returned an unreadable response.') }
  }

  // Only our relay sets this header, and it is stripped from pass-through responses, so its
  // presence means the request never reached the provider rather than the provider refusing it.
  const proxyErrorCode = response.headers.get('x-ai-proxy-error')
  if (proxyErrorCode !== null) {
    return { failure: await mapProxyFailure(response, proxyErrorCode) }
  }

  if (!response.ok) {
    return { failure: mapHttpError(response.status, readRetryAfterMs(response)) }
  }

  try {
    return { data: await response.json() }
  } catch {
    return { failure: fail('bad-response', 'The provider returned a body that was not JSON.') }
  }
}

/**
 * A relay rejection is not a provider answer, so it does not go through `mapHttpError`: a 403 from
 * the allowlist must not read as "the provider refused this key". Timeouts and unreachable upstreams
 * keep their existing codes so the retry policy still applies to them; everything else is
 * `proxy-blocked`, which is not transient - only Settings can fix it.
 */
async function mapProxyFailure(response: AiResponse, proxyErrorCode: string): Promise<AiMoveFailure> {
  const message = await readProxyMessage(response)

  if (proxyErrorCode === 'gateway-timeout') {
    return { success: false, error: message ?? 'The provider did not answer in time.', code: 'timeout', retryAfterMs: null }
  }
  if (proxyErrorCode === 'bad-gateway') {
    return { success: false, error: message ?? 'The AI proxy could not reach the provider.', code: 'network', retryAfterMs: null }
  }

  return {
    success: false,
    error: message ?? 'The AI proxy blocked this endpoint. Check the Base URL in Settings.',
    code: 'proxy-blocked',
    retryAfterMs: null,
  }
}

/** Reads `{ error: { message } }` from a rejection body, tolerating anything a proxy might return. */
async function readProxyMessage(response: AiResponse): Promise<string | null> {
  try {
    const data = await response.json()
    if (typeof data !== 'object' || data === null) {
      return null
    }

    const error = (data as { error?: unknown }).error
    if (typeof error === 'object' && error !== null) {
      const message = (error as { message?: unknown }).message
      return typeof message === 'string' && message.length > 0 ? message : null
    }

    return null
  } catch {
    return null
  }
}

function readRetryAfterMs(response: AiResponse): number | null {
  const raw = response.headers.get('retry-after')
  if (raw === null) {
    return null
  }

  const seconds = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

/** Status code to typed error, with a message a player can act on. */
export function mapHttpError(status: number, retryAfterMs: number | null = null): AiMoveFailure {
  const code: AiErrorCode =
    status === 401
      ? 'unauthorized'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'not-found'
          : status === 429
            ? 'rate-limited'
            : status >= 500
              ? 'server-error'
              : 'bad-response'

  const error =
    code === 'unauthorized'
      ? 'Invalid API key. Check Settings.'
      : code === 'forbidden'
        ? 'The provider refused this key for this model (403).'
        : code === 'not-found'
          ? 'Model or endpoint not found (404). Check the model name and Base URL.'
          : code === 'rate-limited'
            ? retryAfterMs === null
              ? 'Rate limited by the provider (429).'
              : `Rate limited by the provider (429). Try again in ${Math.ceil(retryAfterMs / 1000)}s.`
            : code === 'server-error'
              ? `The provider is having trouble (${status}).`
              : `The provider returned status ${status}.`

  return { success: false, error, code, retryAfterMs }
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10)
  }
  return null
}

function toSource(value: unknown): MoveSource | null {
  if (value === 'bar') {
    return 'bar'
  }

  const point = toInt(value)
  return point !== null && point >= 1 && point <= POINT_COUNT ? point : null
}

function toTarget(value: unknown): MoveTarget | null {
  if (value === 'off') {
    return 'off'
  }

  const point = toInt(value)
  return point !== null && point >= 1 && point <= POINT_COUNT ? point : null
}

function toDie(value: unknown): DieFace | null {
  const face = toInt(value)
  return face !== null && face >= 1 && face <= 6 ? (face as DieFace) : null
}

function moveKey(move: Move): string {
  return `${move.from}|${move.to}|${move.die}`
}

/** First balanced `{...}` in the text, ignoring markdown fences and any prose around it. */
export function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```(?:json)?/gi, '')
  const start = cleaned.indexOf('{')
  if (start === -1) {
    return null
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < cleaned.length; index += 1) {
    const character = cleaned[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        return cleaned.slice(start, index + 1)
      }
    }
  }

  return null
}

/**
 * Model text to a legal move. Accepts the strict `{from,to,die}` object and the simpler
 * `{choice: n}` menu selection, coerces string numbers, and **only** returns a move that is in
 * `legal` — so an invented coordinate can never reach `applyMove`.
 */
export function parseAiMove(text: string, legal: readonly Move[]): { move: Move | null; choice: number | null } {
  const empty = { move: null, choice: null }
  const json = extractJsonObject(text)

  if (json === null) {
    return empty
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return empty
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return empty
  }

  const record = parsed as Record<string, unknown>
  const rawChoice = record.choice ?? record.index ?? record.moveNumber ?? record.move_number
  const choice = rawChoice === undefined ? null : toInt(rawChoice)

  if (choice !== null) {
    const move = legal[choice - 1]
    return move === undefined ? empty : { move, choice }
  }

  const from = toSource(record.from)
  const to = toTarget(record.to)
  const die = toDie(record.die ?? record.dice)

  if (from === null || to === null || die === null) {
    return empty
  }

  const candidate: Move = { from, to, die }
  const match = legal.find((move) => moveKey(move) === moveKey(candidate))

  return match === undefined ? { move: null, choice: null } : { move: match, choice }
}

/** Everything a single provider request needs, pre-resolved and credential-carrying. */
export interface MoveContext {
  apiKey: string
  baseUrl: string
  model: string
  system: string
  user: string
  signal: AbortSignal
  fetchImpl: FetchLike
  timedOut: () => boolean
  legal: readonly Move[]
  /** Resolved from `AiEngineConfig.difficulty` by `getAiMove`, never optional below this line. */
  difficulty: AiDifficulty
  maxTokens: number
  temperature: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readArray(root: unknown, key: string): unknown[] {
  const record = asRecord(root)
  const value = record?.[key]
  return Array.isArray(value) ? value : []
}

function readString(root: unknown, key: string): string | null {
  const record = asRecord(root)
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

/**
 * OpenAI-compatible chat body. `jsonMode` is off for custom gateways that reject the field, and
 * `thinkingOff` is set only for the host that defines `enable_thinking`.
 */
function chatBody(ctx: MoveContext, jsonMode: boolean, thinkingOff: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: ctx.model,
    messages: [
      { role: 'system', content: ctx.system },
      { role: 'user', content: ctx.user },
    ],
    temperature: ctx.temperature,
    max_tokens: ctx.maxTokens,
  }

  if (jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  // `enable_thinking` is not a standard OpenAI parameter - DashScope documents it as a top-level
  // body field that an OpenAI SDK has to smuggle through `extra_body`. Strict gateways answer 400
  // for fields they do not know, which is exactly why it is sent only where it is defined.
  // It is `false` at every difficulty, including hard: enabling thinking was measured to spend tens
  // of seconds on `reasoning_content` before a move appeared, and Hard gets its extra strength from
  // the prompt and a larger reply budget instead (`DIFFICULTY_INSTRUCTIONS`, `budgetFor`).
  if (thinkingOff) {
    body.enable_thinking = false
  }

  return body
}

function extractChatText(data: unknown): string | null {
  const first = readArray(data, 'choices')[0]
  const content = readString(asRecord(first)?.message ?? null, 'content') ?? readString(first, 'text')
  return content !== null && content.length > 0 ? content : null
}

function extractAnthropicText(data: unknown): string | null {
  const blocks = readArray(data, 'content')
  const text = blocks
    .map((block) => readString(block, 'text'))
    .filter((part): part is string => part !== null)
    .join('')

  return text.length > 0 ? text : null
}

function extractGoogleText(data: unknown): string | null {
  const candidate = asRecord(readArray(data, 'candidates')[0])
  const parts = readArray(asRecord(candidate?.content) ?? {}, 'parts')
  const text = parts
    .map((part) => readString(part, 'text'))
    .filter((chunk): chunk is string => chunk !== null)
    .join('')

  return text.length > 0 ? text : null
}

/** POST, dig the reply text out of the provider envelope, then validate it against the menu. */
async function requestText(
  args: {
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
    extract: (data: unknown) => string | null
  },
  ctx: MoveContext,
): Promise<AiResult> {
  const outcome = await postJson({
    url: args.url,
    headers: { 'content-type': 'application/json', ...args.headers },
    body: args.body,
    fetchImpl: ctx.fetchImpl,
    signal: ctx.signal,
    timedOut: ctx.timedOut,
  })

  if ('failure' in outcome) {
    return outcome.failure
  }

  const text = args.extract(outcome.data)

  if (text === null) {
    return fail('bad-response', 'The provider replied in a shape this app does not understand.')
  }

  const { move, choice } = parseAiMove(text, ctx.legal)

  if (move === null) {
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 160)
    // No JSON object at all is a protocol failure; a well-formed but unlisted move is the model's.
    const code: AiErrorCode = extractJsonObject(text) === null ? 'bad-response' : 'illegal-move'
    const error =
      code === 'bad-response'
        ? `The reply was not a JSON object: ${preview.length > 0 ? preview : '(empty)'}`
        : `The model chose a move that is not legal here: ${preview.length > 0 ? preview : '(empty)'}`
    return fail(code, error)
  }

  logger.debug('ai move received', {
    from: String(move.from),
    to: String(move.to),
    die: move.die,
    choice,
  })
  return ok(move, choice)
}

/**
 * True for DashScope's own domains - `dashscope.aliyuncs.com`, `dashscope-intl.aliyuncs.com` and the
 * newer workspace hosts such as `<id>.ap-southeast-1.maas.aliyuncs.com`. The suffix has to be a real
 * sub-domain boundary, so `aliyuncs.com.attacker.test` does not qualify.
 */
function isDashScopeUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'aliyuncs.com' || host.endsWith('.aliyuncs.com')
  } catch {
    return false
  }
}

/** `openai` and `custom` share this request shape; only the host and JSON mode differ. */
export function fetchOpenAiMove(ctx: MoveContext, baseUrl: string, jsonMode: boolean): Promise<AiResult> {
  return requestText(
    {
      url: `${baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${ctx.apiKey}` },
      body: chatBody(ctx, jsonMode, isDashScopeUrl(baseUrl)),
      extract: extractChatText,
    },
    ctx,
  )
}

/** Custom gateways (Ollama, vLLM, LM Studio) speak the chat format but often reject JSON mode. */
export function fetchCustomMove(ctx: MoveContext, baseUrl: string): Promise<AiResult> {
  return fetchOpenAiMove(ctx, baseUrl, false)
}

export function fetchAnthropicMove(ctx: MoveContext): Promise<AiResult> {
  return requestText(
    {
      url: ANTHROPIC_MESSAGES_URL,
      headers: {
        'x-api-key': ctx.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // Without this header Anthropic rejects calls made straight from a browser.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: {
        model: ctx.model,
        system: ctx.system,
        messages: [{ role: 'user', content: ctx.user }],
        max_tokens: ctx.maxTokens,
        temperature: ctx.temperature,
      },
      extract: extractAnthropicText,
    },
    ctx,
  )
}

export function fetchGoogleMove(ctx: MoveContext): Promise<AiResult> {
  return requestText(
    {
      url: `${GOOGLE_BASE_URL}/${encodeURIComponent(ctx.model)}:generateContent`,
      headers: { 'x-goog-api-key': ctx.apiKey },
      body: {
        systemInstruction: { parts: [{ text: ctx.system }] },
        contents: [{ role: 'user', parts: [{ text: ctx.user }] }],
        generationConfig: {
          temperature: ctx.temperature,
          maxOutputTokens: ctx.maxTokens,
          responseMimeType: 'application/json',
        },
      },
      extract: extractGoogleText,
    },
    ctx,
  )
}

function dispatch(provider: AiProvider, ctx: MoveContext): Promise<AiResult> {
  switch (provider) {
    case 'openai':
      return fetchOpenAiMove(ctx, OPENAI_BASE_URL, true)
    case 'anthropic':
      return fetchAnthropicMove(ctx)
    case 'google':
      return fetchGoogleMove(ctx)
    case 'custom': {
      const base = normalizeBaseUrl(ctx.baseUrl)
      if (base.length === 0) {
        return Promise.resolve(fail('missing-endpoint', 'A Base URL is required for a custom endpoint.'))
      }
      return fetchCustomMove(ctx, base)
    }
    default:
      return Promise.resolve(
        fail('unsupported-provider', `No client is wired up for the ${String(provider)} provider.`),
      )
  }
}

/** One retry for genuinely transient failures, honouring `Retry-After` when the provider sends it. */
async function withTransientRetry(
  attempt: () => Promise<AiResult>,
  provider: AiProvider,
  cancelled: () => boolean,
): Promise<AiResult> {
  for (let attemptNo = 0; attemptNo <= AI_TRANSIENT_RETRIES; attemptNo += 1) {
    const result = await attempt()
    const failure: AiMoveFailure | null = result.success ? null : result

    if (
      failure === null ||
      !isTransient(failure.code) ||
      cancelled() ||
      attemptNo === AI_TRANSIENT_RETRIES
    ) {
      return result
    }

    const waitMs = Math.min(
      failure.retryAfterMs ?? AI_RETRY_BASE_MS * (attemptNo + 1),
      AI_RETRY_MAX_WAIT_MS,
    )
    logger.warn('retrying ai move', { provider, code: failure.code, waitMs })
    await delay(waitMs)
  }

  // Unreachable: the loop always returns or breaks out via `attemptNo === AI_TRANSIENT_RETRIES`.
  return fail('network', 'The provider did not answer.')
}

/**
 * Ask one engine for exactly one move out of the legal menu for this position.
 *
 * Never throws: transport, protocol and rules failures all arrive as `{ success: false, code }`.
 */
export async function getAiMove(
  config: AiEngineConfig,
  board: BoardState,
  player: PlayerColor,
  options: AiCallOptions = {},
): Promise<AiResult> {
  const legal = getLegalMoves(board, player, board.dice)

  if (board.phase === 'finished' || board.winner !== null) {
    return fail('aborted', 'The game is already finished.')
  }
  if (board.turn !== player) {
    return fail('illegal-move', `It is ${board.turn}'s turn, not ${player}'s.`)
  }
  if (legal.length === 0) {
    return fail('illegal-move', 'There is no legal move to ask about.')
  }

  const problems = validateEngine(config)
  if (problems.length > 0) {
    const code: AiErrorCode =
      config.apiKey.trim().length === 0
        ? 'missing-key'
        : problems[0].includes('Base URL')
          ? 'missing-endpoint'
          : 'bad-response'
    return fail(code, problems[0])
  }

  const model = config.model.trim().length > 0 ? config.model.trim() : DEFAULT_MODELS[config.provider]
  if (model.trim().length === 0) {
    return fail('missing-model', 'This custom endpoint needs a model name. Set one in Settings.')
  }

  // A signal that is already aborted would never fire its own listener, so check it up front.
  if (options.signal?.aborted === true) {
    return fail('aborted', 'The request was cancelled.')
  }

  const timeoutMs = options.timeoutMs ?? AI_TIMEOUT_MS
  const difficulty = difficultyOf(config)
  const { maxTokens, temperature } = budgetFor(difficulty)
  const prompt = buildMovePrompt(board, player, legal, difficulty)
  let timedOut = false
  const controller = new AbortController()
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const relay = (): void => controller.abort()
  options.signal?.addEventListener('abort', relay, { once: true })

  const ctx: MoveContext = {
    apiKey: config.apiKey.trim(),
    baseUrl: (config.baseUrl ?? '').trim(),
    model,
    system: prompt.system,
    user: prompt.user,
    signal: controller.signal,
    fetchImpl: options.fetchImpl ?? defaultFetch,
    timedOut: () => timedOut,
    legal,
    difficulty,
    maxTokens,
    temperature,
  }

  logger.debug('ai move requested', {
    provider: config.provider,
    model,
    difficulty,
    maxTokens: String(maxTokens),
    menu: legal.length,
  })

  try {
    return await withTransientRetry(
      () => dispatch(config.provider, ctx),
      config.provider,
      () => timedOut || controller.signal.aborted,
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', relay)
  }
}
