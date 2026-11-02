import type { BoardState, DiceRoll, DieFace, MoveSource, MoveTarget, PlayerColor } from '@/types/game'
import type { TurnPassReason } from '@/state/gameStore'

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
  board: BoardState
  lastRoll: DiceRoll | null
  diceRemaining: DieFace[]
  selectedFrom: MoveSource | null
  turnPassed: TurnPassReason | null
  aiThought: string | null
  description: string
  lastMove?: MoveRecord
}

export interface TurnLogEntry {
  turnNumber: number
  player: PlayerColor
  actorKind: 'human' | 'ai'
  actorName: string
  roll: DiceRoll | null
  moves: MoveRecord[]
  passedReason: TurnPassReason | null
  aiThought: string | null
  stepIndices: number[]
}
