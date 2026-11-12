import { createSafeStorage } from '@/state/createSafeStorage'
import type { AiMatchType, GameConfigSnapshot, GameMode } from '@/types/gameConfig'
import type { AiEngineConfig } from '@/types/settings'
import { DEFAULT_DIFFICULTY, sanitizeEngineConfig } from '@/utils/gameConfig'
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
  humanColor: 'light',
  dice: { mode: 'random' },
  aiMatchType: 'mirror',
  opponent: { ...DEFAULT_OPPONENT_CONFIG },
}

/**
 * localStorage key for the setup. Only the opponent credential lives here — a mirror match
 * reuses `ai-backgammon:settings` and never duplicates that key. See the note in
 * settingsStore.ts about when bumping `version` is actually safe.
 */
export const GAME_CONFIG_STORAGE_KEY = 'ai-backgammon:game-config'

type PersistedGameConfig = Pick<
  GameConfigState,
  'mode' | 'humanColor' | 'dice' | 'aiMatchType' | 'opponent' | 'match'
>

export const useGameConfigStore = create<GameConfigState>()(
  persist(
    (set) => ({
      ...DEFAULT_GAME_CONFIG,
      isSetupOpen: false,
      setMode: (mode) => set({ mode }),
      setAiMatchType: (aiMatchType) => set({ aiMatchType }),
      setOpponent: (opponent) => set({ opponent }),
      clearOpponent: () => set({ opponent: { ...DEFAULT_OPPONENT_CONFIG } }),
      saveSetup: (snapshot) =>
        set({
          mode: snapshot.mode,
          aiMatchType: snapshot.aiMatchType,
          opponent: snapshot.opponent,
          // Optional keys merge only when actually provided. Defaults live in the initializer
          // (DEFAULT_GAME_CONFIG), so a partial save — e.g. Settings saving just the match type and
          // opponent — never clobbers the player's dice mode, seat colour or match configuration.
          ...(snapshot.humanColor !== undefined ? { humanColor: snapshot.humanColor } : {}),
          ...(snapshot.dice !== undefined ? { dice: snapshot.dice } : {}),
          ...(snapshot.match !== undefined ? { match: snapshot.match } : {}),
          isSetupOpen: false,
        }),
      openSetup: () => set({ isSetupOpen: true }),
      closeSetup: () => set({ isSetupOpen: false }),
    }),
    {
      name: GAME_CONFIG_STORAGE_KEY,
      version: 1,
      storage: createSafeStorage<PersistedGameConfig>('game-config'),
      partialize: (state): PersistedGameConfig => ({
        mode: state.mode,
        humanColor: state.humanColor,
        dice: state.dice,
        aiMatchType: state.aiMatchType,
        opponent: state.opponent,
        match: state.match,
      }),
      merge: (persisted, current): GameConfigState => {
        const record =
          typeof persisted === 'object' && persisted !== null
            ? (persisted as Record<string, unknown>)
            : {}
        const mode: GameMode =
          record.mode === 'humanVsAi' || record.mode === 'aiVsAi'
            ? record.mode
            : DEFAULT_GAME_CONFIG.mode
        const aiMatchType: AiMatchType =
          record.aiMatchType === 'mirror' || record.aiMatchType === 'custom'
            ? record.aiMatchType
            : DEFAULT_GAME_CONFIG.aiMatchType

        return {
          ...current,
          mode,
          humanColor: record.humanColor === 'dark' ? 'dark' : 'light',
          dice:
            typeof record.dice === 'object' && record.dice !== null
              ? (record.dice as GameConfigSnapshot['dice'])
              : DEFAULT_GAME_CONFIG.dice,
          aiMatchType,
          opponent: sanitizeEngineConfig(record.opponent, DEFAULT_OPPONENT_CONFIG),
          match:
            typeof record.match === 'object' && record.match !== null
              ? (record.match as GameConfigSnapshot['match'])
              : undefined,
        }
      },
    },
  ),
)
