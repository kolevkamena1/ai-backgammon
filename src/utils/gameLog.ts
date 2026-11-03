import type { DiceRoll, PlayerColor } from '@/types/game'
import type { GameSnapshot, PendingTurn, TurnLogEntry } from '@/types/gameLog'
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
  const startedAt = stepHistory.find((snap) => snap.stepIndex === 0)?.at ?? null

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
        rolledAt: snap.at,
        elapsedMs: startedAt === null ? null : Math.max(0, snap.at - startedAt),
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
      // The reasoning belongs to the move it explains: each move keeps its own line, so the
      // explanation for the first die is not replaced by the explanation for the second.
      entry.moves.push({ ...snap.lastMove, stepIndex: snap.stepIndex, reasoning: snap.aiThought })
    }
    if (snap.turnPassed) {
      entry.passedReason = snap.turnPassed
    }
  }

  return entries
}

/**
 * Turns whose dice survive a "keep dice" rewind but have not been replayed yet. Every turn spends
 * exactly one roll and the seats strictly alternate, so turn `t` belongs to the seat that is
 * `t - last` turns after the last logged turn.
 */
export function derivePendingTurns(
  entries: TurnLogEntry[],
  recordedRolls: DiceRoll[],
  nextTurnNumber: number,
  nextPlayer: PlayerColor,
): PendingTurn[] {
  const lastLogged = entries.length > 0 ? entries[entries.length - 1].turnNumber : 0
  const pending: PendingTurn[] = []

  for (let turn = lastLogged + 1; turn <= recordedRolls.length; turn += 1) {
    const offset = turn - nextTurnNumber
    const player: PlayerColor =
      Math.abs(offset) % 2 === 0 ? nextPlayer : nextPlayer === 'light' ? 'dark' : 'light'
    pending.push({ turnNumber: turn, player, roll: recordedRolls[turn - 1] })
  }

  return pending
}

/** `11:42:05` in the viewer's locale-independent 24h form. */
export function formatClock(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** `+02:14`, or `+1:02:14` past the hour. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `+${hours}:${pad(minutes)}:${pad(seconds)}` : `+${pad(minutes)}:${pad(seconds)}`
}
