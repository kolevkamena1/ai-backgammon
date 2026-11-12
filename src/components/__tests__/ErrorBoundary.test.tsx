// @vitest-environment jsdom
import ErrorBoundary from '@/components/ErrorBoundary'
import { logger } from '@/lib/logger'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Boom({ fail }: { fail: boolean }) {
  if (fail) {
    throw new Error('kaboom')
  }
  return <div>healthy</div>
}

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
  vi.restoreAllMocks()
})

const button = (label: string): HTMLElement | undefined =>
  Array.from(host.querySelectorAll('button')).find((el) => (el.textContent ?? '').includes(label))

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom fail={false} />
        </ErrorBoundary>,
      )
    })
    expect(host.textContent).toContain('healthy')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('catches a render error, logs it, and shows the fallback', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom fail={true} />
        </ErrorBoundary>,
      )
    })

    expect(host.querySelector('[role="alert"]')).toBeTruthy()
    expect(host.textContent).toContain('Something went wrong')
    expect(host.textContent).toContain('kaboom')
    expect(logSpy).toHaveBeenCalledWith('app crashed', expect.objectContaining({ message: 'kaboom' }))
    consoleSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('recovers through Try again once the child stops throwing', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom fail={true} />
        </ErrorBoundary>,
      )
    })
    expect(host.textContent).toContain('Something went wrong')

    // The boundary still holds the error until we reset it; the child is now healthy.
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom fail={false} />
        </ErrorBoundary>,
      )
    })
    act(() => {
      button('Try again')?.click()
    })

    expect(host.textContent).toContain('healthy')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    consoleSpy.mockRestore()
  })
})