import type { PlayerColor } from '@/types/game'
import type { GameConfigSnapshot, SeatAssignment, SeatPlan } from '@/types/gameConfig'
import type { AiDifficulty, AiEngineConfig, AiProvider } from '@/types/settings'
import { maskSecret } from '@/utils/formatSecret'

/**
 * Seats are `light`/`dark` throughout the domain (see `types/game.ts`); White and Black are
 * display labels only, so the board vocabulary and the setup vocabulary cannot drift apart.
 */
export const SEAT_LABELS: Record<PlayerColor, string> = {
  light: 'White',
  dark: 'Black',
}

/** The level a seat plays at when its stored config predates the difficulty field. */
export const DEFAULT_DIFFICULTY: AiDifficulty = 'medium'

/** Display names, capitalised for UI text. The domain value stays lower-case for the prompt. */
export const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}

/**
 * The selector's vocabulary in one place: `ByokFields` builds its options from this, and the prompt
 * strength line (`utils/aiPrompt.ts`) is what the label promises, so the two cannot drift apart.
 */
export const AI_DIFFICULTIES: ReadonlyArray<{ value: AiDifficulty; label: string; blurb: string }> = [
  { value: 'easy', label: DIFFICULTY_LABELS.easy, blurb: 'Casual play, loose enough to misfire.' },
  { value: 'medium', label: DIFFICULTY_LABELS.medium, blurb: 'Sound strategy: points made, blots hit.' },
  { value: 'hard', label: DIFFICULTY_LABELS.hard, blurb: 'Primes, blocking and risk, with a bigger reply budget.' },
]

/** Reading `difficulty` is always through this, so the fallback exists in exactly one place. */
export function difficultyOf(engine: AiEngineConfig): AiDifficulty {
  return engine.difficulty ?? DEFAULT_DIFFICULTY
}

/** The <select> yields a plain string, so narrow it back, keeping the current value if odd. */
export function parseDifficulty(value: string, fallback: AiDifficulty): AiDifficulty {
  const match = AI_DIFFICULTIES.find((entry) => entry.value === value)
  return match ? match.value : fallback
}

const PROVIDER_NAMES: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  custom: 'Custom endpoint',
}

function isProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_NAMES, value)
}

/**
 * Coerces an untrusted persisted payload into a valid `AiEngineConfig`, falling back field-by-field
 * to `fallback` so a tampered or stale `localStorage` entry cannot crash the UI.
 */
export function sanitizeEngineConfig(raw: unknown, fallback: AiEngineConfig): AiEngineConfig {
  if (typeof raw !== 'object' || raw === null) {
    return { ...fallback }
  }
  const record = raw as Record<string, unknown>
  const fallbackDifficulty = fallback.difficulty ?? DEFAULT_DIFFICULTY

  return {
    provider: isProvider(record.provider) ? record.provider : fallback.provider,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : fallback.apiKey,
    model: typeof record.model === 'string' ? record.model : fallback.model,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : (fallback.baseUrl ?? ''),
    difficulty:
      typeof record.difficulty === 'string'
        ? parseDifficulty(record.difficulty, fallbackDifficulty)
        : fallbackDifficulty,
  }
}

/** What still stops an engine from playing. Empty means ready. */
export function validateEngine(engine: AiEngineConfig): string[] {
  const problems: string[] = []

  if (engine.apiKey.trim().length === 0) {
    problems.push('An API key is required.')
  }
  if (engine.provider === 'custom' && (engine.baseUrl ?? '').trim().length === 0) {
    problems.push('A Base URL is required for a custom endpoint.')
  }

  return problems
}

/** Key-free description, safe to render anywhere in the UI. */
export interface EngineSummary {
  providerName: string
  model: string
  endpoint: string
  maskedKey: string
  configured: boolean
  /** Never `undefined`: a pre-Phase-4 config reports the default level rather than a blank. */
  difficulty: AiDifficulty
}

export function describeEngine(engine: AiEngineConfig): EngineSummary {
  return {
    providerName: PROVIDER_NAMES[engine.provider],
    model: engine.model.trim(),
    endpoint: (engine.baseUrl ?? '').trim(),
    maskedKey: maskSecret(engine.apiKey),
    configured: validateEngine(engine).length === 0,
    difficulty: difficultyOf(engine),
  }
}

function aiSeat(color: PlayerColor, label: string, engine: AiEngineConfig): SeatAssignment {
  return { color, kind: 'ai', label, engine, problems: validateEngine(engine) }
}

/**
 * Resolves who occupies each seat. This is the single definition of the game modes: the setup
 * modal previews its roster from it, and the future engine loop consumes the very same result.
 *
 * Mirror matches intentionally hand the SAME object to both seats — a personal key is never
 * copied into a second place.
 */
export function planSeats(personal: AiEngineConfig, config: GameConfigSnapshot): SeatPlan {
  if (config.mode === 'humanVsAi') {
    const light: SeatAssignment = { color: 'light', kind: 'human', label: 'You' }
    const dark = aiSeat('dark', 'AI opponent', personal)

    return { light, dark, ready: seatProblems(dark).length === 0 }
  }

  if (config.aiMatchType === 'mirror') {
    const light = aiSeat('light', 'Personal AI', personal)
    const dark = aiSeat('dark', 'Personal AI (mirror)', personal)

    return { light, dark, ready: seatProblems(light).length === 0 }
  }

  const light = aiSeat('light', 'Personal AI', personal)
  const dark = aiSeat('dark', 'Opponent AI', config.opponent)

  return {
    light,
    dark,
    ready: seatProblems(light).length === 0 && seatProblems(dark).length === 0,
  }
}

/** Problems for any seat, human or AI — humans are always ready. */
export function seatProblems(seat: SeatAssignment): string[] {
  return seat.kind === 'ai' ? seat.problems : []
}

/** Short human label for the current setup — used by the header badge and the roster card. */
export function describeMode(config: GameConfigSnapshot): string {
  if (config.mode === 'humanVsAi') {
    return 'Human vs AI'
  }

  return config.aiMatchType === 'mirror' ? 'AI vs AI · Mirror' : 'AI vs AI · Custom'
}
