import { useGameConfigStore } from '@/state/gameConfigStore'
import type { GameConfigSnapshot } from '@/types/gameConfig'
import { maskSecret } from '@/utils/formatSecret'

/**
 * Typed facade over the game-config store. Primitives and the opponent object are subscribed to
 * individually so a change to one does not re-render consumers of the others.
 */
export function useGameConfig() {
  const mode = useGameConfigStore((state) => state.mode)
  const humanColor = useGameConfigStore((state) => state.humanColor)
  const dice = useGameConfigStore((state) => state.dice)
  const match = useGameConfigStore((state) => state.match)
  const aiMatchType = useGameConfigStore((state) => state.aiMatchType)
  const opponent = useGameConfigStore((state) => state.opponent)
  const isSetupOpen = useGameConfigStore((state) => state.isSetupOpen)
  const setMode = useGameConfigStore((state) => state.setMode)
  const setAiMatchType = useGameConfigStore((state) => state.setAiMatchType)
  const setOpponent = useGameConfigStore((state) => state.setOpponent)
  const clearOpponent = useGameConfigStore((state) => state.clearOpponent)
  const saveSetup = useGameConfigStore((state) => state.saveSetup)
  const openSetup = useGameConfigStore((state) => state.openSetup)
  const closeSetup = useGameConfigStore((state) => state.closeSetup)

  const config: GameConfigSnapshot = { mode, humanColor, dice, aiMatchType, opponent, match }

  return {
    config,
    mode,
    aiMatchType,
    opponent,
    isSetupOpen,
    isAiVsAi: mode === 'aiVsAi',
    /** Only a custom match needs a second credential. */
    isCustomMatch: mode === 'aiVsAi' && aiMatchType === 'custom',
    opponentConfigured: opponent.apiKey.trim().length > 0,
    /** Safe to render: masked tail only. */
    maskedOpponentKey: maskSecret(opponent.apiKey),
    setMode,
    setAiMatchType,
    setOpponent,
    clearOpponent,
    saveSetup,
    openSetup,
    closeSetup,
  }
}
