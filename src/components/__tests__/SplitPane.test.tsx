// @vitest-environment jsdom
import SplitPane from '@/components/SplitPane'
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
  act(() => root.unmount())
  host.remove()
})

describe('SplitPane', () => {
  it('renders board on the left and panel on the right by default', () => {
    act(() => {
      root.render(
        <SplitPane
          board={<div data-testid="board-content">Board Content</div>}
          panel={<div data-testid="panel-content">Panel Content</div>}
          panelPosition="right"
        />,
      )
    })

    const children = Array.from(host.firstElementChild?.children ?? [])
    const boardEl = host.querySelector('[data-testid="board-content"]')
    const panelEl = host.querySelector('[data-testid="panel-content"]')
    expect(boardEl).toBeTruthy()
    expect(panelEl).toBeTruthy()

    // Board container should come before separator, panel container after
    expect(children[0].contains(boardEl)).toBe(true)
    expect(children[2].contains(panelEl)).toBe(true)
  })

  it('renders panel on the left and board on the right when panelPosition is left', () => {
    act(() => {
      root.render(
        <SplitPane
          board={<div data-testid="board-content">Board Content</div>}
          panel={<div data-testid="panel-content">Panel Content</div>}
          panelPosition="left"
        />,
      )
    })

    const children = Array.from(host.firstElementChild?.children ?? [])
    const boardEl = host.querySelector('[data-testid="board-content"]')
    const panelEl = host.querySelector('[data-testid="panel-content"]')

    // Panel container should come first, board container should come third
    expect(children[0].contains(panelEl)).toBe(true)
    expect(children[2].contains(boardEl)).toBe(true)
  })

  it('shows drop zone when dragging and triggers onDropPanel', () => {
    const onDropPanel = vi.fn()

    act(() => {
      root.render(
        <SplitPane
          board={<div>Board</div>}
          panel={<div>Panel</div>}
          panelPosition="right"
          isDraggingPanel={true}
          onDropPanel={onDropPanel}
        />,
      )
    })

    expect(host.textContent).toContain('Drop here to dock Log Panel on Left')

    // Find the drop zone
    const dropZone = host.querySelector('div[class*="border-dashed"]')
    expect(dropZone).toBeTruthy()

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    dropZone?.dispatchEvent(dropEvent)

    expect(onDropPanel).toHaveBeenCalledWith('left')
  })
})

