import type { PanelPosition } from '@/types/settings'
import { cn } from '@/utils/cn'
import { PanelBottom, PanelLeft, PanelRight, PanelTop } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from 'react'

interface SplitPaneProps {
  board?: ReactNode
  panel?: ReactNode
  left?: ReactNode
  right?: ReactNode
  panelPosition?: PanelPosition
  onDropPanel?: (position: PanelPosition) => void
  draggingSource?: 'panel' | 'board' | null
  setDraggingSource?: (source: 'panel' | 'board' | null) => void
  isDraggingPanel?: boolean
  setIsDraggingPanel?: (isDragging: boolean) => void
  defaultSplitPercent?: number
  minSplitPercent?: number
  maxSplitPercent?: number
  className?: string
}

const LG_MEDIA_QUERY = '(min-width: 1024px)'
const KEYBOARD_STEP_PERCENT = 2

function readIsLgUp(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }
  return window.matchMedia(LG_MEDIA_QUERY).matches
}

function useIsLgUp(): boolean {
  const [isLgUp, setIsLgUp] = useState<boolean>(readIsLgUp)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mql = window.matchMedia(LG_MEDIA_QUERY)
    const onChange = (event: MediaQueryListEvent): void => {
      setIsLgUp(event.matches)
    }
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [])

  return isLgUp
}

export const SplitPane: FC<SplitPaneProps> = ({
  board,
  panel,
  left,
  right,
  panelPosition = 'right',
  onDropPanel,
  draggingSource,
  setDraggingSource,
  isDraggingPanel = false,
  setIsDraggingPanel,
  defaultSplitPercent = 72,
  minSplitPercent = 55,
  maxSplitPercent = 85,
  className = '',
}) => {
  const isLgUp = useIsLgUp()
  const isDockVertical = panelPosition === 'top' || panelPosition === 'bottom'
  // Below lg (< 1024px), left/right docks stack vertically via `flex-col lg:flex-row`, so the
  // effective orientation of the split is vertical whenever the dock is top/bottom OR below lg.
  const isVertical = isDockVertical || !isLgUp
  const isPanelFirst = panelPosition === 'left' || panelPosition === 'top'
  const effectiveDefault = isVertical ? 65 : defaultSplitPercent
  const effectiveMin = isVertical ? 35 : minSplitPercent
  const effectiveMax = isVertical ? 80 : maxSplitPercent

  const [splitPercent, setSplitPercent] = useState<number>(effectiveDefault)
  const [overTarget, setOverTarget] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null)
  const isDraggingRef = useRef(false)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const liveParamsRef = useRef({
    panelPosition,
    isDockVertical,
    isPanelFirst,
    minSplitPercent,
    maxSplitPercent,
  })
  useEffect(() => {
    liveParamsRef.current = {
      panelPosition,
      isDockVertical,
      isPanelFirst,
      minSplitPercent,
      maxSplitPercent,
    }
  }, [panelPosition, isDockVertical, isPanelFirst, minSplitPercent, maxSplitPercent])

  // Resolve active dragging state (supports both draggingSource and legacy isDraggingPanel)
  const activeDrag = draggingSource ?? (isDraggingPanel ? 'panel' : null)

  const stopDragging = useCallback(() => {
    setOverTarget(null)
    setDraggingSource?.(null)
    setIsDraggingPanel?.(false)
  }, [setDraggingSource, setIsDraggingPanel])

  // Resolve board vs panel content
  const boardNode = board ?? left
  const panelNode = panel ?? right

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragCleanupRef.current?.()
    isDraggingRef.current = true

    const getEffectiveOrientation = () => {
      const params = liveParamsRef.current
      const verticalNow = params.isDockVertical || !readIsLgUp()
      const minNow = verticalNow ? 35 : params.minSplitPercent
      const maxNow = verticalNow ? 80 : params.maxSplitPercent
      return { verticalNow, minNow, maxNow, panelFirstNow: params.isPanelFirst }
    }

    const { verticalNow: startVertical } = getEffectiveOrientation()
    document.body.style.cursor = startVertical ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const { verticalNow, minNow, maxNow, panelFirstNow } = getEffectiveOrientation()
      document.body.style.cursor = verticalNow ? 'row-resize' : 'col-resize'

      if (verticalNow) {
        if (rect.height <= 0) return
        const offsetY = moveEvent.clientY - rect.top
        const percentFromTop = (offsetY / rect.height) * 100
        const newBoardPercent = panelFirstNow ? 100 - percentFromTop : percentFromTop
        const clamped = Math.max(minNow, Math.min(maxNow, newBoardPercent))
        setSplitPercent(clamped)
      } else {
        if (rect.width <= 0) return
        const offsetX = moveEvent.clientX - rect.left
        const percentFromLeft = (offsetX / rect.width) * 100
        const newBoardPercent = panelFirstNow ? 100 - percentFromLeft : percentFromLeft
        const clamped = Math.max(minNow, Math.min(maxNow, newBoardPercent))
        setSplitPercent(clamped)
      }
    }

    const cleanup = () => {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', cleanup)
      dragCleanupRef.current = null
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', cleanup)
  }, [])

  const handleDoubleClick = useCallback(() => {
    setSplitPercent(isVertical ? 65 : defaultSplitPercent)
  }, [isVertical, defaultSplitPercent])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Home') {
        e.preventDefault()
        setSplitPercent(effectiveMin)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        setSplitPercent(effectiveMax)
        return
      }
      if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowUp'
      ) {
        e.preventDefault()
        const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
        const delta = (forward ? 1 : -1) * (isPanelFirst ? -KEYBOARD_STEP_PERCENT : KEYBOARD_STEP_PERCENT)
        setSplitPercent((prev) => Math.max(effectiveMin, Math.min(effectiveMax, prev + delta)))
      }
    },
    [effectiveMin, effectiveMax, isPanelFirst],
  )

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const boardPane = (
    <div
      style={{ flexBasis: `${splitPercent}%` }}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 sm:p-3"
    >
      {boardNode}
    </div>
  )

  const panelPane = (
    <div
      style={{ flexBasis: `${100 - splitPercent}%` }}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-hidden p-2.5 sm:p-3 bg-slate-950/30"
    >
      {panelNode}
    </div>
  )

  const divider = (
    <div
      role="separator"
      aria-orientation={isVertical ? 'horizontal' : 'vertical'}
      aria-valuenow={Math.round(splitPercent)}
      aria-valuemin={effectiveMin}
      aria-valuemax={effectiveMax}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      title="Drag to resize panels (Double-click to reset)"
      className={cn(
        // shrink-0 keeps the divider at its fixed 12px thickness: the two flex-1 panes (basis 0%)
        // must split the leftover space, never be squeezed to zero by a divider that claims 100%.
        'group relative z-20 flex shrink-0 select-none items-center justify-center bg-slate-900/60 hover:bg-sky-500/20 active:bg-sky-500/40 transition-colors',
        // Below lg a left/right dock stacks as a column, so the divider is a 12px-tall bar (h-3),
        // not h-full — h-full gave it a 100% basis and collapsed both panes on phones/tablets.
        isDockVertical ? 'h-3 w-full' : 'h-3 w-full lg:h-full lg:w-3',
        isVertical ? 'cursor-row-resize' : 'cursor-col-resize',
      )}
    >
      {/* Divider line */}
      <div
        className={cn(
          'absolute bg-slate-800 group-hover:bg-sky-500/70',
          isVertical ? 'inset-x-0 top-1/2 h-[1px] -translate-y-1/2' : 'inset-y-0 left-1/2 w-[1px] -translate-x-1/2',
        )}
      />
      {/* Grip dots */}
      <div
        className={cn(
          'hidden lg:flex gap-1 rounded bg-slate-800/80 group-hover:bg-sky-600/80 shadow',
          isVertical ? 'flex-row px-2 py-0.5' : 'flex-col py-2 px-0.5',
        )}
      >
        <div className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-white" />
        <div className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-white" />
        <div className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-white" />
        <div className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-white" />
      </div>
    </div>
  )

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex h-full w-full overflow-hidden',
        isDockVertical ? 'flex-col' : 'flex-col lg:flex-row',
        className,
      )}
    >
      {/* 4 Interactive Drop Zones when dragging either panel */}
      {activeDrag !== null && (
        <>
          {/* Left Drop Target */}
          {panelPosition !== (activeDrag === 'panel' ? 'left' : 'right') && (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOverTarget('left')
              }}
              onDragLeave={() => setOverTarget(null)}
              onDrop={(e) => {
                e.preventDefault()
                stopDragging()
                onDropPanel?.(activeDrag === 'panel' ? 'left' : 'right')
              }}
              className={cn(
                'absolute inset-y-4 left-4 z-50 w-[min(320px,28%)] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2.5 p-4 transition-all shadow-2xl backdrop-blur-md',
                overTarget === 'left'
                  ? 'border-sky-400 bg-sky-500/30 text-slate-50 scale-[1.02]'
                  : 'border-sky-500/60 bg-slate-900/90 text-sky-200 animate-pulse',
              )}
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/40">
                <PanelLeft className="size-6" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-slate-100">
                  {activeDrag === 'panel' ? 'Dock Log on Left' : 'Dock Board on Left'}
                </p>
              </div>
            </div>
          )}

          {/* Right Drop Target */}
          {panelPosition !== (activeDrag === 'panel' ? 'right' : 'left') && (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOverTarget('right')
              }}
              onDragLeave={() => setOverTarget(null)}
              onDrop={(e) => {
                e.preventDefault()
                stopDragging()
                onDropPanel?.(activeDrag === 'panel' ? 'right' : 'left')
              }}
              className={cn(
                'absolute inset-y-4 right-4 z-50 w-[min(320px,28%)] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2.5 p-4 transition-all shadow-2xl backdrop-blur-md',
                overTarget === 'right'
                  ? 'border-sky-400 bg-sky-500/30 text-slate-50 scale-[1.02]'
                  : 'border-sky-500/60 bg-slate-900/90 text-sky-200 animate-pulse',
              )}
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/40">
                <PanelRight className="size-6" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-slate-100">
                  {activeDrag === 'panel' ? 'Dock Log on Right' : 'Dock Board on Right'}
                </p>
              </div>
            </div>
          )}

          {/* Top Drop Target */}
          {panelPosition !== (activeDrag === 'panel' ? 'top' : 'bottom') && (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOverTarget('top')
              }}
              onDragLeave={() => setOverTarget(null)}
              onDrop={(e) => {
                e.preventDefault()
                stopDragging()
                onDropPanel?.(activeDrag === 'panel' ? 'top' : 'bottom')
              }}
              className={cn(
                'absolute inset-x-8 top-4 z-50 h-[min(180px,28%)] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2.5 p-4 transition-all shadow-2xl backdrop-blur-md',
                overTarget === 'top'
                  ? 'border-sky-400 bg-sky-500/30 text-slate-50 scale-[1.02]'
                  : 'border-sky-500/60 bg-slate-900/90 text-sky-200 animate-pulse',
              )}
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/40">
                <PanelTop className="size-6" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-slate-100">
                  {activeDrag === 'panel' ? 'Dock Log on Top' : 'Dock Board on Top'}
                </p>
              </div>
            </div>
          )}

          {/* Bottom Drop Target */}
          {panelPosition !== (activeDrag === 'panel' ? 'bottom' : 'top') && (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOverTarget('bottom')
              }}
              onDragLeave={() => setOverTarget(null)}
              onDrop={(e) => {
                e.preventDefault()
                stopDragging()
                onDropPanel?.(activeDrag === 'panel' ? 'bottom' : 'top')
              }}
              className={cn(
                'absolute inset-x-8 bottom-4 z-50 h-[min(180px,28%)] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2.5 p-4 transition-all shadow-2xl backdrop-blur-md',
                overTarget === 'bottom'
                  ? 'border-sky-400 bg-sky-500/30 text-slate-50 scale-[1.02]'
                  : 'border-sky-500/60 bg-slate-900/90 text-sky-200 animate-pulse',
              )}
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/40">
                <PanelBottom className="size-6" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-slate-100">
                  {activeDrag === 'panel' ? 'Dock Log on Bottom' : 'Dock Board on Bottom'}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Render split panes */}
      {isPanelFirst ? (
        <>
          {panelPane}
          {divider}
          {boardPane}
        </>
      ) : (
        <>
          {boardPane}
          {divider}
          {panelPane}
        </>
      )}
    </div>
  )
}

export default SplitPane
