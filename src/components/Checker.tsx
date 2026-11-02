import type { PlayerColor } from '@/types/game'
import { cn } from '@/utils/cn'

interface CheckerProps {
  owner: PlayerColor
  className?: string
}

/**
 * Rims are chosen against the two point colours a checker sits on (`--color-point-light`
 * `#f2dcb4` cream and `--color-point-dark` `#b5502a` terracotta), not against each other: a
 * near-white disc on cream needs a near-black edge to be readable at all, and the old `slate-400`
 * and `slate-600` rims were close enough in luminance to the triangles that both colours blurred
 * into them. `border-2` rather than a `ring`, because a ring would sit outside the disc and eat the
 * width of a 16 px checker; the shadow is tinted so it reads on the light point as well as the dark.
 */
const CHECKER_STYLES: Record<PlayerColor, string> = {
  light: 'bg-checker-light border-slate-900 checker-disc-light',
  dark: 'bg-checker-dark border-slate-50 checker-disc-dark',
}

/** A single disc. Deliberately inert — click/drag handling belongs to the move phase. */
const Checker = ({ owner, className }: CheckerProps) => (
  <span
    aria-hidden
    style={{
      width: 'var(--checker-size, 1rem)',
      height: 'var(--checker-size, 1rem)',
    }}
    className={cn(
      'checker-disc relative block size-4 aspect-square shrink-0 rounded-full border-2 shadow-md shadow-black/45',
      CHECKER_STYLES[owner],
      className,
    )}
  />
)

export default Checker
