import type { Move } from '@/types/game'
import type { AiThinkingLevel } from '@/types/settings'

/**
 * Everything the inference layer needs that is not a game rule. Nothing here imports React, the
 * DOM or the store, so the client stays as testable as `gameLogic.ts`.
 */

/** Why a move request did not succeed. Drives both the message and the retry decision. */
export type AiErrorCode =
  | 'missing-key'
  | 'missing-endpoint'
  | 'missing-model'
  | 'unsupported-provider'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'server-error'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'bad-response'
  | 'illegal-move'
  /**
   * The `/api/ai-proxy` relay refused the target (allowlist, non-https, private address) or the
   * envelope. Distinct from `network` on purpose: retrying will not help, only Settings will.
   */
  | 'proxy-blocked'

/** The move the engine asked for, or why it could not be obtained. Never a thrown exception. */
export interface AiMoveSuccess {
  success: true
  move: Move
  /** 1-based index into the legal list, when the model used the `{choice}` form. */
  choice: number | null
  /**
   * The model's one-sentence reason, already length-capped, or `null` when it said nothing usable.
   * Purely presentational: a missing or absurd explanation never stops a legal move from playing,
   * and it is never fed back into the rules engine.
   */
  explanation: string | null
}

export interface AiMoveFailure {
  success: false
  /** Safe to show in the UI: never contains a key or a raw provider payload. */
  error: string
  code: AiErrorCode
  /** From `Retry-After` when the provider sent one. */
  retryAfterMs: number | null
}

export type AiResult = AiMoveSuccess | AiMoveFailure

/** What the store holds for the UI banner. */
export interface AiErrorInfo {
  message: string
  code: AiErrorCode
}

export interface AiRequestInit {
  method: 'POST'
  headers: Record<string, string>
  body: string
  signal?: AbortSignal
}

/**
 * One chunk from a streamed response body. Structural rather than `ReadableStreamDefaultReader`, so
 * a test can hand back an array of byte chunks without constructing a stream, and the DOM types stay
 * out of the pure transport layer.
 */
export interface AiStreamChunk {
  readonly done: boolean
  readonly value?: Uint8Array
}

export interface AiStreamReader {
  read(): Promise<AiStreamChunk>
  cancel(reason?: unknown): unknown
}

export interface AiResponseBody {
  /** A web stream hands out one reader at a time; this client reads each response once. */
  getReader(): AiStreamReader
}

/**
 * The slice of `Response` this client reads. Declaring it (instead of using `globalThis.Response`)
 * keeps the whole fetch surface injectable in tests without touching global stubs.
 */
export interface AiResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: { get(name: string): string | null }
  /**
   * Present on every real `fetch` response, streamed or not — so it is never the signal that a reply
   * is incremental. The content type is. Optional because the test doubles do not have to supply it.
   */
  readonly body?: AiResponseBody | null
  json(): Promise<unknown>
  text(): Promise<string>
}

export type FetchLike = (url: string, init: AiRequestInit) => Promise<AiResponse>

/** Which of the two text fields of a streaming reply grew. Only `explanation` is ever displayed. */
export type AiDeltaKind = 'reasoning' | 'explanation'

/**
 * `text` is the CUMULATIVE reply so far, not the increment. Handing the store whole strings means a
 * dropped frame costs a stutter, never a missing word, and no component has to append correctly.
 */
export interface AiDelta {
  readonly kind: AiDeltaKind
  readonly text: string
}

/** The timers a streaming exchange needs that a buffered one does not. */
export interface AiStreamBudget {
  /** First byte arrived: the connect budget is spent, and the idle and total budgets start. */
  firstByte(): void
  /** Another chunk: the idle budget restarts, so a slow-but-alive stream is never cut off. */
  activity(): void
}

/** Optional overrides for a single request; all defaults live in `utils/aiClient.ts`. */
export interface AiCallOptions {
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: FetchLike
  /**
   * Called as a streamed explanation grows. Purely cosmetic: nothing here can decide whether the
   * move plays, because the move is only ever taken from the fully parsed reply.
   */
  onDelta?: (delta: AiDelta) => void
}

/** Model request-shaping class derived from catalog metadata (with `'standard'` fallback). */
export type AiRequestClass = 'standard' | 'openai-reasoning' | 'qwen4' | 'qwen3-hybrid'

/**
 * Capabilities and default inference parameters discovered for a model from its provider metadata
 * endpoint (or enriched from the built-in catalog when a provider's `/v1/models/<id>` endpoint
 * returns only the model identifier).
 */
export interface AiModelMetadata {
  readonly id: string
  readonly displayName: string
  readonly contextWindow: number | null
  readonly maxOutputTokens: number | null
  readonly defaultMaxTokens?: number | null
  readonly defaultTemperature: number | null
  readonly maxTemperature: number | null
  readonly defaultTopP: number | null
  readonly supportsThinking: boolean
  readonly defaultThinkingLevel: AiThinkingLevel
  readonly requestClass?: AiRequestClass
  readonly omitTemperature?: boolean
  /** `'endpoint'` when returned by the provider's model metadata API, `'catalog'` when fallback. */
  readonly source: 'endpoint' | 'catalog'
}
