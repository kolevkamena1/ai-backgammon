/**
 * Core vocabulary for the game.
 *
 * These types are descriptive only: no validation, no move rules, no scoring.
 * Game logic lands in a later phase — see README.md "Roadmap".
 */

/** Which side a checker or point belongs to. */
export type PlayerColor = 'light' | 'dark'

/** A face value on a six-sided die. */
export type DieFace = 1 | 2 | 3 | 4 | 5 | 6

/**
 * Board numbering, 1..24. Point 1 sits in the bottom-right quadrant and numbering runs
 * counter-clockwise around the bar. Reserved conventions for future move support:
 * `0` = the bar, `25` = the bear-off tray.
 */
export type PointIndex = number

/** Which stage the game is at. */
export type GamePhase = 'idle' | 'rolling' | 'playing' | 'finished'

/** A single triangle on the board. */
export interface Point {
  index: PointIndex
  checkers: number
  /** `null` when the point holds no checkers. */
  owner: PlayerColor | null
}

/** A physical die showing a face, tracked as spent or unspent. */
export interface Die {
  value: DieFace
  used: boolean
}

/** A player — human or AI-driven. */
export interface Player {
  color: PlayerColor
  displayName: string
  isAI: boolean
  /** Checkers currently on the bar, waiting to re-enter. */
  bar: number
  /** Checkers already borne off (0..15). */
  borneOff: number
}

/** A single die-driven action. */
export interface Move {
  /** Source point index (`0` = bar). */
  from: PointIndex
  /** Destination point index (`25` = bear off). */
  to: PointIndex
  /** Die value consumed by this move. */
  die: DieFace
}

/** A full snapshot of a game in progress. */
export interface BoardState {
  /** Exactly 24 points, ordered by index 1..24. */
  points: Point[]
  players: Record<PlayerColor, Player>
  /** Two dice, or four when doubles are rolled. */
  dice: Die[]
  turn: PlayerColor
  doublingCube: number
  phase: GamePhase
}
