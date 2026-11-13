import { parseFilters, sanitizeLog, toCsv } from '../../../shared/analytics.ts'
import { cleanTeamDomain, verifyAccessJwtDetail, type AccessIdentity, type Jwk, type VerifyResult } from '../../../shared/analyticsAuth.ts'
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

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

/** How long a fetched key set is trusted. Access rotates its signing keys periodically. */
const CERT_TTL_MS = 3_600_000
/** Upper bound on a single JWKS cert fetch so a hung Access endpoint cannot stall the worker. */
const CERT_FETCH_TIMEOUT_MS = 5_000

/**
 * Minimum spacing between forced re-fetches. Without it, anyone presenting a token with a made-up
 * `kid` could make every request hammer the team's certs endpoint; this bounds that to one refetch a
 * minute per isolate. `lastForcedRefreshAt` is stamped before the await, so two concurrent requests
 * in one isolate cannot both trigger a refresh.
 */
const FORCED_REFRESH_MIN_INTERVAL_MS = 60_000

let cachedKeys: { teamDomain: string; keys: Jwk[]; fetchedAt: number } | null = null
let lastForcedRefreshAt = 0

async function loadKeys(rawTeamDomain: string, forceRefresh = false): Promise<Jwk[]> {
  const teamDomain = cleanTeamDomain(rawTeamDomain)
  if (
    !forceRefresh &&
    cachedKeys !== null &&
    cachedKeys.teamDomain === teamDomain &&
    Date.now() - cachedKeys.fetchedAt < CERT_TTL_MS
  ) {
    return cachedKeys.keys
  }
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(CERT_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`certs ${response.status}`)
  const body = (await response.json()) as { keys?: Jwk[] }
  cachedKeys = { teamDomain, keys: body.keys ?? [], fetchedAt: Date.now() }
  return cachedKeys.keys
}

/**
 * `403` means this caller is not who they claim. `503` means we could not tell either way, because
 * the key set could not be fetched — our outage, not their failure, and it must not be reported as a
 * permission problem (or thrown, which Pages would turn into an opaque 1101 with no diagnostic).
 */
type AuthOutcome =
  | { ok: true; identity?: AccessIdentity }
  | { ok: false; status: 403; reason: string }
  | { ok: false; status: 503; reason: string }

async function checkAuth(request: Request, env: PagesContext['env']): Promise<AuthOutcome> {
  const hostname = new URL(request.url).hostname
  if (env.STATS_DEV_BYPASS === '1' && (hostname === 'localhost' || hostname === '127.0.0.1')) return { ok: true }

  // Fail closed: without both settings nobody gets in, not even with a valid-looking header.
  const teamDomain = env.ACCESS_TEAM_DOMAIN
  const audience = env.ACCESS_AUD
  if (!teamDomain || !audience) {
    const missing: string[] = []
    if (!teamDomain) missing.push('ACCESS_TEAM_DOMAIN')
    if (!audience) missing.push('ACCESS_AUD')
    return {
      ok: false,
      status: 403,
      reason: `missing_configuration (${missing.join(' and ')} not set in Cloudflare Pages Environment variables or wrangler.toml)`,
    }
  }

  const token = request.headers.get('cf-access-jwt-assertion')
  const config = { teamDomain, audience }

  const verify = async (forceRefresh: boolean): Promise<VerifyResult | null> => {
    try {
      return await verifyAccessJwtDetail(token, config, () => loadKeys(teamDomain, forceRefresh))
    } catch (error) {
      console.error('[stats] could not fetch Access certs:', { error: sanitizeLog(String(error), 200) })
      return null
    }
  }

  const first = await verify(false)
  if (first === null) return { ok: false, status: 503, reason: 'jwks_unavailable' }
  if (first.ok) return { ok: true, identity: first.identity }

  // A cached key set that no longer contains the token's `kid` is almost always a rotation, not an
  // attack: the stale set would otherwise lock every admin out for up to CERT_TTL_MS while the reason
  // string blamed the token. Refetch once and re-verify before refusing. Keyed on the structured
  // `code`, never on the human-readable `reason`, which is free to be reworded.
  if (first.code === 'unknown_kid') {
    const now = Date.now()
    if (now - lastForcedRefreshAt > FORCED_REFRESH_MIN_INTERVAL_MS) {
      lastForcedRefreshAt = now
      cachedKeys = null

      const retried = await verify(true)
      if (retried === null) return { ok: false, status: 503, reason: 'jwks_unavailable' }
      if (retried.ok) return { ok: true, identity: retried.identity }

      return { ok: false, status: 403, reason: retried.reason }
    }
  }

  return { ok: false, status: 403, reason: first.reason }
}

const clamp = (value: string | null, fallback: number, max: number): number =>
  Math.min(max, Math.max(0, Number.parseInt(value ?? '', 10) || fallback))

/** `GET /api/stats/{summary|sessions|games|export}` - admin only. */
export const onRequestGet = async ({ request, env }: PagesContext): Promise<Response> => {
  const auth = await checkAuth(request, env)
  if (!auth.ok) {
    // The detailed reason goes to the edge log, never to the client. This body is readable by exactly
    // the people the Access policy was meant to keep out, and the reasons name unset environment
    // variables, AUD prefixes and the team domain — a configuration oracle for anyone probing us.
    // `auth.reason` also interpolates attacker-controlled JWT fields (`kid`, `iss`), so it passes
    // through `sanitizeLog` before reaching the log.
    console.error('[stats] access denied:', { status: auth.status, reason: sanitizeLog(auth.reason, 200) })
    // Two different failures must not share one body: `jwks_unavailable` means the dashboard could not
    // check its own issuer and should be retried shortly, while `insufficient_permissions` means the
    // operator has an Access or environment-variable problem to fix.
    return auth.status === 503
      ? json({ error: 'jwks_unavailable' }, 503)
      : json({ error: 'forbidden', reason: 'insufficient_permissions' }, 403)
  }
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
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        },
      })
    }
    default:
      return json({ error: 'not found' }, 404)
  }
}

