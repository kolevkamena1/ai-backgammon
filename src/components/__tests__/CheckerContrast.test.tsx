// @vitest-environment jsdom
import Board from '@/components/Board'
import Checker from '@/components/Checker'
import Point from '@/components/Point'
import { useSettingsStore } from '@/state/settingsStore'
import { BOARD_DESIGNS } from '@/utils/boardDesigns'
import {
  computeBoardMetrics,
  computeResizedDimensions,
  DEFAULT_BOARD_DIMENSIONS,
} from '@/utils/boardResize'
import { getInitialBoardState } from '@/utils/gameLogic'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * A contract test for the checker geometry, not a rendering test: jsdom applies no CSS, so what is
 * asserted here are the class strings the three components must agree on. They are coupled by
 * arithmetic (`Checker` size × `Point` gap × six visible discs must fit inside `Board`'s triangle
 * height), and the coupling is invisible until the stack paints past the apex — which is exactly how
 * the old 14 px disc with `gap-1` inside `h-28` came to spill on a phone.
 */
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

const classesOf = (selector: string): string[] =>
  Array.from(host.querySelectorAll(selector)).map((el) => el.getAttribute('class') ?? '')

describe('checker contrast', () => {
  it('rims each colour against the point it stands on, not against the other colour', () => {
    act(() => {
      root.render(
        <>
          <Checker owner="light" />
          <Checker owner="dark" />
        </>,
      )
    })

    const [light, dark] = classesOf('span')

    // #f8fafc on a #f2dcb4 cream triangle needs a dark edge; #111827 on #b5502a terracotta a light one.
    expect(light).toContain('border-slate-900')
    expect(dark).toContain('border-slate-50')
    // The previous rims were one step of grey in both directions and blurred into the triangles.
    expect(light).not.toContain('border-slate-400')
    expect(dark).not.toContain('border-slate-600')
  })

  it('lifts both colours off the board with a tinted shadow', () => {
    act(() => {
      root.render(<Checker owner="dark" />)
    })

    const [only] = classesOf('span')
    expect(only).toContain('shadow-md')
    // Untinted `shadow-md` is nearly black at 10%: invisible against the dark field it should pop from.
    expect(only).toContain('shadow-black/45')
  })

  it('sizes the stack and the triangle to each other', () => {
    act(() => {
      root.render(
        <>
          <Checker owner="light" />
          <Point index={1} orientation="bottom" checkers={9} owner="light" />
          <Board />
        </>,
      )
    })

    const [disc] = classesOf('span')
    expect(disc).toContain('size-4')

    const stack = Array.from(host.querySelectorAll('div')).find(
      (el) => (el.getAttribute('class') ?? '').includes('flex-col') && (el.getAttribute('class') ?? '').includes('items-center'),
    )
    expect(stack).toBeDefined()
    // Rendered first, so this is the standalone `Point` above and not one of `Board`'s triangles.
    expect(stack?.getAttribute('class') ?? '').toContain('gap-0.5')

    const quadrant = classesOf('div').find((cls) => cls.includes('grid-cols-6'))
    expect(quadrant ?? '').toContain('h-36')
    expect(quadrant ?? '').toContain('sm:h-40')

    // Six discs then need 6×16 + 5×2 = 106 px, and the triangle offers 144 − 20 = 124 px, the
    // `+3` overflow label included. Nine checkers must therefore show exactly six discs.
    const discs = Array.from(stack?.querySelectorAll('span') ?? []).filter((span) =>
      (span.getAttribute('class') ?? '').includes('size-4'),
    )
    expect(discs).toHaveLength(6)
    expect(stack?.textContent ?? '').toContain('+3')
  })

  it('resizes width on left/right edges, height on top/bottom edges, and locks aspect ratio on corners', () => {
    const start = { width: 800, height: 400 } // 2:1 aspect ratio

    // Right / Left edge: only width changes (symmetrically around center)
    expect(computeResizedDimensions('right', start, 50, 30)).toEqual({ width: 900, height: 400 })
    expect(computeResizedDimensions('left', start, -50, 30)).toEqual({ width: 900, height: 400 })

    // Bottom / Top edge: only height changes
    expect(computeResizedDimensions('bottom', start, 40, 60)).toEqual({ width: 800, height: 460 })
    expect(computeResizedDimensions('top', start, 40, -60)).toEqual({ width: 800, height: 460 })

    // Corner handles: preserve exact 2:1 aspect ratio
    const cornerGrown = computeResizedDimensions('bottom-right', start, 100, 20)
    expect(cornerGrown.width / cornerGrown.height).toBeCloseTo(start.width / start.height, 2)
    expect(cornerGrown).toEqual({ width: 1000, height: 500 })

    const cornerShrunk = computeResizedDimensions('top-left', start, 80, 10)
    expect(cornerShrunk.width / cornerShrunk.height).toBeCloseTo(start.width / start.height, 2)
    expect(cornerShrunk).toEqual({ width: 640, height: 320 })
  })

  it('scales circular checkers with board dimensions and never overflows triangle bounds', () => {
    const base = computeBoardMetrics(
      DEFAULT_BOARD_DIMENSIONS.width,
      DEFAULT_BOARD_DIMENSIONS.height,
    )
    const larger = computeBoardMetrics(1100, 520)
    const smaller = computeBoardMetrics(480, 280)

    expect(larger.checkerSize).toBeGreaterThan(base.checkerSize)
    expect(smaller.checkerSize).toBeLessThan(base.checkerSize)
    expect(larger.quadrantHeight).toBeGreaterThan(base.quadrantHeight)
  })

  it('supports all five artisanal board and checker visual designs', () => {
    expect(BOARD_DESIGNS.map((d) => d.id)).toEqual([
      'levantine',
      'lucite',
      'bridle',
      'coastal',
      'artdeco',
    ])

    for (const design of BOARD_DESIGNS) {
      useSettingsStore.getState().setBoardDesign(design.id)
      expect(useSettingsStore.getState().boardDesign).toBe(design.id)

      act(() => {
        root.render(<Board design={design.id} />)
      })

      const section = host.querySelector('section[aria-label="Backgammon board"]')
      expect(section?.getAttribute('data-board-design')).toBe(design.id)
    }
  })

  it('renders visible checkers on the left (black bear-off), right (white bear-off), and center bars', () => {
    const board = {
      ...getInitialBoardState(),
      bar: { light: 2, dark: 1 },
      off: { light: 3, dark: 4 },
    }

    act(() => {
      root.render(<Board board={board} />)
    })

    // Center bar: Black cell should have 1 dark checker disc, White cell should have 2 light checker discs
    const bar = host.querySelector('.board-bar')
    expect(bar).toBeTruthy()
    const barDarkDiscs = bar?.querySelectorAll('.checker-disc-dark')
    const barLightDiscs = bar?.querySelectorAll('.checker-disc-light')
    expect(barDarkDiscs).toHaveLength(1)
    expect(barLightDiscs).toHaveLength(2)

    // Trays: left is Black bear-off, right is White bear-off
    const trays = host.querySelectorAll('.board-tray')
    expect(trays).toHaveLength(2)
    const leftTray = trays[0]
    const rightTray = trays[1]

    const leftDiscs = leftTray.querySelectorAll('.checker-disc-dark')
    expect(leftDiscs).toHaveLength(4)

    const rightDiscs = rightTray.querySelectorAll('.checker-disc-light')
    expect(rightDiscs).toHaveLength(3)
  })
})