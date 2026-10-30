import type { Move } from '@/types/game'

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
 * The slice of `Response` this client reads. Declaring it (instead of using `globalThis.Response`)
 * keeps the whole fetch surface injectable in tests without touching global stubs.
 */
export interface AiResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}

export type FetchLike = (url: string, init: AiRequestInit) => Promise<AiResponse>

/** Optional overrides for a single request; all defaults live in `utils/aiClient.ts`. */
export interface AiCallOptions {
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: FetchLike
}
