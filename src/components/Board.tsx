import type { PlayerColor, Point as PointModel, PointIndex } from '@/types/game'
import { cn } from '@/utils/cn'
import Point from './Point'

interface BoardProps {
  /** 24 points; the visual placeholder is used when omitted. */
  points?: readonly PointModel[]
  className?: string
}

/**
 * Numbering as seen by the player at the bottom: the bottom row runs 12..1 from left to
 * right (point 1 in the bottom-right corner) and the top row runs 13..24.
 */
const LEFT_TOP: readonly PointIndex[] = [13, 14, 15, 16, 17, 18]
const RIGHT_TOP: readonly PointIndex[] = [19, 20, 21, 22, 23, 24]
const LEFT_BOTTOM: readonly PointIndex[] = [12, 11, 10, 9, 8, 7]
const RIGHT_BOTTOM: readonly PointIndex[] = [6, 5, 4, 3, 2, 1]

/**
 * Visual-only fixture so the shell renders a recognisable board (the standard 2/3/5/5
 * opening layout). This is NOT game logic — nothing validates or mutates it.
 * TODO(phase 2): delete once the board is driven by the game store.
 */
const PLACEHOLDER_LAYOUT: Readonly<Record<number, { checkers: number; owner: PlayerColor }>> = {
  1: { checkers: 2, owner: 'dark' },
  6: { checkers: 5, owner: 'light' },
  8: { checkers: 3, owner: 'light' },
  12: { checkers: 5, owner: 'dark' },
  13: { checkers: 5, owner: 'light' },
  17: { checkers: 3, owner: 'dark' },
  19: { checkers: 5, owner: 'dark' },
  24: { checkers: 2, owner: 'light' },
}

const PLACEHOLDER_POINTS: PointModel[] = Array.from({ length: 24 }, (_, position) => {
  const index = position + 1
  const entry = PLACEHOLDER_LAYOUT[index]
  return { index, checkers: entry?.checkers ?? 0, owner: entry?.owner ?? null }
})

const QUADRANT = 'grid h-28 grid-cols-6 gap-1 sm:h-32'

const Tray = ({ side }: { side: PlayerColor | 'left' | 'right' }) => (
  <div
    role="img"
    aria-label={`${side} bear-off tray`}
    className="hidden w-9 shrink-0 items-center justify-center rounded-lg bg-board-field/70 sm:flex"
  >
    <span className="text-[10px] uppercase tracking-[0.25em] text-point-light/50 [writing-mode:vertical-rl]">
      Bear off
    </span>
  </div>
)

/** Presentational board: 24 triangles, the bar, and the two bear-off trays. */
const Board = ({ points = PLACEHOLDER_POINTS, className }: BoardProps) => {
  const byIndex = new Map<PointIndex, PointModel>(points.map((point) => [point.index, point]))

  const renderQuadrant = (indices: readonly PointIndex[], orientation: 'top' | 'bottom') => (
    <div className={QUADRANT}>
      {indices.map((index) => {
        const point = byIndex.get(index)

        return (
          <Point
            key={index}
            index={index}
            orientation={orientation}
            checkers={point?.checkers ?? 0}
            owner={point?.owner ?? null}
          />
        )
      })}
    </div>
  )

  return (
    <section
      aria-label="Backgammon board (placeholder)"
      className={cn(
        'w-full max-w-3xl rounded-2xl border border-amber-900/70 bg-board-frame p-3 shadow-2xl sm:p-4',
        className,
      )}
    >
      <div className="flex items-stretch gap-2">
        <Tray side="left" />

        <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] grid-rows-2 gap-x-2 rounded-xl bg-board-field p-2">
          <div className="col-start-1 row-start-1">{renderQuadrant(LEFT_TOP, 'top')}</div>

          <div className="col-start-2 row-span-2 row-start-1 flex w-6 items-center justify-center rounded-md bg-bar">
            <span className="text-[10px] uppercase tracking-[0.3em] text-point-light/40 [writing-mode:vertical-rl]">
              Bar
            </span>
          </div>

          <div className="col-start-3 row-start-1">{renderQuadrant(RIGHT_TOP, 'top')}</div>

          <div className="col-start-1 row-start-2">{renderQuadrant(LEFT_BOTTOM, 'bottom')}</div>

          <div className="col-start-3 row-start-2">{renderQuadrant(RIGHT_BOTTOM, 'bottom')}</div>
        </div>

        <Tray side="right" />
      </div>
    </section>
  )
}

export default Board
