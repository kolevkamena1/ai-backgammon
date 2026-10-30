import type { PlayerColor, PointIndex } from '@/types/game'
import { cn } from '@/utils/cn'
import Checker from './Checker'

type PointOrientation = 'top' | 'bottom'

interface PointProps {
  index: PointIndex
  /** `top` = apex points down towards the bar; `bottom` = apex points up. */
  orientation: PointOrientation
  checkers?: number
  owner?: PlayerColor | null
}

const CLIP_PATH: Record<PointOrientation, string> = {
  top: '[clip-path:polygon(0%_0%,100%_0%,50%_100%)]',
  bottom: '[clip-path:polygon(50%_0%,100%_100%,0%_100%)]',
}

/** Checkers stack from the wide base towards the apex. */
const CHECKER_STACK: Record<PointOrientation, string> = {
  top: 'justify-start pt-5',
  bottom: 'justify-end pb-5',
}

/** The index number sits at each triangle's wide base, clear of the checkers. */
const LABEL_ANCHOR: Record<PointOrientation, string> = {
  top: 'top-0',
  bottom: 'bottom-0',
}

/** Past this the triangle gets cluttered; the remainder is summarised as "+n". */
const MAX_VISIBLE_CHECKERS = 6

const Point = ({ index, orientation, checkers = 0, owner = null }: PointProps) => {
  // Alternates within a row and stays continuous across the bar.
  const isDarkPoint = (index + (orientation === 'top' ? 1 : 0)) % 2 === 0
  const visible = Math.min(checkers, MAX_VISIBLE_CHECKERS)
  const overflow = checkers - visible
  const description =
    checkers === 0
      ? 'empty'
      : `${checkers} ${owner ?? 'unowned'} checker${checkers === 1 ? '' : 's'}`

  return (
    <div role="img" aria-label={`Point ${index}, ${description}`} className="relative h-full w-full">
      <div
        className={cn(
          'absolute inset-0',
          CLIP_PATH[orientation],
          isDarkPoint ? 'bg-point-dark' : 'bg-point-light',
        )}
      />

      <span
        className={cn(
          'absolute inset-x-0 select-none text-center text-[10px] font-semibold leading-tight',
          LABEL_ANCHOR[orientation],
          isDarkPoint ? 'text-point-light' : 'text-point-dark',
        )}
      >
        {index}
      </span>

      {owner !== null && visible > 0 ? (
        <div
          className={cn(
            'relative flex h-full w-full flex-col items-center gap-1 px-1',
            CHECKER_STACK[orientation],
          )}
        >
          {Array.from({ length: visible }, (_, slot) => (
            <Checker key={slot} owner={owner} />
          ))}

          {overflow > 0 ? (
            <span
              className={cn(
                'text-[10px] font-bold',
                isDarkPoint ? 'text-point-light' : 'text-point-dark',
              )}
            >
              +{overflow}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default Point
