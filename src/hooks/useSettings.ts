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
  const difficulty = useSettingsStore((state) => state.difficulty)
  const params = useSettingsStore((state) => state.params)
  const theme = useSettingsStore((state) => state.theme)
  const boardDesign = useSettingsStore((state) => state.boardDesign)
  const panelPosition = useSettingsStore((state) => state.panelPosition)
  const isSettingsOpen = useSettingsStore((state) => state.isSettingsOpen)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const toggleTheme = useSettingsStore((state) => state.toggleTheme)
  const setBoardDesign = useSettingsStore((state) => state.setBoardDesign)
  const setPanelPosition = useSettingsStore((state) => state.setPanelPosition)
  const saveSettings = useSettingsStore((state) => state.saveSettings)
  const clearSettings = useSettingsStore((state) => state.clearSettings)
  const openSettings = useSettingsStore((state) => state.openSettings)
  const closeSettings = useSettingsStore((state) => state.closeSettings)

  // baseUrl, difficulty and params belong here: SettingsModal seeds its draft from this object, so
  // omitting a field would silently reopen an empty or default control even though the value is stored.
  const settings: AppSettings = { provider, apiKey, model, baseUrl, difficulty, params }

  return {
    settings,
    provider,
    apiKey,
    model,
    baseUrl,
    difficulty,
    params,
    theme,
    boardDesign,
    panelPosition,
    isSettingsOpen,
    /** Gates AI affordances until a key exists. */
    isConfigured: apiKey.trim().length > 0,
    /** Safe to render anywhere: masked tail of the stored key. */
    maskedApiKey: maskSecret(apiKey),
    defaults: DEFAULT_SETTINGS,
    setTheme,
    toggleTheme,
    setBoardDesign,
    setPanelPosition,
    saveSettings,
    clearSettings,
    openSettings,
    closeSettings,
  }
}
