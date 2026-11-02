import { createSafeStorage } from '@/state/createSafeStorage'
import type { AiDifficulty, AiProvider, AppSettings, ThemeMode } from '@/types/settings'
import { DEFAULT_DIFFICULTY, sanitizeEngineConfig } from '@/utils/gameConfig'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DEFAULT_THEME: ThemeMode = 'light'

interface SettingsState extends AppSettings {
  /** UI color theme: defaults to the warm soft `'light'` theme. */
  theme: ThemeMode
  /** Modal visibility lives here so any component can open it, but it is never persisted. */
  isSettingsOpen: boolean
  setProvider: (provider: AiProvider) => void
  setApiKey: (apiKey: string) => void
  setDifficulty: (difficulty: AiDifficulty) => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  saveSettings: (settings: AppSettings) => void
  clearSettings: () => void
  openSettings: () => void
  closeSettings: () => void
}

/** The exact subset mirrored to disk — actions and modal state never reach storage. */
type PersistedSettings = Pick<
  SettingsState,
  'provider' | 'apiKey' | 'model' | 'baseUrl' | 'difficulty' | 'params' | 'theme'
>

/** Shown when nothing has been saved yet — the AI engine stays disabled with an empty key. */
export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  apiKey: '',
  model: '',
  baseUrl: '',
  difficulty: DEFAULT_DIFFICULTY,
}

/**
 * localStorage key. Only bump `version` for an INCOMPATIBLE shape change, and pair it with
 * `migrate`: a version mismatch with no migrate makes Zustand discard the stored payload,
 * silently wiping the saved key. Adding an optional field (like `baseUrl`, `difficulty`, or `theme`)
 * needs no bump — the default shallow merge fills it from DEFAULT_SETTINGS.
 */
export const SETTINGS_STORAGE_KEY = 'ai-backgammon:settings'

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      theme: DEFAULT_THEME,
      isSettingsOpen: false,
      setProvider: (provider) => set({ provider }),
      setApiKey: (apiKey) => set({ apiKey }),
      setDifficulty: (difficulty) => set({ difficulty }),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      saveSettings: ({ provider, apiKey, model, baseUrl, difficulty, params }) =>
        set({ provider, apiKey, model, baseUrl, difficulty, params, isSettingsOpen: false }),
      clearSettings: () => set({ ...DEFAULT_SETTINGS, params: undefined, isSettingsOpen: false }),
      openSettings: () => set({ isSettingsOpen: true }),
      closeSettings: () => set({ isSettingsOpen: false }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      storage: createSafeStorage<PersistedSettings>('settings'),
      partialize: (state): PersistedSettings => ({
        provider: state.provider,
        apiKey: state.apiKey,
        model: state.model,
        baseUrl: state.baseUrl,
        difficulty: state.difficulty,
        params: state.params,
        theme: state.theme,
      }),
      merge: (persisted, current): SettingsState => {
        const record =
          typeof persisted === 'object' && persisted !== null
            ? (persisted as Record<string, unknown>)
            : {}
        const theme: ThemeMode =
          record.theme === 'dark' || record.theme === 'light' ? record.theme : DEFAULT_THEME

        return {
          ...current,
          ...sanitizeEngineConfig(persisted, DEFAULT_SETTINGS),
          theme,
        }
      },
    },
  ),
)
