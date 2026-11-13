import type { BoardState, PlayerColor } from '@/types/game'
import type { DoublingCubeState, MatchScoreState } from '@/types/gameMatch'
import { calculatePipCount } from './gameLogic'

/**
 * Heuristic doubling decision for an AI player:
 * Evaluates whether the AI should propose a double, and whether it should accept an opponent's double.
 */

export interface AiDoublingDecision {
  shouldDouble: boolean
  reason: string
}

export interface AiAcceptDecision {
  accept: boolean
  reason: string
}

/**
 * Pip-race heuristic for whether the AI should offer a double on its turn before rolling:
 * - Must be allowed to double (cube owner or centered, not Crawford game, max 64)
 * - Has a significant pip count race lead (>= 8% and >= 12 pips ahead, or >= 5 pips with opponent on bar)
 *
 * Scope (R3): match context is consulted only for the Crawford prohibition. Cube value, gammon
 * potential and match equity are deliberately outside this heuristic — it plays a sound race,
 * not full match-play cube theory.
 */
export function evaluateAiShouldDouble(
  board: BoardState,
  aiColor: PlayerColor,
  cube: DoublingCubeState,
  match: MatchScoreState | null,
): AiDoublingDecision {
  // Cannot double if already at 64
  if (cube.value >= 64) {
    return { shouldDouble: false, reason: 'Cube already at maximum (64)' }
  }

  // Cannot double if opponent owns the cube
  if (cube.owner !== 'centered' && cube.owner !== aiColor) {
    return { shouldDouble: false, reason: 'Opponent owns the doubling cube' }
  }

  // Cannot double in Crawford game
  if (match?.isCrawfordGame) {
    return { shouldDouble: false, reason: 'Crawford game prohibits doubling' }
  }

  const opponent: PlayerColor = aiColor === 'light' ? 'dark' : 'light'
  const aiPips = calculatePipCount(board, aiColor)
  const oppPips = calculatePipCount(board, opponent)

  // AI has advantage if its pip count is noticeably lower (fewer pips needed to finish)
  const lead = oppPips - aiPips

  // If opponent has checkers on bar and AI has closed points or good lead
  if (board.bar[opponent] > 0 && lead >= 5) {
    return { shouldDouble: true, reason: 'Strong position with opponent checker on bar and pip lead' }
  }

  // Pip race lead threshold: at least 8% lead and 12 pips ahead
  if (lead >= 12 && lead / Math.max(1, oppPips) >= 0.08) {
    return { shouldDouble: true, reason: `Favorable pip race lead of ${lead} pips` }
  }

  return { shouldDouble: false, reason: 'Position is balanced; not advantageous to double yet' }
}

/**
 * Determines whether the AI should accept (Take) or decline (Drop) an opponent's double offer.
 *
 * Theory: a player should accept with winning chances >= 25% (declining loses 1 stake for sure;
 * accepting risks 2, so EV(accept) > -1 above that threshold). This implementation does NOT compute
 * winning chances — it uses pip deficit plus bar/bear-off shape as a proxy, and drops only clearly
 * lost positions (R3).
 */
export function evaluateAiAcceptDouble(
  board: BoardState,
  aiColor: PlayerColor,
): AiAcceptDecision {
  const opponent: PlayerColor = aiColor === 'light' ? 'dark' : 'light'
  const aiPips = calculatePipCount(board, aiColor)
  const oppPips = calculatePipCount(board, opponent)

  // Behind in pips:
  const deficit = aiPips - oppPips

  // If severely behind (> 35 pips or opponent is almost borne off while AI is far behind)
  if (deficit > 35 && board.off[opponent] > 6) {
    return { accept: false, reason: 'Deficit too severe in bear-off; resigning double' }
  }

  // If AI has 2 or more on bar and opponent has a strong 4+ point board
  if (board.bar[aiColor] >= 2 && deficit > 18) {
    return { accept: false, reason: 'Multiple checkers trapped on bar behind deep deficit' }
  }

  return { accept: true, reason: 'Pip-race deficit within taking range; accepting double' }
}

