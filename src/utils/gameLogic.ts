import type {
  BoardState,
  DieFace,
  DiceRoll,
  Move,
  MoveSource,
  MoveTarget,
  PlayerColor,
  Point,
  PointIndex,
  PointValue,
} from '@/types/game'

/**
 * The rules engine. 100% pure: no React, no DOM, no store, and randomness injected so every
 * branch is testable. Everything here works on plain `BoardState` values and returns new ones.
 *
 * Conventions (see `types/game.ts` for the numbering this board renders):
 *
 * |                  | light (White, bottom) | dark (Black, top) |
 * | ---------------- | --------------------- | ----------------- |
 * | sign in `points` | positive              | negative          |
 * | direction        | decreasing, 24 to 1   | increasing, 1 to 24|
 * | home board       | 1-6                   | 19-24             |
 * | bar entry for d  | 25 - d                | d                 |
 * | pips off from p  | p                     | 25 - p            |
 */

export const POINT_COUNT = 24
export const CHECKERS_PER_PLAYER = 15

/** Which way a player's checkers travel, in point-number terms. */
export const DIRECTION: Record<PlayerColor, 1 | -1> = { light: -1, dark: 1 }

/**
 * The virtual point just beyond each player's home board. Stepping off it means bearing off,
 * and it doubles as the entry reference for checkers on the bar.
 */
export const BAR_OUTSIDE: Record<PlayerColor, number> = { light: 25, dark: 0 }

/** Inclusive range of points a player must occupy before bearing off is allowed. */
export const HOME_BOARD: Record<PlayerColor, readonly [PointIndex, PointIndex]> = {
  light: [1, 6],
  dark: [19, 24],
}

/** +1 for light, -1 for dark: the sign carried by `BoardState.points`. */
export function sign(player: PlayerColor): 1 | -1 {
  return player === 'light' ? 1 : -1
}

export function otherPlayer(player: PlayerColor): PlayerColor {
  return player === 'light' ? 'dark' : 'light'
}

/** Injectable so dice can be made deterministic in tests. */
export type RandomSource = () => number

function toDie(value: number): DieFace {
  const face = Math.floor(value * 6) + 1
  return (face < 1 ? 1 : face > 6 ? 6 : face) as DieFace
}

/** Two dice, consuming exactly two draws from `rng`. */
export function rollPair(rng: RandomSource = Math.random): DiceRoll {
  return [toDie(rng()), toDie(rng())]
}

/** Pure: the raw pair, expanded to the dice that must be played (4 when doubles). */
export function expandRoll(roll: DiceRoll): DieFace[] {
  const [first, second] = roll
  return first === second ? [first, first, first, first] : [first, second]
}

/** The dice to play this turn: two values, or four of a kind on doubles. */
export function rollDice(rng: RandomSource = Math.random): DieFace[] {
  return expandRoll(rollPair(rng))
}

/** Raw signed count on a point (0 when empty or out of range). */
export function pointValue(board: BoardState, index: PointIndex): PointValue {
  return board.points[index - 1] ?? 0
}

/** How many checkers sit on a point, regardless of owner. */
export function checkerCountAt(board: BoardState, index: PointIndex): number {
  return Math.abs(pointValue(board, index))
}

/** `null` when the point is empty or out of range. */
export function ownerOf(board: BoardState, index: PointIndex): PlayerColor | null {
  const value = pointValue(board, index)
  if (value > 0) return 'light'
  if (value < 0) return 'dark'
  return null
}

export function isHomePoint(player: PlayerColor, index: PointIndex): boolean {
  const [first, last] = HOME_BOARD[player]
  return index >= first && index <= last
}

/** Pips a checker still needs to reach the bear-off tray. */
export function pipsToBearOff(player: PlayerColor, index: PointIndex): number {
  return player === 'light' ? index : 25 - index
}

/**
 * True when every remaining checker of the player is in its home board and none is on the bar.
 * Already-borne-off checkers are excluded from the required count.
 */
export function isInHomeBoard(board: BoardState, player: PlayerColor): boolean {
  if (board.bar[player] > 0) {
    return false
  }

  const [first, last] = HOME_BOARD[player]
  let inHome = 0
  for (let index = first; index <= last; index += 1) {
    if (ownerOf(board, index) === player) {
      inHome += checkerCountAt(board, index)
    }
  }

  return inHome === CHECKERS_PER_PLAYER - board.off[player]
}

/** Where a checker lands, or `'off'` when the step leaves the board. */
export function destinationFor(player: PlayerColor, from: MoveSource, die: DieFace): MoveTarget {
  const raw = from === 'bar' ? BAR_OUTSIDE[player] + DIRECTION[player] * die : from + DIRECTION[player] * die
  return raw < 1 || raw > POINT_COUNT ? 'off' : raw
}

/** Empty, friendly, or a single enemy blot (which can be hit). */
export function isEnterable(board: BoardState, player: PlayerColor, to: MoveTarget): boolean {
  if (to === 'off') {
    return false
  }

  const value = pointValue(board, to)
  if (value === 0 || value * sign(player) > 0) {
    return true
  }
  return Math.abs(value) === 1
}

export function getWinner(board: BoardState): PlayerColor | null {
  if (board.off.light >= CHECKERS_PER_PLAYER) return 'light'
  if (board.off.dark >= CHECKERS_PER_PLAYER) return 'dark'
  return null
}

/** Thrown by `applyMove` when a move cannot be reconciled with the board it was given. */
export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalMoveError'
  }
}

function moveKey(move: Move): string {
  return `${move.from}|${move.to}|${move.die}`
}

/**
 * Is any checker of the player farther from the tray than `index`? If so, a die larger than the
 * distance may not be spent on that checker — the standard bear-off restriction.
 */
function hasCheckerFarther(board: BoardState, player: PlayerColor, index: PointIndex): boolean {
  const pips = pipsToBearOff(player, index)

  for (let candidate = 1; candidate <= POINT_COUNT; candidate += 1) {
    if (ownerOf(board, candidate) === player && pipsToBearOff(player, candidate) > pips) {
      return true
    }
  }

  return false
}

/**
 * Every single-die move that is structurally possible, deduplicated, with no regard for what the
 * remaining dice could do afterwards. `getLegalMoves` narrows this with the sequence-level rules;
 * on its own it answers "can anything move at all?", which is all `canPlay` needs.
 */
function candidateMoves(board: BoardState, player: PlayerColor, dice: readonly DieFace[]): Move[] {
  if (dice.length === 0) {
    return []
  }

  const uniqueDice = [...new Set(dice)]
  const moves: Move[] = []

  // Checkers on the bar have priority: nothing else may be moved until they re-enter.
  if (board.bar[player] > 0) {
    for (const die of uniqueDice) {
      const to = destinationFor(player, 'bar', die)
      if (to !== 'off' && isEnterable(board, player, to)) {
        moves.push({ from: 'bar', to, die })
      }
    }
    return moves
  }

  const mayBearOff = isInHomeBoard(board, player)

  for (const die of uniqueDice) {
    for (let index = 1; index <= POINT_COUNT; index += 1) {
      if (ownerOf(board, index) !== player) {
        continue
      }

      const to = destinationFor(player, index, die)

      if (to === 'off') {
        if (!mayBearOff) {
          continue
        }

        const pips = pipsToBearOff(player, index)
        if (pips === die || (die > pips && !hasCheckerFarther(board, player, index))) {
          moves.push({ from: index, to: 'off', die })
        }
        continue
      }

      if (isEnterable(board, player, to)) {
        moves.push({ from: index, to, die })
      }
    }
  }

  const seen = new Set<string>()
  return moves.filter((move) => {
    const key = moveKey(move)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

/**
 * Moves one checker on the board — lifting, hitting, landing, bearing off — and nothing else: no
 * dice, no turn, no winner. Shared by `applyMove` and the sequence search, so a hypothetical line
 * and a real move can never disagree about where the checkers end up. Assumes `move` came from
 * `candidateMoves` (or was validated by the caller).
 */
function moveChecker(board: BoardState, move: Move, player: PlayerColor): BoardState {
  const points = [...board.points]
  const bar = { ...board.bar }
  const off = { ...board.off }

  if (move.from === 'bar') {
    bar[player] -= 1
  } else {
    points[move.from - 1] = pointValue(board, move.from) - sign(player)
  }

  if (move.to === 'off') {
    off[player] += 1
  } else {
    let landing = pointValue(board, move.to)
    if (landing !== 0 && landing * sign(player) < 0) {
      // Exactly one enemy checker (isEnterable already ruled out 2+): send the blot to the bar.
      landing = 0
      bar[otherPlayer(player)] += 1
    }
    points[move.to - 1] = landing + sign(player)
  }

  return { ...board, points, bar, off }
}

function withoutOneDie(dice: readonly DieFace[], die: DieFace): DieFace[] {
  const rest = [...dice]
  const index = rest.indexOf(die)
  if (index !== -1) {
    rest.splice(index, 1)
  }
  return rest
}

/**
 * The most dice a sequence starting with `move` can play. A move that bears off the last checker
 * counts as playing every die: the game is over, and nothing is left to be forced.
 */
function diceUsedStartingWith(
  board: BoardState,
  player: PlayerColor,
  dice: readonly DieFace[],
  move: Move,
): number {
  const next = moveChecker(board, move, player)
  if (next.off[player] >= CHECKERS_PER_PLAYER) {
    return dice.length
  }
  return 1 + mostDicePlayable(next, player, withoutOneDie(dice, move.die))
}

/** Depth-first search for the longest playable sequence. At most four plies deep. */
function mostDicePlayable(board: BoardState, player: PlayerColor, dice: readonly DieFace[]): number {
  let best = 0

  for (const move of candidateMoves(board, player, dice)) {
    best = Math.max(best, diceUsedStartingWith(board, player, dice, move))
    if (best === dice.length) {
      // Nothing can beat playing every die, so stop searching.
      break
    }
  }

  return best
}

/**
 * Every single-die move legal right now, deduplicated (four equal dice still offer each
 * destination once).
 *
 * Moves are still offered one at a time, which is what click-to-move and the AI menu need, but
 * each one is checked against the whole turn so the two sequence-level rules hold:
 *
 *   1. a player must use as many dice as the position allows, so a first move that leaves a
 *      playable die stranded is not offered when another order plays them all;
 *   2. when only one die of a non-double roll can be played, it must be the larger one if that
 *      is possible.
 *
 * Because each step only offers moves that begin a longest sequence, re-deriving the options after
 * every `applyMove` keeps the whole turn legal.
 */
export function getLegalMoves(
  board: BoardState,
  player: PlayerColor,
  dice: readonly DieFace[],
): Move[] {
  if (board.phase === 'finished' || board.winner !== null || dice.length === 0) {
    return []
  }

  const candidates = candidateMoves(board, player, dice)
  if (candidates.length <= 1 && dice.length === 1) {
    return candidates
  }

  const scored = candidates.map((move) => ({ move, used: diceUsedStartingWith(board, player, dice, move) }))
  const most = scored.reduce((max, entry) => Math.max(max, entry.used), 0)
  let legal = scored.filter((entry) => entry.used === most).map((entry) => entry.move)

  const distinctDice = new Set(dice)
  if (most === 1 && dice.length === 2 && distinctDice.size === 2) {
    const larger = Math.max(...legal.map((move) => move.die))
    legal = legal.filter((move) => move.die === larger)
  }

  return legal
}

/** Does the player have any move at all with these dice? If not, the turn passes. */
export function canPlay(board: BoardState, player: PlayerColor, dice: readonly DieFace[]): boolean {
  if (board.phase === 'finished' || board.winner !== null) {
    return false
  }
  // The sequence rules only ever narrow a non-empty set, so "any candidate" is the same answer.
  return candidateMoves(board, player, dice).length > 0
}

/** Hands the turn over: flips `turn`, discards unplayed dice, puts the game in play. */
export function endTurn(board: BoardState): BoardState {
  return { ...board, turn: otherPlayer(board.turn), dice: [], phase: 'playing' }
}

/**
 * Returns a new board with the move applied — handles hitting, bearing off, spending exactly one
 * die, and passing the turn when the last die is used. The input is never mutated.
 *
 * Structural checks only. Callers that need full rule validation compare against `getLegalMoves`
 * first (the store does), because legality is a set question, not a per-field one.
 */
export function applyMove(board: BoardState, move: Move, player: PlayerColor): BoardState {
  if (board.phase === 'finished' || board.winner !== null) {
    throw new IllegalMoveError('The game is already finished')
  }
  if (board.turn !== player) {
    throw new IllegalMoveError(`It is ${board.turn}'s turn, not ${player}'s`)
  }

  const diceIndex = board.dice.indexOf(move.die)
  if (diceIndex === -1) {
    throw new IllegalMoveError(`Die ${move.die} is not available`)
  }

  const points = [...board.points]
  const bar = { ...board.bar }
  const off = { ...board.off }

  if (move.from === 'bar') {
    if (bar[player] < 1) {
      throw new IllegalMoveError(`No ${player} checker on the bar`)
    }
    bar[player] -= 1
  } else {
    if (ownerOf(board, move.from) !== player) {
      throw new IllegalMoveError(`Point ${move.from} does not belong to ${player}`)
    }
    points[move.from - 1] = pointValue(board, move.from) - sign(player)
  }

  if (move.to === 'off') {
    // Judged on the board as it was before the move, exactly like move generation.
    if (!isInHomeBoard(board, player)) {
      throw new IllegalMoveError('Cannot bear off until every checker is in the home board')
    }
    off[player] += 1
  } else {
    if (!isEnterable(board, player, move.to)) {
      throw new IllegalMoveError(`Point ${move.to} is blocked`)
    }

    let landing = pointValue(board, move.to)
    if (landing !== 0 && landing * sign(player) < 0) {
      // Exactly one enemy checker (isEnterable already ruled out 2+): send the blot to the bar.
      landing = 0
      bar[otherPlayer(player)] += 1
    }
    points[move.to - 1] = landing + sign(player)
  }

  const dice = [...board.dice]
  dice.splice(diceIndex, 1)

  const next: BoardState = { ...board, points, bar, off, dice }

  if (off[player] >= CHECKERS_PER_PLAYER) {
    return { ...next, phase: 'finished', winner: player, dice: [] }
  }

  return dice.length === 0 ? endTurn(next) : next
}

/** Determines whether a move hits an opposing blot onto the bar. */
export function isHitMove(board: BoardState, move: Move, player: PlayerColor): boolean {
  if (move.to === 'off') {
    return false
  }
  const landing = pointValue(board, move.to)
  return landing !== 0 && landing * sign(player) < 0
}

/** Standard backgammon notation for a single move (e.g., "13 → 8", "13 → 8*", "Bar → 20", "2 → Off"). */
export function formatMove(move: Move, isHit = false): string {
  const fromStr = move.from === 'bar' ? 'Bar' : String(move.from)
  const toStr = move.to === 'off' ? 'Off' : String(move.to)
  return `${fromStr} → ${toStr}${isHit ? '*' : ''}`
}

/** View model for the board components: 24 triangles with unsigned counts and owners. */
export function toPointViews(board: BoardState): Point[] {
  return board.points.map((value, position): Point => ({
    index: position + 1,
    checkers: Math.abs(value),
    owner: value > 0 ? 'light' : value < 0 ? 'dark' : null,
  }))
}

/** The standard opening layout: 2 / 5 / 3 / 5 per side, mirrored around the bar. */
export function getInitialBoardState(): BoardState {
  const points: PointValue[] = Array.from({ length: POINT_COUNT }, () => 0)

  const place = (index: PointIndex, player: PlayerColor, count: number): void => {
    points[index - 1] = sign(player) * count
  }

  // Each side puts 2 on its 24-point, 5 on its 13-point, 3 on its 8-point and 5 on its 6-point,
  // expressed in this board's absolute numbering (light runs 24 -> 1, dark runs 1 -> 24).
  place(24, 'light', 2)
  place(13, 'light', 5)
  place(8, 'light', 3)
  place(6, 'light', 5)

  place(1, 'dark', 2)
  place(12, 'dark', 5)
  place(17, 'dark', 3)
  place(19, 'dark', 5)

  return {
    points,
    bar: { light: 0, dark: 0 },
    off: { light: 0, dark: 0 },
    turn: 'light',
    dice: [],
    phase: 'idle',
    winner: null,
  }
}

/**
 * Calculates the total pip count for a player (distance left to bear off all checkers).
 * Light moves from 24 down to 1 and off (pip count for point i is i).
 * Dark moves from 1 up to 24 and off (pip count for point i is 25 - i).
 * Checkers on the bar count as 25 pips each.
 */
export function calculatePipCount(board: BoardState, player: PlayerColor): number {
  let count = board.bar[player] * 25
  for (let i = 0; i < POINT_COUNT; i += 1) {
    const val = board.points[i]
    if (player === 'light' && val > 0) {
      count += val * (i + 1)
    } else if (player === 'dark' && val < 0) {
      count += Math.abs(val) * (24 - i)
    }
  }
  return count
}

/**
 * Grades the victory when a player bears off all 15 checkers:
 * - Single (1 point): Loser has borne off at least 1 checker.
 * - Gammon (2 points): Loser has borne off 0 checkers.
 * - Backgammon (3 points): Loser has borne off 0 checkers AND has at least 1 checker in
 *   the winner's home board (points 1-6 for light, 19-24 for dark) or on the bar.
 */
export function evaluateVictoryGrade(board: BoardState, winner: PlayerColor): 'single' | 'gammon' | 'backgammon' {
  const loser: PlayerColor = winner === 'light' ? 'dark' : 'light'

  if (board.off[loser] > 0) {
    return 'single'
  }

  // Check if loser has checkers in winner's home board or bar
  const hasOnBar = board.bar[loser] > 0
  let hasInWinnerHome = false

  if (winner === 'light') {
    // Light's home board is 1..6 (indices 0..5), where dark checkers are negative
    for (let i = 0; i < 6; i += 1) {
      if (board.points[i] < 0) {
        hasInWinnerHome = true
        break
      }
    }
  } else {
    // Dark's home board is 19..24 (indices 18..23), where light checkers are positive
    for (let i = 18; i < 24; i += 1) {
      if (board.points[i] > 0) {
        hasInWinnerHome = true
        break
      }
    }
  }

  if (hasOnBar || hasInWinnerHome) {
    return 'backgammon'
  }

  return 'gammon'
}
