/** Inference vendors the BYOK engine can talk to. Extend as clients are added. */
export type AiProvider = 'openai' | 'anthropic' | 'google' | 'custom'

/**
 * One complete set of credentials for an inference engine: provider, key, optional model
 * override and (for `custom`) the endpoint. Used both for the player's personal BYOK and, in a
 * Custom AI vs AI match, for the opponent.
 */
export interface AiEngineConfig {
  provider: AiProvider
  /**
   * Stored client-side only. Never logged in the clear (see `src/lib/logger.ts`) and never
   * sent anywhere but the selected provider — this app has no backend to proxy through.
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
}

/** The personal BYOK bundle from Settings — the same shape as any engine config. */
export type AppSettings = AiEngineConfig
