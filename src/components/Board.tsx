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
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import Point, { type PointState } from './Point'

export interface BoardDimensions {
  width: number
  height: number
}

export type ResizeHandle =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export const DEFAULT_BOARD_DIMENSIONS: BoardDimensions = {
  width: 768,
  height: 368,
}

export const MIN_BOARD_WIDTH = 440
export const MAX_BOARD_WIDTH = 1360
export const MIN_BOARD_HEIGHT = 260
export const MAX_BOARD_HEIGHT = 880

const BOARD_SIZE_STORAGE_KEY = 'ai-backgammon:board-size'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Computes the internal quadrant height and circular checker diameter (in px) for a given board
 * width and height. Checkers always remain 1:1 circles (`width === height`) and are capped by both
 * the point triangle width and the 6-checker vertical stack height so they never spill.
 */
export function computeBoardMetrics(width: number, height: number): {
  quadrantHeight: number
  checkerSize: number
} {
  // Outer vertical chrome (frame padding + inner field padding + gap) is ~48px; two rows share the rest.
  const quadrantHeight = Math.max(100, Math.round((height - 48) / 2))

  // Outer horizontal chrome (frame padding + two trays + bar + gaps) is ~248px; 12 points share the rest.
  const pointWidth = Math.max(20, (width - 248) / 12)

  // Hard ceilings so a circular checker never overflows its triangle horizontally or vertically.
  const maxFromWidth = Math.floor(pointWidth * 0.68)
  const maxFromHeight = Math.floor((quadrantHeight - 36) / 6)
  const ceiling = Math.max(10, Math.min(40, maxFromWidth, maxFromHeight))

  // Scale smoothly with the geometric mean of width & height relative to the 768x368 default (16px disc).
  const scale = Math.sqrt(
    (width / DEFAULT_BOARD_DIMENSIONS.width) * (height / DEFAULT_BOARD_DIMENSIONS.height),
  )
  const desired = Math.round(16 * scale)
  const checkerSize = clamp(desired, 10, ceiling)

  return { quadrantHeight, checkerSize }
}

/**
 * Pure resize step calculator:
 * - `left` / `right` adjust width symmetrically (keeping the centered board's dragged edge under the cursor).
 * - `top` / `bottom` adjust height.
 * - Corner handles (`top-left`, `top-right`, `bottom-left`, `bottom-right`) lock the starting `width / height` ratio.
 */
export function computeResizedDimensions(
  handle: ResizeHandle,
  start: BoardDimensions,
  deltaX: number,
  deltaY: number,
  maxWidth = MAX_BOARD_WIDTH,
  maxHeight = MAX_BOARD_HEIGHT,
): BoardDimensions {
  const effectiveMaxW = Math.max(MIN_BOARD_WIDTH, Math.min(MAX_BOARD_WIDTH, maxWidth))
  const effectiveMaxH = Math.max(MIN_BOARD_HEIGHT, Math.min(MAX_BOARD_HEIGHT, maxHeight))

  if (handle === 'left' || handle === 'right') {
    const signX = handle === 'right' ? 1 : -1
    const nextWidth = clamp(
      Math.round(start.width + signX * deltaX * 2),
      MIN_BOARD_WIDTH,
      effectiveMaxW,
    )
    return { width: nextWidth, height: start.height }
  }

  if (handle === 'top' || handle === 'bottom') {
    const signY = handle === 'bottom' ? 1 : -1
    const nextHeight = clamp(
      Math.round(start.height + signY * deltaY),
      MIN_BOARD_HEIGHT,
      effectiveMaxH,
    )
    return { width: start.width, height: nextHeight }
  }

  // Corner handles: preserve the exact starting aspect ratio (width / height).
  const ratio = start.width / start.height
  const signX = handle.endsWith('right') ? 1 : -1
  const signY = handle.startsWith('bottom') ? 1 : -1

  const scaleX = (start.width + signX * deltaX * 2) / start.width
  const scaleY = (start.height + signY * deltaY) / start.height
  // Follow whichever axis the user moved further from 1.0.
  const rawScale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY

  const minScale = Math.max(MIN_BOARD_WIDTH / start.width, MIN_BOARD_HEIGHT / start.height)
  const maxScale = Math.min(effectiveMaxW / start.width, effectiveMaxH / start.height)
  const clampedScale = clamp(rawScale, minScale, Math.max(minScale, maxScale))

  const nextWidth = Math.round(start.width * clampedScale)
  const nextHeight = Math.round(nextWidth / ratio)

  return { width: nextWidth, height: nextHeight }
}

function loadStoredBoardSize(): BoardDimensions | null {
  try {
    const raw = localStorage.getItem(BOARD_SIZE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BoardDimensions>
    if (
      typeof parsed.width === 'number' &&
      Number.isFinite(parsed.width) &&
      typeof parsed.height === 'number' &&
      Number.isFinite(parsed.height)
    ) {
      return {
        width: clamp(Math.round(parsed.width), MIN_BOARD_WIDTH, MAX_BOARD_WIDTH),
        height: clamp(Math.round(parsed.height), MIN_BOARD_HEIGHT, MAX_BOARD_HEIGHT),
      }
    }
  } catch {
    // Ignore storage read errors in restricted environments.
  }
  return null
}

function saveStoredBoardSize(size: BoardDimensions | null): void {
  try {
    if (size === null) {
      localStorage.removeItem(BOARD_SIZE_STORAGE_KEY)
    } else {
      localStorage.setItem(BOARD_SIZE_STORAGE_KEY, JSON.stringify(size))
    }
  } catch {
    // Ignore storage write errors.
  }
}

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

/**
 * Triangle height, and the number that decides how big a checker can be. A point shows at most
 * `MAX_VISIBLE_CHECKERS` discs plus a `+n` label, inside a column that starts below the point
 * number (`pt-5`/`pb-5`, 20 px):
 *
 *   6 × size-4 (16 px) + 5 × gap-0.5 (2 px) = 106 px, ~120 px with the overflow label
 *   h-36 (144 px) − 20 px = 124 px on a phone, h-40 (160 px) − 20 px = 140 px from `sm` up
 *
 * `h-28`/`sm:h-32` gave 92/108 px, which the old 14 px discs already spilled on a phone. Anything
 * that enlarges `Checker` has to raise these numbers with it, or the stack paints past the apex.
 */
const QUADRANT = 'grid h-36 grid-cols-6 gap-1 sm:h-40'

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
  const sectionRef = useRef<HTMLElement | null>(null)
  const [boardSize, setBoardSize] = useState<BoardDimensions | null>(() => loadStoredBoardSize())
  const [activeHandle, setActiveHandle] = useState<ResizeHandle | null>(null)
  const dragRef = useRef<{
    handle: ResizeHandle
    startX: number
    startY: number
    startSize: BoardDimensions
  } | null>(null)

  useEffect(() => {
    saveStoredBoardSize(boardSize)
  }, [boardSize])

  useEffect(() => {
    if (activeHandle === null) {
      return
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      const viewportMaxW = Math.max(MIN_BOARD_WIDTH, window.innerWidth - 32)
      const viewportMaxH = Math.max(MIN_BOARD_HEIGHT, window.innerHeight - 96)

      const next = computeResizedDimensions(
        drag.handle,
        drag.startSize,
        deltaX,
        deltaY,
        viewportMaxW,
        viewportMaxH,
      )
      setBoardSize(next)
    }

    const handlePointerUp = (): void => {
      dragRef.current = null
      setActiveHandle(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [activeHandle])

  const startResize = (handle: ResizeHandle, event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()

    const rect = sectionRef.current?.getBoundingClientRect()
    const currentSize: BoardDimensions = boardSize ?? {
      width: rect && rect.width > 0 ? Math.round(rect.width) : DEFAULT_BOARD_DIMENSIONS.width,
      height: rect && rect.height > 0 ? Math.round(rect.height) : DEFAULT_BOARD_DIMENSIONS.height,
    }

    dragRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startSize: currentSize,
    }
    setActiveHandle(handle)
  }

  const resetBoardSize = (): void => {
    setBoardSize(null)
  }

  const metrics = useMemo(
    () =>
      boardSize
        ? computeBoardMetrics(boardSize.width, boardSize.height)
        : null,
    [boardSize],
  )

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

  const quadrantStyle: CSSProperties | undefined = metrics
    ? { height: `${metrics.quadrantHeight}px` }
    : undefined

  const renderQuadrant = (indices: readonly PointIndex[], orientation: 'top' | 'bottom') => (
    <div className={QUADRANT} style={quadrantStyle}>
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

  const boardStyle: CSSProperties | undefined =
    boardSize && metrics
      ? ({
          width: `${boardSize.width}px`,
          height: `${boardSize.height}px`,
          maxWidth: '100%',
          '--checker-size': `${metrics.checkerSize}px`,
        } as CSSProperties)
      : undefined

  return (
    <section
      ref={sectionRef}
      aria-label="Backgammon board"
      style={boardStyle}
      className={cn(
        'group relative w-full rounded-2xl border border-amber-900/70 bg-board-frame p-3 shadow-2xl select-none sm:p-4',
        boardSize === null && 'max-w-3xl',
        activeHandle !== null && 'ring-2 ring-sky-400/70',
        className,
      )}
    >
      {/* Edge resize handles (left/right resize width; top/bottom resize height) */}
      <div
        role="separator"
        aria-label="Resize board left edge"
        title="Drag to resize width · Double-click to reset"
        onPointerDown={(e) => startResize('left', e)}
        onDoubleClick={resetBoardSize}
        className="absolute inset-y-3 -left-1.5 z-20 w-3 cursor-ew-resize rounded-full transition hover:bg-sky-400/40"
      />
      <div
        role="separator"
        aria-label="Resize board right edge"
        title="Drag to resize width · Double-click to reset"
        onPointerDown={(e) => startResize('right', e)}
        onDoubleClick={resetBoardSize}
        className="absolute inset-y-3 -right-1.5 z-20 w-3 cursor-ew-resize rounded-full transition hover:bg-sky-400/40"
      />
      <div
        role="separator"
        aria-label="Resize board top edge"
        title="Drag to resize height · Double-click to reset"
        onPointerDown={(e) => startResize('top', e)}
        onDoubleClick={resetBoardSize}
        className="absolute inset-x-3 -top-1.5 z-20 h-3 cursor-ns-resize rounded-full transition hover:bg-sky-400/40"
      />
      <div
        role="separator"
        aria-label="Resize board bottom edge"
        title="Drag to resize height · Double-click to reset"
        onPointerDown={(e) => startResize('bottom', e)}
        onDoubleClick={resetBoardSize}
        className="absolute inset-x-3 -bottom-1.5 z-20 h-3 cursor-ns-resize rounded-full transition hover:bg-sky-400/40"
      />

      {/* Corner resize handles (lock aspect ratio) */}
      <div
        role="separator"
        aria-label="Resize board top-left corner (keeps aspect ratio)"
        title="Drag corner to resize proportionally · Double-click to reset"
        onPointerDown={(e) => startResize('top-left', e)}
        onDoubleClick={resetBoardSize}
        className="absolute -left-2 -top-2 z-30 size-4 cursor-nwse-resize rounded-full border border-transparent transition group-hover:border-amber-200/40 group-hover:bg-amber-950/60 hover:!border-sky-300 hover:!bg-sky-500/50"
      />
      <div
        role="separator"
        aria-label="Resize board top-right corner (keeps aspect ratio)"
        title="Drag corner to resize proportionally · Double-click to reset"
        onPointerDown={(e) => startResize('top-right', e)}
        onDoubleClick={resetBoardSize}
        className="absolute -right-2 -top-2 z-30 size-4 cursor-nesw-resize rounded-full border border-transparent transition group-hover:border-amber-200/40 group-hover:bg-amber-950/60 hover:!border-sky-300 hover:!bg-sky-500/50"
      />
      <div
        role="separator"
        aria-label="Resize board bottom-left corner (keeps aspect ratio)"
        title="Drag corner to resize proportionally · Double-click to reset"
        onPointerDown={(e) => startResize('bottom-left', e)}
        onDoubleClick={resetBoardSize}
        className="absolute -bottom-2 -left-2 z-30 size-4 cursor-nesw-resize rounded-full border border-transparent transition group-hover:border-amber-200/40 group-hover:bg-amber-950/60 hover:!border-sky-300 hover:!bg-sky-500/50"
      />
      <div
        role="separator"
        aria-label="Resize board bottom-right corner (keeps aspect ratio)"
        title="Drag corner to resize proportionally · Double-click to reset"
        onPointerDown={(e) => startResize('bottom-right', e)}
        onDoubleClick={resetBoardSize}
        className="absolute -bottom-2 -right-2 z-30 size-4 cursor-nwse-resize rounded-full border border-transparent transition group-hover:border-amber-200/40 group-hover:bg-amber-950/60 hover:!border-sky-300 hover:!bg-sky-500/50"
      />

      {boardSize !== null ? (
        <button
          type="button"
          onClick={resetBoardSize}
          title="Restore default board size"
          className="absolute -top-3 right-4 z-30 inline-flex items-center gap-1 rounded-full border border-amber-700/80 bg-amber-950 px-2 py-0.5 text-[10px] font-medium text-amber-100 opacity-0 shadow transition group-hover:opacity-100 focus:opacity-100 hover:bg-amber-900"
        >
          <RotateCcw className="size-2.5" aria-hidden />
          Reset size ({boardSize.width}×{boardSize.height})
        </button>
      ) : null}

      <div className="flex h-full items-stretch gap-2">
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
