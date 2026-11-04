import type { PanelPosition } from '@/types/settings'
import { cn } from '@/utils/cn'
import { PanelLeft, PanelRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from 'react'

interface SplitPaneProps {
  board?: ReactNode
  panel?: ReactNode
  left?: ReactNode
  right?: ReactNode
  panelPosition?: PanelPosition
  onDropPanel?: (position: PanelPosition) => void
  isDraggingPanel?: boolean
  setIsDraggingPanel?: (isDragging: boolean) => void
  defaultSplitPercent?: number
  minSplitPercent?: number
  maxSplitPercent?: number
  className?: string
}

export const SplitPane: FC<SplitPaneProps> = ({
  board,
  panel,
  left,
  right,
  panelPosition = 'right',
  onDropPanel,
  isDraggingPanel = false,
  setIsDraggingPanel,
  defaultSplitPercent = 72,
  minSplitPercent = 55,
  maxSplitPercent = 85,
  className = '',
}) => {
  const [splitPercent, setSplitPercent] = useState<number>(defaultSplitPercent)
  const [isOverTarget, setIsOverTarget] = useState(false)
  const isDraggingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Resolve board vs panel content
  const boardNode = board ?? left
  const panelNode = panel ?? right

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    isDraggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width <= 0) return
      const offsetX = moveEvent.clientX - rect.left
      const percentFromLeft = (offsetX / rect.width) * 100

      // When panel is on right, board is on left: boardPercent = percentFromLeft
      // When panel is on left, panel is on left: boardPercent = 100 - percentFromLeft
      const newBoardPercent = panelPosition === 'right' ? percentFromLeft : 100 - percentFromLeft
      const clamped = Math.max(minSplitPercent, Math.min(maxSplitPercent, newBoardPercent))
      setSplitPercent(clamped)
    }

    const handlePointerUp = () => {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [minSplitPercent, maxSplitPercent, panelPosition])

  const handleDoubleClick = useCallback(() => {
    setSplitPercent(defaultSplitPercent)
  }, [defaultSplitPercent])

  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const boardPane = (
    <div
      style={{ flexBasis: `${splitPercent}%` }}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-auto p-2 sm:p-4"
    >
      {boardNode}
    </div>
  )

  const panelPane = (
    <div
      style={{ flexBasis: `${100 - splitPercent}%` }}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4 bg-slate-950/30"
    >
      {panelNode}
    </div>
  )

  const divider = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(splitPercent)}
      aria-valuemin={minSplitPercent}
      aria-valuemax={maxSplitPercent}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      title="Drag to resize panels (Double-click to reset)"
      className="group relative z-20 flex w-full lg:w-3 cursor-row-resize lg:cursor-col-resize select-none items-center justify-center bg-slate-900/60 hover:bg-sky-500/20 active:bg-sky-500/40 transition-colors"
    >
      {/* Subtle border line */}
      <div className="absolute inset-y-0 left-1/2 w-[1px] -translate-x-1/2 bg-slate-800 group-hover:bg-sky-500/70" />
      {/* Grip handle dots */}
      <div className="hidden lg:flex flex-col gap-1 py-2 px-0.5 rounded bg-slate-800/80 group-hover:bg-sky-600/80 shadow">
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
      className={`relative flex h-full w-full flex-col lg:flex-row overflow-hidden ${className}`}
    >
      {/* Drop Zone Overlay when dragging panel to opposite side */}
      {isDraggingPanel && panelPosition === 'right' && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setIsOverTarget(true)
          }}
          onDragLeave={() => setIsOverTarget(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsOverTarget(false)
            setIsDraggingPanel?.(false)
            onDropPanel?.('left')
          }}
          className={cn(
            'absolute inset-y-4 left-4 z-50 w-[min(440px,45%)] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 p-6 transition-all shadow-2xl backdrop-blur-md',
            isOverTarget
              ? 'border-sky-400 bg-sky-500/30 text-white scale-[1.02]'
              : 'border-sky-500/70 bg-slate-900/95 text-sky-200 animate-pulse',
          )}
        >
          <div className="flex size-14 items-center justify-center rounded-2xl bg-sky-500/20 text-sky-400 border border-sky-400/40">
            <PanelLeft className="size-8" />
          </div>
          <div className="text-center">
            <p className="text-base font-bold text-slate-100">Drop here to dock Log Panel on Left</p>
            <p className="text-xs text-slate-400 mt-1">Move game controls and turn log to the left side</p>
          </div>
        </div>
      )}

      {isDraggingPanel && panelPosition === 'left' && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setIsOverTarget(true)
          }}
          onDragLeave={() => setIsOverTarget(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsOverTarget(false)
            setIsDraggingPanel?.(false)
            onDropPanel?.('right')
          }}
          className={cn(
            'absolute inset-y-4 right-4 z-50 w-[min(440px,45%)] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 p-6 transition-all shadow-2xl backdrop-blur-md',
            isOverTarget
              ? 'border-sky-400 bg-sky-500/30 text-white scale-[1.02]'
              : 'border-sky-500/70 bg-slate-900/95 text-sky-200 animate-pulse',
          )}
        >
          <div className="flex size-14 items-center justify-center rounded-2xl bg-sky-500/20 text-sky-400 border border-sky-400/40">
            <PanelRight className="size-8" />
          </div>
          <div className="text-center">
            <p className="text-base font-bold text-slate-100">Drop here to dock Log Panel on Right</p>
            <p className="text-xs text-slate-400 mt-1">Move game controls and turn log to the right side</p>
          </div>
        </div>
      )}

      {/* When panelPosition is 'right': Board on left, Panel on right */}
      {/* When panelPosition is 'left': Panel on left, Board on right */}
      {panelPosition === 'left' ? (
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

