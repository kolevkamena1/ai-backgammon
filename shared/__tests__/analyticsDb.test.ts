import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsEvent } from '../../src/types/stats.ts'
import { getSummary, listGames, listSessions, purgeOld, recordEvent, type D1Db, type D1Prepared, type RequestFacts } from '../analyticsDb.ts'
import { parseFilters } from '../analytics.ts'

/**
 * Runs the REAL SQL against an in-memory SQLite (the engine D1 is built on) through a thin D1-shaped
 * adapter. `node:sqlite` is unflagged from Node 22.13, so the suite skips itself on older Nodes.
 */
type SqliteModule = typeof import('node:sqlite')
let sqlite: SqliteModule | null = null
try {
  sqlite = await import('node:sqlite')
} catch {
  sqlite = null
}

function createDb(): { db: D1Db; raw: InstanceType<SqliteModule['DatabaseSync']> } {
  const raw = new (sqlite as SqliteModule).DatabaseSync(':memory:')
  raw.exec(readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8'))

  const prepare = (query: string, values: unknown[] = []): D1Prepared => ({
    bind: (...next) => prepare(query, next),
    run: async () => raw.prepare(query).run(...(values as never[])),
    all: async <T>() => ({ results: raw.prepare(query).all(...(values as never[])) as T[] }),
    first: async <T>() => (raw.prepare(query).get(...(values as never[])) as T | undefined) ?? null,
  })

  return {
    raw,
    db: {
      prepare: (query) => prepare(query),
      batch: async (statements) => {
        const results: unknown[] = []
        for (const statement of statements) results.push(await statement.all())
        return results
      },
    },
  }
}

const facts: RequestFacts = {
  ipHash: 'abc123abc123abc1',
  country: 'BG',
  asn: 8866,
  asOrg: 'Vivacom',
  deviceType: 'desktop',
  browser: 'Chrome',
  os: 'Windows',
  isBot: false,
  botScore: null,
}
const SID = 'session-0001-aaaa'
const filters = parseFilters(new URLSearchParams('days=30'))

const visit: AnalyticsEvent = {
  type: 'visit', sessionId: SID, referrerHost: 'google.com', utmSource: null, language: 'bg',
  viewportWidth: 1440, viewportHeight: 900, landingPath: '/',
}
const start = (gameId: string): AnalyticsEvent => ({
  type: 'game_start', sessionId: SID, gameId, mode: 'humanVsAi', matchType: null, aiProvider: 'openai',
  aiModel: 'gpt-4o-mini', difficulty: 'medium', boardStyle: 'levantine', theme: 'dark',
})
const end = (gameId: string, outcome: 'finished' | 'abandoned'): AnalyticsEvent => ({
  type: 'game_end', sessionId: SID, gameId, outcome, winner: outcome === 'finished' ? 'light' : null,
  turns: 30, moves: 55, undoCount: 2, pauseCount: 1, aiErrors: { timeout: 2 },
})

describe.skipIf(sqlite === null)('analytics D1 layer (real SQL on SQLite)', () => {
  it('records a visit and a finished game, and summarises them', async () => {
    const { db } = createDb()
    await recordEvent(db, visit, facts)
    await recordEvent(db, start('game-aaaaaaaa'), facts)
    await recordEvent(db, end('game-aaaaaaaa', 'finished'), facts)

    const summary = await getSummary(db, filters)
    expect(summary.totals).toMatchObject({ sessions: 1, uniqueVisitors: 1, games: 1, finished: 1, abandoned: 0, completionRate: 1, sessionsWithGame: 1 })
    expect(summary.byCountry).toEqual([{ key: 'BG', count: 1 }])
    expect(summary.byAs[0].key).toBe('AS8866 Vivacom')
    expect(summary.byReferrer[0].key).toBe('google.com')
    expect(summary.byProvider[0].key).toBe('openai')
    expect(summary.aiErrors).toEqual([{ key: 'timeout', count: 2 }])
    expect(summary.byDay).toHaveLength(1)

    const games = await listGames(db, filters, 10, 0)
    expect(games.rows[0]).toMatchObject({ outcome: 'finished', winner: 'light', turns: 30, country: 'BG', undo_count: 2 })
    expect(games.rows[0].duration_s).toBeGreaterThanOrEqual(0)

    const sessions = await listSessions(db, filters, 10, 0)
    expect(sessions.rows[0]).toMatchObject({ games_played: 1, games_finished: 1, referrer_host: 'google.com' })
  })

  it('is idempotent for repeated starts and never downgrades finished to abandoned', async () => {
    const { db } = createDb()
    await recordEvent(db, start('game-bbbbbbbb'), facts)
    await recordEvent(db, start('game-bbbbbbbb'), facts)
    await recordEvent(db, end('game-bbbbbbbb', 'finished'), facts)
    await recordEvent(db, end('game-bbbbbbbb', 'abandoned'), facts)

    const { rows } = await listGames(db, filters, 10, 0)
    expect(rows).toHaveLength(1)
    expect(rows[0].outcome).toBe('finished')
  })

  it('lets a late finish override an earlier abandon, and counts abandons in the rate', async () => {
    const { db } = createDb()
    await recordEvent(db, start('game-cccccccc'), facts)
    await recordEvent(db, end('game-cccccccc', 'abandoned'), facts)
    await recordEvent(db, start('game-dddddddd'), facts)
    await recordEvent(db, end('game-dddddddd', 'abandoned'), facts)
    expect((await getSummary(db, filters)).totals).toMatchObject({ abandoned: 2, finished: 0, completionRate: 0 })

    await recordEvent(db, end('game-cccccccc', 'finished'), facts)
    expect((await getSummary(db, filters)).totals).toMatchObject({ abandoned: 1, finished: 1, completionRate: 0.5 })
  })

  it('hides bots by default and applies country/mode/outcome filters', async () => {
    const { db } = createDb()
    await recordEvent(db, visit, facts)
    await recordEvent(db, { ...visit, sessionId: 'session-bot-0001' }, { ...facts, isBot: true, country: 'US' })
    expect((await getSummary(db, filters)).totals.sessions).toBe(1)
    expect((await getSummary(db, parseFilters(new URLSearchParams('bots=1')))).totals.sessions).toBe(2)
    expect((await getSummary(db, parseFilters(new URLSearchParams('country=US')))).totals.sessions).toBe(0)

    await recordEvent(db, start('game-eeeeeeee'), facts)
    expect((await listGames(db, parseFilters(new URLSearchParams('mode=aiVsAi')), 10, 0)).rows).toHaveLength(0)
    expect((await listGames(db, parseFilters(new URLSearchParams('outcome=in_progress')), 10, 0)).rows).toHaveLength(1)
  })

  it('purges rows older than 90 days into daily_stats without double counting', async () => {
    const { db, raw } = createDb()
    await recordEvent(db, visit, facts)
    await recordEvent(db, start('game-ffffffff'), facts)
    await recordEvent(db, end('game-ffffffff', 'finished'), facts)
    raw.exec("UPDATE sessions SET day = '2000-01-01', first_seen = '2000-01-01T00:00:00Z'")

    await purgeOld(db)
    await purgeOld(db) // a second run has nothing left to roll up

    expect(raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
    expect(raw.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({ n: 0 })
    expect(raw.prepare('SELECT * FROM daily_stats').all()).toEqual([
      expect.objectContaining({ day: '2000-01-01', country: 'BG', sessions: 1, games: 1, finished: 1, abandoned: 0 }),
    ])
  })

  it('groups byDay games by game started_at day rather than shadowing with sessions.day across multi-day tabs', async () => {
    const { db, raw } = createDb()
    await recordEvent(db, visit, facts)
    await recordEvent(db, start('game-day1-0001'), facts)
    await recordEvent(db, end('game-day1-0001', 'finished'), facts)

    const day1 = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
    const day2 = new Date().toISOString().slice(0, 10)
    raw.exec(`UPDATE sessions SET day = '${day1}', first_seen = '${day1}T16:28:00.000Z', last_seen = '${day2}T10:45:00.000Z'`)
    raw.exec(`UPDATE games SET started_at = '${day1}T16:28:00.000Z' WHERE game_id = 'game-day1-0001'`)

    await recordEvent(db, start('game-day2-0002'), facts)
    await recordEvent(db, end('game-day2-0002', 'finished'), facts)

    const summary = await getSummary(db, filters)
    expect(summary.byDay).toEqual([
      { day: day1, sessions: 1, games: 1 },
      { day: day2, sessions: 1, games: 1 },
    ])
  })

  it('fetches getSummary in a single db.batch round-trip (D14)', async () => {
    const { db } = createDb()
    await recordEvent(db, visit, facts)
    await recordEvent(db, start('game-batch-0001'), facts)
    await recordEvent(db, end('game-batch-0001', 'finished'), facts)

    const batchSpy = vi.spyOn(db, 'batch')
    const summary = await getSummary(db, filters)

    expect(batchSpy).toHaveBeenCalledTimes(1)
    expect(batchSpy.mock.calls[0]?.[0]).toHaveLength(14)
    expect(summary.totals.sessions).toBe(1)
    expect(summary.totals.games).toBe(1)
    expect(summary.byCountry).toEqual([{ key: 'BG', count: 1 }])
  })
})

