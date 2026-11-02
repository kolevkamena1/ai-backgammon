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
          onOpenSettings={vi.fn()}
          onOpenAbout={vi.fn()}
        />,
      )
    })

    // Click Game menu
    act(() => {
      findButton('Game')?.click()
    })
    expect(text()).toContain('New Game')
    expect(text()).toContain('Restart Match')

    // Click/hover New Game to open submenu
    act(() => {
      findButton('New Game')?.click()
    })
    expect(text()).toContain('Human vs AI')
    expect(text()).toContain('AI vs AI')
    expect(text()).toContain('Custom Match...')

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
})
