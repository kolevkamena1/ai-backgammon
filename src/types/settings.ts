/** Inference vendors the BYOK engine can talk to. Extend as clients are added. */
export type AiProvider = 'openai' | 'anthropic' | 'google' | 'custom'

/** UI color theme: `'light'` (warm soft light default) or `'dark'`. */
export type ThemeMode = 'light' | 'dark'

/**
 * Playing strength. A string union rather than an enum: `erasableSyntaxOnly` is on in both
 * tsconfigs, so an enum would have to compile to a runtime object the type system cannot erase.
 * The UI vocabulary for it lives in `utils/gameConfig.ts`, which keeps `types/` declaration-only.
 */
export type AiDifficulty = 'easy' | 'medium' | 'hard'

/**
 * Reasoning / extended thinking effort. `'off'` disables thinking where the provider supports
 * toggling it; `'low' | 'medium' | 'high'` maps to `reasoning_effort` (OpenAI), `thinking` budget
 * tokens (Anthropic), `thinkingConfig.thinkingBudget` (Google), or `enable_thinking: true`
 * (DashScope / custom gateways).
 */
export type AiThinkingLevel = 'off' | 'low' | 'medium' | 'high'

/**
 * User-configurable inference parameters. Every field is optional: when omitted, the engine uses
 * the defaults resolved from `difficulty` and any queried model metadata.
 */
export interface AiInferenceParams {
  /** Maximum completion/output tokens per move request. */
  maxTokens?: number
  /** Sampling temperature (0 to 2). */
  temperature?: number
  /** Nucleus sampling top-p (0 to 1). */
  topP?: number
  /** Context window size in tokens (sent as `num_ctx` to local/custom gateways). */
  contextWindow?: number
  /** Reasoning / extended thinking effort. */
  thinkingLevel?: AiThinkingLevel
  /**
   * Custom strategy and persona instructions for the system prompt. Combined with the mandatory
   * board-numbering and JSON move-output contract so the model still replies with a valid move.
   */
  systemPrompt?: string
}

/**
 * One complete set of credentials for an inference engine: provider, key, optional model
 * override and (for `custom`) the endpoint. Used both for the player's personal BYOK and, in a
 * Custom AI vs AI match, for the opponent.
 */
export interface AiEngineConfig {
  provider: AiProvider
  /**
   * Stored in `localStorage` only. Never logged in the clear (see `src/lib/logger.ts`) and
   * forwarded only to the selected provider through the same-origin `/api/ai-proxy` relay, which
   * never stores or logs it.
   */
  apiKey: string
  /** Optional model override; an empty string means "use the provider default". */
  model: string
  /**
   * Endpoint for `provider: 'custom'` only (Ollama, vLLM, LM Studio, or any OpenAI-compatible
   * gateway). Ignored by every other provider. Undefined or empty means "not configured".
   * Normalising the path (trailing slash, `/v1` suffix) is the request layer's job, not this one.
   */
  baseUrl?: string
  /**
   * Playing strength for this seat. Optional because a payload stored before Phase 4 has no such
   * key: every reader must fall back to `'medium'`, which is also what the settings store's shallow
   * merge does for a fresh default. It travels with the engine config rather than sitting in a
   * global UI setting so that each seat can be set apart — a mirror match hands the SAME object to
   * both seats (see `utils/gameConfig.ts`), so it is deliberately the same level for both.
   */
  difficulty?: AiDifficulty
  /**
   * Optional per-seat overrides for inference parameters (context window, max output tokens,
   * temperature, top-p, thinking level). Pre-filled from model metadata and difficulty defaults in
   * the UI, and snapshotted with the seat when a game starts.
   */
  params?: AiInferenceParams
}

/** The personal BYOK bundle from Settings — the same shape as any engine config. */
export type AppSettings = AiEngineConfig
