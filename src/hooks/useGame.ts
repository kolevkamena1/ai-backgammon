import type { Move, MoveSource, MoveTarget } from '@/types/game'
import type { SeatAssignment } from '@/types/gameConfig'
import { logger } from '@/lib/logger'
import { useGameStore } from '@/state/gameStore'
import { getLegalMoves } from '@/utils/gameLogic'
import { useMemo } from 'react'

/**
 * Everything the UI needs about the active game: the board, whose turn it is according to the
 * snapshotted seat plan, the legal moves derived from it, and the click handling that drives
 * selection and execution. Components stay presentational.
 */
export function useGame() {
  const board = useGameStore((state) => state.board)
  const seatPlan = useGameStore((state) => state.seatPlan)
  const config = useGameStore((state) => state.config)
  const lastRoll = useGameStore((state) => state.lastRoll)
  const history = useGameStore((state) => state.history)
  const selectedFrom = useGameStore((state) => state.selectedFrom)
  const turnPassed = useGameStore((state) => state.turnPassed)
  const startNewGame = useGameStore((state) => state.startNewGame)
  const roll = useGameStore((state) => state.roll)
  const makeMove = useGameStore((state) => state.makeMove)
  const selectPoint = useGameStore((state) => state.selectPoint)
  const passTurn = useGameStore((state) => state.passTurn)
  const resetGame = useGameStore((state) => state.resetGame)

  const currentSeat: SeatAssignment | null = board && seatPlan ? seatPlan[board.turn] : null
  const isHumanTurn = currentSeat !== null && currentSeat.kind === 'human'
  const isFinished = board?.phase === 'finished'

  /**
   * Dev-only override so an AI-vs-AI match can be stepped through by hand until the inference
   * client exists. Vite statically replaces `import.meta.env.DEV`, so the extra branch is
   * dead-code-eliminated from production bundles rather than shipped.
   */
  const canInteract = isHumanTurn || import.meta.env.DEV

  // Gated on canInteract so production AI turns render no highlighted triangles that would then
  // refuse the click; in dev this is always true, which is what makes manual stepping possible.
  const allLegalMoves = useMemo<Move[]>(
    () =>
      board && board.phase !== 'finished' && canInteract ? getLegalMoves(board, board.turn, board.dice) : [],
    [board, canInteract],
  )

  const selectedMoves = useMemo(
    () => (selectedFrom === null ? [] : allLegalMoves.filter((move) => move.from === selectedFrom)),
    [allLegalMoves, selectedFrom],
  )

  /** Destinations reachable from the current selection — what the board highlights. */
  const legalTargets = useMemo(
    () => new Set<MoveSource | MoveTarget>(selectedMoves.map((move) => move.to)),
    [selectedMoves],
  )

  /** Sources with at least one move, so only those are clickable. */
  const selectableSources = useMemo(
    () => new Set<MoveSource>(allLegalMoves.map((move) => move.from)),
    [allLegalMoves],
  )

  const awaitingRoll = board !== null && board.dice.length === 0 && isFinished === false

  const handlePointClick = (target: MoveSource | MoveTarget): void => {
    if (board === null || isFinished || canInteract === false) {
      return
    }

    // Clicking a highlighted destination plays the matching move ('off' targets the tray).
    if (selectedFrom !== null && legalTargets.has(target)) {
      const move = selectedMoves.find((candidate) => candidate.to === target)
      if (move !== undefined && makeMove(move)) {
        return
      }
    }

    // Only a point or the bar can be a source; `typeof` narrows that for the set lookup.
    if (target === 'bar' || typeof target === 'number') {
      selectPoint(target)

      if (selectedFrom !== target && selectableSources.has(target)) {
        // Direct logging is banned by .clinerules, so the legal-move dump goes through the logger.
        logger.debug('legal moves for point', {
          from: String(target),
          count: allLegalMoves.filter((move) => move.from === target).length,
        })
      }
      return
    }

    selectPoint(null)
  }

  return {
    board,
    seatPlan,
    config,
    lastRoll,
    history,
    selectedFrom,
    turnPassed,
    currentSeat,
    allLegalMoves,
    selectedMoves,
    legalTargets,
    selectableSources,
    isHumanTurn,
    canInteract,
    isFinished,
    awaitingRoll,
    active: board !== null,
    handlePointClick,
    startNewGame,
    roll,
    makeMove,
    selectPoint,
    passTurn,
    resetGame,
  }
}
