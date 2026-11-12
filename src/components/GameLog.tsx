import { useEffect, useRef, useState, type FC, type ReactNode } from 'react'
import { useAiThought } from '@/hooks/useAiThought'
import { useGame } from '@/hooks/useGame'
import type { CubeLogAction, LoggedMove, PendingTurn, TurnLogEntry } from '@/types/gameLog'
import { cn } from '@/utils/cn'
import { formatClock, formatElapsed } from '@/utils/gameLog'
import { Clock, Pause, Play, Swords, Trash2, X } from 'lucide-react'

const PANEL = 'flex flex-1 min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-lg'
const TH = 'sticky top-0 z-10 border-b border-slate-800 bg-slate-900 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400'
const TD = 'border-b border-slate-800/70 px-2 py-1 align-top'
/** Cells that can start a rewind look and behave like spreadsheet cells you can pick. */
const PICKABLE = 'cursor-pointer hover:bg-sky-500/10 hover:ring-1 hover:ring-inset hover:ring-sky-500/40'
const DOOMED = 'bg-red-500/10 text-red-300 line-through decoration-red-400/60'
const SELECTED = 'ring-2 ring-inset ring-red-400'
const CARET = 'ml-0.5 inline-block h-3 w-1 translate-y-0.5 animate-pulse rounded-sm bg-sky-400'

type PickKind = 'moves' | 'dice'

interface Pick {
  turnNumber: number
  kind: PickKind
  /** The log length when the pick was made: any new step makes a stale pick void. */
  stepCount: number
}

const diceText = (roll: TurnLogEntry['roll']): string => (roll === null ? '—' : `${roll[0]} · ${roll[1]}`)

const SeatDot: FC<{ player: TurnLogEntry['player'] }> = ({ player }) => (
  <span
    aria-hidden
    className={cn(
      'inline-block size-2.5 shrink-0 rounded-full border',
      player === 'light' ? 'border-amber-300 bg-amber-100' : 'border-slate-600 bg-slate-800',
    )}
  />
)

/**
 * The game as a spreadsheet: one row per turn (rows split per move so every move sits next to its
 * own reasoning). Picking a past Moves cell rewinds the moves but keeps the dice sequence; picking
 * a Dice cell rewinds the dice too. Both ask for confirmation and leave the game paused.
 */
export const GameLog: FC = () => {
  const {
    board,
    active,
    isPaused,
    isAiThinking,
    seatPlan,
    togglePause,
    turnEntries,
    pendingTurns,
    stepHistory,
    rewindMovesFrom,
    rewindRollsFrom,
  } = useGame()
  // The live sentence is the only thing here that changes per streamed token; it comes from its own
  // selector so the rest of the log (and the board) is not dragged along with it.
  const { thought: aiThought } = useAiThought()

  const scrollRef = useRef<HTMLDivElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [rawPick, setPick] = useState<Pick | null>(null)

  // A pick only means something for the log it was made on, and never while the AI is working.
  const pick =
    rawPick !== null && rawPick.stepCount === stepHistory.length && !isAiThinking ? rawPick : null
  const canRewind = active && !isAiThinking

  // Follow the newest row (and the streaming sentence) unless the user scrolled up to read.
  useEffect(() => {
    const node = scrollRef.current
    if (stickToBottom && node !== null) {
      node.scrollTop = node.scrollHeight
    }
  }, [stickToBottom, stepHistory.length, aiThought?.text, isAiThinking])

  const onScroll = (): void => {
    const node = scrollRef.current
    if (node !== null) {
      setStickToBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 24)
    }
  }

  const toggleExpanded = (key: string): void => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const lastEntry = turnEntries.length > 0 ? turnEntries[turnEntries.length - 1] : null

  /** Rewinding the moves of the live turn before anything was played would change nothing. */
  const movesPickable = (entry: TurnLogEntry): boolean =>
    canRewind && !(entry === lastEntry && entry.moves.length === 0 && entry.passedReason === null)

  const choose = (entry: TurnLogEntry, kind: PickKind): void => {
    if (!canRewind || (kind === 'moves' && !movesPickable(entry))) {
      return
    }
    const same = pick?.turnNumber === entry.turnNumber && pick.kind === kind
    setPick(same ? null : { turnNumber: entry.turnNumber, kind, stepCount: stepHistory.length })
  }

  const confirm = (): void => {
    if (pick === null) {
      return
    }
    if (pick.kind === 'moves') {
      rewindMovesFrom(pick.turnNumber)
    } else {
      rewindRollsFrom(pick.turnNumber)
    }
    setPick(null)
    setStickToBottom(true)
  }

  const movesDoomed = (turnNumber: number): boolean => pick !== null && turnNumber >= pick.turnNumber
  const diceDoomed = (turnNumber: number): boolean =>
    pick !== null && pick.kind === 'dice' && turnNumber >= pick.turnNumber

  /** The live "thinking" line belongs to the row of the turn being played right now. */
  const liveSeat = board !== null && seatPlan !== null ? seatPlan[board.turn] : null
  const showLive =
    isAiThinking &&
    lastEntry !== null &&
    board !== null &&
    board.dice.length > 0 &&
    lastEntry.player === board.turn &&
    liveSeat?.kind === 'ai'
  const liveText = aiThought?.phase === 'streaming' ? aiThought.text : ''

  const renderReasoning = (move: LoggedMove, entry: TurnLogEntry): ReactNode => {
    if (move.reasoning === null) {
      return (
        <span className="text-slate-500">{entry.actorKind === 'ai' ? '(no explanation)' : '—'}</span>
      )
    }
    const key = String(move.stepIndex)
    const open = expanded[key] === true
    return (
      <button
        type="button"
        onClick={() => toggleExpanded(key)}
        title={open ? 'Collapse' : 'Click to read the full reasoning'}
        aria-expanded={open}
        className={cn(
          'block w-full text-left text-slate-300 hover:text-sky-300',
          open ? 'whitespace-normal break-words' : 'truncate',
        )}
      >
        {move.reasoning}
      </button>
    )
  }

  const renderCubeReasoning = (action: CubeLogAction, actionKey: string): ReactNode => {
    const actorName = seatPlan ? seatPlan[action.player]?.label : action.player === 'light' ? 'White' : 'Black'
    const isPropose = action.type === 'propose'
    const isAccept = action.type === 'accept'
    const isDecline = action.type === 'decline'
    const open = expanded[actionKey] === true

    return (
      <div className="flex flex-col gap-0.5 text-xs text-slate-300">
        <div className="flex items-center gap-1.5">
          <SeatDot player={action.player} />
          <span className="font-medium text-slate-200">
            {isPropose && `${actorName} proposed double to ${action.value} pts`}
            {isAccept && `${actorName} accepted double`}
            {isDecline && `${actorName} declined (resigned)`}
          </span>
        </div>
        {action.reasoning && (
          <button
            type="button"
            onClick={() => toggleExpanded(actionKey)}
            title={open ? 'Collapse' : 'Click to read reasoning'}
            className={cn(
              'text-left text-slate-400 italic text-[11px] hover:text-sky-300',
              open ? 'whitespace-normal break-words' : 'truncate',
            )}
          >
            {action.reasoning}
          </button>
        )}
      </div>
    )
  }

  const renderTurn = (entry: TurnLogEntry): ReactNode => {
    const isLive = entry === lastEntry && showLive
    const cubeActions = entry.cubeActions ?? []
    const lines = cubeActions.length + entry.moves.length + (isLive ? 1 : 0)
    const span = Math.max(1, lines)
    const current = entry === lastEntry && !isAiThinking && board?.phase !== 'finished'
    const movesClickable = movesPickable(entry)
    const pickedMoves = pick?.turnNumber === entry.turnNumber && pick.kind === 'moves'
    const pickedDice = pick?.turnNumber === entry.turnNumber && pick.kind === 'dice'

    const movesCellClass = cn(
      TD,
      'font-mono whitespace-nowrap',
      movesClickable && PICKABLE,
      movesDoomed(entry.turnNumber) && DOOMED,
      pickedMoves && SELECTED,
    )
    const reasonCellClass = cn(TD, 'max-w-0', movesDoomed(entry.turnNumber) && DOOMED)

    const head = (
      <>
        <td rowSpan={span} className={cn(TD, 'font-mono text-slate-500', diceDoomed(entry.turnNumber) && DOOMED)}>
          {entry.turnNumber}
        </td>
        <td rowSpan={span} className={cn(TD, 'font-mono leading-tight', diceDoomed(entry.turnNumber) && DOOMED)}>
          <div className="text-slate-300">{formatClock(entry.rolledAt)}</div>
          <div className="text-[10px] text-slate-500">
            {entry.elapsedMs === null ? '' : formatElapsed(entry.elapsedMs)}
          </div>
        </td>
        <td rowSpan={span} className={cn(TD, diceDoomed(entry.turnNumber) && DOOMED)}>
          <div className="flex items-center gap-1.5">
            <SeatDot player={entry.player} />
            <span className="truncate text-slate-200">{entry.actorName}</span>
            {entry.actorKind === 'ai' ? (
              <span className="rounded border border-sky-800/50 bg-sky-950/60 px-1 text-[9px] font-semibold text-sky-300">
                AI
              </span>
            ) : null}
          </div>
        </td>
        <td
          rowSpan={span}
          onClick={() => choose(entry, 'dice')}
          title={canRewind ? 'Remove this turn and everything after it, dice included' : undefined}
          className={cn(
            TD,
            'font-mono font-semibold whitespace-nowrap text-slate-100',
            canRewind && PICKABLE,
            diceDoomed(entry.turnNumber) && DOOMED,
            pickedDice && SELECTED,
          )}
        >
          {diceText(entry.roll)}
        </td>
      </>
    )

    const movesTitle = movesClickable
      ? 'Remove the moves from this turn onward, keep the dice sequence'
      : undefined

    const rows: ReactNode[] = []
    let headRendered = false

    // 1. Render doubling cube actions (propose, accept, decline)
    cubeActions.forEach((action, idx) => {
      const isPropose = action.type === 'propose'
      const isAccept = action.type === 'accept'
      const isDecline = action.type === 'decline'
      const actionKey = `cube-${entry.turnNumber}-${idx}`
      const shouldAttachHead = !headRendered
      if (shouldAttachHead) {
        headRendered = true
      }

      rows.push(
        <tr key={actionKey} className={cn(current && 'bg-sky-500/5')}>
          {shouldAttachHead ? head : null}
          <td className={cn(TD, 'whitespace-nowrap')}>
            {isPropose && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300 border border-amber-500/40">
                <span>🎲</span> Double {action.value}x
              </span>
            )}
            {isAccept && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-300 border border-emerald-500/40">
                <span>✓</span> Take ({action.value}x)
              </span>
            )}
            {isDecline && (
              <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-rose-300 border border-rose-500/40">
                <span>✕</span> Drop (Resign)
              </span>
            )}
          </td>
          <td className={reasonCellClass}>{renderCubeReasoning(action, actionKey)}</td>
        </tr>,
      )
    })

    // 2. Render checker moves
    entry.moves.forEach((move) => {
      const shouldAttachHead = !headRendered
      if (shouldAttachHead) {
        headRendered = true
      }
      rows.push(
        <tr key={`m-${move.stepIndex}`} className={cn(current && 'bg-sky-500/5')}>
          {shouldAttachHead ? head : null}
          <td onClick={() => choose(entry, 'moves')} title={movesTitle} className={movesCellClass}>
            <span className={cn(move.isHit && 'text-rose-400')}>{move.formatted}</span>
          </td>
          <td className={reasonCellClass}>{renderReasoning(move, entry)}</td>
        </tr>,
      )
    })

    // 3. Render live streaming AI thought if active
    if (isLive) {
      const shouldAttachHead = !headRendered
      if (shouldAttachHead) {
        headRendered = true
      }
      rows.push(
        <tr key={`live-${entry.turnNumber}`}>
          {shouldAttachHead ? head : null}
          <td className={cn(TD, 'font-mono text-slate-500')}>…</td>
          <td className={cn(TD, 'max-w-0')} aria-live="polite" aria-busy="true">
            <span className="block truncate text-sky-300">
              {liveText.length > 0 ? liveText : 'Thinking…'}
              <span className={CARET} aria-hidden />
            </span>
          </td>
        </tr>,
      )
    }

    // 4. Fallback when there are neither cube actions nor moves yet
    if (rows.length === 0) {
      const passed = entry.passedReason !== null
      rows.push(
        <tr key={`empty-${entry.turnNumber}`} className={cn(current && 'bg-sky-500/5')}>
          {head}
          <td onClick={() => choose(entry, 'moves')} title={movesTitle} className={cn(movesCellClass, 'font-sans')}>
            {passed ? (
              <span className="italic text-amber-400">
                {entry.passedReason === 'unplayable-roll' ? 'No legal move' : 'Passed'}
              </span>
            ) : (
              <span className="italic text-slate-500">to move…</span>
            )}
          </td>
          <td className={reasonCellClass} />
        </tr>,
      )
    }

    return rows
  }

  const renderPending = (turn: PendingTurn): ReactNode => (
    <tr key={`p-${turn.turnNumber}`} className="opacity-50" title="Dice kept from before the rewind">
      <td className={cn(TD, 'font-mono text-slate-500', diceDoomed(turn.turnNumber) && DOOMED)}>{turn.turnNumber}</td>
      <td className={cn(TD, 'text-slate-500')}>—</td>
      <td className={TD}>
        <div className="flex items-center gap-1.5">
          <SeatDot player={turn.player} />
          <span className="text-slate-400">{turn.player === 'light' ? 'White' : 'Black'}</span>
        </div>
      </td>
      <td className={cn(TD, 'font-mono font-semibold whitespace-nowrap', diceDoomed(turn.turnNumber) && DOOMED)}>
        {diceText(turn.roll)}
      </td>
      <td className={cn(TD, 'italic text-slate-500')}>to replay</td>
      <td className={TD} />
    </tr>
  )

  const pickedEntry = pick === null ? null : turnEntries.find((e) => e.turnNumber === pick.turnNumber) ?? null

  return (
    <section aria-label="Game history log" className={PANEL}>
      {/* Header & toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-3 py-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-sky-400" />
          <h2 className="text-xs font-semibold tracking-wide uppercase text-slate-200">Game Log &amp; Turns</h2>
          {isPaused && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
              Paused
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={togglePause}
          disabled={!active || board?.phase === 'finished'}
          className={cn(
            'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
            isPaused
              ? 'border border-emerald-500/40 bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50'
              : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
            (!active || board?.phase === 'finished') && 'cursor-not-allowed opacity-40',
          )}
          title={isPaused ? 'Resume game flow' : 'Pause game (halts AI auto-play)'}
        >
          {isPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5" />}
          <span>{isPaused ? 'Resume' : 'Pause'}</span>
        </button>
      </div>

      {/* Rewind confirmation */}
      {pick !== null && pickedEntry !== null ? (
        <div
          role="alertdialog"
          aria-label="Confirm rewind"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-red-900/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-200"
        >
          <span>
            {pick.kind === 'moves'
              ? `Remove the moves from turn ${pick.turnNumber} onward? The dice sequence is kept and replayed.`
              : `Remove turn ${pick.turnNumber} onward, dice included? The next rolls will be random.`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={confirm}
              className="flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-red-500"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              Remove
            </button>
            <button
              type="button"
              onClick={() => setPick(null)}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-500/20"
            >
              <X className="h-3 w-3" aria-hidden />
              Cancel
            </button>
          </div>
        </div>
      ) : isPaused && active && board?.phase !== 'finished' ? (
        <div className="border-b border-amber-900/50 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">
          Game paused. Click <strong className="font-semibold">Resume</strong> to continue.
        </div>
      ) : null}

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto text-xs select-text">
        {!active && (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-slate-500">
            <Clock className="mb-2 h-8 w-8 opacity-30" />
            <p className="font-medium text-slate-400">No game in progress</p>
            <p className="mt-1 max-w-xs text-xs text-slate-600">
              Start a new game from the Game menu to track rolls, moves, and AI thinking turn by turn.
            </p>
          </div>
        )}

        {active && turnEntries.length === 0 && pendingTurns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-slate-500">
            <Swords className="mb-2 h-8 w-8 text-sky-400 opacity-40" />
            <p className="font-medium text-slate-300">Game started</p>
            <p className="mt-1 text-xs text-slate-500">Roll the dice to log Turn 1.</p>
          </div>
        )}

        {active && (turnEntries.length > 0 || pendingTurns.length > 0) && (
          <table className="w-full min-w-[30rem] table-fixed border-collapse text-[11px]">
            <colgroup>
              <col className="w-7" />
              <col className="w-16" />
              <col className="w-24" />
              <col className="w-12" />
              <col className="w-20" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>Time</th>
                <th className={TH}>Player</th>
                <th className={TH}>Dice</th>
                <th className={TH}>Moves</th>
                <th className={TH}>AI reasoning</th>
              </tr>
            </thead>
            <tbody>
              {turnEntries.map(renderTurn)}
              {pendingTurns.map(renderPending)}
            </tbody>
          </table>
        )}
      </div>

      {active && canRewind && turnEntries.length > 0 && pick === null ? (
        <p className="border-t border-slate-800 px-3 py-1 text-[10px] text-slate-500">
          Tip: click a <strong>Moves</strong> cell to replay from there with the same dice, or a{' '}
          <strong>Dice</strong> cell to replay with new dice.
        </p>
      ) : null}
    </section>
  )
}

export default GameLog
