// @vitest-environment jsdom
import type { BoardState } from '@/types/game'
import Board from '@/components/Board'
import GameControls from '@/components/GameControls'
import { useGame } from '@/hooks/useGame'
import { useGameStore } from '@/state/gameStore'
import type { AiEngineConfig } from '@/types/settings'
import type { GameConfigSnapshot } from '@/types/gameConfig'
import { getInitialBoardState } from '@/utils/gameLogic'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAiMove } from '@/utils/aiClient'

// The transport is stubbed: these tests must never reach a real provider.
vi.mock('@/utils/aiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/aiClient')>()
  return { ...actual, getAiMove: vi.fn() }
})

const mockedGetAiMove = vi.mocked(getAiMove)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const personal: AiEngineConfig = { provider: 'openai', apiKey: 'sk-test-1234', model: 'test-model', baseUrl: '' }
const humanVsAi: GameConfigSnapshot = { mode: 'humanVsAi', aiMatchType: 'mirror', opponent: personal }
const aiVsAi: GameConfigSnapshot = { mode: 'aiVsAi', aiMatchType: 'mirror', opponent: personal }

/** `Board` wired through the hook, exactly as `App` wires it. */
function WiredBoard() {
  const game = useGame()

  return (
    <Board
      board={game.board ?? undefined}
      turn={game.board?.turn ?? null}
      legalTargets={game.legalTargets}
      selectableSources={game.selectableSources}
      selectedFrom={game.selectedFrom}
      onSelectPoint={game.handlePointClick}
      onDragStartSource={game.handlePointDragStart}
      onDropTarget={game.handlePointDrop}
    />
  )
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useGameStore.setState({
    board: null,
    seatPlan: null,
    config: null,
    lastRoll: null,
    history: [],
    selectedFrom: null,
    turnPassed: null,
    aiThought: null,
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const text = () => host.textContent ?? ''
const buttons = () => Array.from(host.querySelectorAll('button'))
const labelled = (needle: string) => buttons().find((el) => (el.textContent ?? '').includes(needle))
const pointButton = (index: number) =>
  buttons().find((el) => el.getAttribute('aria-label')?.startsWith(`Point ${index},`))
const aria = (name: string) => buttons().find((el) => el.getAttribute("aria-label") === name)
/** The tint divs live inside the triangle, so state is read from their class list. */
const tints = (index: number) => {
  const el = pointButton(index)
  return el ? Array.from(el.querySelectorAll("div")).map((d) => d.className).join(" ") : ""
}
const click = (el: HTMLElement | undefined): void => {
  if (!el) {
    throw new Error('expected a button that is not there')
  }
  act(() => {
    el.click()
  })
}

/** Seed a position deterministically instead of relying on a real roll. */
const seedBoard = (board: BoardState): void => {
  act(() => {
    useGameStore.getState().startNewGame(humanVsAi, personal)
  })
  act(() => {
    useGameStore.setState({ board })
  })
}

describe('GameControls', () => {
  it('explains that no game is running', () => {
    act(() => root.render(<GameControls />))
    expect(text()).toContain('No game in progress')
    expect(labelled('Roll dice')).toBeUndefined()
  })

  it('transitions smoothly from no game to game started without hook errors', () => {
    act(() => root.render(<GameControls />))
    expect(text()).toContain('No game in progress')

    act(() => {
      useGameStore.getState().startNewGame(humanVsAi, personal)
    })
    act(() => root.render(<GameControls />))
    expect(text()).not.toContain('No game in progress')
    expect(text()).toContain('White to roll')
  })

  it('lets the human seat roll and reports what it can do next', () => {
    act(() => {
      useGameStore.getState().startNewGame(humanVsAi, personal)
    })
    act(() => root.render(<GameControls />))

    expect(text()).toContain('White to roll')
    expect(text()).toContain('You')
    click(labelled('Roll dice'))

    const state = useGameStore.getState()
    // Either the dice are in hand (2 values, or 4 on doubles), or the roll was unplayable.
    const dice = state.board?.dice.length ?? 0
    expect(dice === 2 || dice === 4 || state.turnPassed === 'unplayable-roll').toBe(true)
    expect(labelled('Roll dice')).toBeUndefined()
  })

  it('counts the available moves once the dice are in hand', () => {
    seedBoard({ ...getInitialBoardState(), dice: [5], phase: 'playing' })
    act(() => root.render(<GameControls />))

    expect(text()).toContain('2 moves available')
    expect(text()).toContain('select a checker')
  })

  it('names the roll button after the AI seat while stepping through in dev', () => {
    act(() => {
      useGameStore.getState().startNewGame(aiVsAi, personal)
    })
    act(() => root.render(<GameControls />))

    expect(labelled('Roll for White')).toBeTruthy()
    expect(text()).not.toContain('is an AI seat')
  })

  it('refuses to render an interactive board for a finished game', () => {
    seedBoard({ ...getInitialBoardState(), dice: [5], phase: 'finished', winner: 'light' })
    act(() => root.render(<GameControls />))
    expect(text()).toContain('Game over')
    expect(text()).toContain('bore off all 15')

    act(() => root.render(<WiredBoard />))
    expect(buttons()).toHaveLength(0)
  })
})

describe('AI turn feedback', () => {
  const startMirror = (): void => {
    expect(
      useGameStore.getState().startNewGame(aiVsAi, personal),
    ).toBe(true)
    useGameStore.setState({ aiMoveDelayMs: 0 })
  }

  it('shows a thinking indicator and suspends interaction while the engine is asked', () => {
    startMirror()
    useGameStore.setState({ board: { ...getInitialBoardState(), dice: [5], phase: 'playing' }, isAiThinking: true })
    act(() => root.render(<GameControls />))

    expect(text()).toContain('Asking the engine')
    expect(text()).toContain('OpenAI')
    expect(text()).not.toContain('Roll for White')

    act(() => root.render(<WiredBoard />))
    // Even in dev, no triangle is clickable while a chain is moving pieces.
    expect(buttons()).toHaveLength(0)
  })

  it('surfaces a credential failure with a route to Settings and can dismiss it', () => {
    startMirror()
    useGameStore.setState({
      lastAiError: { code: 'unauthorized', message: 'Invalid API key. Check Settings.' },
    })
    act(() => root.render(<GameControls />))

    expect(text()).toContain('Invalid API key. Check Settings.')
    expect(labelled('Open Settings')).toBeTruthy()

    click(labelled('Dismiss'))
    expect(useGameStore.getState().lastAiError).toBeNull()
    expect(text()).not.toContain('Invalid API key')
  })

  it('routes a relay refusal to Settings too, since only the Base URL can fix it', () => {
    startMirror()
    useGameStore.setState({
      lastAiError: {
        code: 'proxy-blocked',
        message: 'The AI proxy blocked this endpoint. Check the Base URL in Settings.',
      },
    })
    act(() => root.render(<GameControls />))

    expect(text()).toContain('The AI proxy blocked this endpoint')
    expect(labelled('Open Settings')).toBeTruthy()
  })

  it('re-requests a move from the Retry button', async () => {
    startMirror()
    useGameStore.setState({
      board: { ...getInitialBoardState(), dice: [5], phase: 'playing' },
      lastAiError: { code: 'network', message: 'Could not reach the provider.' },
    })
    mockedGetAiMove.mockResolvedValue({ success: false, error: 'still down', code: 'network', retryAfterMs: null })
    act(() => root.render(<GameControls />))
    expect(labelled('Open Settings')).toBeUndefined()

    click(labelled('Retry'))
    await act(async () => {
      await vi.waitFor(() => {
        expect(useGameStore.getState().isAiThinking).toBe(false)
        expect(useGameStore.getState().lastAiError?.message).toBe('still down')
      })
    })

    expect(text()).toContain('still down')
  })
})

describe('click-to-move through the wired board', () => {
  it('plays a point-to-point move on two clicks', () => {
    // Opening layout with a single 5: 13 -> 8 and 8 -> 3 are the only legal moves.
    seedBoard({ ...getInitialBoardState(), dice: [5], phase: 'playing' })
    act(() => root.render(<WiredBoard />))

    expect(pointButton(13)).toBeTruthy()
    expect(pointButton(20)).toBeUndefined()
    // Both 13 and 8 are sources, so both start out faintly marked rather than green.
    expect(tints(13)).toContain('bg-sky-300/25')
    expect(tints(8)).toContain('bg-sky-300/25')

    click(pointButton(13))
    expect(useGameStore.getState().selectedFrom).toBe(13)
    expect(tints(13)).toContain('bg-sky-300/60')
    expect(tints(8)).toContain('bg-emerald-300/60')

    click(pointButton(8))

    const state = useGameStore.getState()
    expect(state.history).toHaveLength(1)
    expect(state.selectedFrom).toBeNull()
    expect(state.board?.points[12]).toBe(4)
    expect(state.board?.points[7]).toBe(4)
    expect(state.board?.turn).toBe('dark')
  })

  it('brings a checker in from the bar', () => {
    const points = [...getInitialBoardState().points]
    points[12] = 4 // one light checker is on the bar instead

    seedBoard({
      ...getInitialBoardState(),
      points,
      bar: { light: 1, dark: 0 },
      dice: [4],
      phase: 'playing',
    })
    act(() => root.render(<WiredBoard />))

    click(aria('Bring White in from the bar'))
    expect(useGameStore.getState().selectedFrom).toBe('bar')

    click(pointButton(21))

    const state = useGameStore.getState()
    expect(state.board?.bar.light).toBe(0)
    expect(state.board?.points[20]).toBe(1)
    expect(state.history).toHaveLength(1)
  })

  it('keeps an AI seat interactive in dev, so a match can be stepped by hand', () => {
    act(() => {
      useGameStore.getState().startNewGame(aiVsAi, personal)
    })
    act(() => {
      useGameStore.setState({ board: { ...getInitialBoardState(), dice: [5], phase: 'playing' } })
    })
    act(() => root.render(<WiredBoard />))

    // `canInteract` is false for this seat in a production build, which leaves no buttons at all.
    expect(pointButton(13)).toBeTruthy()
    click(pointButton(13))
    expect(useGameStore.getState().selectedFrom).toBe(13)
  })
})

describe('drag-and-drop moves through the wired board', () => {
  const dragEvent = (type: string): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        effectAllowed: 'none',
        dropEffect: 'none',
        setData: vi.fn(),
        getData: vi.fn(),
        setDragImage: vi.fn(),
      },
    })
    return event
  }

  it('drags a checker from a legal point and drops it onto a legal destination point', () => {
    // Opening layout with a single 5: 13 -> 8 and 8 -> 3 are the only legal moves.
    seedBoard({ ...getInitialBoardState(), dice: [5], phase: 'playing' })
    act(() => root.render(<WiredBoard />))

    const source13 = pointButton(13)
    expect(source13?.getAttribute('draggable')).toBe('true')

    act(() => {
      source13?.dispatchEvent(dragEvent('dragstart'))
    })

    // Starting the drag selects point 13 and highlights point 8 as a legal green target.
    expect(useGameStore.getState().selectedFrom).toBe(13)
    expect(tints(8)).toContain('bg-emerald-300/60')

    const target8 = pointButton(8)
    act(() => {
      target8?.dispatchEvent(dragEvent('dragover'))
      target8?.dispatchEvent(dragEvent('drop'))
    })

    const state = useGameStore.getState()
    expect(state.history).toHaveLength(1)
    expect(state.selectedFrom).toBeNull()
    expect(state.board?.points[12]).toBe(4)
    expect(state.board?.points[7]).toBe(4)
    expect(state.board?.turn).toBe('dark')
  })

  it('drags a checker from the bar onto a legal entry point', () => {
    const points = [...getInitialBoardState().points]
    points[12] = 4

    seedBoard({
      ...getInitialBoardState(),
      points,
      bar: { light: 1, dark: 0 },
      dice: [4],
      phase: 'playing',
    })
    act(() => root.render(<WiredBoard />))

    const barBtn = aria('Bring White in from the bar')
    expect(barBtn?.getAttribute('draggable')).toBe('true')

    act(() => {
      barBtn?.dispatchEvent(dragEvent('dragstart'))
    })
    expect(useGameStore.getState().selectedFrom).toBe('bar')

    const entry21 = pointButton(21)
    act(() => {
      entry21?.dispatchEvent(dragEvent('dragover'))
      entry21?.dispatchEvent(dragEvent('drop'))
    })

    const state = useGameStore.getState()
    expect(state.board?.bar.light).toBe(0)
    expect(state.board?.points[20]).toBe(1)
    expect(state.history).toHaveLength(1)
  })

  it('drags a checker from the home board into the bear-off tray', () => {
    const points = new Array<number>(24).fill(0)
    points[1] = 2 // 2 White checkers on point 2
    points[0] = -2 // 2 Black checkers on point 1

    seedBoard({
      points,
      bar: { light: 0, dark: 0 },
      off: { light: 13, dark: 13 },
      turn: 'light',
      dice: [2],
      phase: 'playing',
      winner: null,
    })
    act(() => root.render(<WiredBoard />))

    const source2 = pointButton(2)
    expect(source2?.getAttribute('draggable')).toBe('true')

    act(() => {
      source2?.dispatchEvent(dragEvent('dragstart'))
    })
    expect(useGameStore.getState().selectedFrom).toBe(2)

    const trayBtn = aria('Bear off into the White tray')
    expect(trayBtn).toBeTruthy()

    act(() => {
      trayBtn?.dispatchEvent(dragEvent('dragover'))
      trayBtn?.dispatchEvent(dragEvent('drop'))
    })

    const state = useGameStore.getState()
    expect(state.board?.off.light).toBe(14)
    expect(state.board?.points[1]).toBe(1)
    expect(state.history).toHaveLength(1)
  })

  it('ignores drops onto non-target points', () => {
    seedBoard({ ...getInitialBoardState(), dice: [5], phase: 'playing' })
    act(() => root.render(<WiredBoard />))

    const source13 = pointButton(13)
    act(() => {
      source13?.dispatchEvent(dragEvent('dragstart'))
    })

    // Point 6 has checkers (so it is a button), but it is not a legal target for 13 with die 5.
    const nonTarget6 = pointButton(6)
    act(() => {
      nonTarget6?.dispatchEvent(dragEvent('drop'))
    })

    const state = useGameStore.getState()
    expect(state.history).toHaveLength(0)
    expect(state.board?.points[12]).toBe(5)
  })
})

describe('AI thought panel', () => {
  const startMirror = (): void => {
    expect(useGameStore.getState().startNewGame(aiVsAi, personal)).toBe(true)
    useGameStore.setState({ aiMoveDelayMs: 0 })
  }

  const seed = (): void => {
    startMirror()
    useGameStore.setState({ board: { ...getInitialBoardState(), dice: [5], phase: 'playing' } })
  }

  it('says which seat said it', () => {
    seed()
    useGameStore.setState({ aiThought: { seat: 'dark', text: 'I block your 6-point.', phase: 'final' } })
    act(() => root.render(<GameControls />))

    expect(text()).toContain('Black says')
    expect(text()).toContain('I block your 6-point.')
    // The panel belongs to the seat that spoke, not the one to act: White is on roll here.
    expect(text()).not.toContain('White says')
  })

  it('stays away when the engine gave no reason', () => {
    seed()
    act(() => root.render(<GameControls />))

    expect(host.querySelector('[aria-label="AI reasoning"]')).toBeNull()
    expect(text()).not.toContain('says')
  })

  it('marks itself busy while a sentence is still arriving', () => {
    seed()
    useGameStore.setState({ aiThought: { seat: 'light', text: 'I am building a prim', phase: 'streaming' } })
    act(() => root.render(<GameControls />))

    const live = host.querySelector('[aria-live="polite"]')
    expect(live?.getAttribute('aria-busy')).toBe('true')
    expect(text()).toContain('White is reasoning')
    expect(text()).toContain('I am building a prim')
  })

  /** The panel's own dismiss control, found by label prefix because `aria()` matches exactly. */
  const dismiss = (): HTMLElement | undefined =>
    buttons().find((el) => (el.getAttribute('aria-label') ?? '').startsWith('Hide the engine'))

  it('hides on dismiss without touching the board or the turn', () => {
    seed()
    const before = useGameStore.getState().board
    useGameStore.setState({ aiThought: { seat: 'light', text: 'I hit your blot.', phase: 'final' } })
    act(() => root.render(<GameControls />))

    click(dismiss())
    expect(useGameStore.getState().aiThought).toBeNull()
    expect(text()).not.toContain('I hit your blot.')
    expect(useGameStore.getState().board).toEqual(before)
    expect(useGameStore.getState().board?.turn).toBe('light')
  })
})
