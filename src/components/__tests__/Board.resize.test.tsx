// @vitest-environment jsdom
import Board from '@/components/Board'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  vi.restoreAllMocks()
  act(() => root.unmount())
  host.remove()
})

describe('Board resize — rAF throttling and pointerup/cancel persistence (P2)', () => {
  it('throttles pointermove via requestAnimationFrame and persists to localStorage only on pointerup/pointercancel', () => {
    const rafCallbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    act(() => {
      root.render(<Board />)
    })

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    setItemSpy.mockClear()

    const rightHandle = host.querySelector('[aria-label="Resize board right edge"]') as HTMLElement
    expect(rightHandle).not.toBeNull()

    act(() => {
      rightHandle.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: 500, clientY: 200, bubbles: true }),
      )
    })

    // Fire 3 rapid pointermove events within a single animation frame
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 520, clientY: 200 }))
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 540, clientY: 200 }))
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 560, clientY: 200 }))
    })

    // Only one rAF should be queued for the burst of moves
    expect(rafCallbacks).toHaveLength(1)
    expect(setItemSpy).not.toHaveBeenCalled()

    // Flush the animation frame: board DOM updates, but localStorage is still NOT written mid-drag
    act(() => {
      const cb = rafCallbacks.shift()
      cb?.(16)
    })

    const boardSection = host.querySelector('section[aria-label="Backgammon board"]') as HTMLElement
    expect(boardSection.style.width).not.toBe('')
    expect(setItemSpy).not.toHaveBeenCalled()

    // Completing the gesture on pointerup persists the final size once
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 560, clientY: 200 }))
    })

    expect(setItemSpy).toHaveBeenCalledTimes(1)
    expect(setItemSpy.mock.calls[0]?.[0]).toBe('ai-backgammon:board-size')
  })
})
