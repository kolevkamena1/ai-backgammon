import type { PlayerColor } from '@/types/game'
import type { GameConfigSnapshot, SeatAssignment, SeatPlan } from '@/types/gameConfig'
import type { AiEngineConfig, AiProvider } from '@/types/settings'
import { maskSecret } from '@/utils/formatSecret'

/**
 * Seats are `light`/`dark` throughout the domain (see `types/game.ts`); White and Black are
 * display labels only, so the board vocabulary and the setup vocabulary cannot drift apart.
 */
export const SEAT_LABELS: Record<PlayerColor, string> = {
  light: 'White',
  dark: 'Black',
}

const PROVIDER_NAMES: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  custom: 'Custom endpoint',
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
}

export function describeEngine(engine: AiEngineConfig): EngineSummary {
  return {
    providerName: PROVIDER_NAMES[engine.provider],
    model: engine.model.trim(),
    endpoint: (engine.baseUrl ?? '').trim(),
    maskedKey: maskSecret(engine.apiKey),
    configured: validateEngine(engine).length === 0,
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
