import {
  BAR_OUTSIDE,
  DIRECTION,
  HOME_BOARD,
  POINT_COUNT,
  applyMove,
  canPlay,
  checkerCountAt,
  destinationFor,
  endTurn,
  expandRoll,
  getInitialBoardState,
  getLegalMoves,
  getWinner,
  IllegalMoveError,
  isInHomeBoard,
  isEnterable,
  isHomePoint,
  otherPlayer,
  ownerOf,
  pipsToBearOff,
  pointValue,
  rollDice,
  rollPair,
  sign,
  toPointViews,
  type RandomSource,
} from '@/utils/gameLogic'
import type {
  BoardState,
  DieFace,
  DiceRoll,
  Move,
  MoveSource,
  MoveTarget,
  PlayerColor,
  PointValue,
} from '@/types/game'
import { describe, expect, it } from 'vitest'

/** Light checkers are positive, dark are negative — the convention `points` uses. */
const L = (count: number): PointValue => count
const D = (count: number): PointValue => -count

function emptyBoard(overrides: Partial<BoardState> = {}): BoardState {
  return {
    points: Array.from({ length: POINT_COUNT }, (): PointValue => 0),
    bar: { light: 0, dark: 0 },
    off: { light: 0, dark: 0 },
    turn: 'light',
    dice: [],
    phase: 'playing',
    winner: null,
    ...overrides,
  }
}

/** `entries` keys are point numbers (1..24), values are signed counts. */
function boardWith(entries: Record<number, PointValue>, overrides: Partial<BoardState> = {}): BoardState {
  const board = emptyBoard(overrides)
  for (const [index, value] of Object.entries(entries)) {
    board.points[Number(index) - 1] = value
  }
  return board
}

/** Deterministic rng cycling through fixed values, so dice branches are testable. */
function seqRng(values: number[]): RandomSource {
  let cursor = 0
  return () => {
    const value = values[cursor % values.length]
    cursor += 1
    return value
  }
}

/** Small linear congruential generator: reproducible across runs and machines. */
function lcg(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function deepFreeze<T>(value: T): T {
  Object.freeze(value)
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (nested && typeof nested === 'object') {
      deepFreeze(nested)
    }
  }
  return value
}

function hasMove(moves: readonly Move[], from: MoveSource, to: MoveTarget, die: DieFace): boolean {
  return moves.some((move) => move.from === from && move.to === to && move.die === die)
}

function countFor(board: BoardState, player: PlayerColor): number {
  let total = board.bar[player] + board.off[player]
  for (let index = 1; index <= POINT_COUNT; index += 1) {
    if (ownerOf(board, index) === player) {
      total += checkerCountAt(board, index)
    }
  }
  return total
}

describe('getInitialBoardState', () => {
  it('has exactly 24 points and starts idle with light to move', () => {
    const board = getInitialBoardState()
    expect(board.points).toHaveLength(POINT_COUNT)
    expect(board.turn).toBe('light')
    expect(board.dice).toEqual([])
    expect(board.phase).toBe('idle')
    expect(board.winner).toBeNull()
  })

  it('places the standard 2 / 5 / 3 / 5 opening for both sides', () => {
    const board = getInitialBoardState()
    expect(pointValue(board, 1)).toBe(D(2))
    expect(pointValue(board, 6)).toBe(L(5))
    expect(pointValue(board, 8)).toBe(L(3))
    expect(pointValue(board, 12)).toBe(D(5))
    expect(pointValue(board, 13)).toBe(L(5))
    expect(pointValue(board, 17)).toBe(D(3))
    expect(pointValue(board, 19)).toBe(D(5))
    expect(pointValue(board, 24)).toBe(L(2))

    const occupied = board.points.filter((value) => value !== 0)
    expect(occupied).toHaveLength(8)
  })

  it('gives each side exactly 15 checkers, none bar or off', () => {
    const board = getInitialBoardState()
    expect(countFor(board, 'light')).toBe(15)
    expect(countFor(board, 'dark')).toBe(15)
    expect(board.bar).toEqual({ light: 0, dark: 0 })
    expect(board.off).toEqual({ light: 0, dark: 0 })
  })
})

describe('dice', () => {
  it('rollPair consumes exactly two draws', () => {
    let draws = 0
    const counting: RandomSource = () => {
      draws += 1
      return 0.5
    }
    const roll = rollPair(counting)
    expect(draws).toBe(2)
    expect(roll).toHaveLength(2)
  })

  it('expands doubles into four playable dice', () => {
    const doubles: DiceRoll = [3, 3]
    expect(expandRoll(doubles)).toEqual([3, 3, 3, 3])
    expect(expandRoll([6, 2])).toEqual([6, 2])
  })

  it('rollDice yields four of a kind on a doubled roll', () => {
    // 0 -> 1, 5/6 -> 6: both dice land on 6.
    expect(rollDice(seqRng([5 / 6, 5 / 6]))).toEqual([6, 6, 6, 6])
    expect(rollDice(seqRng([0, 5 / 6]))).toEqual([1, 6])
  })

  it('never produces an out-of-range face, even from a hostile rng', () => {
    for (const raw of [0, 0.17, 0.5, 0.999999, 1, 1.4, -0.2]) {
      const face = rollPair(seqRng([raw, raw]))[0]
      expect(face).toBeGreaterThanOrEqual(1)
      expect(face).toBeLessThanOrEqual(6)
    }
  })
})

describe('queries', () => {
  it('resolves sign, direction and home ranges consistently', () => {
    expect(sign('light')).toBe(1)
    expect(sign('dark')).toBe(-1)
    expect(otherPlayer('light')).toBe('dark')
    expect(DIRECTION.light).toBe(-1)
    expect(DIRECTION.dark).toBe(1)
    expect(BAR_OUTSIDE.light).toBe(25)
    expect(BAR_OUTSIDE.dark).toBe(0)
    expect(HOME_BOARD.light).toEqual([1, 6])
    expect(HOME_BOARD.dark).toEqual([19, 24])
    expect(isHomePoint('light', 6)).toBe(true)
    expect(isHomePoint('light', 7)).toBe(false)
    expect(isHomePoint('dark', 19)).toBe(true)
    expect(pipsToBearOff('light', 4)).toBe(4)
    expect(pipsToBearOff('dark', 4)).toBe(21)
  })

  it('ownerOf and checkerCountAt read the signed array', () => {
    const board = boardWith({ 5: L(3), 20: D(2) })
    expect(ownerOf(board, 5)).toBe('light')
    expect(ownerOf(board, 20)).toBe('dark')
    expect(ownerOf(board, 12)).toBeNull()
    expect(checkerCountAt(board, 20)).toBe(2)
    expect(pointValue(board, 99)).toBe(0)
  })

  it('destinationFor walks each colour toward its own tray', () => {
    expect(destinationFor('light', 12, 5)).toBe(7)
    expect(destinationFor('dark', 12, 5)).toBe(17)
    expect(destinationFor('light', 4, 6)).toBe('off')
    expect(destinationFor('dark', 22, 4)).toBe('off')
    // Bar entries: light lands in dark's home board, dark in light's.
    expect(destinationFor('light', 'bar', 1)).toBe(24)
    expect(destinationFor('light', 'bar', 6)).toBe(19)
    expect(destinationFor('dark', 'bar', 1)).toBe(1)
    expect(destinationFor('dark', 'bar', 6)).toBe(6)
  })

  it('isEnterable allows empty, friendly and a single blot but never a block', () => {
    const board = boardWith({ 5: L(2), 9: D(1), 14: D(2), 20: 0 })
    expect(isEnterable(board, 'light', 20)).toBe(true)
    expect(isEnterable(board, 'light', 5)).toBe(true)
    expect(isEnterable(board, 'light', 9)).toBe(true)
    expect(isEnterable(board, 'light', 14)).toBe(false)
    expect(isEnterable(board, 'dark', 5)).toBe(false)
    expect(isEnterable(board, 'light', 'off')).toBe(false)
  })

  it('isInHomeBoard requires all survivors in range and nothing on the bar', () => {
    const scattered = boardWith({ 4: L(5), 6: L(5), 13: L(5) })
    expect(isInHomeBoard(scattered, 'light')).toBe(false)

    const gathered = boardWith({ 1: L(5), 6: L(10) })
    expect(isInHomeBoard(gathered, 'light')).toBe(true)

    const withBar = boardWith({ 1: L(13), 6: L(1) }, { bar: { light: 1, dark: 0 } })
    expect(isInHomeBoard(withBar, 'light')).toBe(false)

    // Two already borne off: the requirement drops to the 13 still on the board.
    const partlyOff = boardWith({ 3: L(13) }, { off: { light: 2, dark: 0 } })
    expect(isInHomeBoard(partlyOff, 'light')).toBe(true)
  })

  it('getWinner fires only at 15 borne off', () => {
    expect(getWinner(boardWith({ 1: L(14) }))).toBeNull()
    expect(getWinner(emptyBoard({ off: { light: 15, dark: 3 } }))).toBe('light')
    expect(getWinner(emptyBoard({ off: { light: 0, dark: 15 } }))).toBe('dark')
  })

  it('toPointViews mirrors the signed array', () => {
    const views = toPointViews(getInitialBoardState())
    expect(views).toHaveLength(POINT_COUNT)
    expect(views[0]).toEqual({ index: 1, checkers: 2, owner: 'dark' })
    expect(views[5]).toEqual({ index: 6, checkers: 5, owner: 'light' })
    expect(views[2]).toEqual({ index: 3, checkers: 0, owner: null })
    const mismatch = views.find((view, position) => view.checkers !== Math.abs(getInitialBoardState().points[position]))
    expect(mismatch).toBeUndefined()
  })
})

describe('getLegalMoves', () => {
  it('offers only bar entries while a checker sits on the bar', () => {
    const board = boardWith({ 6: L(2), 24: D(2) }, { bar: { light: 1, dark: 0 } })
    const moves = getLegalMoves(board, 'light', [3, 5])
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.every((move) => move.from === 'bar')).toBe(true)
    expect(hasMove(moves, 'bar', 22, 3)).toBe(true)
    expect(hasMove(moves, 'bar', 20, 5)).toBe(true)
  })

  it('refuses every entry when each candidate point is blocked', () => {
    const board = boardWith({ 22: D(2), 20: D(2) }, { bar: { light: 1, dark: 0 } })
    expect(getLegalMoves(board, 'light', [3, 5])).toEqual([])
    expect(canPlay(board, 'light', [3, 5])).toBe(false)
  })

  it('suppresses normal moves completely while on the bar', () => {
    const board = boardWith({ 20: L(1), 16: L(1) }, { bar: { light: 1, dark: 0 } })
    const moves = getLegalMoves(board, 'light', [4])
    expect(moves).toEqual([{ from: 'bar', to: 21, die: 4 }])
  })

  it('allows hitting a blot but never a blocked point', () => {
    const board = boardWith({ 12: L(2), 7: D(1), 9: D(2) })
    const moves = getLegalMoves(board, 'light', [5, 3])
    expect(hasMove(moves, 12, 7, 5)).toBe(true)
    expect(hasMove(moves, 12, 9, 3)).toBe(false)
  })

  it('allows stacking onto a friendly point', () => {
    const board = boardWith({ 12: L(1), 7: L(3) })
    expect(hasMove(getLegalMoves(board, 'light', [5]), 12, 7, 5)).toBe(true)
  })

  it('runs dark in the opposite direction, entries included', () => {
    const hitting = boardWith({ 1: D(2), 4: L(1) }, { turn: 'dark' })
    expect(hasMove(getLegalMoves(hitting, 'dark', [3]), 1, 4, 3)).toBe(true)

    const entering = boardWith({ 4: L(1) }, { bar: { light: 0, dark: 1 }, turn: 'dark' })
    expect(hasMove(getLegalMoves(entering, 'dark', [4]), 'bar', 4, 4)).toBe(true)

    const blocked = boardWith({ 1: D(2), 4: L(2) }, { turn: 'dark' })
    expect(hasMove(getLegalMoves(blocked, 'dark', [3]), 1, 4, 3)).toBe(false)
  })

  it('blocks bearing off until every remaining checker is home', () => {
    const scattered = boardWith({ 4: L(3), 13: L(2) }, { off: { light: 10, dark: 0 } })
    expect(isInHomeBoard(scattered, 'light')).toBe(false)
    expect(getLegalMoves(scattered, 'light', [1, 3, 4, 6]).some((move) => move.to === 'off')).toBe(false)

    const gathered = boardWith({ 4: L(3), 6: L(2) }, { off: { light: 10, dark: 0 } })
    expect(isInHomeBoard(gathered, 'light')).toBe(true)
    expect(hasMove(getLegalMoves(gathered, 'light', [4]), 4, 'off', 4)).toBe(true)
  })

  it('bears off with the exact die', () => {
    const board = boardWith({ 3: L(2), 6: L(1) }, { off: { light: 12, dark: 0 } })
    const moves = getLegalMoves(board, 'light', [3])
    expect(hasMove(moves, 3, 'off', 3)).toBe(true)
    expect(hasMove(moves, 6, 'off', 3)).toBe(false)
  })

  it('allows a higher die only when nothing sits farther from the tray', () => {
    const near = boardWith({ 2: L(3) }, { off: { light: 12, dark: 0 } })
    expect(hasMove(getLegalMoves(near, 'light', [6]), 2, 'off', 6)).toBe(true)

    const farther = boardWith({ 2: L(3), 6: L(1) }, { off: { light: 11, dark: 0 } })
    const six = getLegalMoves(farther, 'light', [6])
    expect(hasMove(six, 2, 'off', 6)).toBe(false)
    expect(hasMove(six, 6, 'off', 6)).toBe(true)

    // A 5 fits nothing here: too small for point 6, and point 2 is blocked by it.
    expect(getLegalMoves(farther, 'light', [5]).filter((move) => move.to === 'off')).toEqual([])
  })

  it('returns nothing for a finished game or an empty dice pool', () => {
    const board = boardWith({ 13: L(2) })
    expect(getLegalMoves({ ...board, phase: 'finished', winner: 'light' }, 'light', [3])).toEqual([])
    expect(getLegalMoves(board, 'light', [])).toEqual([])
    expect(canPlay(board, 'light', [])).toBe(false)
  })

  it('deduplicates a destination offered by four equal dice', () => {
    const board = boardWith({ 13: L(2), 8: D(1) })
    const moves = getLegalMoves(board, 'light', [5, 5, 5, 5])
    const keys = moves.map((move) => `${move.from}|${move.to}|${move.die}`)
    expect(keys).toHaveLength(new Set(keys).size)
    expect(moves).toHaveLength(1)
    expect(moves[0]).toEqual({ from: 13, to: 8, die: 5 })
  })
})

describe('applyMove', () => {
  it('never mutates the board it is given', () => {
    const board = deepFreeze({ ...getInitialBoardState(), dice: [5, 3] as DieFace[] })
    const move = getLegalMoves(board, 'light', board.dice)[0]
    const next = applyMove(board, move, 'light')

    expect(next).not.toBe(board)
    expect(next.points).not.toBe(board.points)
    expect(next.points).toHaveLength(POINT_COUNT)
    expect(board.off).toEqual({ light: 0, dark: 0 })
    expect(countFor(board, 'light')).toBe(15)
    expect(countFor(next, 'light')).toBe(15)
  })

  it('moves a checker and spends exactly one die', () => {
    const board = boardWith({ 13: L(2) }, { dice: [5, 3] })
    const next = applyMove(board, { from: 13, to: 8, die: 5 }, 'light')
    expect(pointValue(next, 13)).toBe(L(1))
    expect(pointValue(next, 8)).toBe(L(1))
    expect(next.dice).toEqual([3])
    expect(next.turn).toBe('light')
  })

  it('sends a single enemy blot to the bar', () => {
    const board = boardWith({ 12: L(2), 7: D(1) }, { dice: [5] })
    const next = applyMove(board, { from: 12, to: 7, die: 5 }, 'light')
    expect(pointValue(next, 7)).toBe(L(1))
    expect(pointValue(next, 12)).toBe(L(1))
    expect(next.bar.dark).toBe(1)
    expect(countFor(next, 'dark')).toBe(1)
    expect(next.turn).toBe('dark')
  })

  it('brings a checker in from the bar', () => {
    const board = boardWith({ 19: D(1) }, { bar: { light: 1, dark: 0 }, dice: [6] })
    const next = applyMove(board, { from: 'bar', to: 19, die: 6 }, 'light')
    expect(next.bar.light).toBe(0)
    // Point 19 held a lone dark blot, so the entry also sends it to the bar.
    expect(next.bar.dark).toBe(1)
    expect(pointValue(next, 19)).toBe(L(1))
  })

  it('bears off and declares the winner at 15', () => {
    const board = boardWith({ 3: L(1) }, { dice: [3], off: { light: 14, dark: 0 } })
    const next = applyMove(board, { from: 3, to: 'off', die: 3 }, 'light')
    expect(next.off.light).toBe(15)
    expect(pointValue(next, 3)).toBe(0)
    expect(next.phase).toBe('finished')
    expect(next.winner).toBe('light')
    expect(next.dice).toEqual([])
    expect(getLegalMoves(next, 'light', [3])).toEqual([])
  })

  it('passes the turn only when the last die is played', () => {
    const halfSpent = applyMove(boardWith({ 13: L(1) }, { dice: [4, 2] }), { from: 13, to: 9, die: 4 }, 'light')
    expect(halfSpent.turn).toBe('light')
    expect(halfSpent.dice).toEqual([2])

    const exhausted = applyMove(halfSpent, { from: 9, to: 7, die: 2 }, 'light')
    expect(exhausted.turn).toBe('dark')
    expect(exhausted.dice).toEqual([])
    expect(exhausted.phase).toBe('playing')
  })

  it('refuses moves that contradict the board', () => {
    const board = boardWith({ 13: L(1), 9: D(2) }, { dice: [4] })
    expect(() => applyMove(board, { from: 13, to: 9, die: 4 }, 'light')).toThrow(IllegalMoveError)
    expect(() => applyMove(board, { from: 13, to: 9, die: 6 }, 'light')).toThrow(/not available/)
    expect(() => applyMove(board, { from: 20, to: 16, die: 4 }, 'light')).toThrow(/does not belong/)
    expect(() => applyMove(board, { from: 13, to: 9, die: 4 }, 'dark')).toThrow(/turn/)

    const notHome = boardWith({ 13: L(1), 3: L(1) }, { dice: [3] })
    expect(() => applyMove(notHome, { from: 3, to: 'off', die: 3 }, 'light')).toThrow(/home board/)

    const finished = { ...board, phase: 'finished' as const, winner: 'light' as const }
    expect(() => applyMove(finished, { from: 13, to: 9, die: 4 }, 'light')).toThrow(/finished/)
  })

  it('rejects a bar move when nothing is on the bar', () => {
    const board = boardWith({ 20: L(1) }, { dice: [4] })
    expect(() => applyMove(board, { from: 'bar', to: 21, die: 4 }, 'light')).toThrow(/on the bar/)
  })
})

describe('endTurn', () => {
  it('flips the turn and discards unplayed dice', () => {
    const board = boardWith({ 13: L(1) }, { dice: [4, 2] })
    const next = endTurn(board)
    expect(next.turn).toBe('dark')
    expect(next.dice).toEqual([])
    expect(next.phase).toBe('playing')
    expect(next.points).toEqual(board.points)
    expect(board.dice).toEqual([4, 2])
  })
})

describe('full-game simulation', () => {
  it('plays a complete random game to a winner, holding every invariant', () => {
    const rng = lcg(20261030)
    let board: BoardState = { ...getInitialBoardState(), phase: 'playing' }
    let plies = 0

    for (let turn = 0; turn < 4000; turn += 1) {
      expect(board.points).toHaveLength(POINT_COUNT)
      expect(countFor(board, 'light')).toBe(15)
      expect(countFor(board, 'dark')).toBe(15)

      if (board.phase === 'finished') {
        break
      }

      const player = board.turn
      board = { ...board, dice: rollDice(rng) }
      plies += 1

      if (!canPlay(board, player, board.dice)) {
        board = endTurn(board)
        continue
      }

      let moves = getLegalMoves(board, player, board.dice)
      while (moves.length > 0) {
        board = applyMove(board, moves[0], player)
        if (board.turn !== player || board.phase === 'finished') {
          break
        }
        moves = getLegalMoves(board, player, board.dice)
      }

      if (board.turn === player && board.phase !== 'finished') {
        board = endTurn(board) // stranded dice
      }
    }

    expect(board.phase).toBe('finished')
    expect(['light', 'dark']).toContain(board.winner)
    if (board.winner !== null) {
      expect(board.off[board.winner]).toBe(15)
    }
    expect(plies).toBeGreaterThan(10)
  })
})
