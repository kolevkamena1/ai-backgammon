import type { DieFace } from '@/types/game'
import { cn } from '@/utils/cn'

interface DieProps {
  value: DieFace
  /** Rendered dimmed once the die has been spent on a move. */
  used?: boolean
  /** Overrides the generated accessible label. */
  label?: string
  className?: string
}

/** The nine pip slots of a 3x3 grid, numbered left-to-right, top-to-bottom. */
const PIP_SLOTS = 9

const PIP_LAYOUT: Record<DieFace, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

/** Purely visual: no rolling, no selection, no game meaning. */
const Die = ({ value, used = false, label, className }: DieProps) => {
  const pips = PIP_LAYOUT[value]

  return (
    <div
      role="img"
      aria-label={label ?? `Die showing ${value}`}
      className={cn(
        'grid size-12 shrink-0 place-items-center rounded-lg border border-slate-500 bg-slate-100 p-1.5 shadow-md transition-opacity',
        used && 'opacity-40',
        className,
      )}
    >
      <div className="grid h-full w-full grid-cols-3 grid-rows-3">
        {Array.from({ length: PIP_SLOTS }, (_, slot) => (
          <span
            key={slot}
            className={cn(
              'size-2 self-center justify-self-center rounded-full',
              pips.includes(slot) ? 'bg-slate-900' : 'bg-transparent',
            )}
          />
        ))}
      </div>
    </div>
  )
}

export default Die
