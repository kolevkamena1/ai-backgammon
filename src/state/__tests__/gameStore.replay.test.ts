import { beforeEach, describe, expect, it } from 'vitest'
import { useGameStore } from '@/state/gameStore'
import type { GameConfigSnapshot } from '@/types/gameConfig'
import type { AiEngineConfig } from '@/types/settings'

const PERSONAL_AI: AiEngineConfig = {
  provider: 'custom',
  apiKey: 'test-key',
  baseUrl: 'http://localhost:11434',
  model: 'qwen2.5:7b',
}

const HUMAN_VS_AI_CONFIG: GameConfigSnapshot = {
  mode: 'humanVsAi',
  aiMatchType: 'mirror',
  opponent: PERSONAL_AI,
}

describe('gameStore undo, redo and exact dice replay', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame()
  })

  it('initializes stepHistory with step 0 on game start', () => {
    const started = useGameStore.getState().startNewGame(HUMAN_VS_AI_CONFIG, PERSONAL_AI)
    expect(started).toBe(true)

    const state = useGameStore.getState()
    expect(state.stepHistory).toHaveLength(1)
    expect(state.currentStepIndex).toBe(0)
    expect(state.isPaused).toBe(false)
    expect(state.turnNumber).toBe(1)
    expect(state.recordedRolls).toEqual([])
  })

  it('records dice roll and checker moves in stepHistory and replays exact dice after undo', () => {
    useGameStore.getState().startNewGame(HUMAN_VS_AI_CONFIG, PERSONAL_AI)

    // Roll dice for turn 1
    const dice = useGameStore.getState().roll()
    expect(dice).not.toBeNull()
    const originalRoll = useGameStore.getState().lastRoll
    expect(originalRoll).not.toBeNull()

    const stateAfterRoll = useGameStore.getState()
    expect(stateAfterRoll.stepHistory).toHaveLength(2)
    expect(stateAfterRoll.currentStepIndex).toBe(1)
    expect(stateAfterRoll.recordedRolls).toHaveLength(1)
    expect(stateAfterRoll.recordedRolls[0]).toEqual(originalRoll)

    // Move a checker (24 to 24 - die, or legal move for light)
    const board = useGameStore.getState().board!
    const die = board.dice[0]
    const from = 24
    const to = 24 - die
    const moved = useGameStore.getState().makeMove({ from, to, die })
    expect(moved).toBe(true)

    const stateAfterMove = useGameStore.getState()
    expect(stateAfterMove.stepHistory).toHaveLength(3)
    expect(stateAfterMove.currentStepIndex).toBe(2)

    // Undo move
    useGameStore.getState().undo()
    const stateAfterUndo = useGameStore.getState()
    expect(stateAfterUndo.currentStepIndex).toBe(1)
    expect(stateAfterUndo.isPaused).toBe(true)
    expect(stateAfterUndo.board?.dice).toContain(die)

    // Redo move
    useGameStore.getState().redo()
    const stateAfterRedo = useGameStore.getState()
    expect(stateAfterRedo.currentStepIndex).toBe(2)

    // Jump to step 0
    useGameStore.getState().jumpToStep(0)
    const stateAtStart = useGameStore.getState()
    expect(stateAtStart.currentStepIndex).toBe(0)
    expect(stateAtStart.board?.dice).toHaveLength(0)

    // Roll again from turn 1: exact dice roll replay!
    const replayedDice = useGameStore.getState().roll()
    expect(replayedDice).not.toBeNull()
    expect(useGameStore.getState().lastRoll).toEqual(originalRoll)
  })

  it('supports pause and resume', () => {
    useGameStore.getState().startNewGame(HUMAN_VS_AI_CONFIG, PERSONAL_AI)
    expect(useGameStore.getState().isPaused).toBe(false)

    useGameStore.getState().togglePause()
    expect(useGameStore.getState().isPaused).toBe(true)

    useGameStore.getState().togglePause()
    expect(useGameStore.getState().isPaused).toBe(false)
  })
})
