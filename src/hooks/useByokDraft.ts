import type { AiEngineConfig } from '@/types/settings'
import { useCallback, useState } from 'react'

/**
 * Local draft for a BYOK field group. Edits stay out of the store until `commit()`, so Cancel
 * can discard them and the trim/normalise rules live in exactly one place.
 */
export function useByokDraft(initial: AiEngineConfig) {
  const [draft, setDraft] = useState<AiEngineConfig>(initial)

  const patch = useCallback((changes: Partial<AiEngineConfig>): void => {
    setDraft((current) => ({ ...current, ...changes }))
  }, [])

  const reset = useCallback((next: AiEngineConfig): void => {
    setDraft(next)
  }, [])

  /** Normalises the draft for persistence: trimmed, with baseUrl always a string. */
  const commit = useCallback(
    (): AiEngineConfig => ({
      provider: draft.provider,
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      baseUrl: draft.baseUrl?.trim() ?? '',
    }),
    [draft],
  )

  return { draft, patch, reset, commit }
}
