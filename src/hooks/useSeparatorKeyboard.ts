import { useEffect, useRef, type RefObject } from 'react'

export interface SeparatorKeyboardOptions {
  /** Current numeric value of the separator (percent, px, ...). */
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  /** Increment per arrow press. Defaults to 2. */
  step?: number
  /**
   * Which arrow axis moves the separator. `horizontal` = Left/Right (a vertical divider line),
   * `vertical` = Up/Down (a horizontal divider line), `both` accepts all four (legacy split pane).
   */
  orientation?: 'horizontal' | 'vertical' | 'both'
  /** Flip which direction increases the value (panel-first splits). */
  invert?: boolean
}

/**
 * Shared keyboard behaviour for focusable separators (SplitPane divider and Board edge handles, E3).
 * Attaches a `keydown` listener to the referenced element and removes it on unmount / re-subscribe,
 * so no listener leaks. Arrows step the value (clamped to [min, max]); Home/End jump to the bounds.
 * The element itself supplies `tabIndex`, `role="separator"` and the `aria-value*` attributes.
 */
export function useSeparatorKeyboard(
  ref: RefObject<HTMLElement | null>,
  options: SeparatorKeyboardOptions,
): void {
  const { value, min, max, onChange, step = 2, orientation = 'both', invert = false } = options

  // Track the live value in a ref so several keydowns dispatched in the same task accumulate
  // (a captured `value` would be stale until React re-renders). External changes sync back in.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    const el = ref.current
    if (el === null) {
      return
    }

    const clamp = (n: number): number => Math.min(max, Math.max(min, n))
    const decreaseKeys = invert ? ['ArrowRight', 'ArrowUp'] : ['ArrowLeft', 'ArrowDown']
    const increaseKeys = invert ? ['ArrowLeft', 'ArrowDown'] : ['ArrowRight', 'ArrowUp']
    const horizontalKeys = ['ArrowLeft', 'ArrowRight']
    const verticalKeys = ['ArrowUp', 'ArrowDown']

    const emit = (next: number): void => {
      valueRef.current = next
      onChange(next)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (orientation === 'horizontal' && verticalKeys.includes(event.key)) return
      if (orientation === 'vertical' && horizontalKeys.includes(event.key)) return

      if (decreaseKeys.includes(event.key)) {
        event.preventDefault()
        emit(clamp(valueRef.current - step))
      } else if (increaseKeys.includes(event.key)) {
        event.preventDefault()
        emit(clamp(valueRef.current + step))
      } else if (event.key === 'Home') {
        event.preventDefault()
        emit(min)
      } else if (event.key === 'End') {
        event.preventDefault()
        emit(max)
      }
    }

    el.addEventListener('keydown', handleKeyDown)
    return () => {
      el.removeEventListener('keydown', handleKeyDown)
    }
  }, [ref, min, max, onChange, step, orientation, invert])
}