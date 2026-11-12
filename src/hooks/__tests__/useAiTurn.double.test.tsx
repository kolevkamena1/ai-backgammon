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