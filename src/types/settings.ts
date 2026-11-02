/** Inference vendors the BYOK engine can talk to. Extend as clients are added. */
export type AiProvider = 'openai' | 'anthropic' | 'google' | 'custom'

/**
 * Playing strength. A string union rather than an enum: `erasableSyntaxOnly` is on in both
 * tsconfigs, so an enum would have to compile to a runtime object the type system cannot erase.
 * The UI vocabulary for it lives in `utils/gameConfig.ts`, which keeps `types/` declaration-only.
 */
export type AiDifficulty = 'easy' | 'medium' | 'hard'

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
}

/** The personal BYOK bundle from Settings — the same shape as any engine config. */
export type AppSettings = AiEngineConfig
