import { DEFAULT_SETTINGS, useSettingsStore } from '@/state/settingsStore'
import type { AppSettings } from '@/types/settings'
import { maskSecret } from '@/utils/formatSecret'

/**
 * Typed facade over the settings store. Each primitive is subscribed to individually so a
 * change to one field does not re-render components that only read another.
 */
export function useSettings() {
  const provider = useSettingsStore((state) => state.provider)
  const apiKey = useSettingsStore((state) => state.apiKey)
  const model = useSettingsStore((state) => state.model)
  const baseUrl = useSettingsStore((state) => state.baseUrl)
  const isSettingsOpen = useSettingsStore((state) => state.isSettingsOpen)
  const saveSettings = useSettingsStore((state) => state.saveSettings)
  const clearSettings = useSettingsStore((state) => state.clearSettings)
  const openSettings = useSettingsStore((state) => state.openSettings)
  const closeSettings = useSettingsStore((state) => state.closeSettings)

  // baseUrl belongs here: SettingsModal seeds its draft from this object, so omitting it would
  // silently reopen an empty field even though the value is stored.
  const settings: AppSettings = { provider, apiKey, model, baseUrl }

  return {
    settings,
    provider,
    apiKey,
    model,
    baseUrl,
    isSettingsOpen,
    /** Gates AI affordances until a key exists. */
    isConfigured: apiKey.trim().length > 0,
    /** Safe to render anywhere: masked tail of the stored key. */
    maskedApiKey: maskSecret(apiKey),
    defaults: DEFAULT_SETTINGS,
    saveSettings,
    clearSettings,
    openSettings,
    closeSettings,
  }
}
