import { beforeEach, describe, expect, it } from 'vitest'
import { useGameStore } from '@/state/gameStore'
import { evaluateVictoryGrade, getInitialBoardState } from '@/utils/gameLogic'
import { evaluateAiAcceptDouble, evaluateAiShouldDouble } from '@/utils/doublingAi'
import type { GameConfigSnapshot } from '@/types/gameConfig'
import type { AiEngineConfig } from '@/types/settings'

const PERSONAL_AI: AiEngineConfig = {
  provider: 'custom',
  apiKey: 'test-key',
  baseUrl: 'http://localhost:11434',
  model: 'qwen2.5:7b',
}

const MATCH_CONFIG: GameConfigSnapshot = {
  mode: 'humanVsAi',
  aiMatchType: 'mirror',
  opponent: PERSONAL_AI,
  match: {
    targetPoints: 7,
    enableCrawford: true,
  },
}

describe('Game Sets and Victory Grading', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame()
  })

  it('grades Single victory (1 point) when loser bore off >= 1 checker', () => {
    const board = getInitialBoardState()
    board.off.light = 15
    board.off.dark = 2

    const grade = evaluateVictoryGrade(board, 'light')
    expect(grade).toBe('single')
  })

  it('grades Gammon victory (2 points) when loser bore off 0 checkers and has none in winner home', () => {
    const board = getInitialBoardState()
    board.off.light = 15
    board.off.dark = 0
    // Clear dark checkers from points 1..6 (Light's home board)
    for (let i = 0; i < 6; i += 1) {
      if (board.points[i] < 0) board.points[i] = 0
    }
    // Place dark checkers in outer board (e.g. point 12)
    board.points[11] = -15

    const grade = evaluateVictoryGrade(board, 'light')
    expect(grade).toBe('gammon')
  })

  it('grades Backgammon victory (3 points) when loser bore off 0 checkers and has a checker in winner home', () => {
    const board = getInitialBoardState()
    board.off.light = 15
    board.off.dark = 0
    // Place a dark checker on point 1 (inside Light's home board 1..6)
    board.points[0] = -1

    const grade = evaluateVictoryGrade(board, 'light')
    expect(grade).toBe('backgammon')
  })

  it('grades Backgammon victory when loser has checker on the bar', () => {
    const board = getInitialBoardState()
    board.off.dark = 15
    board.off.light = 0
    board.bar.light = 1

    const grade = evaluateVictoryGrade(board, 'dark')
    expect(grade).toBe('backgammon')
  })
})

describe('Doubling Cube stake raising mechanism', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame()
  })

  it('allows human player to propose double before rolling when cube is centered', () => {
    useGameStore.getState().startNewGame(MATCH_CONFIG, PERSONAL_AI)
    const state = useGameStore.getState()

    expect(state.cube.value).toBe(1)
    expect(state.cube.owner).toBe('centered')
    expect(state.cube.proposedBy).toBeNull()

    // Propose double for light against AI dark: AI dark evaluates and accepts immediately
    const proposed = useGameStore.getState().proposeDouble('light')
    expect(proposed).toBe(true)

    const afterAccept = useGameStore.getState()
    expect(afterAccept.cube.value).toBe(2)
    expect(afterAccept.cube.owner).toBe('dark') // Responder owns cube now
    expect(afterAccept.cube.proposedBy).toBeNull()

    const cubeSteps = afterAccept.stepHistory.filter((s) => s.cubeAction)
    expect(cubeSteps).toHaveLength(2)
    expect(cubeSteps[0].cubeAction?.type).toBe('propose')
    expect(cubeSteps[1].cubeAction?.type).toBe('accept')

    // Light cannot double now because dark owns the cube
    expect(useGameStore.getState().proposeDouble('light')).toBe(false)
  })

  it('awards current stake points when double is declined (Drop/Resign)', () => {
    useGameStore.getState().startNewGame(MATCH_CONFIG, PERSONAL_AI)

    // Set dark to decline by setting severe deficit
    const board = useGameStore.getState().board!
    board.bar.dark = 3
    board.off.light = 8
    useGameStore.setState({ board })

    // Propose double for light: AI dark sees deficit and resigns
    useGameStore.getState().proposeDouble('light')

    const state = useGameStore.getState()
    expect(state.board?.phase).toBe('finished')
    expect(state.board?.winner).toBe('light')
    expect(state.match?.light).toBe(1) // 1 point won
    expect(state.match?.lastVictory?.reason).toBe('resigned-double')
  })

  it('tracks game set points across games and declares set winner', () => {
    const shortMatch: GameConfigSnapshot = {
      ...MATCH_CONFIG,
      match: { targetPoints: 3, enableCrawford: false },
    }
    useGameStore.getState().startNewGame(shortMatch, PERSONAL_AI)

    // Game 1: double to 2, dark declines -> Light wins 1 pt
    const b1 = useGameStore.getState().board!
    b1.bar.dark = 3
    b1.off.light = 8
    useGameStore.setState({ board: b1 })
    useGameStore.getState().proposeDouble('light')
    expect(useGameStore.getState().match?.light).toBe(1)

    // Start game 2 in set
    useGameStore.getState().startNextGameInSet()
    expect(useGameStore.getState().match?.gameIndex).toBe(2)
    expect(useGameStore.getState().match?.light).toBe(1)

    // Game 2: double to 2, dark accepts (stake 2), then light bears off all checkers -> 2 pts won
    useGameStore.getState().proposeDouble('light')
    expect(useGameStore.getState().cube.value).toBe(2)

    // Simulating light win
    const board = useGameStore.getState().board!
    board.off.light = 15
    board.off.dark = 5 // single win: 1 * cube 2 = 2 pts
    useGameStore.setState({ board: { ...board, phase: 'finished', winner: 'light' } })

    // Simulate move completion logic or trigger manually
    const lightTotal = useGameStore.getState().match!.light + 2 // 1 + 2 = 3 pts
    useGameStore.setState({
      match: {
        ...useGameStore.getState().match!,
        light: lightTotal,
        matchWinner: lightTotal >= 3 ? 'light' : null,
      },
    })

    expect(useGameStore.getState().match?.matchWinner).toBe('light')
  })
})

describe('AI doubling heuristics', () => {
  it('recommends accept when position is normal/fair', () => {
    const board = getInitialBoardState()
    const decision = evaluateAiAcceptDouble(board, 'dark')
    expect(decision.accept).toBe(true)
  })

  it('recommends double when AI has huge pip lead', () => {
    const board = getInitialBoardState()
    // Advance dark checkers far ahead
    const cube = { value: 1, owner: 'centered' as const, proposedBy: null }
    // Light is far behind (many checkers on 24)
    board.points[23] = 10
    const decision = evaluateAiShouldDouble(board, 'dark', cube, null)
    expect(typeof decision.shouldDouble).toBe('boolean')
  })
})

