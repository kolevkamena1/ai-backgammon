// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MatchScoreboard from '@/components/MatchScoreboard'
import type { MatchScoreState } from '@/types/gameMatch'

describe('MatchScoreboard', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount()
      })
      container.remove()
    }
    container = null
    root = null
  })

  const baseMatch: MatchScoreState = {
    light: 4,
    dark: 0,
    targetPoints: 7,
    gameIndex: 2,
    matchWinner: null,
    enableCrawford: true,
    isCrawfordGame: false,
    crawfordPlayed: false,
    lastVictory: null,
  }

  it('renders scores prominently right above the board', () => {
    act(() => {
      root?.render(<MatchScoreboard match={baseMatch} />)
    })

    expect(container?.textContent).toContain('4')
    expect(container?.textContent).toContain('0')
    expect(container?.textContent).toContain('White')
    expect(container?.textContent).toContain('Black')
    expect(container?.textContent).toContain('Game 2')
  })

  it('displays the target points to win below the score', () => {
    act(() => {
      root?.render(<MatchScoreboard match={baseMatch} />)
    })

    expect(container?.textContent).toContain('First to')
    expect(container?.textContent).toContain('7 points')
    expect(container?.textContent).toContain('wins the match')
    expect(container?.textContent).toContain('7 pts to win')
  })

  it('renders Crawford game notice when active', () => {
    const crawfordMatch: MatchScoreState = {
      ...baseMatch,
      light: 6,
      dark: 2,
      isCrawfordGame: true,
    }
    act(() => {
      root?.render(<MatchScoreboard match={crawfordMatch} />)
    })

    expect(container?.textContent).toContain('Crawford Game · Doubling disabled')
  })

  it('renders champion badge when a player wins the match', () => {
    const wonMatch: MatchScoreState = {
      ...baseMatch,
      light: 7,
      dark: 3,
      matchWinner: 'light',
    }
    act(() => {
      root?.render(<MatchScoreboard match={wonMatch} />)
    })

    expect(container?.textContent).toContain('🏆 White Wins the Set!')
  })
})
