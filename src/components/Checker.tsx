import type { PlayerColor } from '@/types/game'
import { cn } from '@/utils/cn'

interface CheckerProps {
  owner: PlayerColor
  className?: string
}

const CHECKER_STYLES: Record<PlayerColor, string> = {
  light: 'bg-checker-light border-slate-400',
  dark: 'bg-checker-dark border-slate-600',
}

/** A single disc. Deliberately inert — click/drag handling belongs to the move phase. */
const Checker = ({ owner, className }: CheckerProps) => (
  <span
    aria-hidden
    className={cn(
      'block size-3.5 shrink-0 rounded-full border-2 shadow-sm',
      CHECKER_STYLES[owner],
      className,
    )}
  />
)

export default Checker
