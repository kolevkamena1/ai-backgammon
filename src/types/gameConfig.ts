import type { PlayerColor } from './game'
import type { MatchConfig } from './gameMatch'
import type { AiEngineConfig } from './settings'

/** Who plays: the local human against one AI, or two AIs against each other. */
export type GameMode = 'humanVsAi' | 'aiVsAi'

/** How dice are generated for games in this set. */
export type DiceMode = 'random' | 'seeded' | 'manual'

export interface DiceConfig {
  mode: DiceMode
  /** Integer seed for reproducible pseudorandom dice series. */
  seed?: number
}

/** Meaningful only when `GameMode` is `aiVsAi`. */
export type AiMatchType =
  /** One engine plays both seats, reusing the personal BYOK; no second key is ever stored. */
  | 'mirror'
  /** Two independent configurations; the opponent's is persisted separately. */
  | 'custom'

/** The persisted, serialisable subset of the setup — exactly what `planSeats` consumes. */
export interface GameConfigSnapshot {
  mode: GameMode
  /** Which color the human player controls in Human vs AI mode (default 'light'). */
  humanColor?: PlayerColor
  /** Dice generation settings (random, seeded with numeric seed, or manual input). */
  dice?: DiceConfig
  aiMatchType: AiMatchType
  /** Used only when `mode === 'aiVsAi' && aiMatchType === 'custom'`. */
  opponent: AiEngineConfig
  /** Configuration for match play / game sets (target points & Crawford rule) */
  match?: MatchConfig
}

/**
 * A seat's assignment, discriminated on `kind`: a human seat cannot carry an engine, an AI seat
 * must always have one (with its own validation problems).
 */
export type SeatAssignment =
  | { color: PlayerColor; kind: 'human'; label: string }
  | { color: PlayerColor; kind: 'ai'; label: string; engine: AiEngineConfig; problems: string[] }

/** The resolved pairing for a match — the engine loop's only input about who is who. */
export interface SeatPlan {
  light: SeatAssignment
  dark: SeatAssignment
  /** False when any AI seat is missing required configuration. */
  ready: boolean
}
