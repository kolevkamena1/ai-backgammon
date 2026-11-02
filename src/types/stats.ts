/**
 * Wire types shared by the telemetry client, the Pages Functions and the admin dashboard.
 * Pure types only, so `shared/` (compiled for the edge) and `src/` (compiled for the browser) can
 * both import them without dragging runtime code across the boundary.
 */

export type StatsGameMode = 'humanVsAi' | 'aiVsAi'
export type StatsMatchType = 'mirror' | 'custom'
export type StatsOutcome = 'in_progress' | 'finished' | 'abandoned'
export type StatsDeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown'

export interface VisitEvent {
  type: 'visit'
  sessionId: string
  /** Referrer HOST only, never a full URL. */
  referrerHost: string | null
  utmSource: string | null
  language: string | null
  viewportWidth: number | null
  viewportHeight: number | null
  landingPath: string
}

export interface GameStartEvent {
  type: 'game_start'
  sessionId: string
  gameId: string
  mode: StatsGameMode
  matchType: StatsMatchType | null
  /** Provider ids only (e.g. `openai+anthropic`). Never keys, endpoints or prompts. */
  aiProvider: string | null
  aiModel: string | null
  difficulty: string | null
  boardStyle: string | null
  theme: string | null
}

export interface GameEndEvent {
  type: 'game_end'
  sessionId: string
  gameId: string
  outcome: 'finished' | 'abandoned'
  winner: 'light' | 'dark' | null
  turns: number
  moves: number
  undoCount: number
  pauseCount: number
  /** Error code -> occurrences, e.g. `{ timeout: 2 }`. */
  aiErrors: Record<string, number>
}

export type AnalyticsEvent = VisitEvent | GameStartEvent | GameEndEvent

export interface StatsFilters {
  days: number
  country: string | null
  mode: StatsGameMode | null
  outcome: StatsOutcome | null
  includeBots: boolean
}

export interface CountRow {
  key: string
  count: number
}

export interface StatsSummary {
  generatedAt: string
  filters: StatsFilters
  totals: {
    sessions: number
    uniqueVisitors: number
    games: number
    finished: number
    abandoned: number
    inProgress: number
    /** finished / (finished + abandoned), null when nothing has ended yet. */
    completionRate: number | null
    avgFinishedSeconds: number | null
    avgAbandonedSeconds: number | null
    avgTurns: number | null
    sessionsWithGame: number
  }
  byDay: { day: string; sessions: number; games: number }[]
  byCountry: CountRow[]
  byAs: CountRow[]
  byReferrer: CountRow[]
  byDevice: CountRow[]
  byBrowser: CountRow[]
  byMode: CountRow[]
  byProvider: CountRow[]
  byOutcome: CountRow[]
  byBoardStyle: CountRow[]
  aiErrors: CountRow[]
}

export interface SessionRow {
  session_id: string
  first_seen: string
  last_seen: string
  ip_hash: string | null
  country: string | null
  asn: number | null
  as_org: string | null
  referrer_host: string | null
  utm_source: string | null
  device_type: string | null
  browser: string | null
  os: string | null
  language: string | null
  is_bot: number
  games_played: number
  games_finished: number
}

export interface GameRow {
  game_id: string
  session_id: string
  started_at: string
  ended_at: string | null
  duration_s: number | null
  mode: string
  match_type: string | null
  ai_provider: string | null
  ai_model: string | null
  difficulty: string | null
  outcome: StatsOutcome
  winner: string | null
  turns: number | null
  moves: number | null
  undo_count: number | null
  pause_count: number | null
  ai_errors: string | null
  board_style: string | null
  theme: string | null
  country: string | null
  asn: number | null
  as_org: string | null
  ip_hash: string | null
}

export interface ListResponse<T> {
  rows: T[]
  limit: number
  offset: number
}

