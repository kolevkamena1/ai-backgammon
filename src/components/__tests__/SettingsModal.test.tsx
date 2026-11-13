// @vitest-environment jsdom
import GameSetupModal from '@/components/GameSetupModal'
import SettingsModal from '@/components/SettingsModal'
import { DEFAULT_OPPONENT_CONFIG, useGameConfigStore } from '@/state/gameConfigStore'
import { DEFAULT_SETTINGS, useSettingsStore } from '@/state/settingsStore'
import * as aiModels from '@/utils/aiModels'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  useSettingsStore.setState({
    ...DEFAULT_SETTINGS,
    params: undefined,
    isSettingsOpen: true,
  })
  useGameConfigStore.setState({
    mode: 'humanVsAi',
    aiMatchType: 'mirror',
    opponent: { ...DEFAULT_OPPONENT_CONFIG },
    isSetupOpen: false,
  })
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

describe('SettingsModal (side-by-side BYOK 1 & BYOK 2)', () => {
  it('renders BYOK 1 enabled and BYOK 2 grayed out / disabled until "Use two different BYOK" is toggled', () => {
    act(() => {
      root.render(<SettingsModal onClose={() => undefined} />)
    })

    const toggle = host.querySelector<HTMLInputElement>('#settings-use-two-byok')
    expect(toggle).not.toBeNull()
    expect(toggle?.checked).toBe(false)

    const byok1Key = host.querySelector<HTMLInputElement>('#settings-byok1-api-key')
    const byok2Key = host.querySelector<HTMLInputElement>('#settings-byok2-api-key')
    const byok2Fieldset = byok2Key?.closest('fieldset')

    expect(byok1Key).not.toBeNull()
    expect(byok2Key).not.toBeNull()
    expect(byok2Fieldset?.disabled).toBe(true)

    // Enable the toggle
    act(() => {
      toggle?.click()
    })

    expect(toggle?.checked).toBe(true)
    expect(byok2Fieldset?.disabled).toBe(false)
  })

  it('copies BYOK 1 into BYOK 2 and swaps the two configurations via the quick-action buttons', () => {
    useSettingsStore.setState({
      provider: 'anthropic',
      apiKey: 'sk-ant-1111',
      model: 'claude-sonnet-4-20250514',
      baseUrl: '',
      difficulty: 'hard',
      params: { systemPrompt: 'Play a relentless blitz.' },
    })
    useGameConfigStore.setState({
      aiMatchType: 'custom',
      opponent: {
        provider: 'google',
        apiKey: 'AIza-2222',
        model: 'gemini-2.5-flash',
        baseUrl: '',
        difficulty: 'easy',
      },
    })

    act(() => {
      root.render(<SettingsModal onClose={() => undefined} />)
    })

    const byok1Model = host.querySelector<HTMLInputElement>('#settings-byok1-model')
    const byok2Model = host.querySelector<HTMLInputElement>('#settings-byok2-model')
    expect(byok1Model?.value).toBe('claude-sonnet-4-20250514')
    expect(byok2Model?.value).toBe('gemini-2.5-flash')

    // Swap 1 <-> 2
    const swapButton = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Swap 1 ↔ 2'),
    )
    act(() => {
      swapButton?.click()
    })

    expect(byok1Model?.value).toBe('gemini-2.5-flash')
    expect(byok2Model?.value).toBe('claude-sonnet-4-20250514')

    // Copy BYOK 1 -> BYOK 2
    const copyButton = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Copy BYOK 1 → BYOK 2'),
    )
    act(() => {
      copyButton?.click()
    })

    expect(byok2Model?.value).toBe('gemini-2.5-flash')
  })

  it('saves both BYOK 1 and BYOK 2 and syncs aiMatchType on submit', () => {
    const onClose = vi.fn()

    act(() => {
      root.render(<SettingsModal onClose={onClose} />)
    })

    const toggle = host.querySelector<HTMLInputElement>('#settings-use-two-byok')!
    const byok1Key = host.querySelector<HTMLInputElement>('#settings-byok1-api-key')!
    const byok2Key = host.querySelector<HTMLInputElement>('#settings-byok2-api-key')!
    const byok2Prompt = host.querySelector<HTMLTextAreaElement>('#settings-byok2-system-prompt')!

    act(() => {
      toggle.click()
      setInputValue(byok1Key, 'sk-primary-1234')
      setInputValue(byok2Key, 'sk-secondary-5678')
      setInputValue(byok2Prompt, 'Prioritize building a 6-prime.')
    })

    const form = host.querySelector('form')!
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().apiKey).toBe('sk-primary-1234')
    expect(useGameConfigStore.getState().aiMatchType).toBe('custom')
    expect(useGameConfigStore.getState().opponent.apiKey).toBe('sk-secondary-5678')
    expect(useGameConfigStore.getState().opponent.params?.systemPrompt).toBe(
      'Prioritize building a 6-prime.',
    )
  })

  it('defaults to the warm soft light theme and toggles between light and dark', () => {
    expect(useSettingsStore.getState().theme).toBe('light')
    useSettingsStore.getState().toggleTheme()
    expect(useSettingsStore.getState().theme).toBe('dark')
    useSettingsStore.getState().toggleTheme()
    expect(useSettingsStore.getState().theme).toBe('light')
  })

  it('renders color-aware system prompt previews and non-remapped active preset contrast in ByokFields (C11 regression)', () => {
    useGameConfigStore.setState({
      mode: 'humanVsAi',
      humanColor: 'light',
      aiMatchType: 'custom',
    })

    act(() => {
      root.render(<SettingsModal onClose={() => undefined} />)
    })

    // In 2-BYOK mode, BYOK 1 plays White (light) and BYOK 2 plays Black (dark).
    const preElements = Array.from(host.querySelectorAll('pre'))
    expect(preElements).toHaveLength(2)
    expect(preElements[0]?.textContent).toContain('You are a backgammon engine playing White.')
    expect(preElements[1]?.textContent).toContain('You are a backgammon engine playing Black.')

    // Active preset pill uses non-theme-remapped text-white on bg-sky-700 (not text-sky-200).
    const defaultPresetBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.startsWith('Default ('),
    )
    expect(defaultPresetBtn?.className).toContain('text-white')
    expect(defaultPresetBtn?.className).not.toContain('text-sky-200')
  })

  it('updates Human vs AI description when Play Black is selected and uses non-remapped checker swatch tokens in GameSetupModal (C11 regression)', () => {
    act(() => {
      root.render(<GameSetupModal onClose={() => undefined} />)
    })

    expect(host.textContent).toContain('You play White; BYOK 1 plays Black.')

    const blackRadio = host.querySelector<HTMLInputElement>('input[name="human-color"][value="dark"]')
    expect(blackRadio).not.toBeNull()
    const blackSwatch = blackRadio?.parentElement?.querySelector('span[aria-hidden]')
    expect(blackSwatch?.className).toContain('bg-checker-dark')
    expect(blackSwatch?.className).not.toContain('bg-slate-950')

    act(() => {
      blackRadio?.click()
    })

    expect(host.textContent).toContain('You play Black; BYOK 1 plays White.')
  })

  it('does not re-fetch model metadata on unrelated systemPrompt edits and aborts in-flight fetch on unmount (P3)', async () => {
    vi.useFakeTimers()
    const capturedSignals: AbortSignal[] = []
    const metadataSpy = vi
      .spyOn(aiModels, 'fetchModelMetadata')
      .mockImplementation(async (_engine, _modelId, options) => {
        if (options?.signal) capturedSignals.push(options.signal)
        return {
          ok: true,
          metadata: aiModels.lookupCatalogMetadata('openai', 'gpt-4o-mini'),
          error: null,
        }
      })

    try {
      useSettingsStore.setState({
        provider: 'openai',
        apiKey: 'sk-test-key-1234',
        model: 'gpt-4o-mini',
        baseUrl: '',
        difficulty: 'medium',
      })

      act(() => {
        root.render(<SettingsModal onClose={() => undefined} />)
      })

      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      expect(metadataSpy).toHaveBeenCalledTimes(1)

      // Editing system prompt must NOT re-trigger fetchModelMetadata
      const promptTextarea = host.querySelector<HTMLTextAreaElement>(
        '#settings-byok1-system-prompt',
      )!
      act(() => {
        setInputValue(promptTextarea, 'Anchor early and avoid leaving blots.')
      })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      expect(metadataSpy).toHaveBeenCalledTimes(1)

      // Changing model triggers a new metadata fetch; unmounting aborts its AbortSignal
      const modelInput = host.querySelector<HTMLInputElement>('#settings-byok1-model')!
      act(() => {
        setInputValue(modelInput, 'gpt-4o')
      })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      expect(metadataSpy).toHaveBeenCalledTimes(2)
      const latestSignal = capturedSignals[capturedSignals.length - 1]
      expect(latestSignal?.aborted).toBe(false)

      act(() => {
        root.unmount()
      })
      expect(latestSignal?.aborted).toBe(true)
    } finally {
      metadataSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})

