import { describe, expect, it } from 'vitest'
import { deriveTurnEntries } from '@/utils/gameLog'
import type { GameSnapshot } from '@/types/gameLog'
import { getInitialBoardState } from '@/utils/gameLogic'

describe('deriveTurnEntries', () => {
  it('skips step 0 (initial board state) and groups steps by turnNumber', () => {
    const initialBoard = getInitialBoardState()
    const snapshots: GameSnapshot[] = [
      {
        stepIndex: 0,
        turnNumber: 1,
        player: 'light',
        board: initialBoard,
        lastRoll: null,
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        aiThought: null,
        description: 'Game started',
      },
      {
        stepIndex: 1,
        turnNumber: 1,
        player: 'light',
        board: { ...initialBoard, dice: [5, 3] },
        lastRoll: [5, 3],
        diceRemaining: [5, 3],
        selectedFrom: null,
        turnPassed: null,
        aiThought: null,
        description: 'Rolled 5-3',
      },
      {
        stepIndex: 2,
        turnNumber: 1,
        player: 'light',
        board: { ...initialBoard, dice: [3] },
        lastRoll: [5, 3],
        diceRemaining: [3],
        selectedFrom: null,
        turnPassed: null,
        aiThought: null,
        description: '13 → 8',
        lastMove: {
          from: 13,
          to: 8,
          die: 5,
          isHit: false,
          formatted: '13 → 8',
        },
      },
      {
        stepIndex: 3,
        turnNumber: 1,
        player: 'light',
        board: { ...initialBoard, dice: [], turn: 'dark' },
        lastRoll: [5, 3],
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        aiThought: null,
        description: '8 → 5',
        lastMove: {
          from: 8,
          to: 5,
          die: 3,
          isHit: false,
          formatted: '8 → 5',
        },
      },
    ]

    const entries = deriveTurnEntries(snapshots, null)
    expect(entries).toHaveLength(1)
    expect(entries[0].turnNumber).toBe(1)
    expect(entries[0].player).toBe('light')
    expect(entries[0].roll).toEqual([5, 3])
    expect(entries[0].moves).toHaveLength(2)
    expect(entries[0].moves[0].formatted).toBe('13 → 8')
    expect(entries[0].moves[1].formatted).toBe('8 → 5')
    expect(entries[0].stepIndices).toEqual([1, 2, 3])
  })

  it('records hits and AI thoughts correctly', () => {
    const initialBoard = getInitialBoardState()
    const snapshots: GameSnapshot[] = [
      {
        stepIndex: 1,
        turnNumber: 2,
        player: 'dark',
        board: { ...initialBoard, turn: 'dark', dice: [4, 2] },
        lastRoll: [4, 2],
        diceRemaining: [4, 2],
        selectedFrom: null,
        turnPassed: null,
        aiThought: 'Advancing blot to attack opponent home',
        description: 'Rolled 4-2',
      },
      {
        stepIndex: 2,
        turnNumber: 2,
        player: 'dark',
        board: { ...initialBoard, turn: 'dark', dice: [2] },
        lastRoll: [4, 2],
        diceRemaining: [2],
        selectedFrom: null,
        turnPassed: null,
        aiThought: 'Advancing blot to attack opponent home',
        description: '1 → 5*',
        lastMove: {
          from: 1,
          to: 5,
          die: 4,
          isHit: true,
          formatted: '1 → 5*',
        },
      },
    ]

    const entries = deriveTurnEntries(snapshots, null)
    expect(entries).toHaveLength(1)
    expect(entries[0].turnNumber).toBe(2)
    expect(entries[0].player).toBe('dark')
    expect(entries[0].moves[0].isHit).toBe(true)
    expect(entries[0].aiThought).toBe('Advancing blot to attack opponent home')
  })
})

