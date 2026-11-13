// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/state/gameStore'
import { getInitialBoardState } from '@/utils/gameLogic'
import { startTelemetry } from '@/utils/telemetry'
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

  it('double -> rewind restores cube value/owner and rewindRollsFrom(T) rewinds pre-roll double steps', () => {
    const matchCfg: GameConfigSnapshot = {
      ...HUMAN_VS_AI_CONFIG,
      match: { targetPoints: 7, enableCrawford: true },
    }
    useGameStore.getState().startNewGame(matchCfg, PERSONAL_AI)

    // Turn 1: no double, roll [4, 3], play both dice
    useGameStore.getState().roll([4, 3])
    expect(useGameStore.getState().makeMove({ from: 24, to: 20, die: 4 })).toBe(true)
    expect(useGameStore.getState().makeMove({ from: 13, to: 10, die: 3 })).toBe(true)
    expect(useGameStore.getState().turnNumber).toBe(2)

    // Turn 2 (dark): propose double -> light accepts (cube becomes 2, owned by light), then dark rolls and moves
    expect(useGameStore.getState().proposeDouble('dark')).toBe(true)
    useGameStore.getState().respondToDouble('light', true)
    expect(useGameStore.getState().cube).toEqual({ value: 2, owner: 'light', proposedBy: null })

    useGameStore.getState().roll([2, 1])
    expect(useGameStore.getState().makeMove({ from: 1, to: 3, die: 2 })).toBe(true)

    // Rewinding Turn 1 moves restores Turn 1's pre-double cube state (value 1, centered)
    expect(useGameStore.getState().rewindMovesFrom(1)).toBe(true)
    expect(useGameStore.getState().cube).toEqual({ value: 1, owner: 'centered', proposedBy: null })

    // Re-play Turn 1 and Turn 2 double + roll, then rewindRollsFrom(2) must rewind BEFORE Turn 2's pre-roll double
    useGameStore.getState().setPaused(false)
    expect(useGameStore.getState().makeMove({ from: 24, to: 20, die: 4 })).toBe(true)
    expect(useGameStore.getState().makeMove({ from: 13, to: 10, die: 3 })).toBe(true)
    expect(useGameStore.getState().proposeDouble('dark')).toBe(true)
    useGameStore.getState().respondToDouble('light', true)
    expect(useGameStore.getState().cube).toEqual({ value: 2, owner: 'light', proposedBy: null })
    useGameStore.getState().roll([2, 1])

    expect(useGameStore.getState().rewindRollsFrom(2)).toBe(true)
    expect(useGameStore.getState().turnNumber).toBe(2)
    expect(useGameStore.getState().cube).toEqual({ value: 1, owner: 'centered', proposedBy: null })
    expect(useGameStore.getState().board?.dice).toEqual([])
  })

  it('declined-double turn (no roll) rewinds cleanly via rewindRollsFrom', () => {
    const matchCfg: GameConfigSnapshot = {
      ...HUMAN_VS_AI_CONFIG,
      match: { targetPoints: 5, enableCrawford: true },
    }
    useGameStore.getState().startNewGame(matchCfg, PERSONAL_AI)

    // Turn 1: roll and play
    useGameStore.getState().roll([4, 3])
    expect(useGameStore.getState().makeMove({ from: 24, to: 20, die: 4 })).toBe(true)
    expect(useGameStore.getState().makeMove({ from: 13, to: 10, die: 3 })).toBe(true)
    expect(useGameStore.getState().turnNumber).toBe(2)

    // Turn 2: dark proposes double, light declines -> game finishes without any roll on Turn 2
    expect(useGameStore.getState().proposeDouble('dark')).toBe(true)
    useGameStore.getState().respondToDouble('light', false)
    expect(useGameStore.getState().board?.phase).toBe('finished')
    expect(useGameStore.getState().match?.dark).toBe(1)

    // Rewinding Turn 2 (which had no roll) must succeed and restore pre-double state and match score
    expect(useGameStore.getState().rewindRollsFrom(2)).toBe(true)
    const after = useGameStore.getState()
    expect(after.board?.phase).toBe('playing')
    expect(after.board?.winner).toBeNull()
    expect(after.turnNumber).toBe(2)
    expect(after.cube).toEqual({ value: 1, owner: 'centered', proposedBy: null })
    expect(after.match?.dark).toBe(0)
    expect(after.match?.lastVictory).toBeNull()
  })

  it('finish -> rewind -> re-finish scores match points once and emits one game_end telemetry event', () => {
    const sentEvents: Array<{ type?: string; gameId?: string; outcome?: string }> = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (typeof init?.body === 'string') {
        sentEvents.push(JSON.parse(init.body) as { type?: string; gameId?: string; outcome?: string })
      }
      return new Response(null, { status: 204 })
    })

    const stopTelemetry = (startTelemetry as (opts?: { forceEnable?: boolean }) => () => void)({
      forceEnable: true,
    })

    try {
      const matchCfg: GameConfigSnapshot = {
        ...HUMAN_VS_AI_CONFIG,
        match: { targetPoints: 5, enableCrawford: true },
      }
      useGameStore.getState().startNewGame(matchCfg, PERSONAL_AI)
      const gameId = useGameStore.getState().gameId

      // Set up a board where light has 14 borne off and 1 checker on point 1, then roll [1, 2]
      const nearlyDone = getInitialBoardState()
      nearlyDone.points = Array<number>(24).fill(0)
      nearlyDone.points[0] = 1 // 1 light checker on point 1
      nearlyDone.points[23] = -15 // 15 dark checkers on point 24
      nearlyDone.off = { light: 14, dark: 1 }
      useGameStore.setState({
        board: nearlyDone,
        stepHistory: [
          {
            ...useGameStore.getState().stepHistory[0],
            board: {
              ...nearlyDone,
              points: [...nearlyDone.points],
              bar: { ...nearlyDone.bar },
              off: { ...nearlyDone.off },
              dice: [],
            },
          },
        ],
      })

      useGameStore.getState().roll([1, 2])
      expect(useGameStore.getState().makeMove({ from: 1, to: 'off', die: 1 })).toBe(true)
      expect(useGameStore.getState().board?.phase).toBe('finished')
      expect(useGameStore.getState().match?.light).toBe(1)

      // Rewind the winning move, then bear off again
      expect(useGameStore.getState().rewindMovesFrom(1)).toBe(true)
      expect(useGameStore.getState().board?.phase).toBe('playing')
      expect(useGameStore.getState().match?.light).toBe(0)
      expect(useGameStore.getState().match?.lastVictory).toBeNull()

      useGameStore.getState().setPaused(false)
      expect(useGameStore.getState().makeMove({ from: 1, to: 'off', die: 1 })).toBe(true)
      expect(useGameStore.getState().board?.phase).toBe('finished')
      // Match score must be 1, NOT 2
      expect(useGameStore.getState().match?.light).toBe(1)

      const gameEndsForId = sentEvents.filter((e) => e.type === 'game_end' && e.gameId === gameId)
      expect(gameEndsForId).toHaveLength(1)
    } finally {
      stopTelemetry()
      fetchSpy.mockRestore()
    }
  })

  it('invariant: for every step i, restoring snapshot[i] deep-equals the full recorded state at i', () => {
    const matchCfg: GameConfigSnapshot = {
      ...HUMAN_VS_AI_CONFIG,
      match: { targetPoints: 5, enableCrawford: true },
    }

    const captureLiveState = () => {
      const s = useGameStore.getState()
      return structuredClone({
        board: s.board,
        lastRoll: s.lastRoll,
        cube: s.cube,
        match: s.match,
        history: s.history,
        selectedFrom: s.selectedFrom,
        turnPassed: s.turnPassed,
        turnNumber: s.turnNumber,
        recordedRolls: s.recordedRolls,
        currentStepIndex: s.currentStepIndex,
      })
    }

    const recorded: ReturnType<typeof captureLiveState>[] = []

    // Step 0: game-start
    useGameStore.getState().startNewGame(matchCfg, PERSONAL_AI)
    recorded.push(captureLiveState())

    // Step 1: double-proposed (light proposes -> AI dark immediately responds in step 2)
    // To capture step 1 and step 2 separately, let's testdark proposing to human light on Turn 2!
    // Step 1: Turn 1 roll
    useGameStore.getState().roll([4, 3])
    recorded.push(captureLiveState())

    // Step 2: Turn 1 move 1
    expect(useGameStore.getState().makeMove({ from: 24, to: 20, die: 4 })).toBe(true)
    recorded.push(captureLiveState())

    // Step 3: Turn 1 move 2 (ends Turn 1)
    expect(useGameStore.getState().makeMove({ from: 13, to: 10, die: 3 })).toBe(true)
    recorded.push(captureLiveState())

    // Step 4: Turn 2 double-proposed by dark (human light is responder, so it stays pending at step 4)
    expect(useGameStore.getState().proposeDouble('dark')).toBe(true)
    recorded.push(captureLiveState())

    // Step 5: Turn 2 double-accepted by light
    useGameStore.getState().respondToDouble('light', true)
    recorded.push(captureLiveState())

    // Step 6: Turn 2 passTurn
    useGameStore.getState().passTurn()
    recorded.push(captureLiveState())

    const fullSteps = structuredClone(useGameStore.getState().stepHistory)
    expect(fullSteps).toHaveLength(recorded.length)

    // Verify structured kind flag on every step
    expect(fullSteps.map((s) => (s as { kind?: string }).kind)).toEqual([
      'game-start',
      'roll',
      'move',
      'move',
      'double-proposed',
      'double-accepted',
      'pass',
    ])

    for (let i = 0; i < fullSteps.length; i += 1) {
      // Restore full history first, then restore to step i
      useGameStore.setState({ stepHistory: structuredClone(fullSteps), currentStepIndex: fullSteps.length - 1 })
      const ok = (useGameStore.getState() as { restoreToStep?: (idx: number) => boolean }).restoreToStep?.(i)
      expect(ok).toBe(true)
      expect(captureLiveState()).toEqual(recorded[i])
    }
  })

  it('telemetry turns matrix: bear-off finish, declined-double finish, and mid-game abandon (C13 regression)', () => {
    const sentEvents: Array<{ type?: string; gameId?: string; outcome?: string; turns?: number }> = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (typeof init?.body === 'string') {
        sentEvents.push(
          JSON.parse(init.body) as { type?: string; gameId?: string; outcome?: string; turns?: number },
        )
      }
      return new Response(null, { status: 204 })
    })

    const stopTelemetry = startTelemetry({ forceEnable: true })

    try {
      const matchCfg: GameConfigSnapshot = {
        ...HUMAN_VS_AI_CONFIG,
        match: { targetPoints: 5, enableCrawford: true },
      }

      // 1. Bear-off finish on Turn 1 -> turns must be 1 (not 0)
      useGameStore.getState().startNewGame(matchCfg, PERSONAL_AI)
      const bearOffGameId = useGameStore.getState().gameId
      const nearlyDone = getInitialBoardState()
      nearlyDone.points = Array<number>(24).fill(0)
      nearlyDone.points[0] = 1
      nearlyDone.points[23] = -15
      nearlyDone.off = { light: 14, dark: 1 }
      useGameStore.setState({ board: nearlyDone })
      useGameStore.getState().roll([1, 2])
      expect(useGameStore.getState().makeMove({ from: 1, to: 'off', die: 1 })).toBe(true)
      const bearOffEnd = sentEvents.find((e) => e.type === 'game_end' && e.gameId === bearOffGameId)
      expect(bearOffEnd).toMatchObject({ outcome: 'finished', turns: 1 })

      // 2. Declined-double finish on Turn 2 -> turns must be 2 (not 1)
      useGameStore.getState().startNewGame(matchCfg, PERSONAL_AI)
      const declinedDoubleGameId = useGameStore.getState().gameId
      useGameStore.getState().roll([4, 3])
      expect(useGameStore.getState().makeMove({ from: 24, to: 20, die: 4 })).toBe(true)
      expect(useGameStore.getState().makeMove({ from: 13, to: 10, die: 3 })).toBe(true)
      expect(useGameStore.getState().turnNumber).toBe(2)
      expect(useGameStore.getState().proposeDouble('dark')).toBe(true)
      useGameStore.getState().respondToDouble('light', false)
      const declinedEnd = sentEvents.find((e) => e.type === 'game_end' && e.gameId === declinedDoubleGameId)
      expect(declinedEnd).toMatchObject({ outcome: 'finished', turns: 2 })

      // 3. Mid-game abandon after completing Turn 1 (turnNumber is now 2, mid-game) -> turns must be 1
      useGameStore.getState().startNewGame(matchCfg, PERSONAL_AI)
      const midGameId = useGameStore.getState().gameId
      useGameStore.getState().roll([4, 3])
      expect(useGameStore.getState().makeMove({ from: 24, to: 20, die: 4 })).toBe(true)
      expect(useGameStore.getState().makeMove({ from: 13, to: 10, die: 3 })).toBe(true)
      expect(useGameStore.getState().turnNumber).toBe(2)
      useGameStore.getState().resetGame()
      const midGameEnd = sentEvents.find((e) => e.type === 'game_end' && e.gameId === midGameId)
      expect(midGameEnd).toMatchObject({ outcome: 'abandoned', turns: 1 })
    } finally {
      stopTelemetry()
      fetchSpy.mockRestore()
    }
  })
})
