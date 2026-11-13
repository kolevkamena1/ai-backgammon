// @vitest-environment jsdom
import { useAiTurn } from '@/hooks/useAiTurn'
import { useGameStore } from '@/state/gameStore'
import type { GameConfigSnapshot } from '@/types/gameConfig'
import type { AiEngineConfig } from '@/types/settings'
import { getAiMove } from '@/utils/aiClient'
import { getInitialBoardState, getLegalMoves } from '@/utils/gameLogic'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/aiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/aiClient')>()
  return { ...actual, getAiMove: vi.fn() }
})
const mockedGetAiMove = vi.mocked(getAiMove)

// Pass-through by default; individual tests can force the AI's cube decision.
const cubeControl = vi.hoisted(() => ({ forceDouble: false }))
vi.mock('@/utils/doublingAi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/doublingAi')>()
  return {
    ...actual,
    evaluateAiShouldDouble: (...args: Parameters<typeof actual.evaluateAiShouldDouble>) =>
      cubeControl.forceDouble ? { ...actual.evaluateAiShouldDouble(...args), shouldDouble: true } : actual.evaluateAiShouldDouble(...args),
  }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const personal: AiEngineConfig = { provider: 'openai', apiKey: 'sk-test-1234', model: 'gpt-test', baseUrl: '' }
const humanVsAi: GameConfigSnapshot = { mode: 'humanVsAi', aiMatchType: 'mirror', opponent: personal }

function Driver() {
  useAiTurn()
  return null
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useGameStore.getState().resetGame()
  mockedGetAiMove.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** Flush the async AI chain until a predicate holds (or give up). */
const waitFor = async (predicate: () => boolean, ms = 800): Promise<void> => {
  const start = Date.now()
  while (!predicate() && Date.now() - start < ms) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

describe('useAiTurn double resumption (B2 regression)', () => {
  it('waits while its own offer is pending, then resumes once the human accepts', async () => {
    expect(useGameStore.getState().startNewGame(humanVsAi, personal)).toBe(true)
    useGameStore.setState({ aiMoveDelayMs: 0 })
    mockedGetAiMove.mockImplementation(async (_config, board, player) => {
      const [move] = getLegalMoves(board, player, board.dice)
      return { success: true, move, choice: 1, explanation: null }
    })

    // Dark (AI) has proposed a double; the human (light) has not answered yet.
    useGameStore.setState({
      board: { ...getInitialBoardState(), turn: 'dark', dice: [], phase: 'playing' },
      cube: { value: 1, owner: 'centered', proposedBy: 'dark' },
    })

    act(() => {
      root.render(<Driver />)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    // While the offer is pending the AI must not roll or spend a request.
    expect(mockedGetAiMove).not.toHaveBeenCalled()
    expect(useGameStore.getState().board?.dice).toHaveLength(0)

    // The human accepts: the AI must now resume its turn (roll, then play).
    act(() => {
      useGameStore.getState().respondToDouble('light', true)
    })
    await waitFor(() => mockedGetAiMove.mock.calls.length > 0)

    expect(useGameStore.getState().cube.proposedBy).toBeNull()
    expect(mockedGetAiMove).toHaveBeenCalled()
  })
})


describe('AI-initiated doubles through the real runAiTurn path', () => {
  beforeEach(() => {
    cubeControl.forceDouble = true
    useGameStore.setState({ aiMoveDelayMs: 0 })
    mockedGetAiMove.mockImplementation(async (_config, board, player) => {
      const [move] = getLegalMoves(board, player, board.dice)
      return { success: true, move, choice: 1, explanation: null }
    })
  })

  afterEach(() => {
    cubeControl.forceDouble = false
  })

  it('offers, parks while the human deliberates, then plays on after the take', async () => {
    expect(useGameStore.getState().startNewGame(humanVsAi, personal)).toBe(true)
    useGameStore.setState({
      aiMoveDelayMs: 0,
      board: { ...getInitialBoardState(), turn: 'dark', dice: [], phase: 'playing' },
      cube: { value: 1, owner: 'centered', proposedBy: null },
    })

    act(() => {
      root.render(<Driver />)
    })
    await waitFor(() => useGameStore.getState().cube.proposedBy !== null)

    // The offer is genuinely made by the AI — no state seeding.
    expect(useGameStore.getState().cube.proposedBy).toBe('dark')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(useGameStore.getState().isAiThinking).toBe(false)
    expect(useGameStore.getState().board?.dice).toHaveLength(0)
    expect(mockedGetAiMove).not.toHaveBeenCalled()

    act(() => {
      useGameStore.getState().respondToDouble('light', true)
    })
    await waitFor(() => mockedGetAiMove.mock.calls.length > 0)

    expect(useGameStore.getState().cube).toEqual({ value: 2, owner: 'light', proposedBy: null })
    expect(mockedGetAiMove).toHaveBeenCalled()
  })

  it('ends the game when the human drops the AI double', async () => {
    expect(useGameStore.getState().startNewGame(humanVsAi, personal)).toBe(true)
    useGameStore.setState({
      aiMoveDelayMs: 0,
      board: { ...getInitialBoardState(), turn: 'dark', dice: [], phase: 'playing' },
      cube: { value: 1, owner: 'centered', proposedBy: null },
    })

    act(() => {
      root.render(<Driver />)
    })
    await waitFor(() => useGameStore.getState().cube.proposedBy === 'dark')

    act(() => {
      useGameStore.getState().respondToDouble('light', false)
    })

    expect(useGameStore.getState().board?.phase).toBe('finished')
    expect(useGameStore.getState().board?.winner).toBe('dark')
    expect(mockedGetAiMove).not.toHaveBeenCalled()
  })

  it('resolves an AI-vs-AI double immediately and keeps playing', async () => {
    const aiVsAi: GameConfigSnapshot = { mode: 'aiVsAi', aiMatchType: 'mirror', opponent: personal }
    expect(useGameStore.getState().startNewGame(aiVsAi, personal)).toBe(true)
    useGameStore.setState({
      aiMoveDelayMs: 0,
      board: { ...getInitialBoardState(), turn: 'dark', dice: [], phase: 'playing' },
      cube: { value: 1, owner: 'centered', proposedBy: null },
    })

    await act(async () => {
      await useGameStore.getState().runAiTurn()
    })

    const { cube, board } = useGameStore.getState()
    expect(cube.proposedBy).toBeNull()
    if (board?.phase === 'finished') {
      // The responder dropped: the doubler wins.
      expect(board.winner).toBe('dark')
    } else {
      expect(cube).toEqual({ value: 2, owner: 'light', proposedBy: null })
      expect(mockedGetAiMove).toHaveBeenCalled()
    }
  })

  it('passes acceptDecision.reason into respondToDouble in runAiTurn and blocks proposeDouble when paused (C9 regression)', async () => {
    expect(useGameStore.getState().startNewGame(humanVsAi, personal)).toBe(true)

    // 1. Pausing blocks proposeDouble.
    useGameStore.getState().setPaused(true)
    const stepsBeforePauseDouble = useGameStore.getState().stepHistory.length
    expect(useGameStore.getState().proposeDouble('light')).toBe(false)
    expect(useGameStore.getState().cube.proposedBy).toBeNull()
    expect(useGameStore.getState().stepHistory).toHaveLength(stepsBeforePauseDouble)

    // 2. Unpaused: when runAiTurn answers a pending opponent double, reasoning is recorded on the snapshot.
    useGameStore.getState().setPaused(false)
    useGameStore.setState({
      board: { ...getInitialBoardState(), turn: 'dark', dice: [], phase: 'playing' },
      cube: { value: 1, owner: 'centered', proposedBy: 'light' },
    })

    await act(async () => {
      await useGameStore.getState().runAiTurn()
    })

    const lastSnap = useGameStore.getState().stepHistory.at(-1)
    expect(lastSnap?.kind).toBe('double-accepted')
    expect(lastSnap?.cubeAction?.reasoning).toEqual(expect.any(String))
    expect(lastSnap?.cubeAction?.reasoning?.length).toBeGreaterThan(0)
    expect(lastSnap?.aiThought).toBe(lastSnap?.cubeAction?.reasoning)
  })
})
