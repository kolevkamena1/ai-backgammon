import type { PlayerColor } from './game'

export type VictoryGrade = 'single' | 'gammon' | 'backgammon'

export interface GameVictory {
  winner: PlayerColor
  loser: PlayerColor
  grade: VictoryGrade
  basePoints: 1 | 2 | 3
  cubeMultiplier: number
  totalPoints: number
  reason: 'bear-off' | 'resigned-double'
}

export type CubeOwner = PlayerColor | 'centered'

export interface DoublingCubeState {
  /** Cube values: 1 (centered), then 2, 4, 8, 16, 32, 64 */
  value: number
  owner: CubeOwner
  /** Active double offer pending response */
  proposedBy: PlayerColor | null
}

export interface MatchConfig {
  /** Target points to win the set: 1 (single game), 7, 11, or custom positive integer */
  targetPoints: number
  /** Whether Crawford rule is enabled for the set */
  enableCrawford: boolean
}

export interface MatchScoreState {
  light: number
  dark: number
  targetPoints: number
  gameIndex: number
  matchWinner: PlayerColor | null
  enableCrawford: boolean
  /** Whether the current game is a Crawford game (doubling disabled) */
  isCrawfordGame: boolean
  lastVictory: GameVictory | null
}

