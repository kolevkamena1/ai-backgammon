// @vitest-environment jsdom
import AboutModal from '@/components/AboutModal'
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

describe('AboutModal', () => {
  it('renders the key purposes of the application', () => {
    act(() => {
      root.render(<AboutModal onClose={vi.fn()} />)
    })

    expect(text()).toContain('Why AI Backgammon?')
    expect(text()).toContain('For Backgammon Enthusiasts')
    expect(text()).toContain('Learn & Explore AI Models')
    expect(text()).toContain('Model vs Model Arena')
    expect(text()).toContain('Just for Fun')
    expect(text()).toContain('Local & Private BYOK Architecture')
  })

  it('provides a link to the GitHub README and triggers onClose', () => {
    const onClose = vi.fn()
    act(() => {
      root.render(<AboutModal onClose={onClose} />)
    })

    const link = host.querySelector('a[href*="github.com"]')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('href')?.toLowerCase()).toContain('readme')

    const closeBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Close')
    expect(closeBtn).toBeTruthy()
    act(() => {
      closeBtn?.click()
    })
    expect(onClose).toHaveBeenCalled()
  })
})

