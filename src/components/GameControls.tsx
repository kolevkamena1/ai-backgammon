import type { PlayerColor } from '@/types/game'
import type { SeatAssignment } from '@/types/gameConfig'
import { BUTTON } from '@/components/ui/controls'
import { useGame } from '@/hooks/useGame'
import { describeEngine } from '@/utils/gameConfig'
import { cn } from '@/utils/cn'
import { Dices, RotateCcw } from 'lucide-react'
import Checker from './Checker'
import Die from './Die'

const PANEL = 'flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4'
const HEADING = 'text-sm font-semibold text-slate-100'
const SUBTLE = 'text-xs text-slate-400'
const PRIMARY = cn(BUTTON, 'bg-sky-600 text-white hover:bg-sky-500')
const SECONDARY = cn(BUTTON, 'border border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700')

/** Why a turn ended without a move, in the player's words. */
const PASS_COPY: Record<string, string> = {
  'unplayable-roll': 'No legal move with that roll, so the turn passed automatically.',
  'stranded-dice': 'The dice left over fit nothing, so the turn passed automatically.',
}

function seatSummary(seat: SeatAssignment): string {
  if (seat.kind === 'human') {
    return seat.label
  }

  const engine = describeEngine(seat.engine)
  return `${seat.label} · ${engine.providerName}${engine.model ? ` · ${engine.model}` : ''}`
}

/**
 * Turn status, the dice in hand and the roll action. All mutation goes through `useGame`, which
 * forwards to the store; this component holds no state of its own.
 */
const GameControls = () => {
  const game = useGame()
  const { board, currentSeat, lastRoll, history, selectedFrom, turnPassed } = game

  if (board === null || currentSeat === null) {
    return (
      <section aria-label="Game controls" className={PANEL}>
        <h2 className={HEADING}>Game</h2>
        <p className={SUBTLE}>
          No game in progress. Open <span className="font-medium text-slate-200">New game</span> to
          choose the seats, then roll.
        </p>
      </section>
    )
  }

  const seat: PlayerColor = board.turn
  const seatName = seat === 'light' ? 'White' : 'Black'

  /**
   * Phase 2 ships no inference client, so this is the manual stand-in. `import.meta.env.DEV` is
   * statically false in a production build, which folds the `Roll for ...` label away and leaves
   * the plain one plus the Phase 3 notice.
   */
  const devStepping = import.meta.env.DEV && game.isHumanTurn === false
  const rollLabel = devStepping ? `Roll for ${seatName}` : 'Roll dice'

  const sourceHint =
    selectedFrom === null
      ? `${game.allLegalMoves.length} move${game.allLegalMoves.length === 1 ? '' : 's'} available — select a checker.`
      : `${game.selectedMoves.length} destination${game.selectedMoves.length === 1 ? '' : 's'} from ${
          selectedFrom === 'bar' ? 'the bar' : `point ${selectedFrom}`
        } — click a green triangle.`

  return (
    <section aria-label="Game controls" className={PANEL}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={HEADING}>Game</h2>
        <span className={SUBTLE}>{history.length} moves played</span>
      </div>

      <div className="flex items-center gap-2">
        <Checker owner={seat} />
        <p className="text-sm font-medium text-slate-100">
          {game.isFinished ? 'Game over' : `${seatName} to ${game.awaitingRoll ? 'roll' : 'move'}`}
        </p>
        <span className={SUBTLE}>· {seatSummary(currentSeat)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {board.dice.length > 0 ? (
          <div className="flex items-center gap-2" aria-label="Dice still to play">
            {board.dice.map((value, position) => (
              <Die key={`${position}-${value}`} value={value} className="size-9" />
            ))}
          </div>
        ) : (
          <p className={SUBTLE}>
            {lastRoll === null ? 'Dice are idle until you roll.' : `Last roll: ${lastRoll[0]} and ${lastRoll[1]}.`}
          </p>
        )}

        {game.awaitingRoll && game.canInteract ? (
          <button type="button" onClick={game.roll} className={PRIMARY}>
            <Dices className="size-4" aria-hidden />
            {rollLabel}
          </button>
        ) : null}
      </div>

      {game.isFinished && board.winner !== null ? (
        <p className="text-sm font-semibold text-emerald-300">
          {board.winner === 'light' ? 'White' : 'Black'} bore off all 15 checkers and wins.
        </p>
      ) : null}

      {turnPassed !== null ? (
        <p className="text-sm text-amber-300">{PASS_COPY[turnPassed] ?? 'The turn passed.'}</p>
      ) : null}

      {game.canInteract === false && !game.isFinished ? (
        <p className={SUBTLE}>
          {seatName} is an AI seat. Automated moves arrive with the inference client in Phase 3.
        </p>
      ) : null}

      {!game.isFinished && !game.awaitingRoll ? <p className={SUBTLE}>{sourceHint}</p> : null}

      <button type="button" onClick={game.resetGame} className={cn(SECONDARY, 'self-start py-1.5 text-xs')}>
        <RotateCcw className="size-3.5" aria-hidden />
        Abandon game
      </button>
    </section>
  )
}

export default GameControls
