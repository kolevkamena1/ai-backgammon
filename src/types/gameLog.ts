import type { BoardState, DiceRoll, DieFace, MoveSource, MoveTarget, PlayerColor } from '@/types/game'
import type { DoublingCubeState, MatchScoreState } from '@/types/gameMatch'

/** Why the last turn ended early, so the UI can explain it instead of looking broken. */
export type TurnPassReason = 'unplayable-roll' | 'stranded-dice'

export type CubeActionKind = 'propose' | 'accept' | 'decline'

export type GameSnapshotKind =
  | 'game-start'
  | 'roll'
  | 'move'
  | 'pass'
  | 'double-proposed'
  | 'double-accepted'
  | 'double-declined'

export interface CubeLogAction {
  type: CubeActionKind
  player: PlayerColor
  value: number
  reasoning?: string | null
  at: number
}

export interface MoveRecord {
  from: MoveSource
  to: MoveTarget
  die: DieFace
  isHit: boolean
  formatted: string
}

export interface GameSnapshot {
  stepIndex: number
  turnNumber: number
  player: PlayerColor
  kind: GameSnapshotKind
  board: BoardState
  lastRoll: DiceRoll | null
  diceRemaining: DieFace[]
  selectedFrom: MoveSource | null
  turnPassed: TurnPassReason | null
  cubeAction?: CubeLogAction | null
  cube: DoublingCubeState
  match: MatchScoreState | null
  /**
   * The engine's explanation for THIS step's move only. Never inherited from an earlier step, so a
   * move the model said nothing about shows nothing instead of the previous move's reasoning.
   */
  aiThought: string | null
  description: string
  lastMove?: MoveRecord
  /** Wall-clock time (epoch ms) the step happened; feeds the log's time column. */
  at: number
}

/** One played move inside a turn, together with the reasoning the engine gave for it. */
export interface LoggedMove extends MoveRecord {
  stepIndex: number
  reasoning: string | null
}

export interface TurnLogEntry {
  turnNumber: number
  player: PlayerColor
  actorKind: 'human' | 'ai'
  actorName: string
  roll: DiceRoll | null
  /** Every move of the turn in order; a doubles roll can hold four, each with its own reasoning. */
  moves: LoggedMove[]
  passedReason: TurnPassReason | null
  cubeActions?: CubeLogAction[]
  /** When the dice were rolled (epoch ms). */
  rolledAt: number
  /** Milliseconds between the game start and the roll; null when the start step is missing. */
  elapsedMs: number | null
  stepIndices: number[]
}

/** A turn whose dice are already known (kept by a rewind) but which has not been replayed yet. */
export interface PendingTurn {
  turnNumber: number
  player: PlayerColor
  roll: DiceRoll
}
