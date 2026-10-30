import type { AiErrorCode, AiResult } from '@/types/ai'
import type { GameConfigSnapshot } from '@/types/gameConfig'
import type { AiEngineConfig } from '@/types/settings'
import { MAX_AI_MOVES_PER_TURN, useGameStore } from '@/state/gameStore'
import { getAiMove } from '@/utils/aiClient'
import { getInitialBoardState, getLegalMoves } from '@/utils/gameLogic'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/aiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/aiClient')>()
  return { ...actual, getAiMove: vi.fn() }
})

const mockedGetAiMove = vi.mocked(getAiMove)

const personal: AiEngineConfig = {
  provider: 'openai',
  apiKey: 'sk-test-1234',
  model: 'gpt-test',
  baseUrl: '',
}
const aiVsAi: GameConfigSnapshot = { mode: 'aiVsAi', aiMatchType: 'mirror', opponent: personal }
const humanVsAi: GameConfigSnapshot = { mode: 'humanVsAi', aiMatchType: 'mirror', opponent: personal }

/** Every seat shares the one personal engine object in a mirror match. */
function startMirror(): void {
  expect(useGameStore.getState().startNewGame(aiVsAi, personal)).toBe(true)
  useGameStore.setState({ aiMoveDelayMs: 0 })
}

const acceptAnyLegal = (): void => {
  mockedGetAiMove.mockImplementation(async (_config, board, player) => {
    const [move] = getLegalMoves(board, player, board.dice)
    return { success: true, move, choice: 1, explanation: null }
  })
}

const rejectWith = (code: AiErrorCode, error = 'provider said no'): void => {
  mockedGetAiMove.mockResolvedValue({ success: false, error, code, retryAfterMs: null })
}

beforeEach(() => {
  useGameStore.getState().resetGame()
  mockedGetAiMove.mockReset()
})

describe('aiMakeMove', () => {
  it('does nothing on a human seat', async () => {
    expect(useGameStore.getState().startNewGame(humanVsAi, personal)).toBe(true)
    useGameStore.getState().roll()

    await expect(useGameStore.getState().aiMakeMove()).resolves.toBe(false)
    expect(mockedGetAiMove).not.toHaveBeenCalled()
    expect(useGameStore.getState().isAiThinking).toBe(false)
  })

  it('plays the move the engine chose and clears the thinking flag', async () => {
    startMirror()
    acceptAnyLegal()
    useGameStore.getState().roll()

    await expect(useGameStore.getState().aiMakeMove()).resolves.toBe(true)

    const state = useGameStore.getState()
    expect(mockedGetAiMove).toHaveBeenCalledTimes(1)
    expect(state.history).toHaveLength(1)
    expect(state.isAiThinking).toBe(false)
    expect(state.lastAiError).toBeNull()
  })

  it('asks the seat engine from the snapshot, for the seat to act', async () => {
    startMirror()
    acceptAnyLegal()
    useGameStore.getState().roll()
    await useGameStore.getState().aiMakeMove()

    const [config, board, player] = mockedGetAiMove.mock.calls[0]
    expect(config).toBe(personal)
    expect(board.turn).toBe(player)
    expect(player).toBe('light')
  })

  it('surfaces a transport failure without touching the board', async () => {
    startMirror()
    rejectWith('unauthorized', 'Invalid API key. Check Settings.')
    useGameStore.getState().roll()

    const before = useGameStore.getState().board
    await expect(useGameStore.getState().aiMakeMove()).resolves.toBe(false)

    const state = useGameStore.getState()
    expect(state.lastAiError).toEqual({ code: 'unauthorized', message: 'Invalid API key. Check Settings.' })
    expect(state.history).toHaveLength(0)
    expect(state.board).toEqual(before)
    expect(state.isAiThinking).toBe(false)
  })

  it('stops when the rules engine rejects the chosen move', async () => {
    startMirror()
    mockedGetAiMove.mockResolvedValue({ success: true, move: { from: 24, to: 1, die: 6 }, choice: 99, explanation: null })
    useGameStore.getState().roll()

    await expect(useGameStore.getState().aiMakeMove()).resolves.toBe(false)
    expect(useGameStore.getState().lastAiError?.code).toBe('illegal-move')
    expect(useGameStore.getState().history).toHaveLength(0)
  })

  it('ignores a reply for a game that no longer exists', async () => {
    startMirror()
    useGameStore.getState().roll()

    let release: (value: AiResult) => void = () => {}
    mockedGetAiMove.mockImplementation(
      () =>
        new Promise<AiResult>((resolve) => {
          release = resolve
        }),
    )

    const running = useGameStore.getState().runAiTurn()
    await Promise.resolve()

    useGameStore.getState().resetGame()
    // Carries an explanation on purpose: a reply for an abandoned game must not leave its reason
    // sitting in the panel of the game that replaced it.
    release({ success: true, move: { from: 13, to: 8, die: 5 }, choice: 1, explanation: 'I bring a checker home.' })
    await running

    const state = useGameStore.getState()
    expect(state.board).toBeNull()
    expect(state.history).toHaveLength(0)
    expect(state.isAiThinking).toBe(false)
    expect(state.aiThought).toBeNull()
    // The in-flight request was cancelled rather than left running.
    expect(mockedGetAiMove.mock.calls[0][3]?.signal?.aborted).toBe(true)
  })
})

describe('runAiTurn', () => {
  it('rolls for an AI seat, because nothing else can', async () => {
    startMirror()
    acceptAnyLegal()

    await useGameStore.getState().runAiTurn()

    const state = useGameStore.getState()
    expect(state.lastRoll).not.toBeNull()
    expect(state.history.length).toBeGreaterThan(0)
    expect(state.board?.turn).toBe('dark')
  })

  it('keeps playing until the dice are spent', async () => {
    startMirror()
    acceptAnyLegal()
    useGameStore.setState({
      board: { ...getInitialBoardState(), dice: [5, 5, 5, 5], phase: 'playing' },
    })

    await useGameStore.getState().runAiTurn()

    const state = useGameStore.getState()
    expect(state.history.length).toBeGreaterThan(1)
    expect(state.board?.turn).toBe('dark')
    expect(state.board?.dice).toEqual([])
    expect(mockedGetAiMove.mock.calls.length).toBeLessThanOrEqual(MAX_AI_MOVES_PER_TURN)
  })

  it('runs a single chain even when triggered twice', async () => {
    startMirror()
    acceptAnyLegal()

    await Promise.all([useGameStore.getState().runAiTurn(), useGameStore.getState().runAiTurn()])

    expect(mockedGetAiMove.mock.calls.length).toBeLessThanOrEqual(MAX_AI_MOVES_PER_TURN)
    expect(useGameStore.getState().isAiThinking).toBe(false)
  })

  it('stops at the first failure and does not spin', async () => {
    startMirror()
    rejectWith('rate-limited', 'Rate limited by the provider (429).')

    await useGameStore.getState().runAiTurn()

    expect(mockedGetAiMove).toHaveBeenCalledTimes(1)
    expect(useGameStore.getState().lastAiError?.code).toBe('rate-limited')
    expect(useGameStore.getState().isAiThinking).toBe(false)
  })

  it('does nothing for a finished game', async () => {
    startMirror()
    useGameStore.setState({
      board: { ...getInitialBoardState(), phase: 'finished', winner: 'light' },
    })

    await useGameStore.getState().runAiTurn()

    expect(mockedGetAiMove).not.toHaveBeenCalled()
    expect(useGameStore.getState().isAiThinking).toBe(false)
  })

  it('clears the error on retry and plays again', async () => {
    startMirror()
    rejectWith('network', 'Could not reach the provider.')
    await useGameStore.getState().runAiTurn()
    expect(useGameStore.getState().lastAiError?.code).toBe('network')

    acceptAnyLegal()
    useGameStore.getState().retryAiTurn()
    await vi.waitFor(() => expect(useGameStore.getState().isAiThinking).toBe(false))

    expect(useGameStore.getState().lastAiError).toBeNull()
    expect(useGameStore.getState().history.length).toBeGreaterThan(0)
  })

  it('dismisses the banner without replaying the request', () => {
    startMirror()
    useGameStore.setState({ lastAiError: { code: 'timeout', message: 'too slow' } })

    useGameStore.getState().dismissAiError()

    expect(useGameStore.getState().lastAiError).toBeNull()
    expect(mockedGetAiMove).not.toHaveBeenCalled()
  })
})

describe('aiThought', () => {
  const explained = (explanation: string | null): void => {
    mockedGetAiMove.mockImplementation(async (_config, board, player) => {
      const [move] = getLegalMoves(board, player, board.dice)
      return { success: true, move, choice: 1, explanation }
    })
  }

  it('keeps the sentence with the seat that said it', async () => {
    startMirror()
    explained('I make my five-point to shut Black in.')
    useGameStore.getState().roll()

    await expect(useGameStore.getState().aiMakeMove()).resolves.toBe(true)

    // The seat matters as much as the text: in an AI vs AI match the two sides can justify
    // contradictory plans, and a panel that says only "the AI thinks" would be unreadable.
    expect(useGameStore.getState().aiThought).toEqual({
      seat: 'light',
      text: 'I make my five-point to shut Black in.',
      phase: 'final',
    })
  })

  it('shows nothing when the model gave no reason, but still plays the move', async () => {
    startMirror()
    explained(null)
    useGameStore.getState().roll()

    await expect(useGameStore.getState().aiMakeMove()).resolves.toBe(true)

    expect(useGameStore.getState().history).toHaveLength(1)
    expect(useGameStore.getState().aiThought).toBeNull()
  })

  it('drops the previous sentence when a later request fails', async () => {
    startMirror()
    explained('I hit your blot.')
    useGameStore.getState().roll()
    await useGameStore.getState().aiMakeMove()
    expect(useGameStore.getState().aiThought).not.toBeNull()

    rejectWith('network', 'Could not reach the provider.')
    await useGameStore.getState().aiMakeMove()

    expect(useGameStore.getState().lastAiError?.code).toBe('network')
    expect(useGameStore.getState().aiThought).toBeNull()
  })

  it('is cleared by a human move, because the position it described is gone', async () => {
    expect(useGameStore.getState().startNewGame(humanVsAi, personal)).toBe(true)
    useGameStore.setState({ aiMoveDelayMs: 0 })
    useGameStore.getState().roll()
    useGameStore.setState({ aiThought: { seat: 'dark', text: 'I built a prime.', phase: 'final' } })

    const board = useGameStore.getState().board
    const legal = board === null ? [] : getLegalMoves(board, 'light', board.dice)
    expect(legal.length).toBeGreaterThan(0)
    const [move] = legal

    expect(useGameStore.getState().makeMove(move)).toBe(true)
    expect(useGameStore.getState().aiThought).toBeNull()
  })

  it('is replaced by a new sentence, and hides on demand or when the game is abandoned', async () => {
    startMirror()
    explained('I keep my builder safe.')
    useGameStore.getState().roll()
    await useGameStore.getState().aiMakeMove()
    expect(useGameStore.getState().aiThought?.text).toBe('I keep my builder safe.')

    // The dismiss button must not disturb the board: it hides a caption, not a move.
    const board = useGameStore.getState().board
    useGameStore.getState().clearAiThought()
    expect(useGameStore.getState().aiThought).toBeNull()
    expect(useGameStore.getState().board).toEqual(board)

    // A thought left over from a finished or abandoned match would be attributed to a position the
    // player can no longer see, so `resetGame` drops it on its way to nulling the board.
    useGameStore.setState({ aiThought: { seat: 'dark', text: 'stale', phase: 'final' } })
    useGameStore.getState().resetGame()
    expect(useGameStore.getState().aiThought).toBeNull()
  })
})
