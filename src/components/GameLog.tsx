import { useEffect, useRef, useState, type FC } from 'react'
import { useGame } from '@/hooks/useGame'
import { cn } from '@/utils/cn'
import {
  Clock,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
  Swords,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import Die from './Die'

const PANEL = 'flex flex-1 min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-lg'

export const GameLog: FC = () => {
  const {
    board,
    active,
    isPaused,
    togglePause,
    undo,
    redo,
    canUndo,
    canRedo,
    turnEntries,
    currentStepIndex,
    stepHistory,
    jumpToStep,
  } = useGame()

  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [expandedThoughts, setExpandedThoughts] = useState<Record<number, boolean>>({})

  // Automatically scroll to bottom when new steps are added unless user navigated history
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [turnEntries.length, stepHistory.length, autoScroll])

  const toggleThought = (turnNumber: number) => {
    setExpandedThoughts((prev) => ({
      ...prev,
      [turnNumber]: !prev[turnNumber],
    }))
  }

  const isRewound = currentStepIndex < stepHistory.length - 1

  return (
    <section aria-label="Game history log" className={PANEL}>
      {/* Log Header & Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-3 py-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-sky-400" />
          <h2 className="text-xs font-semibold tracking-wide uppercase text-slate-200">
            Game Log & Turns
          </h2>
          {isPaused && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/30">
              Paused
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={togglePause}
            disabled={!active || board?.phase === 'finished'}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
              isPaused
                ? 'bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50 border border-emerald-500/40'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700',
              (!active || board?.phase === 'finished') && 'opacity-40 cursor-not-allowed',
            )}
            title={isPaused ? 'Resume game flow' : 'Pause game (halts AI auto-play)'}
          >
            {isPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5" />}
            <span>{isPaused ? 'Resume' : 'Pause'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAutoScroll(false)
              undo()
            }}
            disabled={!canUndo}
            className={cn(
              'flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-colors',
              !canUndo && 'opacity-35 cursor-not-allowed',
            )}
            title="Undo move or roll (steps back in time)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Undo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              redo()
            }}
            disabled={!canRedo}
            className={cn(
              'flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-colors',
              !canRedo && 'opacity-35 cursor-not-allowed',
            )}
            title="Redo move"
          >
            <RotateCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Redo</span>
          </button>
        </div>
      </div>

      {/* Rewound Notice Banner */}
      {isRewound && (
        <div className="flex items-center justify-between bg-amber-950/40 border-b border-amber-900/50 px-3 py-1.5 text-xs text-amber-200">
          <span>
            Rewound to step <strong className="font-semibold text-amber-100">{currentStepIndex}</strong> of {stepHistory.length - 1}.
          </span>
          <button
            type="button"
            onClick={() => jumpToStep(stepHistory.length - 1)}
            className="text-[11px] underline hover:text-white"
          >
            Jump to latest
          </button>
        </div>
      )}

      {/* Turn History List */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5 text-xs select-text"
      >
        {!active && (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-slate-500">
            <Clock className="h-8 w-8 mb-2 opacity-30" />
            <p className="font-medium text-slate-400">No game in progress</p>
            <p className="text-xs text-slate-600 mt-1 max-w-xs">
              Start a new game from the Game menu to track rolls, moves, and AI thinking turn by turn.
            </p>
          </div>
        )}

        {active && turnEntries.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-slate-500">
            <Swords className="h-8 w-8 mb-2 opacity-40 text-sky-400" />
            <p className="font-medium text-slate-300">Game started</p>
            <p className="text-xs text-slate-500 mt-1">Roll the dice to log Turn 1.</p>
          </div>
        )}

        {turnEntries.map((turn) => {
          const isLight = turn.player === 'light'
          const isAi = turn.actorKind === 'ai'
          const hasThought = Boolean(turn.aiThought)
          const isThoughtExpanded = expandedThoughts[turn.turnNumber] ?? true

          return (
            <div
              key={turn.turnNumber}
              className={cn(
                'rounded-lg border bg-slate-900/90 transition-all shadow-sm',
                isLight ? 'border-amber-900/30' : 'border-sky-900/30',
              )}
            >
              {/* Turn Header */}
              <div
                className="flex items-center justify-between border-b border-slate-800/80 px-2.5 py-1.5 cursor-pointer hover:bg-slate-800/50"
                onClick={() => {
                  if (turn.stepIndices.length > 0) {
                    jumpToStep(turn.stepIndices[0])
                  }
                }}
                title="Click to jump to this turn's start"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-slate-400">
                    T{turn.turnNumber}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'inline-block h-3 w-3 rounded-full border shadow-sm',
                        isLight
                          ? 'bg-amber-100 border-amber-300'
                          : 'bg-slate-800 border-slate-600',
                      )}
                    />
                    <span className="font-medium text-slate-200">
                      {turn.actorName}
                    </span>
                    {isAi && (
                      <span className="rounded bg-sky-950/80 px-1.5 py-0.2 text-[10px] text-sky-300 border border-sky-800/50 font-medium">
                        AI
                      </span>
                    )}
                  </div>
                </div>

                {/* Dice roll badge */}
                {turn.roll && (
                  <div className="flex items-center gap-1 scale-75 origin-right">
                    <Die value={turn.roll[0]} className="size-6 p-0.5 rounded shadow-sm" />
                    <Die value={turn.roll[1]} className="size-6 p-0.5 rounded shadow-sm" />
                  </div>
                )}
              </div>

              {/* Moves Body */}
              <div className="p-2 space-y-1.5">
                {turn.moves.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {turn.moves.map((move, moveIdx) => {
                      // Corresponding stepIndex for this move:
                      // turn.stepIndices[0] is the roll, subsequent indices are moves
                      const stepIdx = turn.stepIndices[moveIdx + 1] ?? turn.stepIndices[moveIdx]
                      const isCurrentStep = currentStepIndex === stepIdx

                      return (
                        <button
                          key={moveIdx}
                          type="button"
                          onClick={() => jumpToStep(stepIdx)}
                          title="Click to jump to this move"
                          className={cn(
                            'group flex items-center gap-1 rounded border px-2 py-0.5 text-xs transition-colors',
                            isCurrentStep
                              ? 'border-sky-400 bg-sky-500/20 text-white font-semibold ring-1 ring-sky-400'
                              : 'border-slate-700/80 bg-slate-800/60 text-slate-300 hover:border-slate-500 hover:bg-slate-800',
                            move.isHit && 'border-rose-900/60 bg-rose-950/30 text-rose-200',
                          )}
                        >
                          <span>{move.formatted}</span>
                          {move.isHit && (
                            <span className="text-[10px] font-bold text-rose-400" title="Hit opponent checker onto bar">
                              (Hit)
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ) : turn.passedReason ? (
                  <div className="text-[11px] text-amber-400 italic">
                    Turn passed ({turn.passedReason === 'unplayable-roll' ? 'No legal moves' : 'Stranded dice'})
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 italic">Rolling / waiting for move...</div>
                )}

                {/* AI Thought Card */}
                {hasThought && (
                  <div className="mt-1.5 rounded border border-sky-900/40 bg-sky-950/20 text-[11px] text-slate-300 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleThought(turn.turnNumber)}
                      className="flex w-full items-center justify-between px-2 py-1 text-slate-400 hover:text-sky-300 font-medium"
                    >
                      <div className="flex items-center gap-1 text-sky-400">
                        <Sparkles className="h-3 w-3" />
                        <span>AI Reasoning</span>
                      </div>
                      {isThoughtExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                    {isThoughtExpanded && (
                      <p className="px-2 pb-2 pt-0.5 text-slate-300 leading-relaxed border-t border-sky-900/30">
                        "{turn.aiThought}"
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default GameLog
