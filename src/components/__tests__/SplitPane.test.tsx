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

  it('renders panel on top and board on bottom when panelPosition is top', () => {
    act(() => {
      root.render(
        <SplitPane
          board={<div data-testid="board-content">Board Content</div>}
          panel={<div data-testid="panel-content">Panel Content</div>}
          panelPosition="top"
        />,
      )
    })

    const container = host.firstElementChild
    expect(container?.className).toContain('flex-col')
    const children = Array.from(container?.children ?? [])
    const boardEl = host.querySelector('[data-testid="board-content"]')
    const panelEl = host.querySelector('[data-testid="panel-content"]')

    // Panel container should come first (top), board container after (bottom)
    expect(children[0].contains(panelEl)).toBe(true)
    expect(children[2].contains(boardEl)).toBe(true)
  })

  it('renders board on top and panel on bottom when panelPosition is bottom', () => {
    act(() => {
      root.render(
        <SplitPane
          board={<div data-testid="board-content">Board Content</div>}
          panel={<div data-testid="panel-content">Panel Content</div>}
          panelPosition="bottom"
        />,
      )
    })

    const container = host.firstElementChild
    expect(container?.className).toContain('flex-col')
    const children = Array.from(container?.children ?? [])
    const boardEl = host.querySelector('[data-testid="board-content"]')
    const panelEl = host.querySelector('[data-testid="panel-content"]')

    // Board container should come first (top), panel container after (bottom)
    expect(children[0].contains(boardEl)).toBe(true)
    expect(children[2].contains(panelEl)).toBe(true)
  })

  it('shows drop zones when dragging log panel and triggers onDropPanel', () => {
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

    expect(host.textContent).toContain('Dock Log on Left')
    expect(host.textContent).toContain('Dock Log on Top')
    expect(host.textContent).toContain('Dock Log on Bottom')

    // Find the left drop zone
    const leftDropZone = Array.from(host.querySelectorAll('div[class*="border-dashed"]')).find((el) =>
      el.textContent?.includes('Dock Log on Left'),
    )
    expect(leftDropZone).toBeTruthy()

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    leftDropZone?.dispatchEvent(dropEvent)

    expect(onDropPanel).toHaveBeenCalledWith('left')
  })

  it('shows drop zones when dragging board panel and triggers onDropPanel for opposite edge', () => {
    const onDropPanel = vi.fn()

    act(() => {
      root.render(
        <SplitPane
          board={<div>Board</div>}
          panel={<div>Panel</div>}
          panelPosition="right"
          draggingSource="board"
          onDropPanel={onDropPanel}
        />,
      )
    })

    // When panelPosition is 'right', board is already on the left.
    // So the available dock targets for the board are Right, Top, and Bottom.
    expect(host.textContent).toContain('Dock Board on Right')
    expect(host.textContent).toContain('Dock Board on Top')
    expect(host.textContent).toContain('Dock Board on Bottom')

    // Find the top drop zone
    const topDropZone = Array.from(host.querySelectorAll('div[class*="border-dashed"]')).find((el) =>
      el.textContent?.includes('Dock Board on Top'),
    )
    expect(topDropZone).toBeTruthy()

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    topDropZone?.dispatchEvent(dropEvent)

    // Dropping board on top docks log panel on bottom
    expect(onDropPanel).toHaveBeenCalledWith('bottom')
  })

  it('does not apply justify-center to boardPane to prevent clipping tall content', () => {
    act(() => {
      root.render(
        <SplitPane
          board={<div data-testid="board-child">Board</div>}
          panel={<div>Panel</div>}
          panelPosition="bottom"
        />,
      )
    })

    const boardChild = host.querySelector('[data-testid="board-child"]')
    const boardContainer = boardChild?.parentElement
    expect(boardContainer?.className).not.toContain('justify-center')
    expect(boardContainer?.className).toContain('overflow-hidden')
  })
})
