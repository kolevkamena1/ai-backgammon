import type { AiErrorCode } from '@/types/ai'
import type { PlayerColor } from '@/types/game'
import type { SeatAssignment } from '@/types/gameConfig'
import type { TurnPassReason } from '@/state/gameStore'
import { BUTTON } from '@/components/ui/controls'
import { useGame } from '@/hooks/useGame'
import { useSettings } from '@/hooks/useSettings'
import { describeEngine, DIFFICULTY_LABELS, SEAT_LABELS } from '@/utils/gameConfig'
import { cn } from '@/utils/cn'
import { Dices, RefreshCw, RotateCcw, TriangleAlert, X } from 'lucide-react'
import AiThoughtPanel from './AiThoughtPanel'
import Checker from './Checker'
import Die from './Die'

const PANEL = 'flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4'
const HEADING = 'text-sm font-semibold text-slate-100'
const SUBTLE = 'text-xs text-slate-400'
const PRIMARY = cn(BUTTON, 'bg-sky-600 text-white hover:bg-sky-500')
const SECONDARY = cn(BUTTON, 'border border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700')
const GHOST = cn(BUTTON, 'px-2 py-1 text-xs text-slate-300 hover:bg-slate-800')

/** Codes that only Settings can fix, so the banner offers the Settings button next to Retry. */
const SETTINGS_CODES: ReadonlySet<AiErrorCode> = new Set([
  'unauthorized',
  'forbidden',
  'missing-key',
  'missing-endpoint',
  'missing-model',
  // The relay refused the target, so what needs editing is the Base URL - and retrying cannot help,
  // which is exactly why the client does not retry this code either (see `isTransient`).
  'proxy-blocked',
])

/** Why a turn ended without a move, in the player's words. */
const PASS_COPY: Record<TurnPassReason, string> = {
  'unplayable-roll': 'No legal move with that roll, so the turn passed automatically.',
  'stranded-dice': 'The dice left over fit nothing, so the turn passed automatically.',
}

function seatSummary(seat: SeatAssignment): string {
  if (seat.kind === 'human') {
    return seat.label
  }

  const engine = describeEngine(seat.engine)
  // The level belongs in the line the player reads while the engine works: the same provider and
  // model play very differently at Easy and at Hard, and nothing else on screen says which was picked.
  return `${seat.label} · ${engine.providerName}${engine.model ? ` · ${engine.model}` : ''} · ${DIFFICULTY_LABELS[engine.difficulty]}`
}

/**
 * Turn status, the dice in hand, the AI's progress and the roll action. All mutation goes through
 * `useGame`, which forwards to the store; this component holds no state of its own.
 */
const GameControls = () => {
  const game = useGame()
  const { openSettings } = useSettings()
  const { board, currentSeat, lastRoll, history, selectedFrom, turnPassed, isAiThinking, lastAiError, aiThought } =
    game

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
  const seatName = SEAT_LABELS[seat]
  const providerName =
    currentSeat.kind === 'ai' ? describeEngine(currentSeat.engine).providerName : null

  /**
   * Dev-only convenience: with an engine failing, `useAiTurn` stops retrying, and this button lets
   * you step the match past that seat by hand. `import.meta.env.DEV` is statically false in a
   * production build, so the `Roll for ...` label folds away and only the plain one ships.
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
          {game.isFinished
            ? 'Game over'
            : isAiThinking
              ? `${seatName} is working`
              : `${seatName} to ${game.awaitingRoll ? 'roll' : 'move'}`}
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

      {/* Live feedback that the engine is thinking, for the seat that is waiting. Superseded by the
          thought panel as soon as streamed text exists, so the player never reads the same status
          twice: the panel says more, and says it earlier. */}
      {isAiThinking && aiThought === null ? (
        <p className="flex items-center gap-2 text-sm text-sky-300" aria-live="polite">
          <span className="relative flex size-2.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-sky-500" />
          </span>
          Asking the engine{providerName ? ` (${providerName})` : ''} for a move…
        </p>
      ) : null}

      {/* The engine's own words. Rendered last of the three status lines so a failure banner, when
          there is one, always sits underneath everything the player is still reading. */}
      {aiThought !== null ? <AiThoughtPanel thought={aiThought} onDismiss={game.clearAiThought} /> : null}

      {game.isFinished && board.winner !== null ? (
        <p className="text-sm font-semibold text-emerald-300">
          {SEAT_LABELS[board.winner]} bore off all 15 checkers and wins.
        </p>
      ) : null}

      {turnPassed !== null ? (
        <p className="text-sm text-amber-300">{PASS_COPY[turnPassed] ?? 'The turn passed.'}</p>
      ) : null}

      {lastAiError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2"
        >
          <TriangleAlert className="size-4 shrink-0 text-red-400" aria-hidden />
          <p className="min-w-40 flex-1 text-xs text-red-200">
            {seatName} move failed: {lastAiError.message}
          </p>
          <div className="flex items-center gap-1">
            {SETTINGS_CODES.has(lastAiError.code) ? (
              <button type="button" onClick={openSettings} className={GHOST}>
                Open Settings
              </button>
            ) : null}
            <button type="button" onClick={game.retryAiTurn} className={cn(PRIMARY, 'px-2 py-1 text-xs')}>
              <RefreshCw className="size-3.5" aria-hidden />
              Retry
            </button>
            <button type="button" onClick={game.dismissAiError} className={GHOST}>
              <X className="size-3.5" aria-hidden />
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {!game.isFinished && !game.awaitingRoll && game.canInteract ? (
        <p className={SUBTLE}>{sourceHint}</p>
      ) : null}

      <button type="button" onClick={game.resetGame} className={cn(SECONDARY, 'self-start py-1.5 text-xs')}>
        <RotateCcw className="size-3.5" aria-hidden />
        Abandon game
      </button>
    </section>
  )
}

export default GameControls
