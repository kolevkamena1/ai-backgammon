import { describe, expect, it } from 'vitest'
import { derivePendingTurns, deriveTurnEntries, formatClock, formatElapsed } from '@/utils/gameLog'
import type { GameSnapshot } from '@/types/gameLog'
import { getInitialBoardState } from '@/utils/gameLogic'

const DEFAULT_CUBE = { value: 1, owner: 'centered' as const, proposedBy: null }

describe('deriveTurnEntries', () => {
  it('skips step 0 (initial board state) and groups steps by turnNumber', () => {
    const initialBoard = getInitialBoardState()
    const baseTime = 1700000000000
    const snapshots: GameSnapshot[] = [
      {
        stepIndex: 0,
        turnNumber: 1,
        player: 'light',
        kind: 'game-start',
        board: initialBoard,
        lastRoll: null,
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        cube: DEFAULT_CUBE,
        match: null,
        aiThought: null,
        description: 'Game started',
        at: baseTime,
      },
      {
        stepIndex: 1,
        turnNumber: 1,
        player: 'light',
        kind: 'roll',
        board: { ...initialBoard, dice: [5, 3] },
        lastRoll: [5, 3],
        diceRemaining: [5, 3],
        selectedFrom: null,
        turnPassed: null,
        cube: DEFAULT_CUBE,
        match: null,
        aiThought: null,
        description: 'Rolled 5-3',
        at: baseTime + 1000,
      },
      {
        stepIndex: 2,
        turnNumber: 1,
        player: 'light',
        kind: 'move',
        board: { ...initialBoard, dice: [3] },
        lastRoll: [5, 3],
        diceRemaining: [3],
        selectedFrom: null,
        turnPassed: null,
        cube: DEFAULT_CUBE,
        match: null,
        aiThought: 'Moving from 13 to 8',
        description: '13 → 8',
        lastMove: {
          from: 13,
          to: 8,
          die: 5,
          isHit: false,
          formatted: '13 → 8',
        },
        at: baseTime + 2000,
      },
      {
        stepIndex: 3,
        turnNumber: 1,
        player: 'light',
        kind: 'move',
        board: { ...initialBoard, dice: [], turn: 'dark' },
        lastRoll: [5, 3],
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        cube: DEFAULT_CUBE,
        match: null,
        aiThought: 'Closing to 5',
        description: '8 → 5',
        lastMove: {
          from: 8,
          to: 5,
          die: 3,
          isHit: false,
          formatted: '8 → 5',
        },
        at: baseTime + 3000,
      },
    ]

    const entries = deriveTurnEntries(snapshots, null)
    expect(entries).toHaveLength(1)
    expect(entries[0].turnNumber).toBe(1)
    expect(entries[0].player).toBe('light')
    expect(entries[0].roll).toEqual([5, 3])
    expect(entries[0].moves).toHaveLength(2)
    expect(entries[0].moves[0].formatted).toBe('13 → 8')
    expect(entries[0].moves[0].reasoning).toBe('Moving from 13 to 8')
    expect(entries[0].moves[1].formatted).toBe('8 → 5')
    expect(entries[0].moves[1].reasoning).toBe('Closing to 5')
    expect(entries[0].stepIndices).toEqual([1, 2, 3])
    expect(entries[0].rolledAt).toBe(baseTime + 1000)
    expect(entries[0].elapsedMs).toBe(1000)
  })

  it('records hits and per-move AI thoughts correctly without overwriting', () => {
    const initialBoard = getInitialBoardState()
    const baseTime = 1700000000000
    const snapshots: GameSnapshot[] = [
      {
        stepIndex: 1,
        turnNumber: 2,
        player: 'dark',
        kind: 'roll',
        board: { ...initialBoard, turn: 'dark', dice: [4, 2] },
        lastRoll: [4, 2],
        diceRemaining: [4, 2],
        selectedFrom: null,
        turnPassed: null,
        cube: DEFAULT_CUBE,
        match: null,
        aiThought: null,
        description: 'Rolled 4-2',
        at: baseTime,
      },
      {
        stepIndex: 2,
        turnNumber: 2,
        player: 'dark',
        kind: 'move',
        board: { ...initialBoard, turn: 'dark', dice: [2] },
        lastRoll: [4, 2],
        diceRemaining: [2],
        selectedFrom: null,
        turnPassed: null,
        cube: DEFAULT_CUBE,
        match: null,
        aiThought: 'Hitting on 5 to disrupt White',
        description: '1 → 5*',
        lastMove: {
          from: 1,
          to: 5,
          die: 4,
          isHit: true,
          formatted: '1 → 5*',
        },
        at: baseTime + 1500,
      },
      {
        stepIndex: 3,
        turnNumber: 2,
        player: 'dark',
        kind: 'move',
        board: { ...initialBoard, turn: 'light', dice: [] },
        lastRoll: [4, 2],
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        cube: DEFAULT_CUBE,
        match: null,
        aiThought: 'Safely moving blot',
        description: '6 → 8',
        lastMove: {
          from: 6,
          to: 8,
          die: 2,
          isHit: false,
          formatted: '6 → 8',
        },
        at: baseTime + 2500,
      },
    ]

    const entries = deriveTurnEntries(snapshots, null)
    expect(entries).toHaveLength(1)
    expect(entries[0].turnNumber).toBe(2)
    expect(entries[0].player).toBe('dark')
    expect(entries[0].moves).toHaveLength(2)
    expect(entries[0].moves[0].isHit).toBe(true)
    expect(entries[0].moves[0].reasoning).toBe('Hitting on 5 to disrupt White')
    expect(entries[0].moves[1].isHit).toBe(false)
    expect(entries[0].moves[1].reasoning).toBe('Safely moving blot')
  })

  it('records doubling cube proposals and acceptances into turn entries', () => {
    const initialBoard = getInitialBoardState()
    const baseTime = 1700000000000
    const snapshots: GameSnapshot[] = [
      {
        stepIndex: 0,
        turnNumber: 1,
        player: 'light',
        kind: 'game-start',
        board: initialBoard,
        lastRoll: null,
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        cube: DEFAULT_CUBE,
        match: null,
        aiThought: null,
        description: 'Game started',
        at: baseTime,
      },
      {
        stepIndex: 1,
        turnNumber: 1,
        player: 'light',
        kind: 'double-proposed',
        board: initialBoard,
        lastRoll: null,
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        cube: { value: 1, owner: 'centered', proposedBy: 'light' },
        match: null,
        cubeAction: {
          type: 'propose',
          player: 'light',
          value: 2,
          at: baseTime + 500,
        },
        aiThought: null,
        description: 'White proposed double to 2',
        at: baseTime + 500,
      },
      {
        stepIndex: 2,
        turnNumber: 1,
        player: 'dark',
        kind: 'double-accepted',
        board: initialBoard,
        lastRoll: null,
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        cube: { value: 2, owner: 'dark', proposedBy: null },
        match: null,
        cubeAction: {
          type: 'accept',
          player: 'dark',
          value: 2,
          reasoning: 'Good chances in bear-off',
          at: baseTime + 600,
        },
        aiThought: 'Good chances in bear-off',
        description: 'Black accepted double (2x)',
        at: baseTime + 600,
      },
      {
        stepIndex: 3,
        turnNumber: 1,
        player: 'light',
        kind: 'roll',
        board: { ...initialBoard, dice: [4, 2] },
        lastRoll: [4, 2],
        diceRemaining: [4, 2],
        selectedFrom: null,
        turnPassed: null,
        cube: { value: 2, owner: 'dark', proposedBy: null },
        match: null,
        aiThought: null,
        description: 'Rolled 4-2',
        at: baseTime + 1000,
      },
    ]

    const entries = deriveTurnEntries(snapshots, null)
    expect(entries).toHaveLength(1)
    expect(entries[0].turnNumber).toBe(1)
    expect(entries[0].cubeActions).toHaveLength(2)
    expect(entries[0].cubeActions![0]).toEqual({
      type: 'propose',
      player: 'light',
      value: 2,
      reasoning: null,
      at: baseTime + 500,
    })
    expect(entries[0].cubeActions![1]).toEqual({
      type: 'accept',
      player: 'dark',
      value: 2,
      reasoning: 'Good chances in bear-off',
      at: baseTime + 600,
    })
    expect(entries[0].roll).toEqual([4, 2])
  })
})

describe('derivePendingTurns and formatters', () => {
  it('derives pending turns correctly', () => {
    const entries = [
      {
        turnNumber: 1,
        player: 'light' as const,
        actorKind: 'human' as const,
        actorName: 'White',
        roll: [3, 1] as const,
        moves: [],
        passedReason: null,
        rolledAt: 1000,
        elapsedMs: 0,
        stepIndices: [1],
      },
    ]
    const recordedRolls = [[3, 1] as const, [4, 4] as const, [6, 2] as const]
    const pending = derivePendingTurns(entries, recordedRolls, 2, 'dark')

    expect(pending).toHaveLength(2)
    expect(pending[0]).toEqual({ turnNumber: 2, player: 'dark', roll: [4, 4] })
    expect(pending[1]).toEqual({ turnNumber: 3, player: 'light', roll: [6, 2] })
  })

  it('formats elapsed time correctly', () => {
    expect(formatElapsed(14000)).toBe('+00:14')
    expect(formatElapsed(134000)).toBe('+02:14')
    expect(formatElapsed(3725000)).toBe('+1:02:05')
  })

  it('formats clock time', () => {
    const formatted = formatClock(new Date(2026, 10, 3, 14, 5, 9).getTime())
    expect(formatted).toBe('14:05:09')
  })
})
