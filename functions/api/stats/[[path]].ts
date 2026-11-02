import { parseFilters, toCsv } from '../../../shared/analytics.ts'
import { verifyAccessJwt, type Jwk } from '../../../shared/analyticsAuth.ts'
import { getSummary, listGames, listSessions, type D1Db } from '../../../shared/analyticsDb.ts'

interface PagesContext {
  request: Request
  env: {
    DB?: D1Db
    /** Zero Trust team domain, e.g. `myteam.cloudflareaccess.com`. */
    ACCESS_TEAM_DOMAIN?: string
    /** AUD tag of the Access application protecting `/stats*` and `/api/stats*`. */
    ACCESS_AUD?: string
    /** `1` skips the JWT check, honoured ONLY on localhost (for `wrangler pages dev`). */
    STATS_DEV_BYPASS?: string
  }
}

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' }
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

let cachedKeys: { teamDomain: string; keys: Jwk[]; fetchedAt: number } | null = null

async function loadKeys(teamDomain: string): Promise<Jwk[]> {
  if (cachedKeys !== null && cachedKeys.teamDomain === teamDomain && Date.now() - cachedKeys.fetchedAt < 3_600_000) {
    return cachedKeys.keys
  }
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!response.ok) throw new Error(`certs ${response.status}`)
  const body = (await response.json()) as { keys?: Jwk[] }
  cachedKeys = { teamDomain, keys: body.keys ?? [], fetchedAt: Date.now() }
  return cachedKeys.keys
}

async function authorised(request: Request, env: PagesContext['env']): Promise<boolean> {
  const hostname = new URL(request.url).hostname
  if (env.STATS_DEV_BYPASS === '1' && (hostname === 'localhost' || hostname === '127.0.0.1')) return true

  // Fail closed: without both settings nobody gets in, not even with a valid-looking header.
  if (env.ACCESS_TEAM_DOMAIN === undefined || env.ACCESS_AUD === undefined) return false

  try {
    const identity = await verifyAccessJwt(
      request.headers.get('cf-access-jwt-assertion'),
      { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD },
      () => loadKeys(env.ACCESS_TEAM_DOMAIN as string),
    )
    return identity !== null
  } catch {
    return false
  }
}

const clamp = (value: string | null, fallback: number, max: number): number =>
  Math.min(max, Math.max(0, Number.parseInt(value ?? '', 10) || fallback))

/** `GET /api/stats/{summary|sessions|games|export}` - admin only. */
export const onRequestGet = async ({ request, env }: PagesContext): Promise<Response> => {
  if (!(await authorised(request, env))) return json({ error: 'forbidden' }, 403)
  if (env.DB === undefined) return json({ error: 'database not configured' }, 503)

  const url = new URL(request.url)
  const route = url.pathname.replace(/^\/api\/stats\/?/, '').replace(/\/$/, '')
  const filters = parseFilters(url.searchParams)
  const limit = Math.max(1, clamp(url.searchParams.get('limit'), 50, 500))
  const offset = clamp(url.searchParams.get('offset'), 0, 1_000_000)

  switch (route) {
    case 'summary':
      return json(await getSummary(env.DB, filters))
    case 'sessions':
      return json(await listSessions(env.DB, filters, limit, offset))
    case 'games':
      return json(await listGames(env.DB, filters, limit, offset))
    case 'export': {
      const kind = url.searchParams.get('type') === 'sessions' ? 'sessions' : 'games'
      const { rows } =
        kind === 'sessions'
          ? await listSessions(env.DB, filters, 5000, 0)
          : await listGames(env.DB, filters, 5000, 0)
      return new Response(toCsv(rows as unknown as Record<string, unknown>[]), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="backgammon-${kind}.csv"`,
          'cache-control': 'no-store',
        },
      })
    }
    default:
      return json({ error: 'not found' }, 404)
  }
}

