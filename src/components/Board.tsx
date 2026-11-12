import type {
  BoardState,
  MoveSource,
  MoveTarget,
  PlayerColor,
  Point as PointModel,
  PointIndex,
} from '@/types/game'
import type { DoublingCubeState } from '@/types/gameMatch'
import { DEFAULT_BOARD_DESIGN, type BoardDesignId } from '@/utils/boardDesigns'
import {
  computeBoardMetrics,
  computeResizedDimensions,
  DEFAULT_BOARD_DIMENSIONS,
  loadStoredBoardSize,
  MIN_BOARD_HEIGHT,
  MIN_BOARD_WIDTH,
  saveStoredBoardSize,
  type BoardDimensions,
  type ResizeHandle,
} from '@/utils/boardResize'
import { getInitialBoardState, toPointViews } from '@/utils/gameLogic'
import { cn } from '@/utils/cn'
import { RotateCcw } from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import Checker from './Checker'
import DoublingCube from './DoublingCube'
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
  /** Initiates a drag from a legal source (`1..24` or `'bar'`). */
  onDragStartSource?: (source: MoveSource) => void
  /** Completes a drop onto a legal destination (`1..24` or `'off'`). */
  onDropTarget?: (target: MoveSource | MoveTarget, draggedSource?: MoveSource | null) => void
  /** Visual material preset for the board, triangles, and checkers. */
  design?: BoardDesignId
  /** Current doubling cube state to render in the center bar */
  cube?: DoublingCubeState
  canDouble?: boolean
  onDouble?: () => void
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

/** Stable no-op so a target point enables drag-over highlighting without a fresh closure per render. */
const noopDragOver = (): void => undefined

const MAX_VISIBLE_TRAY_CHECKERS = 15
const MAX_VISIBLE_BAR_CHECKERS = 5

const Tray = ({
  seat,
  count,
  live,
  onSelect,
  onDragOver,
  onDrop,
}: {
  seat: PlayerColor
  count: number
  live: boolean
  onSelect?: () => void
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void
}) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const label = `${SEAT_NAMES[seat]} off ${count}`
  const visible = Math.min(count, MAX_VISIBLE_TRAY_CHECKERS)
  const overflow = count - visible

  const look = cn(
    'board-tray flex w-9 sm:w-10 shrink-0 flex-col items-center justify-between gap-1 rounded-lg px-1 py-2 text-center transition-all',
    live
      ? 'bg-emerald-500/25 text-slate-50 ring-2 ring-emerald-400/70'
      : 'bg-board-field/70 text-point-light/50',
    live && isDragOver && 'bg-emerald-500/45 ring-2 ring-emerald-300 scale-[1.02]',
  )

  const body = (
    <>
      <div className="flex shrink-0 flex-col items-center">
        <span className="text-[9px] uppercase tracking-[0.18em] font-semibold">{SEAT_NAMES[seat]}</span>
        <span className="text-xs font-bold leading-tight">{count}</span>
      </div>

      <div
        className={cn(
          'flex flex-1 flex-col items-center justify-center w-full min-h-0 overflow-hidden py-1',
          visible > 1 && '-space-y-2 sm:-space-y-2.5',
        )}
      >
        {visible > 0 ? (
          <>
            {Array.from({ length: visible }, (_, slot) => (
              <Checker key={slot} owner={seat} />
            ))}
            {overflow > 0 ? (
              <span className="text-[10px] font-bold text-slate-100">+{overflow}</span>
            ) : null}
          </>
        ) : (
          <div
            title={`No ${SEAT_NAMES[seat]} checkers borne off yet`}
            className="size-4 rounded-full border border-dashed border-current opacity-25"
          />
        )}
      </div>

      <span className="text-[8px] uppercase tracking-wider opacity-60">Off</span>
    </>
  )

  if (onSelect) {
    return (
      <button
        type="button"
        aria-label={`Bear off into the ${SEAT_NAMES[seat]} tray`}
        title={label}
        onClick={onSelect}
        onDragOver={
          onDragOver
            ? (event) => {
                event.preventDefault()
                if (event.dataTransfer) {
                  event.dataTransfer.dropEffect = 'move'
                }
                if (!isDragOver) setIsDragOver(true)
                onDragOver(event)
              }
            : undefined
        }
        onDragLeave={() => {
          if (isDragOver) setIsDragOver(false)
        }}
        onDrop={
          onDrop
            ? (event) => {
                event.preventDefault()
                setIsDragOver(false)
                onDrop(event)
              }
            : undefined
        }
        className={cn(
          look,
          'cursor-pointer appearance-none border-0 transition-colors hover:bg-emerald-500/40',
        )}
      >
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
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  seat: PlayerColor
  count: number
  live: boolean
  selected: boolean
  onSelect?: () => void
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void
}) => {
  const visible = Math.min(count, MAX_VISIBLE_BAR_CHECKERS)
  const overflow = count - visible

  const handleBarDragStart = (event: DragEvent<HTMLButtonElement>): void => {
    const discs = event.currentTarget.querySelectorAll<HTMLElement>('.checker-disc')
    const grabbed = discs[discs.length - 1] ?? discs[0]
    if (grabbed && typeof event.dataTransfer?.setDragImage === 'function') {
      const rect = grabbed.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        event.dataTransfer.setDragImage(grabbed, rect.width / 2, rect.height / 2)
      }
    }
    onDragStart?.(event)
  }

  const look = cn(
    'flex flex-col items-center justify-center w-full rounded-md px-1 py-1.5 text-center text-[10px] font-semibold transition-all',
    selected
      ? 'bg-sky-400/70 text-slate-950 ring-2 ring-sky-300'
      : live
        ? 'bg-emerald-500/30 text-slate-50 ring-2 ring-emerald-400'
        : 'text-point-light/45',
  )

  const body = (
    <>
      <span className="block uppercase tracking-[0.1em] text-[9px] font-medium">{SEAT_NAMES[seat]}</span>
      {visible > 0 ? (
        <div
          className={cn(
            'relative my-1 flex flex-col items-center justify-center',
            visible > 3 ? '-space-y-1.5' : 'gap-0.5',
          )}
        >
          {Array.from({ length: visible }, (_, slot) => (
            <Checker key={slot} owner={seat} />
          ))}
          {overflow > 0 ? (
            <span className="text-[10px] font-bold text-slate-100">+{overflow}</span>
          ) : null}
        </div>
      ) : null}
      <span className="block text-xs font-semibold">{count}</span>
    </>
  )

  if (onSelect) {
    return (
      <button
        type="button"
        aria-label={`Bring ${SEAT_NAMES[seat]} in from the bar`}
        title={`${SEAT_NAMES[seat]} has ${count} checker${count === 1 ? '' : 's'} on the bar`}
        draggable={draggable}
        onClick={onSelect}
        onDragStart={draggable ? handleBarDragStart : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        className={cn(
          look,
          'cursor-pointer appearance-none border-0 transition-colors hover:bg-emerald-500/45',
          draggable && 'cursor-grab active:cursor-grabbing',
        )}
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
  onDragStartSource,
  onDropTarget,
  design = DEFAULT_BOARD_DESIGN,
  cube,
  canDouble = false,
  onDouble,
  className,
}: BoardProps) => {
  const sectionRef = useRef<HTMLElement | null>(null)
  const draggedSourceRef = useRef<MoveSource | null>(null)
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
    const handleResetEvent = (): void => setBoardSize(null)
    window.addEventListener('ai-backgammon:reset-board-size', handleResetEvent)
    return () => window.removeEventListener('ai-backgammon:reset-board-size', handleResetEvent)
  }, [])

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

  // Stable drag/drop handlers: memo(Point) compares them by reference, so they must not be recreated
  // on every board re-render (each resize tick, selection change, or unrelated store write).
  const beginDragSource = useCallback(
    (source: MoveSource, event: DragEvent<HTMLButtonElement>): void => {
      draggedSourceRef.current = source
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        try {
          event.dataTransfer.setData('text/plain', String(source))
        } catch {
          // Ignore browser environments that disallow setData on synthetic DragEvents
        }
      }
      if (onDragStartSource) {
        onDragStartSource(source)
      } else if (onSelectPoint && selectedFrom !== source) {
        onSelectPoint(source)
      }
    },
    [onDragStartSource, onSelectPoint, selectedFrom],
  )

  const endDragSource = useCallback((): void => {
    draggedSourceRef.current = null
  }, [])

  const dropOnTarget = useCallback(
    (target: MoveSource | MoveTarget): void => {
      const from = draggedSourceRef.current
      draggedSourceRef.current = null
      if (onDropTarget) {
        onDropTarget(target, from)
      } else if (onSelectPoint && legalTargets?.has(target)) {
        onSelectPoint(target)
      }
    },
    [onDropTarget, onSelectPoint, legalTargets],
  )

  const quadrantStyle: CSSProperties | undefined = metrics
    ? { height: `${metrics.quadrantHeight}px` }
    : undefined

  const canInteractWithPoints = Boolean(onSelectPoint || onDragStartSource || onDropTarget)

  const renderQuadrant = (indices: readonly PointIndex[], orientation: 'top' | 'bottom') => (
    <div className={QUADRANT} style={quadrantStyle}>
      {indices.map((index) => {
        const point = byIndex.get(index)
        const state = stateFor(index)
        const isDraggable = canInteractWithPoints && (selectableSources?.has(index) ?? false)
        const isDropTarget = canInteractWithPoints && (legalTargets?.has(index) ?? false)

        return (
          <Point
            key={index}
            index={index}
            orientation={orientation}
            checkers={point?.checkers ?? 0}
            owner={point?.owner ?? null}
            state={state}
            draggable={isDraggable}
            onDragStart={isDraggable ? beginDragSource : undefined}
            onDragEnd={isDraggable ? endDragSource : undefined}
            onDragOver={isDropTarget ? noopDragOver : undefined}
            onDrop={isDropTarget ? dropOnTarget : undefined}
            // Static triangles stay static: only relevant points become tab stops. The callback is
            // the same stable reference for every point; Point supplies its own index.
            onSelect={onSelectPoint && state !== 'none' ? onSelectPoint : undefined}
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
      data-board-design={design}
      style={boardStyle}
      className={cn(
        'board-frame group relative w-full rounded-2xl border border-amber-900/70 bg-board-frame p-3 shadow-2xl select-none sm:p-4',
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
          onDragOver={trayLive('dark') && canInteractWithPoints ? () => undefined : undefined}
          onDrop={trayLive('dark') && canInteractWithPoints ? () => dropOnTarget('off') : undefined}
        />

        <div className="board-surface grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] grid-rows-2 gap-x-2 rounded-xl bg-board-field p-2">
          <div className="col-start-1 row-start-1">{renderQuadrant(LEFT_TOP, 'top')}</div>

          <div className="board-bar col-start-2 row-span-2 row-start-1 flex w-14 flex-col items-center justify-between gap-1 rounded-md bg-bar py-1">
            <BarCell
              seat="dark"
              count={board.bar.dark}
              live={barLive('dark')}
              selected={turn === 'dark' && selectedFrom === 'bar'}
              draggable={barLive('dark') && canInteractWithPoints}
              onDragStart={
                barLive('dark') && canInteractWithPoints
                  ? (e) => beginDragSource('bar', e)
                  : undefined
              }
              onDragEnd={barLive('dark') && canInteractWithPoints ? endDragSource : undefined}
              onSelect={barLive('dark') && onSelectPoint ? () => onSelectPoint('bar') : undefined}
            />

            {cube ? (
              <div className="my-auto flex flex-col items-center gap-1 z-10">
                <DoublingCube
                  cube={cube}
                  size="sm"
                  interactive={canDouble}
                  onClick={canDouble ? onDouble : undefined}
                  title={
                    canDouble
                      ? `Click to Double Stake to ${cube.value * 2}`
                      : `Doubling Cube (${cube.value}x)`
                  }
                />
              </div>
            ) : (
              <span className="text-[10px] uppercase tracking-[0.3em] text-point-light/40 [writing-mode:vertical-rl]">
                Bar
              </span>
            )}

            <BarCell
              seat="light"
              count={board.bar.light}
              live={barLive('light')}
              selected={turn === 'light' && selectedFrom === 'bar'}
              draggable={barLive('light') && canInteractWithPoints}
              onDragStart={
                barLive('light') && canInteractWithPoints
                  ? (e) => beginDragSource('bar', e)
                  : undefined
              }
              onDragEnd={barLive('light') && canInteractWithPoints ? endDragSource : undefined}
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
          onDragOver={trayLive('light') && canInteractWithPoints ? () => undefined : undefined}
          onDrop={trayLive('light') && canInteractWithPoints ? () => dropOnTarget('off') : undefined}
        />
      </div>
    </section>
  )
}

export default memo(Board)
