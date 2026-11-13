import type { PanelPosition } from '@/types/settings'
import {
  useCallback,
  useEffect,
  useRef,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export type DockDragSource = 'board' | 'panel'

interface UseDockDragOptions {
  source: DockDragSource
  setDraggingSource: (source: DockDragSource | null) => void
  setPanelPosition: (position: PanelPosition) => void
}

export interface DockDragHandlers {
  draggable: true
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
}

function resolvePanelDockPosition(
  source: DockDragSource,
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): PanelPosition {
  const distLeft = clientX
  const distRight = viewportWidth - clientX
  const distTop = clientY
  const distBottom = viewportHeight - clientY
  const minDist = Math.min(distLeft, distRight, distTop, distBottom)

  if (source === 'board') {
    // Moving the board to an edge docks the board there, placing the log panel on the opposite edge.
    if (minDist === distLeft) return 'right'
    if (minDist === distRight) return 'left'
    if (minDist === distTop) return 'bottom'
    return 'top'
  }

  if (minDist === distLeft) return 'left'
  if (minDist === distRight) return 'right'
  if (minDist === distTop) return 'top'
  return 'bottom'
}

/**
 * Shared HTML5 + pointer dock-drag handlers for the board and log panel headers.
 * Cleans up active window pointermove/pointerup listeners if the component unmounts mid-drag.
 */
export function useDockDrag({
  source,
  setDraggingSource,
  setPanelPosition,
}: UseDockDragOptions): DockDragHandlers {
  const activeCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      activeCleanupRef.current?.()
      activeCleanupRef.current = null
    }
  }, [])

  const onDragStart = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData('text/plain', source === 'board' ? 'board-panel' : 'log-panel')
      event.dataTransfer.effectAllowed = 'move'
      setDraggingSource(source)
    },
    [source, setDraggingSource],
  )

  const onDragEnd = useCallback(() => {
    setDraggingSource(null)
  }, [setDraggingSource])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest('button')) return

      activeCleanupRef.current?.()
      activeCleanupRef.current = null

      const startX = event.clientX
      const startY = event.clientY
      let hasStarted = false

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = Math.abs(moveEvent.clientX - startX)
        const deltaY = Math.abs(moveEvent.clientY - startY)
        if ((deltaX > 20 || deltaY > 20) && !hasStarted) {
          hasStarted = true
          setDraggingSource(source)
        }
      }

      const cleanupListeners = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        activeCleanupRef.current = null
      }

      function handlePointerUp(upEvent: PointerEvent) {
        cleanupListeners()
        if (hasStarted) {
          setDraggingSource(null)
          setPanelPosition(
            resolvePanelDockPosition(
              source,
              upEvent.clientX,
              upEvent.clientY,
              window.innerWidth,
              window.innerHeight,
            ),
          )
        }
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      activeCleanupRef.current = cleanupListeners
    },
    [source, setDraggingSource, setPanelPosition],
  )

  return {
    draggable: true,
    onDragStart,
    onDragEnd,
    onPointerDown,
  }
}
