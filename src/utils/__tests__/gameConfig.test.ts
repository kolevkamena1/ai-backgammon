import type { GameConfigSnapshot, SeatAssignment } from '@/types/gameConfig'
import type { AiEngineConfig } from '@/types/settings'
import {
  AI_DIFFICULTIES,
  DEFAULT_DIFFICULTY,
  SEAT_LABELS,
  describeEngine,
  describeMode,
  difficultyOf,
  parseDifficulty,
  planSeats,
  seatProblems,
  validateEngine,
} from '@/utils/gameConfig'
import { describe, expect, it } from 'vitest'

const engine = (overrides: Partial<AiEngineConfig> = {}): AiEngineConfig => ({
  provider: 'openai',
  apiKey: 'sk-personal-1234',
  model: '',
  baseUrl: '',
  ...overrides,
})

const snapshot = (overrides: Partial<GameConfigSnapshot> = {}): GameConfigSnapshot => ({
  mode: 'humanVsAi',
  aiMatchType: 'mirror',
  opponent: engine({ apiKey: 'sk-opponent-5678' }),
  ...overrides,
})

describe('SEAT_LABELS', () => {
  it('keeps White/Black as display-only labels over the domain colours', () => {
    expect(SEAT_LABELS).toEqual({ light: 'White', dark: 'Black' })
  })
})

describe('validateEngine', () => {
  it('requires a key', () => {
    expect(validateEngine(engine({ apiKey: '' }))).toEqual(['An API key is required.'])
    expect(validateEngine(engine({ apiKey: '    ' }))).toEqual(['An API key is required.'])
  })

  it('requires a base URL only for the custom provider', () => {
    expect(validateEngine(engine({ provider: 'custom', baseUrl: '' }))).toEqual([
      'A Base URL is required for a custom endpoint.',
    ])
    expect(validateEngine(engine({ provider: 'openai', baseUrl: '' }))).toEqual([])
    expect(validateEngine(engine({ provider: 'custom', baseUrl: 'http://localhost:11434/v1' }))).toEqual([])
  })

  it('lists both problems when both are missing', () => {
    expect(validateEngine(engine({ provider: 'custom', apiKey: '', baseUrl: '' }))).toHaveLength(2)
  })
})

describe('describeEngine', () => {
  it('names every provider and never exposes the key', () => {
    expect(describeEngine(engine()).providerName).toBe('OpenAI')
    expect(describeEngine(engine({ provider: 'anthropic' })).providerName).toBe('Anthropic')
    expect(describeEngine(engine({ provider: 'google' })).providerName).toBe('Google Gemini')
    expect(describeEngine(engine({ provider: 'custom' })).providerName).toBe('Custom endpoint')

    const summary = describeEngine(engine({ apiKey: 'sk-super-secret-9999' }))
    expect(summary.maskedKey).not.toContain('super-secret')
    expect(summary.maskedKey.endsWith('9999')).toBe(true)
    expect(summary.configured).toBe(true)
  })

  it('reports an unconfigured engine', () => {
    const summary = describeEngine(engine({ apiKey: '', model: ' gpt-x ', baseUrl: ' http://x/v1 ' }))
    expect(summary.configured).toBe(false)
    expect(summary.model).toBe('gpt-x')
    expect(summary.endpoint).toBe('http://x/v1')
  })
})

describe('describeMode', () => {
  it('labels all three configurations', () => {
    expect(describeMode(snapshot())).toBe('Human vs AI')
    expect(describeMode(snapshot({ mode: 'aiVsAi', aiMatchType: 'mirror' }))).toBe('AI vs AI · Mirror')
    expect(describeMode(snapshot({ mode: 'aiVsAi', aiMatchType: 'custom' }))).toBe('AI vs AI · Custom')
  })
})

describe('difficulty', () => {
  it('defaults a config that predates the field instead of reporting nothing', () => {
    expect(difficultyOf(engine())).toBe(DEFAULT_DIFFICULTY)
    expect(describeEngine(engine()).difficulty).toBe('medium')
    expect(difficultyOf(engine({ difficulty: 'hard' }))).toBe('hard')
  })

  it('offers exactly the three levels the prompt knows about, in order', () => {
    expect(AI_DIFFICULTIES.map((entry) => entry.value)).toEqual(['easy', 'medium', 'hard'])
    // Every entry needs the text a player picks it for; a blank blurb would render an empty hint.
    for (const entry of AI_DIFFICULTIES) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.blurb.length).toBeGreaterThan(0)
    }
  })

  it('narrows a raw select value back to a level, keeping the current one if it is nonsense', () => {
    expect(parseDifficulty('easy', 'medium')).toBe('easy')
    expect(parseDifficulty('hard', 'easy')).toBe('hard')
    // A <select> can only emit these three today, but the fallback is what keeps a stray value from
    // reaching the prompt as `Playing strength: undefined`.
    expect(parseDifficulty('insane', 'medium')).toBe('medium')
    expect(parseDifficulty('', 'hard')).toBe('hard')
  })

  it('snapshots the level with the seat, so a mid-game Settings edit cannot retune a match', () => {
    const engineOf = (seat: SeatAssignment): AiEngineConfig | null =>
      seat.kind === 'ai' ? seat.engine : null

    const personal = engine({ difficulty: 'hard' })
    const mirror = planSeats(personal, snapshot({ mode: 'aiVsAi', aiMatchType: 'mirror' }))
    const light = engineOf(mirror.light)
    const dark = engineOf(mirror.dark)

    expect(light !== null && difficultyOf(light)).toBe('hard')
    // A mirror match hands the SAME object to both seats, so both must play the same level.
    expect(dark !== null && difficultyOf(dark)).toBe('hard')

    const custom = planSeats(personal, snapshot({ mode: 'aiVsAi', aiMatchType: 'custom' }))
    const opponent = engineOf(custom.dark)
    // The opponent carries its own level: the personal Hard must not bleed into the second seat.
    expect(opponent !== null && difficultyOf(opponent)).toBe('medium')
  })
})

describe('planSeats', () => {
  const personal = engine()

  it('puts the human in the light seat for human vs AI by default', () => {
    const plan = planSeats(personal, snapshot())
    expect(plan.light.kind).toBe('human')
    expect(plan.light.label).toBe('You')
    expect(seatProblems(plan.light)).toEqual([])
    expect(plan.dark.kind).toBe('ai')
    if (plan.dark.kind === 'ai') {
      expect(plan.dark.engine).toBe(personal)
    }
    expect(plan.ready).toBe(true)
  })

  it('puts the human in the dark seat when humanColor is dark', () => {
    const plan = planSeats(personal, snapshot({ humanColor: 'dark' }))
    expect(plan.dark.kind).toBe('human')
    expect(plan.dark.label).toBe('You')
    expect(seatProblems(plan.dark)).toEqual([])
    expect(plan.light.kind).toBe('ai')
    if (plan.light.kind === 'ai') {
      expect(plan.light.engine).toBe(personal)
    }
    expect(plan.ready).toBe(true)
  })

  it('ignores the stored opponent for human vs AI and mirror matches', () => {
    const unusableOpponent = engine({ provider: 'custom', apiKey: '', baseUrl: '' })
    const config = snapshot({ opponent: unusableOpponent })
    expect(planSeats(personal, config).ready).toBe(true)
    expect(planSeats(personal, { ...config, mode: 'aiVsAi', aiMatchType: 'mirror' }).ready).toBe(true)
  })

  it('hands a mirror match the same engine object for both seats', () => {
    const plan = planSeats(personal, snapshot({ mode: 'aiVsAi', aiMatchType: 'mirror' }))
    expect(plan.light.kind).toBe('ai')
    expect(plan.dark.kind).toBe('ai')
    if (plan.light.kind === 'ai' && plan.dark.kind === 'ai') {
      expect(plan.light.engine).toBe(plan.dark.engine)
    }
    expect(plan.light.label).toBe('Personal AI')
    expect(plan.dark.label).toBe('Personal AI (mirror)')
  })

  it('uses two distinct engines for a custom match', () => {
    const opponent = engine({ apiKey: 'sk-opponent-5678', provider: 'anthropic' })
    const plan = planSeats(personal, snapshot({ mode: 'aiVsAi', aiMatchType: 'custom', opponent }))
    if (plan.light.kind === 'ai' && plan.dark.kind === 'ai') {
      expect(plan.light.engine).toBe(personal)
      expect(plan.dark.engine).toBe(opponent)
      expect(plan.light.engine).not.toBe(plan.dark.engine)
    }
    expect(plan.ready).toBe(true)
  })

  it('is not ready when either AI seat lacks configuration', () => {
    const noPersonal = planSeats(engine({ apiKey: '' }), snapshot({ mode: 'aiVsAi', aiMatchType: 'custom' }))
    expect(noPersonal.ready).toBe(false)
    expect(seatProblems(noPersonal.light)).toEqual(['An API key is required.'])

    const noOpponentUrl = planSeats(
      personal,
      snapshot({ mode: 'aiVsAi', aiMatchType: 'custom', opponent: engine({ provider: 'custom', baseUrl: '' }) }),
    )
    expect(noOpponentUrl.ready).toBe(false)
    expect(seatProblems(noOpponentUrl.dark)).toEqual(['A Base URL is required for a custom endpoint.'])
    expect(seatProblems(noOpponentUrl.light)).toEqual([])
  })
})
