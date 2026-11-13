// @vitest-environment jsdom
import { useSeparatorKeyboard, type SeparatorKeyboardOptions } from '@/hooks/useSeparatorKeyboard'
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function Harness(props: SeparatorKeyboardOptions) {
  const ref = useRef<HTMLDivElement>(null)
  // Controlled, like the real consumers: onChange feeds the new value back in.
  const [value, setValue] = useState(props.value)
  useSeparatorKeyboard(ref, {
    ...props,
    value,
    onChange: (next) => {
      setValue(next)
      props.onChange(next)
    },
  })
  return <div ref={ref} data-testid="sep" tabIndex={0} />
}

function mount(props: SeparatorKeyboardOptions): HTMLDivElement {
  act(() => {
    root.render(<Harness {...props} />)
  })
  return host.querySelector('[data-testid="sep"]') as HTMLDivElement
}

function press(el: HTMLElement, key: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
})

describe('useSeparatorKeyboard', () => {
  it('steps the value with arrows and accumulates repeated presses', () => {
    const onChange = vi.fn()
    const el = mount({ value: 50, min: 0, max: 100, step: 2, orientation: 'horizontal', onChange })
    press(el, 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith(52)
    // Two presses in the same task must accumulate (52 -> 54), not read a stale value.
    act(() => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith(56)
    press(el, 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith(54)
  })

  it('Home/End jump to the bounds', () => {
    const onChange = vi.fn()
    const el = mount({ value: 50, min: 10, max: 90, onChange })
    press(el, 'Home')
    expect(onChange).toHaveBeenLastCalledWith(10)
    press(el, 'End')
    expect(onChange).toHaveBeenLastCalledWith(90)
  })

  it('clamps at the maximum instead of overshooting', () => {
    const onChange = vi.fn()
    const el = mount({ value: 99, min: 0, max: 100, step: 5, orientation: 'horizontal', onChange })
    press(el, 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith(100)
  })

  it('respects orientation (horizontal ignores Up/Down)', () => {
    const onChange = vi.fn()
    const el = mount({ value: 50, min: 0, max: 100, orientation: 'horizontal', onChange })
    press(el, 'ArrowUp')
    press(el, 'ArrowDown')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('invert flips which arrow increases', () => {
    const onChange = vi.fn()
    const el = mount({ value: 50, min: 0, max: 100, step: 2, invert: true, orientation: 'horizontal', onChange })
    press(el, 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith(52)
  })

  it('removes its listener on unmount (no leak)', () => {
    const onChange = vi.fn()
    const el = mount({ value: 50, min: 0, max: 100, onChange })
    press(el, 'ArrowRight')
    expect(onChange).toHaveBeenCalledTimes(1)
    act(() => {
      root.unmount()
    })
    // Dispatching on the detached node must not invoke the callback again.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})