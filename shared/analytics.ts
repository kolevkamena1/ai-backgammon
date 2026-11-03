import type {
  AnalyticsEvent,
  StatsDeviceType,
  StatsFilters,
  StatsGameMode,
  StatsMatchType,
  StatsOutcome,
} from '../src/types/stats.ts'

/**
 * Runtime-agnostic analytics core: validation of untrusted beacons, privacy-preserving hashing,
 * coarse User-Agent classification and CSV export. No D1, no Cloudflare types - so it runs in
 * Vitest (Node) and at the edge alike.
 */

export const MAX_BODY_BYTES = 4096
export const RETENTION_DAYS = 90

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const HOST_PATTERN = /^[a-z0-9.-]{1,100}$/
const CODE_PATTERN = /^[a-z0-9-]{2,32}$/

const MODES: readonly StatsGameMode[] = ['humanVsAi', 'aiVsAi']
const MATCH_TYPES: readonly StatsMatchType[] = ['mirror', 'custom']
const OUTCOMES: readonly StatsOutcome[] = ['in_progress', 'finished', 'abandoned']

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  // Strip control characters so a hostile value cannot smuggle newlines into logs or CSV.
  const cleaned = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
    .trim()
  return cleaned.length === 0 ? null : cleaned.slice(0, max)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function int(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
}

function id(value: unknown): string | null {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null
}

function host(value: unknown): string | null {
  const text = str(value, 100)?.toLowerCase() ?? null
  return text !== null && HOST_PATTERN.test(text) ? text : null
}

function sanitizeErrors(value: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof value !== 'object' || value === null) return out

  for (const [code, count] of Object.entries(value as Record<string, unknown>).slice(0, 10)) {
    const n = int(count, 0, 1000)
    if (CODE_PATTERN.test(code) && n !== null && n > 0) out[code] = n
  }
  return out
}

/** Validates an untrusted beacon body. Returns null for anything malformed - never throws. */
export function parseEvent(raw: unknown): AnalyticsEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Record<string, unknown>
  const sessionId = id(e.sessionId)
  if (sessionId === null) return null

  switch (e.type) {
    case 'visit':
      return {
        type: 'visit',
        sessionId,
        referrerHost: host(e.referrerHost),
        utmSource: str(e.utmSource, 40),
        language: str(e.language, 16),
        viewportWidth: int(e.viewportWidth, 0, 20000),
        viewportHeight: int(e.viewportHeight, 0, 20000),
        landingPath: (str(e.landingPath, 100) ?? '/').split('?')[0],
      }
    case 'game_start': {
      const gameId = id(e.gameId)
      const mode = oneOf(e.mode, MODES)
      if (gameId === null || mode === null) return null
      return {
        type: 'game_start',
        sessionId,
        gameId,
        mode,
        matchType: oneOf(e.matchType, MATCH_TYPES),
        aiProvider: str(e.aiProvider, 64),
        aiModel: str(e.aiModel, 64),
        difficulty: str(e.difficulty, 16),
        boardStyle: str(e.boardStyle, 32),
        theme: str(e.theme, 16),
      }
    }
    case 'game_end': {
      const gameId = id(e.gameId)
      const outcome = oneOf(e.outcome, ['finished', 'abandoned'] as const)
      if (gameId === null || outcome === null) return null
      return {
        type: 'game_end',
        sessionId,
        gameId,
        outcome,
        winner: oneOf(e.winner, ['light', 'dark'] as const),
        turns: int(e.turns, 0, 10000) ?? 0,
        moves: int(e.moves, 0, 10000) ?? 0,
        undoCount: int(e.undoCount, 0, 10000) ?? 0,
        pauseCount: int(e.pauseCount, 0, 10000) ?? 0,
        aiErrors: sanitizeErrors(e.aiErrors),
      }
    }
    default:
      return null
  }
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * HMAC-SHA256 of `day|ip`, truncated to 16 hex chars (64 bits). The day is part of the message, so
 * the same visitor hashes differently tomorrow: unique visitors per day are countable, but nobody
 * can be followed across days - and with the secret unset nothing identifying is stored at all.
 */
export async function hashIp(ip: string | null, secret: string | undefined, day: string): Promise<string | null> {
  if (ip === null || ip === '' || secret === undefined || secret === '') return null

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${day}|${ip}`))
  return toHex(signature).slice(0, 16)
}

export interface UserAgentInfo {
  browser: string
  os: string
  deviceType: StatsDeviceType
  isBot: boolean
}

const BOT_PATTERN = /bot|crawl|spider|slurp|headless|lighthouse|curl|wget|python-requests|httpclient|facebookexternalhit|preview/i

/** Coarse classification only - the raw User-Agent string is discarded by the caller. */
export function parseUserAgent(ua: string | null): UserAgentInfo {
  if (ua === null || ua === '') return { browser: 'unknown', os: 'unknown', deviceType: 'unknown', isBot: false }
  if (BOT_PATTERN.test(ua)) return { browser: 'bot', os: 'unknown', deviceType: 'bot', isBot: true }

  const browser = /edg(e|a|ios)?\//i.test(ua)
    ? 'Edge'
    : /opr\/|opera/i.test(ua)
      ? 'Opera'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /chrome|crios/i.test(ua)
          ? 'Chrome'
          : /safari/i.test(ua)
            ? 'Safari'
            : 'other'
  const os = /windows/i.test(ua)
    ? 'Windows'
    : /android/i.test(ua)
      ? 'Android'
      : /iphone|ipad|ipod/i.test(ua)
        ? 'iOS'
        : /mac os x|macintosh/i.test(ua)
          ? 'macOS'
          : /linux|cros/i.test(ua)
            ? 'Linux'
            : 'other'
  const deviceType: StatsDeviceType = /ipad|tablet/i.test(ua)
    ? 'tablet'
    : /mobi|iphone|android/i.test(ua)
      ? 'mobile'
      : 'desktop'

  return { browser, os, deviceType, isBot: false }
}

/**
 * Strip control characters and bound the length before a value reaches an edge log. `str()` does this
 * for fields that get *stored*; this does it for request metadata (`Origin`, a full URL, a JWT `kid`)
 * that is only ever logged, where an embedded CR or LF would forge extra lines in the log stream.
 * Written as a code-point filter rather than a regex because ESLint's `no-control-regex` is on, and
 * the filter is the form this module already uses.
 */
export function sanitizeLog(value: string, max = 100): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
    .slice(0, max)
}

/** Own-origin check for a beacon: browsers always send Origin on cross-site POSTs. */
export function isSameOrigin(origin: string | null, requestUrl: string): boolean {
  if (origin === null || origin === '' || origin === 'null') return true // same-origin sendBeacon/fetch may omit it or send literal "null"
  try {
    return new URL(origin).host === new URL(requestUrl).host
  } catch {
    return false
  }
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function parseFilters(params: URLSearchParams): StatsFilters {
  const days = Math.min(RETENTION_DAYS, Math.max(1, Number.parseInt(params.get('days') ?? '30', 10) || 30))
  const country = params.get('country')?.toUpperCase() ?? null

  return {
    days,
    country: country !== null && /^[A-Z]{2}$/.test(country) ? country : null,
    mode: oneOf(params.get('mode'), MODES),
    outcome: oneOf(params.get('outcome'), OUTCOMES),
    includeBots: params.get('bots') === '1',
  }
}

/** CSV with formula-injection protection: cells starting with = + - @ are prefixed with a quote. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const columns = Object.keys(rows[0])
  const cell = (value: unknown): string => {
    let text = value === null || value === undefined ? '' : String(value)
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  return [columns.join(','), ...rows.map((row) => columns.map((c) => cell(row[c])).join(','))].join('\n')
}
