import type { AiEngineConfig } from '@/types/settings'
import { DEFAULT_GAME_CONFIG, useGameConfigStore } from '@/state/gameConfigStore'
import { beforeEach, describe, expect, it } from 'vitest'

const opponent: AiEngineConfig = {
  provider: 'openai',
  apiKey: 'sk-opponent-1234',
  model: '',
  baseUrl: '',
}

beforeEach(() => {
  useGameConfigStore.setState({ ...DEFAULT_GAME_CONFIG, opponent: { ...opponent }, isSetupOpen: false })
})

describe('saveSetup merges only provided keys (B3 regression)', () => {
  it('preserves dice, humanColor and match when saving only mode/aiMatchType/opponent', () => {
    // A rich setup the player already chose.
    useGameConfigStore.setState({
      humanColor: 'dark',
      dice: { mode: 'seeded', seed: 42 },
      match: { targetPoints: 7, enableCrawford: true },
    })

    // Settings saves only the match type + opponent (see SettingsModal.handleSubmit).
    useGameConfigStore.getState().saveSetup({ mode: 'aiVsAi', aiMatchType: 'custom', opponent })

    const s = useGameConfigStore.getState()
    expect(s.mode).toBe('aiVsAi')
    expect(s.aiMatchType).toBe('custom')
    expect(s.opponent).toEqual(opponent)
    // None of these were part of the save, so they must survive it. Before the fix they were
    // reset to 'light' / { mode: 'random' } / undefined respectively.
    expect(s.humanColor).toBe('dark')
    expect(s.dice).toEqual({ mode: 'seeded', seed: 42 })
    expect(s.match).toEqual({ targetPoints: 7, enableCrawford: true })
  })

  it('still applies optional keys when they are provided', () => {
    useGameConfigStore.getState().saveSetup({
      mode: 'humanVsAi',
      aiMatchType: 'mirror',
      opponent,
      humanColor: 'light',
      dice: { mode: 'manual' },
      match: { targetPoints: 3, enableCrawford: false },
    })

    const s = useGameConfigStore.getState()
    expect(s.humanColor).toBe('light')
    expect(s.dice).toEqual({ mode: 'manual' })
    expect(s.match).toEqual({ targetPoints: 3, enableCrawford: false })
  })

  it('closes the setup modal on save', () => {
    useGameConfigStore.setState({ isSetupOpen: true })
    useGameConfigStore.getState().saveSetup({ mode: 'humanVsAi', aiMatchType: 'mirror', opponent })
    expect(useGameConfigStore.getState().isSetupOpen).toBe(false)
  })
})