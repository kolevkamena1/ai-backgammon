import { useAiThought } from '@/hooks/useAiThought'
import { cn } from '@/utils/cn'
import { SEAT_LABELS } from '@/utils/gameConfig'
import { Brain, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface AiThoughtPanelProps {
  /** Provider name for the "Asking the engine (…)" line shown before any text arrives. */
  providerName?: string | null
}

const PANEL = 'flex gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2'
const HEADING = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400'
/**
 * Bounded and scrollable because a chatty model can produce far more than one sentence: the panel
 * must never push the roll button off the screen.
 */
const BODY = 'max-h-32 overflow-y-auto text-xs leading-relaxed text-slate-300'
const CARET = 'ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-sky-400'

/**
 * What the engine said about the move it just made, or the text still arriving for the next one.
 * It owns the `aiThought` subscription (via `useAiThought`) so a streamed token repaints only this
 * panel — not the board or the controls around it. Purely a mirror: it holds no game state, draws no
 * conclusions, and cannot affect the game — the move is validated and applied before this renders.
 */
const AiThoughtPanel = ({ providerName = null }: AiThoughtPanelProps) => {
  const { thought, isAiThinking, clearAiThought } = useAiThought()
  const body = useRef<HTMLParagraphElement>(null)

  // Keep the newest words in view while they stream in. Without this the panel looks frozen at the
  // top while tokens are still landing, which reads as the engine having stopped talking.
  useEffect(() => {
    const node = body.current

    if (node !== null) {
      node.scrollTop = node.scrollHeight
    }
  }, [thought?.text, thought?.phase])

  if (thought === null) {
    // No sentence yet: while a request is in flight, show the waiting line. Superseded by the panel
    // below as soon as streamed text exists, so the player never reads the same status twice.
    if (isAiThinking) {
      return (
        <p className="flex items-center gap-2 text-sm text-sky-300" aria-live="polite">
          <span className="relative flex size-2.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-sky-500" />
          </span>
          Asking the engine{providerName ? ` (${providerName})` : ''} for a move…
        </p>
      )
    }
    return null
  }

  const streaming = thought.phase === 'streaming'

  return (
    <section aria-label="AI reasoning" className={PANEL}>
      <Brain className="size-4 shrink-0 text-sky-400" aria-hidden />
      <div className="min-w-40 flex-1 space-y-1">
        <p className={HEADING}>
          {SEAT_LABELS[thought.seat]}
          {streaming ? ' is reasoning' : ' says'}
        </p>
        <p className={BODY} aria-live="polite" aria-busy={streaming}>
          {thought.text.length > 0 ? thought.text : 'Thinking…'}
          {streaming ? <span className={cn(CARET)} aria-hidden /> : null}
        </p>
      </div>
      <button
        type="button"
        onClick={clearAiThought}
        aria-label="Hide the engine's reasoning"
        className="shrink-0 self-start rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </section>
  )
}

export default AiThoughtPanel