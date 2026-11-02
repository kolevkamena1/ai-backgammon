import type { PlayerColor, PointIndex } from '@/types/game'
import { cn } from '@/utils/cn'
import { useState, type DragEvent } from 'react'
import Checker from './Checker'

type PointOrientation = 'top' | 'bottom'

/** How a point participates in the current click-to-move or drag-to-move selection. */
export type PointState = 'none' | 'selectable' | 'selected' | 'target'

interface PointProps {
  index: PointIndex
  /** `top` = apex points down towards the bar; `bottom` = apex points up. */
  orientation: PointOrientation
  checkers?: number
  owner?: PlayerColor | null
  /** Overlay hint; `target` marks a legal destination, `selected` the active source. */
  state?: PointState
  /** When provided the point becomes a real button; otherwise it stays a static graphic. */
  onSelect?: () => void
  /** True when the top checker on this point has at least one legal move and can be dragged. */
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void
}

const CLIP_PATH: Record<PointOrientation, string> = {
  top: '[clip-path:polygon(0%_0%,100%_0%,50%_100%)]',
  bottom: '[clip-path:polygon(50%_0%,100%_100%,0%_100%)]',
}

/**
 * Checkers stack from the wide base towards the apex. The gap is `gap-0.5` because the stack has to
 * fit a full six discs inside the triangle: see the arithmetic in `Board.tsx`'s `QUADRANT`.
 */
const CHECKER_STACK: Record<PointOrientation, string> = {
  top: 'justify-start pt-5',
  bottom: 'justify-end pb-5',
}

/** The index number sits at each triangle's wide base, clear of the checkers. */
const LABEL_ANCHOR: Record<PointOrientation, string> = {
  top: 'top-0',
  bottom: 'bottom-0',
}

/**
 * Tints are painted on a second clipped layer rather than a ring, because `clip-path` also clips
 * outlines and box-shadows away.
 */
const OVERLAY: Record<PointState, string | null> = {
  none: null,
  selectable: 'bg-sky-300/25',
  selected: 'bg-sky-300/60',
  target: 'bg-emerald-300/60',
}

/** Past this the triangle gets cluttered; the remainder is summarised as "+n". */
const MAX_VISIBLE_CHECKERS = 6

const Point = ({
  index,
  orientation,
  checkers = 0,
  owner = null,
  state = 'none',
  onSelect,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: PointProps) => {
  const [isDragOver, setIsDragOver] = useState(false)
  // Alternates within a row and stays continuous across the bar.
  const isDarkPoint = (index + (orientation === 'top' ? 1 : 0)) % 2 === 0
  const visible = Math.min(checkers, MAX_VISIBLE_CHECKERS)
  const overflow = checkers - visible
  const description = `Point ${index}, ${
    checkers === 0 ? 'empty' : `${checkers} ${owner ?? 'unowned'} checker${checkers === 1 ? '' : 's'}`
  }`
  const overlay = OVERLAY[state]

  const handleDragStart = (event: DragEvent<HTMLButtonElement>): void => {
    const discs = event.currentTarget.querySelectorAll<HTMLElement>('.checker-disc')
    const grabbed =
      orientation === 'top' ? discs[discs.length - 1] : discs[0]
    if (grabbed && typeof event.dataTransfer?.setDragImage === 'function') {
      const rect = grabbed.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        event.dataTransfer.setDragImage(grabbed, rect.width / 2, rect.height / 2)
      }
    }
    onDragStart?.(event)
  }

  const handleDragOver = (event: DragEvent<HTMLButtonElement>): void => {
    if (!onDragOver) return
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    if (!isDragOver) {
      setIsDragOver(true)
    }
    onDragOver(event)
  }

  const handleDragLeave = (): void => {
    if (isDragOver) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>): void => {
    if (!onDrop) return
    event.preventDefault()
    setIsDragOver(false)
    onDrop(event)
  }

  const inner = (
    <>
      <div
        className={cn(
          'absolute inset-0',
          CLIP_PATH[orientation],
          isDarkPoint
            ? 'bg-point-dark point-triangle-dark'
            : 'bg-point-light point-triangle-light',
        )}
      />

      {overlay ? (
        <div
          className={cn(
            'absolute inset-0 transition-opacity',
            CLIP_PATH[orientation],
            overlay,
            isDragOver && state === 'target' && 'brightness-125',
          )}
        />
      ) : null}

      <span
        className={cn(
          'point-index-label absolute inset-x-0 select-none text-center text-[10px] font-semibold leading-tight',
          LABEL_ANCHOR[orientation],
          isDarkPoint ? 'text-point-light' : 'text-point-dark',
        )}
      >
        {index}
      </span>

      {owner !== null && visible > 0 ? (
        <div
          className={cn(
            'relative flex h-full w-full flex-col items-center gap-0.5 px-1',
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
    </>
  )

  const layout = 'relative h-full w-full'

  if (onSelect) {
    return (
      <button
        type="button"
        aria-label={description}
        draggable={draggable}
        onClick={onSelect}
        onDragStart={draggable ? handleDragStart : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        onDragOver={onDragOver ? handleDragOver : undefined}
        onDragLeave={onDragOver ? handleDragLeave : undefined}
        onDrop={onDrop ? handleDrop : undefined}
        className={cn(
          layout,
          'cursor-pointer appearance-none border-0 bg-transparent p-0 text-left',
          draggable && 'cursor-grab active:cursor-grabbing',
        )}
      >
        {inner}
      </button>
    )
  }

  return (
    <div role="img" aria-label={description} className={layout}>
      {inner}
    </div>
  )
}

export default Point
