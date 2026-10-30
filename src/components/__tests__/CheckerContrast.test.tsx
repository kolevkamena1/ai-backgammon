// @vitest-environment jsdom
import Board from '@/components/Board'
import Checker from '@/components/Checker'
import Point from '@/components/Point'
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
})