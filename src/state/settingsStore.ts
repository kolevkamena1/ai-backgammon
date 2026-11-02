import { createSafeStorage } from '@/state/createSafeStorage'
import type { AiDifficulty, AiProvider, AppSettings } from '@/types/settings'
import { DEFAULT_DIFFICULTY, sanitizeEngineConfig } from '@/utils/gameConfig'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState extends AppSettings {
  /** Modal visibility lives here so any component can open it, but it is never persisted. */
  isSettingsOpen: boolean
  setProvider: (provider: AiProvider) => void
  setApiKey: (apiKey: string) => void
  setDifficulty: (difficulty: AiDifficulty) => void
  saveSettings: (settings: AppSettings) => void
  clearSettings: () => void
  openSettings: () => void
  closeSettings: () => void
}

/** The exact subset mirrored to disk — actions and modal state never reach storage. */
type PersistedSettings = Pick<SettingsState, 'provider' | 'apiKey' | 'model' | 'baseUrl' | 'difficulty'>

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
 * silently wiping the saved key. Adding an optional field (like `baseUrl`, or `difficulty`)
 * needs no bump — the default shallow merge fills it from DEFAULT_SETTINGS.
 */
export const SETTINGS_STORAGE_KEY = 'ai-backgammon:settings'

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      isSettingsOpen: false,
      setProvider: (provider) => set({ provider }),
      setApiKey: (apiKey) => set({ apiKey }),
      setDifficulty: (difficulty) => set({ difficulty }),
      saveSettings: ({ provider, apiKey, model, baseUrl, difficulty }) =>
        set({ provider, apiKey, model, baseUrl, difficulty, isSettingsOpen: false }),
      clearSettings: () => set({ ...DEFAULT_SETTINGS, isSettingsOpen: false }),
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
      }),
      merge: (persisted, current): SettingsState => ({
        ...current,
        ...sanitizeEngineConfig(persisted, DEFAULT_SETTINGS),
      }),
    },
  ),
)
