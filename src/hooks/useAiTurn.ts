import { useGameStore } from '@/state/gameStore'
import { useEffect } from 'react'

/**
 * Auto-advance: when the seat to act is an AI and no chain is running, drive its turn.
 *
 * Mount this exactly once (see `App`). The store guards single-flight itself, so a StrictMode
 * double-mount can never spend a turn twice. The `lastAiError` term is what stops a failing
 * provider from being retried forever: the banner stays up until Retry or Dismiss.
 *
 * `isAiThinking` flips at both ends of every chain, so handing over between two AI seats re-triggers
 * this effect even though `shouldRun` never falls to false in between.
 *
 * The `proposedBy !== seat.color` gate parks the effect while the AI's OWN double awaits a human
 * answer (so it cannot busy-loop), and — crucially — re-triggers it the moment that offer resolves:
 * when the human accepts, `proposedBy` drops to null, `shouldRun` flips back to true, and the AI
 * resumes its turn. It deliberately does NOT block a human's double (`proposedBy` is then the
 * opponent's colour), which the AI must still answer.
 */
export function useAiTurn(): void {
  const board = useGameStore((state) => state.board)
  const seatPlan = useGameStore((state) => state.seatPlan)
  const isAiThinking = useGameStore((state) => state.isAiThinking)
  const lastAiError = useGameStore((state) => state.lastAiError)
  const isPaused = useGameStore((state) => state.isPaused)
  const proposedBy = useGameStore((state) => state.cube.proposedBy)
  const runAiTurn = useGameStore((state) => state.runAiTurn)

  const seat = board !== null && seatPlan !== null ? seatPlan[board.turn] : null

  const shouldRun =
    board !== null &&
    seat !== null &&
    seat.kind === 'ai' &&
    board.phase !== 'finished' &&
    isAiThinking === false &&
    lastAiError === null &&
    isPaused === false &&
    proposedBy !== seat.color

  useEffect(() => {
    if (shouldRun === false) {
      return
    }

    void runAiTurn()
  }, [shouldRun, runAiTurn])
}
