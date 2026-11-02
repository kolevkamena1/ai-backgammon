import type {
  AnalyticsEvent,
  CountRow,
  GameRow,
  ListResponse,
  SessionRow,
  StatsFilters,
  StatsSummary,
} from '../src/types/stats.ts'
import { RETENTION_DAYS, utcDay } from './analytics.ts'

/** The slice of the D1 API used here, declared structurally (see the ai-proxy Function). */
export interface D1Prepared {
  bind(...values: unknown[]): D1Prepared
  run(): Promise<unknown>
  all<T>(): Promise<{ results: T[] }>
  first<T>(): Promise<T | null>
}
export interface D1Db {
  prepare(query: string): D1Prepared
  batch(statements: D1Prepared[]): Promise<unknown[]>
}

/** Request-derived facts, resolved by the Function (never trusted from the body). */
export interface RequestFacts {
  ipHash: string | null
  country: string | null
  asn: number | null
  asOrg: string | null
  deviceType: string
  browser: string
  os: string
  isBot: boolean
  botScore: number | null
}

const nowIso = (): string => new Date().toISOString()

export async function recordEvent(db: D1Db, event: AnalyticsEvent, facts: RequestFacts): Promise<void> {
  const now = nowIso()
  const visit = event.type === 'visit' ? event : null

  // Upsert on every event: a beacon that lands before (or without) the visit still gets a session.
  const upsertSession = db
    .prepare(
      `INSERT INTO sessions (session_id, first_seen, last_seen, day, ip_hash, country, asn, as_org,
         referrer_host, utm_source, device_type, browser, os, language, viewport_w, viewport_h,
         is_bot, bot_score, landing_path)
       VALUES (?1,?2,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
       ON CONFLICT(session_id) DO UPDATE SET
         last_seen = excluded.last_seen,
         referrer_host = COALESCE(sessions.referrer_host, excluded.referrer_host),
         utm_source = COALESCE(sessions.utm_source, excluded.utm_source),
         language = COALESCE(sessions.language, excluded.language),
         viewport_w = COALESCE(sessions.viewport_w, excluded.viewport_w),
         viewport_h = COALESCE(sessions.viewport_h, excluded.viewport_h),
         landing_path = COALESCE(sessions.landing_path, excluded.landing_path)`,
    )
    .bind(
      event.sessionId,
      now,
      utcDay(new Date()),
      facts.ipHash,
      facts.country,
      facts.asn,
      facts.asOrg,
      visit?.referrerHost ?? null,
      visit?.utmSource ?? null,
      facts.deviceType,
      facts.browser,
      facts.os,
      visit?.language ?? null,
      visit?.viewportWidth ?? null,
      visit?.viewportHeight ?? null,
      facts.isBot ? 1 : 0,
      facts.botScore,
      visit?.landingPath ?? null,
    )

  if (event.type === 'visit') {
    await upsertSession.run()
    return
  }

  if (event.type === 'game_start') {
    await db.batch([
      upsertSession,
      db
        .prepare(
          `INSERT OR IGNORE INTO games (game_id, session_id, started_at, mode, match_type, ai_provider,
             ai_model, difficulty, outcome, board_style, theme)
           VALUES (?,?,?,?,?,?,?,?, 'in_progress', ?, ?)`,
        )
        .bind(
          event.gameId,
          event.sessionId,
          now,
          event.mode,
          event.matchType,
          event.aiProvider,
          event.aiModel,
          event.difficulty,
          event.boardStyle,
          event.theme,
        ),
    ])
    return
  }

  // game_end: duration comes from the SERVER clock, so a client cannot invent it. A late
  // `finished` may override an earlier `abandoned` (tab restored), but never the reverse.
  await db.batch([
    upsertSession,
    db
      .prepare(
        `UPDATE games SET
           ended_at = ?1,
           duration_s = CAST((julianday(?1) - julianday(started_at)) * 86400 AS INTEGER),
           outcome = ?2, winner = ?3, turns = ?4, moves = ?5, undo_count = ?6, pause_count = ?7,
           ai_errors = ?8
         WHERE game_id = ?9 AND session_id = ?10 AND outcome != 'finished'`,
      )
      .bind(
        now,
        event.outcome,
        event.winner,
        event.turns,
        event.moves,
        event.undoCount,
        event.pauseCount,
        Object.keys(event.aiErrors).length > 0 ? JSON.stringify(event.aiErrors) : null,
        event.gameId,
        event.sessionId,
      ),
  ])
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

interface Where {
  sql: string
  params: unknown[]
}

function sessionFilters(filters: StatsFilters): Where {
  const parts: string[] = []
  const params: unknown[] = []
  if (!filters.includeBots) parts.push('s.is_bot = 0')
  if (filters.country !== null) {
    parts.push('s.country = ?')
    params.push(filters.country)
  }
  return { sql: parts.join(' AND '), params }
}

function sessionWhere(filters: StatsFilters): Where {
  const extra = sessionFilters(filters)
  return {
    sql: ['s.first_seen >= ?', extra.sql].filter((p) => p !== '').join(' AND '),
    params: [sinceIso(filters.days), ...extra.params],
  }
}

function gameWhere(filters: StatsFilters): Where {
  const extra = sessionFilters(filters)
  const parts = ['g.started_at >= ?', extra.sql].filter((p) => p !== '')
  const params: unknown[] = [sinceIso(filters.days), ...extra.params]
  if (filters.mode !== null) {
    parts.push('g.mode = ?')
    params.push(filters.mode)
  }
  if (filters.outcome !== null) {
    parts.push('g.outcome = ?')
    params.push(filters.outcome)
  }
  return { sql: parts.join(' AND '), params }
}

/** `expr` is always a literal from this file, never user input. */
async function group(db: D1Db, expr: string, from: string, where: Where, limit = 10): Promise<CountRow[]> {
  const { results } = await db
    .prepare(`SELECT ${expr} AS key, COUNT(*) AS count ${from} WHERE ${where.sql} GROUP BY key ORDER BY count DESC LIMIT ${limit}`)
    .bind(...where.params)
    .all<CountRow>()
  return results
}

export async function getSummary(db: D1Db, filters: StatsFilters): Promise<StatsSummary> {
  const sw = sessionWhere(filters)
  const gw = gameWhere(filters)
  const fromSessions = 'FROM sessions s'
  const fromGames = 'FROM games g JOIN sessions s ON s.session_id = g.session_id'

  const sessionTotals = await db
    .prepare(
      `SELECT COUNT(*) AS sessions, COUNT(DISTINCT s.day || ':' || s.ip_hash) AS uniq ${fromSessions} WHERE ${sw.sql}`,
    )
    .bind(...sw.params)
    .first<{ sessions: number; uniq: number }>()

  const gameTotals = await db
    .prepare(
      `SELECT COUNT(*) AS games,
         COALESCE(SUM(g.outcome = 'finished'), 0) AS finished,
         COALESCE(SUM(g.outcome = 'abandoned'), 0) AS abandoned,
         COALESCE(SUM(g.outcome = 'in_progress'), 0) AS in_progress,
         AVG(CASE WHEN g.outcome = 'finished' THEN g.duration_s END) AS avg_finished,
         AVG(CASE WHEN g.outcome = 'abandoned' THEN g.duration_s END) AS avg_abandoned,
         AVG(g.turns) AS avg_turns,
         COUNT(DISTINCT g.session_id) AS sessions_with_game
       ${fromGames} WHERE ${gw.sql}`,
    )
    .bind(...gw.params)
    .first<{
      games: number
      finished: number
      abandoned: number
      in_progress: number
      avg_finished: number | null
      avg_abandoned: number | null
      avg_turns: number | null
      sessions_with_game: number
    }>()

  const dayRows = await db
    .prepare(`SELECT s.day AS day, COUNT(*) AS sessions ${fromSessions} WHERE ${sw.sql} GROUP BY s.day ORDER BY s.day`)
    .bind(...sw.params)
    .all<{ day: string; sessions: number }>()
  const gameDayRows = await db
    .prepare(
      `SELECT substr(g.started_at, 1, 10) AS day, COUNT(*) AS games ${fromGames} WHERE ${gw.sql} GROUP BY day ORDER BY day`,
    )
    .bind(...gw.params)
    .all<{ day: string; games: number }>()

  const days = new Map<string, { day: string; sessions: number; games: number }>()
  for (const row of dayRows.results) days.set(row.day, { day: row.day, sessions: row.sessions, games: 0 })
  for (const row of gameDayRows.results) {
    const entry = days.get(row.day) ?? { day: row.day, sessions: 0, games: 0 }
    entry.games = row.games
    days.set(row.day, entry)
  }

  const finished = gameTotals?.finished ?? 0
  const abandoned = gameTotals?.abandoned ?? 0
  const errorRows = await db
    .prepare(`SELECT g.ai_errors AS errors ${fromGames} WHERE ${gw.sql} AND g.ai_errors IS NOT NULL`)
    .bind(...gw.params)
    .all<{ errors: string }>()
  const errorCounts = new Map<string, number>()
  for (const row of errorRows.results) {
    try {
      for (const [code, n] of Object.entries(JSON.parse(row.errors) as Record<string, number>)) {
        errorCounts.set(code, (errorCounts.get(code) ?? 0) + n)
      }
    } catch {
      // A malformed row is skipped rather than failing the whole dashboard.
    }
  }

  return {
    generatedAt: nowIso(),
    filters,
    totals: {
      sessions: sessionTotals?.sessions ?? 0,
      uniqueVisitors: sessionTotals?.uniq ?? 0,
      games: gameTotals?.games ?? 0,
      finished,
      abandoned,
      inProgress: gameTotals?.in_progress ?? 0,
      completionRate: finished + abandoned === 0 ? null : finished / (finished + abandoned),
      avgFinishedSeconds: gameTotals?.avg_finished ?? null,
      avgAbandonedSeconds: gameTotals?.avg_abandoned ?? null,
      avgTurns: gameTotals?.avg_turns ?? null,
      sessionsWithGame: gameTotals?.sessions_with_game ?? 0,
    },
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byCountry: await group(db, "COALESCE(s.country, '??')", fromSessions, sw),
    byAs: await group(db, "COALESCE('AS' || s.asn || ' ' || s.as_org, 'unknown')", fromSessions, sw),
    byReferrer: await group(db, "COALESCE(s.referrer_host, 'direct')", fromSessions, sw),
    byDevice: await group(db, "COALESCE(s.device_type, 'unknown')", fromSessions, sw),
    byBrowser: await group(db, "COALESCE(s.browser, 'unknown')", fromSessions, sw),
    byMode: await group(db, "g.mode || COALESCE(' / ' || g.match_type, '')", fromGames, gw),
    byProvider: await group(db, "COALESCE(g.ai_provider, 'none')", fromGames, gw),
    byOutcome: await group(db, 'g.outcome', fromGames, gw),
    byBoardStyle: await group(db, "COALESCE(g.board_style, 'unknown')", fromGames, gw),
    aiErrors: [...errorCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  }
}

export async function listSessions(
  db: D1Db,
  filters: StatsFilters,
  limit: number,
  offset: number,
): Promise<ListResponse<SessionRow>> {
  const w = sessionWhere(filters)
  const { results } = await db
    .prepare(
      `SELECT s.session_id, s.first_seen, s.last_seen, s.ip_hash, s.country, s.asn, s.as_org, s.referrer_host,
         s.utm_source, s.device_type, s.browser, s.os, s.language, s.is_bot,
         (SELECT COUNT(*) FROM games g WHERE g.session_id = s.session_id) AS games_played,
         (SELECT COUNT(*) FROM games g WHERE g.session_id = s.session_id AND g.outcome = 'finished') AS games_finished
       FROM sessions s WHERE ${w.sql} ORDER BY s.first_seen DESC LIMIT ? OFFSET ?`,
    )
    .bind(...w.params, limit, offset)
    .all<SessionRow>()
  return { rows: results, limit, offset }
}

export async function listGames(
  db: D1Db,
  filters: StatsFilters,
  limit: number,
  offset: number,
): Promise<ListResponse<GameRow>> {
  const w = gameWhere(filters)
  const { results } = await db
    .prepare(
      `SELECT g.*, s.country, s.asn, s.as_org, s.ip_hash
       FROM games g JOIN sessions s ON s.session_id = g.session_id
       WHERE ${w.sql} ORDER BY g.started_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...w.params, limit, offset)
    .all<GameRow>()
  return { rows: results, limit, offset }
}

/**
 * Retention: roll raw rows older than RETENTION_DAYS into `daily_stats`, then delete them. One
 * batch (atomic in D1), so a retry can never double-count.
 */
export async function purgeOld(db: D1Db): Promise<void> {
  const cutoffDay = utcDay(new Date(Date.now() - RETENTION_DAYS * 86_400_000))

  await db.batch([
    db
      .prepare(
        `INSERT INTO daily_stats (day, country, sessions)
         SELECT day, COALESCE(country, '??'), COUNT(*) FROM sessions WHERE day < ?1 GROUP BY day, COALESCE(country, '??')
         ON CONFLICT(day, country) DO UPDATE SET sessions = sessions + excluded.sessions`,
      )
      .bind(cutoffDay),
    db
      .prepare(
        `INSERT INTO daily_stats (day, country, games, finished, abandoned, duration_s)
         SELECT s.day, COALESCE(s.country, '??'), COUNT(*),
                SUM(g.outcome = 'finished'), SUM(g.outcome = 'abandoned'), COALESCE(SUM(g.duration_s), 0)
         FROM games g JOIN sessions s ON s.session_id = g.session_id
         WHERE s.day < ?1 GROUP BY s.day, COALESCE(s.country, '??')
         ON CONFLICT(day, country) DO UPDATE SET
           games = games + excluded.games, finished = finished + excluded.finished,
           abandoned = abandoned + excluded.abandoned, duration_s = duration_s + excluded.duration_s`,
      )
      .bind(cutoffDay),
    db.prepare(`DELETE FROM games WHERE session_id IN (SELECT session_id FROM sessions WHERE day < ?1)`).bind(cutoffDay),
    db.prepare(`DELETE FROM sessions WHERE day < ?1`).bind(cutoffDay),
  ])
}
