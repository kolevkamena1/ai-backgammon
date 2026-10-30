import type {
  BoardState,
  MoveSource,
  MoveTarget,
  PlayerColor,
  Point as PointModel,
  PointIndex,
} from '@/types/game'
import { getInitialBoardState, toPointViews } from '@/utils/gameLogic'
import { cn } from '@/utils/cn'
import { useMemo } from 'react'
import Point, { type PointState } from './Point'

interface BoardProps {
  /** Signed board; falls back to the opening layout so the shell renders without a game. */
  board?: BoardState
  /** Whose turn it is: decides which bar cell and bear-off tray are live. */
  turn?: PlayerColor | null
  /** Destinations reachable from the current selection, painted green. */
  legalTargets?: ReadonlySet<MoveSource | MoveTarget>
  /** Sources with at least one legal move: the only triangles worth clicking. */
  selectableSources?: ReadonlySet<MoveSource>
  selectedFrom?: MoveSource | null
  onSelectPoint?: (target: MoveSource | MoveTarget) => void
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

const QUADRANT = 'grid h-28 grid-cols-6 gap-1 sm:h-32'

/** Display-only names; the domain colour is `light` / `dark`. */
const SEAT_NAMES: Record<PlayerColor, string> = { light: 'White', dark: 'Black' }

/** Used until a game starts, and by any render that passes no board. */
const OPENING_BOARD = getInitialBoardState()

const Tray = ({
  seat,
  count,
  live,
  onSelect,
}: {
  seat: PlayerColor
  count: number
  live: boolean
  onSelect?: () => void
}) => {
  const label = `${SEAT_NAMES[seat]} off ${count}`
  const look = cn(
    'flex w-9 shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-center',
    live ? 'bg-emerald-500/25 text-slate-50' : 'bg-board-field/70 text-point-light/50',
  )

  const body = (
    <>
      <span className="text-[9px] uppercase tracking-[0.18em]">{SEAT_NAMES[seat]}</span>
      <span className="text-sm font-semibold">{count}</span>
    </>
  )

  if (onSelect) {
    return (
      <button type="button" aria-label={`Bear off into the ${SEAT_NAMES[seat]} tray`} title={label} onClick={onSelect} className={cn(look, 'cursor-pointer appearance-none border-0 transition-colors hover:bg-emerald-500/40')}>
        {body}
      </button>
    )
  }

  return (
    <div role="img" aria-label={label} title={label} className={look}>
      {body}
    </div>
  )
}

/** Checkers waiting to re-enter. Nothing else may move while these exist. */
const BarCell = ({
  seat,
  count,
  live,
  selected,
  onSelect,
}: {
  seat: PlayerColor
  count: number
  live: boolean
  selected: boolean
  onSelect?: () => void
}) => {
  const look = cn(
    'rounded-md px-1 py-1 text-center text-[10px] font-semibold',
    selected ? 'bg-sky-400/70 text-slate-950' : live ? 'bg-emerald-500/30 text-slate-50' : 'text-point-light/45',
  )

  const body = (
    <>
      <span className="block uppercase tracking-[0.1em]">{SEAT_NAMES[seat]}</span>
      <span className="block text-xs">{count}</span>
    </>
  )

  if (onSelect) {
    return (
      <button
        type="button"
        aria-label={`Bring ${SEAT_NAMES[seat]} in from the bar`}
        title={`${SEAT_NAMES[seat]} has ${count} checker${count === 1 ? '' : 's'} on the bar`}
        onClick={onSelect}
        className={cn(look, 'cursor-pointer appearance-none border-0 transition-colors hover:bg-emerald-500/45')}
      >
        {body}
      </button>
    )
  }

  return (
    <div title={`${SEAT_NAMES[seat]} has ${count} checker${count === 1 ? '' : 's'} on the bar`} className={look}>
      {body}
    </div>
  )
}

/** Presentational board: 24 triangles, the bar and both bear-off trays, driven by `BoardState`. */
const Board = ({
  board = OPENING_BOARD,
  turn = null,
  legalTargets,
  selectableSources,
  selectedFrom = null,
  onSelectPoint,
  className,
}: BoardProps) => {
  const byIndex = useMemo(
    () => new Map<PointIndex, PointModel>(toPointViews(board).map((point) => [point.index, point])),
    [board],
  )

  const stateFor = (index: PointIndex): PointState => {
    if (selectedFrom === index) return 'selected'
    if (legalTargets?.has(index)) return 'target'
    if (selectableSources?.has(index)) return 'selectable'
    return 'none'
  }

  const renderQuadrant = (indices: readonly PointIndex[], orientation: 'top' | 'bottom') => (
    <div className={QUADRANT}>
      {indices.map((index) => {
        const point = byIndex.get(index)
        const state = stateFor(index)

        return (
          <Point
            key={index}
            index={index}
            orientation={orientation}
            checkers={point?.checkers ?? 0}
            owner={point?.owner ?? null}
            state={state}
            // Static triangles stay static: only relevant points become tab stops.
            onSelect={onSelectPoint && state !== 'none' ? () => onSelectPoint(index) : undefined}
          />
        )
      })}
    </div>
  )

  const barLive = (seat: PlayerColor): boolean => turn === seat && (selectableSources?.has('bar') ?? false)
  const trayLive = (seat: PlayerColor): boolean => turn === seat && (legalTargets?.has('off') ?? false)

  return (
    <section
      aria-label="Backgammon board"
      className={cn(
        'w-full max-w-3xl rounded-2xl border border-amber-900/70 bg-board-frame p-3 shadow-2xl sm:p-4',
        className,
      )}
    >
      <div className="flex items-stretch gap-2">
        <Tray
          seat="dark"
          count={board.off.dark}
          live={trayLive('dark')}
          onSelect={trayLive('dark') && onSelectPoint ? () => onSelectPoint('off') : undefined}
        />

        <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] grid-rows-2 gap-x-2 rounded-xl bg-board-field p-2">
          <div className="col-start-1 row-start-1">{renderQuadrant(LEFT_TOP, 'top')}</div>

          <div className="col-start-2 row-span-2 row-start-1 flex w-14 flex-col items-center justify-between gap-1 rounded-md bg-bar py-1">
            <BarCell
              seat="dark"
              count={board.bar.dark}
              live={barLive('dark')}
              selected={turn === 'dark' && selectedFrom === 'bar'}
              onSelect={barLive('dark') && onSelectPoint ? () => onSelectPoint('bar') : undefined}
            />

            <span className="text-[10px] uppercase tracking-[0.3em] text-point-light/40 [writing-mode:vertical-rl]">
              Bar
            </span>

            <BarCell
              seat="light"
              count={board.bar.light}
              live={barLive('light')}
              selected={turn === 'light' && selectedFrom === 'bar'}
              onSelect={barLive('light') && onSelectPoint ? () => onSelectPoint('bar') : undefined}
            />
          </div>

          <div className="col-start-3 row-start-1">{renderQuadrant(RIGHT_TOP, 'top')}</div>

          <div className="col-start-1 row-start-2">{renderQuadrant(LEFT_BOTTOM, 'bottom')}</div>

          <div className="col-start-3 row-start-2">{renderQuadrant(RIGHT_BOTTOM, 'bottom')}</div>
        </div>

        <Tray
          seat="light"
          count={board.off.light}
          live={trayLive('light')}
          onSelect={trayLive('light') && onSelectPoint ? () => onSelectPoint('off') : undefined}
        />
      </div>
    </section>
  )
}

export default Board
