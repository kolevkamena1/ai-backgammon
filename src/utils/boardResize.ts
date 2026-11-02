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

export function loadStoredBoardSize(): BoardDimensions | null {
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

export function saveStoredBoardSize(size: BoardDimensions | null): void {
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

