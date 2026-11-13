import { beforeEach, describe, expect, it } from 'vitest'
import { useGameStore } from '@/state/gameStore'
import type { GameConfigSnapshot } from '@/types/gameConfig'
import type { AiEngineConfig } from '@/types/settings'

const PERSONAL_AI: AiEngineConfig = {
  provider: 'custom',
  apiKey: 'test-key',
  baseUrl: 'http://localhost:11434',
  model: 'qwen2.5:7b',
}

const crawfordConfig = (targetPoints: number, enableCrawford = true): GameConfigSnapshot => ({
  mode: 'humanVsAi',
  aiMatchType: 'mirror',
  opponent: PERSONAL_AI,
  match: { targetPoints, enableCrawford },
})

/** Sets the live match score without playing a game out, then advances to the next game in the set. */
function playToScore(light: number, dark: number): void {
  useGameStore.setState({ match: { ...useGameStore.getState().match!, light, dark } })
  expect(useGameStore.getState().startNextGameInSet()).toBe(true)
}

describe('Crawford rule (R1/R8 regression)', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame()
  })

  it('starts a Crawford game the first time either seat reaches one point from the target', () => {
    useGameStore.getState().startNewGame(crawfordConfig(5), PERSONAL_AI)
    expect(useGameStore.getState().match?.isCrawfordGame).toBe(false)
    expect(useGameStore.getState().match?.crawfordPlayed).toBe(false)

    playToScore(4, 1) // light is one point away
    const match = useGameStore.getState().match!
    expect(match.isCrawfordGame).toBe(true)
    expect(match.crawfordPlayed).toBe(true)
  })

  it('triggers for dark as well', () => {
    useGameStore.getState().startNewGame(crawfordConfig(5), PERSONAL_AI)
    playToScore(1, 4)
    expect(useGameStore.getState().match?.isCrawfordGame).toBe(true)
    expect(useGameStore.getState().match?.crawfordPlayed).toBe(true)
  })

  it('refuses doubles during the Crawford game and allows them again afterwards', () => {
    useGameStore.getState().startNewGame(crawfordConfig(5), PERSONAL_AI)
    playToScore(4, 1)

    // Crawford game in progress: the seat to act cannot double (only the Crawford guard can
    // refuse here — turn, dice, cube ownership and pause all permit it).
    expect(useGameStore.getState().proposeDouble('light')).toBe(false)

    // Light loses the Crawford game; the next game is post-Crawford.
    playToScore(4, 2)
    expect(useGameStore.getState().match?.isCrawfordGame).toBe(false)
    expect(useGameStore.getState().match?.crawfordPlayed).toBe(true)

    // Doubling is legal again (the AI responder answers synchronously inside proposeDouble).
    expect(useGameStore.getState().proposeDouble('light')).toBe(true)
    expect(useGameStore.getState().cube.value).toBe(2)
  })

  it('never re-triggers Crawford later in the match, even while the trailer stays one point away (R1)', () => {
    useGameStore.getState().startNewGame(crawfordConfig(5), PERSONAL_AI)
    playToScore(4, 0)
    expect(useGameStore.getState().match?.isCrawfordGame).toBe(true)

    // Light keeps losing while stuck at 4/5: every later game must stay post-Crawford.
    for (const dark of [1, 2, 3]) {
      playToScore(4, dark)
      expect(useGameStore.getState().match?.isCrawfordGame).toBe(false)
      expect(useGameStore.getState().match?.crawfordPlayed).toBe(true)
    }
  })

  it('does not start a Crawford game when the rule is disabled', () => {
    useGameStore.getState().startNewGame(crawfordConfig(5, false), PERSONAL_AI)
    playToScore(4, 1)
    expect(useGameStore.getState().match?.isCrawfordGame).toBe(false)
    expect(useGameStore.getState().match?.crawfordPlayed).toBe(false)
  })

  it('resets the Crawford memory when a new match set starts', () => {
    useGameStore.getState().startNewGame(crawfordConfig(5), PERSONAL_AI)
    playToScore(4, 1)
    expect(useGameStore.getState().match?.crawfordPlayed).toBe(true)

    useGameStore.getState().startNewGame(crawfordConfig(5), PERSONAL_AI, true)
    expect(useGameStore.getState().match?.crawfordPlayed).toBe(false)
    expect(useGameStore.getState().match?.isCrawfordGame).toBe(false)
  })
})
