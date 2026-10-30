import { createSafeStorage } from '@/state/createSafeStorage'
import type { AiMatchType, GameConfigSnapshot, GameMode } from '@/types/gameConfig'
import type { AiEngineConfig } from '@/types/settings'
import { DEFAULT_DIFFICULTY } from '@/utils/gameConfig'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface GameConfigState extends GameConfigSnapshot {
  /** Setup modal visibility — never persisted. */
  isSetupOpen: boolean
  setMode: (mode: GameMode) => void
  setAiMatchType: (type: AiMatchType) => void
  setOpponent: (opponent: AiEngineConfig) => void
  clearOpponent: () => void
  saveSetup: (snapshot: GameConfigSnapshot) => void
  openSetup: () => void
  closeSetup: () => void
}

/** Fresh copy on purpose: a shared reference could leak edits into the default. */
export const DEFAULT_OPPONENT_CONFIG: AiEngineConfig = {
  provider: 'openai',
  apiKey: '',
  model: '',
  baseUrl: '',
  difficulty: DEFAULT_DIFFICULTY,
}

/**
 * Defaults for a first run. `humanVsAi` is the conservative choice: it needs no second
 * credential and matches the single-key behaviour the app has always had.
 */
export const DEFAULT_GAME_CONFIG: GameConfigSnapshot = {
  mode: 'humanVsAi',
  aiMatchType: 'mirror',
  opponent: { ...DEFAULT_OPPONENT_CONFIG },
}

/**
 * localStorage key for the setup. Only the opponent credential lives here — a mirror match
 * reuses `ai-backgammon:settings` and never duplicates that key. See the note in
 * settingsStore.ts about when bumping `version` is actually safe.
 */
export const GAME_CONFIG_STORAGE_KEY = 'ai-backgammon:game-config'

type PersistedGameConfig = Pick<GameConfigState, 'mode' | 'aiMatchType' | 'opponent'>

export const useGameConfigStore = create<GameConfigState>()(
  persist(
    (set) => ({
      ...DEFAULT_GAME_CONFIG,
      isSetupOpen: false,
      setMode: (mode) => set({ mode }),
      setAiMatchType: (aiMatchType) => set({ aiMatchType }),
      setOpponent: (opponent) => set({ opponent }),
      clearOpponent: () => set({ opponent: { ...DEFAULT_OPPONENT_CONFIG } }),
      saveSetup: ({ mode, aiMatchType, opponent }) =>
        set({ mode, aiMatchType, opponent, isSetupOpen: false }),
      openSetup: () => set({ isSetupOpen: true }),
      closeSetup: () => set({ isSetupOpen: false }),
    }),
    {
      name: GAME_CONFIG_STORAGE_KEY,
      version: 1,
      storage: createSafeStorage<PersistedGameConfig>('game-config'),
      partialize: (state): PersistedGameConfig => ({
        mode: state.mode,
        aiMatchType: state.aiMatchType,
        opponent: state.opponent,
      }),
    },
  ),
)
