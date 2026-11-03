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

/**
 * Seeded on purpose. These tests derive their move from whatever the dice show (`to = 24 - die`), so
 * an unseeded `roll()` put the outcome at the mercy of `Math.random`: a first die of 5 aims at point 19,
 * which holds five dark checkers at the opening, and `makeMove` refused it — failing the rewind
 * assertions about one run in six while looking like a bug in `rewindMovesFrom`.
 *
 * Seed 42 opens with the pair [4, 3], so the move is 24 -> 20 (empty) and the roll is not doubles, which
 * keeps `board.dice` at two entries. 30 of the first 200 seeds roll a 5 first, so if this seed is ever
 * changed, re-run the file before concluding the rewind logic broke.
 */
const HUMAN_VS_AI_CONFIG: GameConfigSnapshot = {
  mode: 'humanVsAi',
  aiMatchType: 'mirror',
  dice: { mode: 'seeded', seed: 42 },
  opponent: PERSONAL_AI,
}

describe('gameStore rewind (keep dice vs. discard dice) and pause', () => {
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

  it('rewindMovesFrom (Option a): keeps recorded dice and restores state right after roll', () => {
    useGameStore.getState().startNewGame(HUMAN_VS_AI_CONFIG, PERSONAL_AI)

    // Roll dice for turn 1
    const dice = useGameStore.getState().roll()
    expect(dice).not.toBeNull()
    // The fixture's promise, restated where it is relied on: seed 42 opens [4, 3]. If this ever fails,
    // the dice have gone nondeterministic again — not the rewind.
    expect(dice).toEqual([4, 3])
    const originalRoll = useGameStore.getState().lastRoll
    expect(originalRoll).not.toBeNull()

    // Move a checker
    const board = useGameStore.getState().board!
    const die = board.dice[0]
    const from = 24
    const to = 24 - die
    const moved = useGameStore.getState().makeMove({ from, to, die })
    expect(moved).toBe(true)

    expect(useGameStore.getState().stepHistory).toHaveLength(3)

    // Option a: rewind moves for turn 1, keep dice
    const res = useGameStore.getState().rewindMovesFrom(1)
    expect(res).toBe(true)

    const stateAfterRewind = useGameStore.getState()
    // History truncated back to roll snapshot (stepIndex 1)
    expect(stateAfterRewind.stepHistory).toHaveLength(2)
    expect(stateAfterRewind.currentStepIndex).toBe(1)
    expect(stateAfterRewind.isPaused).toBe(true)
    // Board has all original rolled dice back in hand
    expect(stateAfterRewind.board?.dice).toEqual(dice)
    // Recorded rolls preserved
    expect(stateAfterRewind.recordedRolls).toEqual([originalRoll])
    expect(stateAfterRewind.history).toHaveLength(0)
  })

  it('rewindRollsFrom (Option b): removes moves and rolls from turn N onward and leaves dice random', () => {
    useGameStore.getState().startNewGame(HUMAN_VS_AI_CONFIG, PERSONAL_AI)

    // Roll dice for turn 1
    const dice = useGameStore.getState().roll()
    expect(dice).not.toBeNull()

    // Move a checker
    const board = useGameStore.getState().board!
    const die = board.dice[0]
    const moved = useGameStore.getState().makeMove({ from: 24, to: 24 - die, die })
    // Asserted, because everything below only means something if there was a move to remove. Without it
    // this test passed silently while the unseeded die made `makeMove` refuse, which is how the flake
    // hid in the sibling test's failure output instead of its own.
    expect(moved).toBe(true)

    // Option b: rewind rolls for turn 1
    const res = useGameStore.getState().rewindRollsFrom(1)
    expect(res).toBe(true)

    const stateAfterRewind = useGameStore.getState()
    // History truncated back to before the roll (stepIndex 0)
    expect(stateAfterRewind.stepHistory).toHaveLength(1)
    expect(stateAfterRewind.currentStepIndex).toBe(0)
    expect(stateAfterRewind.isPaused).toBe(true)
    expect(stateAfterRewind.board?.dice).toHaveLength(0)
    // Recorded rolls for turn 1 and beyond are removed
    expect(stateAfterRewind.recordedRolls).toEqual([])
  })

  it('refuses rewind while AI is thinking', () => {
    useGameStore.getState().startNewGame(HUMAN_VS_AI_CONFIG, PERSONAL_AI)
    useGameStore.getState().roll()
    useGameStore.setState({ isAiThinking: true })

    expect(useGameStore.getState().rewindMovesFrom(1)).toBe(false)
    expect(useGameStore.getState().rewindRollsFrom(1)).toBe(false)
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
