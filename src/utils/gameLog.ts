import type { GameSnapshot, TurnLogEntry } from '@/types/gameLog'
import type { SeatPlan } from '@/types/gameConfig'

/**
 * Derives structured turn-by-turn log entries from the raw step snapshots.
 * Step 0 represents the game start layout and is excluded from the turn log.
 */
export function deriveTurnEntries(
  stepHistory: GameSnapshot[],
  seatPlan: SeatPlan | null,
): TurnLogEntry[] {
  const entries: TurnLogEntry[] = []
  const entryByTurn = new Map<number, TurnLogEntry>()

  for (const snap of stepHistory) {
    if (snap.stepIndex === 0) {
      continue
    }

    let entry = entryByTurn.get(snap.turnNumber)
    if (!entry) {
      const seat = seatPlan ? seatPlan[snap.player] : null
      const actorKind = seat ? seat.kind : 'human'
      const actorName = seat ? seat.label : snap.player === 'light' ? 'White' : 'Black'

      entry = {
        turnNumber: snap.turnNumber,
        player: snap.player,
        actorKind,
        actorName,
        roll: snap.lastRoll,
        moves: [],
        passedReason: snap.turnPassed,
        aiThought: snap.aiThought,
        stepIndices: [],
      }
      entryByTurn.set(snap.turnNumber, entry)
      entries.push(entry)
    }

    entry.stepIndices.push(snap.stepIndex)
    if (snap.lastRoll && !entry.roll) {
      entry.roll = snap.lastRoll
    }
    if (snap.lastMove) {
      entry.moves.push(snap.lastMove)
    }
    if (snap.turnPassed) {
      entry.passedReason = snap.turnPassed
    }
    if (snap.aiThought) {
      entry.aiThought = snap.aiThought
    }
  }

  return entries
}

