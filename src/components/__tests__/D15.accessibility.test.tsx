// @vitest-environment jsdom
import App from '@/App'
import DoublingCube from '@/components/DoublingCube'
import Modal from '@/components/ui/Modal'
import { Info } from 'lucide-react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  vi.restoreAllMocks()
  act(() => root.unmount())
  host.remove()
})

describe('D15 — DoublingCube button semantics, Modal focus trap/restore, and dock-drag unmount cleanup', () => {
  it('gives interactive DoublingCube real button semantics and keyboard activation (Enter/Space)', () => {
    const onDouble = vi.fn()
    act(() => {
      root.render(
        <div>
          <DoublingCube
            cube={{ value: 2, owner: 'light', proposedBy: null }}
            interactive={false}
          />
          <DoublingCube
            cube={{ value: 4, owner: 'dark', proposedBy: null }}
            interactive={true}
            onClick={onDouble}
          />
        </div>,
      )
    })

    const staticCube = host.querySelector('[role="img"]')
    expect(staticCube).not.toBeNull()

    const interactiveCube = host.querySelector('button[aria-label*="Doubling cube showing 4"]') as HTMLButtonElement | null
    expect(interactiveCube).not.toBeNull()
    expect(interactiveCube?.getAttribute('type')).toBe('button')

    act(() => {
      interactiveCube?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onDouble).toHaveBeenCalledTimes(1)

    act(() => {
      interactiveCube?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    expect(onDouble).toHaveBeenCalledTimes(2)
  })

  it('traps Tab / Shift+Tab focus inside Modal and restores focus to trigger on unmount', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open Modal'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const onClose = vi.fn()
    try {
      act(() => {
        root.render(
          <Modal titleId="test-modal" title="Test Modal" icon={Info} onClose={onClose}>
            <button type="button" id="first-inner">
              First Action
            </button>
            <button type="button" id="last-inner">
              Last Action
            </button>
          </Modal>,
        )
      })

      const dialog = host.querySelector('[role="dialog"]') as HTMLElement
      expect(dialog).not.toBeNull()
      const closeBtn = dialog.querySelector('button[aria-label="Close"]') as HTMLButtonElement
      const lastInner = dialog.querySelector('#last-inner') as HTMLButtonElement
      expect(closeBtn).not.toBeNull()
      expect(lastInner).not.toBeNull()

      // Focus moves inside the modal when opened
      expect(dialog.contains(document.activeElement)).toBe(true)

      // Tab from the last focusable element wraps to the first focusable element (Close button)
      lastInner.focus()
      expect(document.activeElement).toBe(lastInner)
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      })
      expect(document.activeElement).toBe(closeBtn)

      // Shift+Tab from the first focusable element wraps to the last focusable element
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
        )
      })
      expect(document.activeElement).toBe(lastInner)

      // Unmounting the modal restores focus to the trigger button
      act(() => {
        root.render(<div />)
      })
      expect(document.activeElement).toBe(trigger)
    } finally {
      trigger.remove()
    }
  })

  it('cleans up window pointermove and pointerup listeners when unmounted mid-dock-drag', () => {
    const addedMoveListeners = new Set<EventListenerOrEventListenerObject>()
    const addedUpListeners = new Set<EventListenerOrEventListenerObject>()
    const origAdd = window.addEventListener.bind(window)
    const origRemove = window.removeEventListener.bind(window)

    vi.spyOn(window, 'addEventListener').mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        if (type === 'pointermove') addedMoveListeners.add(listener)
        if (type === 'pointerup') addedUpListeners.add(listener)
        origAdd(type, listener, options)
      },
    )
    vi.spyOn(window, 'removeEventListener').mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
        if (type === 'pointermove') addedMoveListeners.delete(listener)
        if (type === 'pointerup') addedUpListeners.delete(listener)
        origRemove(type, listener, options)
      },
    )

    act(() => {
      root.render(<App />)
    })

    const boardDockHeader = host.querySelector(
      '[title="Drag and drop board to reposition layout, or choose a dock option"]',
    ) as HTMLElement
    expect(boardDockHeader).not.toBeNull()

    act(() => {
      boardDockHeader.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }),
      )
    })

    expect(addedMoveListeners.size).toBe(1)
    expect(addedUpListeners.size).toBe(1)

    // Unmount mid-drag before pointerup fires
    act(() => {
      root.unmount()
    })

    expect(addedMoveListeners.size).toBe(0)
    expect(addedUpListeners.size).toBe(0)
  })
})

describe('R5 — modal focus trap skips controls hidden in a collapsed <details>', () => {
  it('wraps Tab between the rendered controls, never into the collapsed details', () => {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <Modal titleId="r5-modal" title="R5 Modal" icon={Info} onClose={onClose}>
          <button type="button" id="visible-action">
            Visible
          </button>
          <details>
            <summary>More options</summary>
            <button type="button" id="hidden-action">
              Hidden
            </button>
          </details>
        </Modal>,
      )
    })

    const dialog = host.querySelector('[role="dialog"]') as HTMLElement
    const closeBtn = dialog.querySelector('button[aria-label="Close"]') as HTMLButtonElement
    const summary = dialog.querySelector('summary') as HTMLElement
    const hidden = dialog.querySelector('#hidden-action') as HTMLButtonElement

    // The hidden control exists in the DOM but must not become a trap boundary. The summary is
    // the LAST rendered focusable: Close (header) -> Visible -> summary.
    expect(hidden).not.toBeNull()
    expect(hidden.closest('details')?.open).toBe(false)

    summary.focus()
    expect(document.activeElement).toBe(summary)

    // Tab from the last rendered control wraps to the first (Close), not into the details.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(closeBtn)

    // Shift+Tab from the first wraps back to the last RENDERED control (the summary).
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    })
    expect(document.activeElement).toBe(summary)
  })
})
