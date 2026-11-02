import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from 'react'

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  defaultSplitPercent?: number
  minSplitPercent?: number
  maxSplitPercent?: number
  className?: string
}

export const SplitPane: FC<SplitPaneProps> = ({
  left,
  right,
  defaultSplitPercent = 72,
  minSplitPercent = 55,
  maxSplitPercent = 85,
  className = '',
}) => {
  const [splitPercent, setSplitPercent] = useState<number>(defaultSplitPercent)
  const isDraggingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

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
      const newPercent = (offsetX / rect.width) * 100
      const clamped = Math.max(minSplitPercent, Math.min(maxSplitPercent, newPercent))
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
  }, [minSplitPercent, maxSplitPercent])

  const handleDoubleClick = useCallback(() => {
    setSplitPercent(defaultSplitPercent)
  }, [defaultSplitPercent])

  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full w-full flex-col lg:flex-row overflow-hidden ${className}`}
    >
      {/* Left Pane (Board Area) */}
      <div
        style={{ flexBasis: `${splitPercent}%` }}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-auto p-2 sm:p-4"
      >
        {left}
      </div>

      {/* Resizable Divider Bar */}
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

      {/* Right Pane (Game Controls + Game Log) */}
      <div
        style={{ flexBasis: `${100 - splitPercent}%` }}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4 bg-slate-950/30"
      >
        {right}
      </div>
    </div>
  )
}

export default SplitPane

