// @vitest-environment jsdom
import MenuBar from '@/components/MenuBar'
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

const text = () => host.textContent ?? ''
const buttons = () => Array.from(host.querySelectorAll('button'))
const findButton = (label: string) =>
  buttons().find((el) => el.textContent?.trim().startsWith(label) || el.getAttribute('aria-label') === label)

describe('MenuBar', () => {
  it('renders classic menu bar items: Game, View, Options, Help', () => {
    act(() => {
      root.render(
        <MenuBar
          isGameActive={false}
          onOpenNewGame={vi.fn()}
          onRestartGame={vi.fn()}
          onResetToOpening={vi.fn()}
          boardDesign="levantine"
          onSelectBoardDesign={vi.fn()}
          theme="dark"
          onSetTheme={vi.fn()}
          panelPosition="right"
          onSetPanelPosition={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenAbout={vi.fn()}
        />,
      )
    })

    expect(findButton('Game')).toBeTruthy()
    expect(findButton('View')).toBeTruthy()
    expect(findButton('Options')).toBeTruthy()
    expect(findButton('Help')).toBeTruthy()
  })

  it('applies theme-aware high-contrast hover styling without hardcoded text-white', () => {
    act(() => {
      root.render(
        <MenuBar
          isGameActive={false}
          onOpenNewGame={vi.fn()}
          onRestartGame={vi.fn()}
          onResetToOpening={vi.fn()}
          boardDesign="levantine"
          onSelectBoardDesign={vi.fn()}
          theme="light"
          onSetTheme={vi.fn()}
          panelPosition="right"
          onSetPanelPosition={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenAbout={vi.fn()}
        />,
      )
    })

    const viewButton = findButton('View')
    expect(viewButton).toBeTruthy()
    expect(viewButton?.className).toContain('hover:text-slate-50')
    expect(viewButton?.className).not.toContain('hover:text-white')
  })

  it('opens Game menu and launches Human vs AI from submenu', () => {
    const onOpenNewGame = vi.fn()

    act(() => {
      root.render(
        <MenuBar
          isGameActive={false}
          onOpenNewGame={onOpenNewGame}
          onRestartGame={vi.fn()}
          onResetToOpening={vi.fn()}
          boardDesign="levantine"
          onSelectBoardDesign={vi.fn()}
          theme="dark"
          onSetTheme={vi.fn()}
          panelPosition="right"
          onSetPanelPosition={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenAbout={vi.fn()}
        />,
      )
    })

    // Click Game menu
    act(() => {
      findButton('Game')?.click()
    })
    expect(text()).toContain('Human vs AI')
    expect(text()).toContain('AI vs AI')
    expect(text()).toContain('Custom Match...')
    expect(text()).toContain('Restart Match')

    // Click Human vs AI
    act(() => {
      findButton('Human vs AI')?.click()
    })
    expect(onOpenNewGame).toHaveBeenCalledWith('humanVsAi')
  })

  it('opens View menu and selects a different board style', () => {
    const onSelectBoardDesign = vi.fn()

    act(() => {
      root.render(
        <MenuBar
          isGameActive={true}
          onOpenNewGame={vi.fn()}
          onRestartGame={vi.fn()}
          onResetToOpening={vi.fn()}
          boardDesign="levantine"
          onSelectBoardDesign={onSelectBoardDesign}
          theme="dark"
          onSetTheme={vi.fn()}
          panelPosition="right"
          onSetPanelPosition={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenAbout={vi.fn()}
        />,
      )
    })

    act(() => {
      findButton('View')?.click()
    })
    expect(text()).toContain('Board Style')

    act(() => {
      findButton('Board Style')?.click()
    })
    expect(text()).toContain('Crystal Lucite')

    act(() => {
      findButton('Crystal Lucite')?.click()
    })
    expect(onSelectBoardDesign).toHaveBeenCalledWith('lucite')
  })

  it('opens Options menu and triggers BYOK Settings', () => {
    const onOpenSettings = vi.fn()

    act(() => {
      root.render(
        <MenuBar
          isGameActive={false}
          onOpenNewGame={vi.fn()}
          onRestartGame={vi.fn()}
          onResetToOpening={vi.fn()}
          boardDesign="levantine"
          onSelectBoardDesign={vi.fn()}
          theme="dark"
          onSetTheme={vi.fn()}
          panelPosition="right"
          onSetPanelPosition={vi.fn()}
          onOpenSettings={onOpenSettings}
          onOpenAbout={vi.fn()}
        />,
      )
    })

    act(() => {
      findButton('Options')?.click()
    })
    expect(text()).toContain('BYOK Settings...')

    act(() => {
      findButton('BYOK Settings...')?.click()
    })
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('opens Help menu with GitHub README link and About dialog', () => {
    const onOpenAbout = vi.fn()

    act(() => {
      root.render(
        <MenuBar
          isGameActive={false}
          onOpenNewGame={vi.fn()}
          onRestartGame={vi.fn()}
          onResetToOpening={vi.fn()}
          boardDesign="levantine"
          onSelectBoardDesign={vi.fn()}
          theme="dark"
          onSetTheme={vi.fn()}
          panelPosition="right"
          onSetPanelPosition={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenAbout={onOpenAbout}
        />,
      )
    })

    act(() => {
      findButton('Help')?.click()
    })

    const readmeLink = host.querySelector('a[href*="github.com"]')
    expect(readmeLink).toBeTruthy()
    expect(readmeLink?.getAttribute('href')?.toLowerCase()).toContain('readme')

    act(() => {
      findButton('About AI Backgammon...')?.click()
    })
    expect(onOpenAbout).toHaveBeenCalled()
  })

  it('opens View menu and changes Log Panel placement', () => {
    const onSetPanelPosition = vi.fn()

    act(() => {
      root.render(
        <MenuBar
          isGameActive={false}
          onOpenNewGame={vi.fn()}
          onRestartGame={vi.fn()}
          onResetToOpening={vi.fn()}
          boardDesign="levantine"
          onSelectBoardDesign={vi.fn()}
          theme="dark"
          onSetTheme={vi.fn()}
          panelPosition="right"
          onSetPanelPosition={onSetPanelPosition}
          onOpenSettings={vi.fn()}
          onOpenAbout={vi.fn()}
        />,
      )
    })

    act(() => {
      findButton('View')?.click()
    })
    expect(text()).toContain('Log Panel Placement')
    expect(text()).toContain('Dock on Left')
    expect(text()).toContain('Dock on Right')
    expect(text()).toContain('Dock on Top')
    expect(text()).toContain('Dock on Bottom')

    act(() => {
      findButton('Dock on Left')?.click()
    })
    expect(onSetPanelPosition).toHaveBeenCalledWith('left')

    act(() => {
      findButton('View')?.click()
    })
    act(() => {
      findButton('Dock on Top')?.click()
    })
    expect(onSetPanelPosition).toHaveBeenCalledWith('top')

    act(() => {
      findButton('View')?.click()
    })
    act(() => {
      findButton('Dock on Bottom')?.click()
    })
    expect(onSetPanelPosition).toHaveBeenCalledWith('bottom')
  })
})
