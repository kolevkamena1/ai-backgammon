/**
 * Core vocabulary for the game.
 *
 * These types only describe state; `src/utils/gameLogic.ts` owns every rule. Points are signed
 * integers (positive = light/White, negative = dark/Black) and `BoardState` is the single source
 * of truth for checker counts — seat identity lives in `src/types/gameConfig.ts`.
 */

/** Which side a checker or point belongs to. */
export type PlayerColor = 'light' | 'dark'

/** A face value on a six-sided die. */
export type DieFace = 1 | 2 | 3 | 4 | 5 | 6

/**
 * Board numbering, 1..24. Point 1 sits in the bottom-right corner as seen by the player at the
 * bottom of the board; numbering runs counter-clockwise around the bar, so the two home boards
 * (1-6 and 19-24) flank the bar on the right.
 */
export type PointIndex = number

/**
 * Checkers on one point, signed by owner: positive is light, negative is dark, 0 is empty.
 * `Math.abs()` is the count; `ownerOf()` resolves the owner.
 */
export type PointValue = number

/** The two dice straight off the cup, before doubles expand into playable values. */
export type DiceRoll = readonly [DieFace, DieFace]

/** Where a move starts: a point, or the bar. */
export type MoveSource = PointIndex | 'bar'

/** Where a move ends: a point, or the bear-off tray. */
export type MoveTarget = PointIndex | 'off'

/** Which stage the game is at. */
export type GamePhase = 'idle' | 'rolling' | 'playing' | 'finished'

/** A single die-driven action. */
export interface Move {
  from: MoveSource
  to: MoveTarget
  /**
   * The die this move pays with. Not derivable from `from`/`to`: bearing off may spend a die
   * larger than the distance, and doubles leave several dice of the same face to choose from.
   */
  die: DieFace
}

/**
 * A triangle as the presentational components need it. `BoardState.points` stays authoritative;
 * `toPointViews()` derives this view model from it.
 */
export interface Point {
  index: PointIndex
  checkers: number
  /** `null` when the point holds no checkers. */
  owner: PlayerColor | null
}

/** Everything the rules engine needs about a game in progress. */
export interface BoardState {
  /** Exactly 24 signed counts; index 0 is point 1. */
  points: PointValue[]
  /** Checkers waiting to re-enter. While either side has any, only entries are legal. */
  bar: Record<PlayerColor, number>
  /** Checkers borne off; 15 ends the game. */
  off: Record<PlayerColor, number>
  /** Who is expected to move right now. */
  turn: PlayerColor
  /** Dice still to be played this turn: 2 values, or 4 after doubles. */
  dice: DieFace[]
  phase: GamePhase
  /** Set once a player bears off all 15; no further move is legal. */
  winner: PlayerColor | null
}
