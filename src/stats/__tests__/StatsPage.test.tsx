// @vitest-environment jsdom
import StatsPage from '@/stats/StatsPage'
import type { StatsSummary } from '@/types/stats'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const mockSummary: StatsSummary = {
  generatedAt: '2026-11-04T12:00:00Z',
  filters: { days: 30, country: null, mode: null, outcome: null, includeBots: false },
  totals: {
    sessions: 3,
    uniqueVisitors: 2,
    games: 9,
    finished: 7,
    abandoned: 1,
    inProgress: 1,
    completionRate: 0.875,
    avgFinishedSeconds: 420,
    avgAbandonedSeconds: 120,
    avgTurns: 38,
    sessionsWithGame: 2,
  },
  byDay: [
    { day: '2026-11-02', sessions: 1, games: 1 },
    { day: '2026-11-03', sessions: 1, games: 8 },
    { day: '2026-11-04', sessions: 1, games: 0 },
  ],
  byCountry: [{ key: 'BG', count: 9 }],
  byAs: [],
  byReferrer: [],
  byDevice: [],
  byBrowser: [],
  byMode: [],
  byProvider: [],
  byOutcome: [],
  byBoardStyle: [],
  aiErrors: [],
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/api/stats/summary')) {
      return {
        ok: true,
        status: 200,
        redirected: false,
        json: async () => mockSummary,
      } as Response
    }
    return {
      ok: true,
      status: 200,
      redirected: false,
      json: async () => ({ rows: [], total: 0 }),
    } as Response
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  act(() => root.unmount())
  host.remove()
})

const text = () => host.textContent ?? ''

describe('StatsPage and DayChart', () => {
  it('renders overall games/session KPI in summary section', async () => {
    await act(async () => {
      root.render(<StatsPage />)
    })

    expect(text()).toContain('Games / session')
    // 9 games / 3 sessions = 3.00
    expect(text()).toContain('3.00')
    expect(text()).toContain('4.50 per active session')
  })

  it('renders visible dates, counts, and games/session ratios without needing to hover', async () => {
    await act(async () => {
      root.render(<StatsPage />)
    })

    // Header info
    expect(text()).toContain('By day')
    expect(text()).toContain('Avg. Games / Session:')
    expect(text()).toContain('3.0')

    // On-chart labels and ratios
    expect(text()).toContain('Nov 2')
    expect(text()).toContain('Nov 3')
    expect(text()).toContain('Nov 4')
    expect(text()).toContain('8.0') // games/session for Nov 3
    expect(text()).toContain('1.0') // games/session for Nov 2

    // Breakdown table
    expect(text()).toContain('Last Days Breakdown')
    expect(text()).toContain('8.0 / sess')
    expect(text()).toContain('1.0 / sess')
  })
})

