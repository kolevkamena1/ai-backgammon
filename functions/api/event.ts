import { MAX_BODY_BYTES, hashIp, isSameOrigin, parseEvent, parseUserAgent, sanitizeLog, utcDay } from '../../shared/analytics.ts'
import { purgeOld, recordEvent, type D1Db } from '../../shared/analyticsDb.ts'

interface CfProperties {
  country?: string
  asn?: number
  asOrganization?: string
  botManagement?: { score?: number }
}

interface PagesContext {
  request: Request & { cf?: CfProperties }
  env: { DB?: D1Db; ANALYTICS_SALT?: string }
  waitUntil(promise: Promise<unknown>): void
}

const NO_CONTENT = (): Response => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })

/**
 * A refusal that is not a 204: a body over the agreed limit is not a game bug, and answering 413 says
 * so plainly while still writing nothing to D1. A real beacon is a few hundred bytes, so no genuine
 * visitor ever sees this status — `src/utils/telemetry.ts` ignores the response either way.
 */
const PAYLOAD_TOO_LARGE = (): Response =>
  new Response('Payload too large', {
    status: 413,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

/**
 * Cloudflare scores bot traffic 1-100, and 1-30 is its "definitely automated" band. Refusing only
 * that band is deliberate: it never turns away a human on a shared or corporate IP, which is what a
 * score in the 30-60 "likely automated" range would risk, and this is an analytics sink rather than
 * a payment page — a false positive costs a visitor's stats, nothing else.
 */
const BOT_REJECT_SCORE = 30

/**
 * This endpoint is an unauthenticated write path with a per-account daily D1 write quota behind it,
 * so automated traffic is refused before the body is read rather than merely flagged.
 */
const AUTOMATED_BLOCKED = (): Response =>
  new Response(JSON.stringify({ error: { code: 'automated-visitor', message: 'This endpoint does not accept automated traffic.' } }), {
    status: 403,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

/** Reused per request: `str.length` counts UTF-16 code units, and the cap is a byte cap. */
const byteEncoder = new TextEncoder()

/**
 * `POST /api/event` - the anonymous telemetry sink. Fail-soft by design: analytics must never
 * break the game, so every problem (no D1 binding, bad payload, DB error) answers 204 and the
 * visitor never notices — except an oversized body (413) and definitely-automated traffic (403),
 * neither of which is a visitor. Only the request itself is trusted for country/ASN/IP; the body
 * supplies nothing but validated, enumerated facts about the session and the game.
 *
 * `functions/api/collect.ts` re-exports this same handler as a legacy alias, so every rule here —
 * origin, bot score, size cap — applies to `POST /api/collect` automatically and identically.
 */
export const onRequestPost = async ({ request, env, waitUntil }: PagesContext): Promise<Response> => {
  const db = env.DB
  if (db === undefined) {
    console.error('[event] env.DB is not bound. Ensure D1 binding "DB" is attached in Cloudflare Pages Settings -> Functions.')
    return NO_CONTENT()
  }

  const origin = request.headers.get('origin')
  if (!isSameOrigin(origin, request.url)) {
    // Edge console used per .clinerules §3; input sanitized to prevent log injection.
    console.warn('[event] origin mismatch:', { origin: sanitizeLog(origin ?? ''), url: sanitizeLog(request.url) })
    return NO_CONTENT()
  }

  // Read from the request, never from the body, and before the body is read at all: the point is to
  // spend no D1 writes and no parsing on traffic the network has already classified as a script.
  // `cf.bot_management` is only populated where Bot Management is enabled, so `null` — no score —
  // passes. A plan without the score therefore loses nothing, and a User-Agent string (trivially
  // forged) is never a reason to refuse someone.
  const botScore = request.cf?.botManagement?.score ?? null
  if (botScore !== null && botScore < BOT_REJECT_SCORE) {
    console.warn('[event] refusing automated visitor:', {
      score: String(botScore),
      path: sanitizeLog(new URL(request.url).pathname),
    })
    return AUTOMATED_BLOCKED()
  }

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return PAYLOAD_TOO_LARGE()

  try {
    const text = await request.text()
    // Bytes, not code units: `text.length` would let a body of 4096 multi-byte characters through at
    // up to 16 KB, because the limit this function promises is a byte limit.
    if (byteEncoder.encode(text).byteLength > MAX_BODY_BYTES) return PAYLOAD_TOO_LARGE()

    const event = parseEvent(JSON.parse(text))
    if (event === null) {
      console.warn('[event] invalid event body payload')
      return NO_CONTENT()
    }

    const ua = parseUserAgent(request.headers.get('user-agent'))
    const ipHash = await hashIp(request.headers.get('cf-connecting-ip'), env.ANALYTICS_SALT, utcDay(new Date()))

    await recordEvent(db, event, {
      ipHash,
      country: request.cf?.country ?? null,
      asn: request.cf?.asn ?? null,
      asOrg: request.cf?.asOrganization ?? null,
      deviceType: ua.deviceType,
      browser: ua.browser,
      os: ua.os,
      // Anything below `BOT_REJECT_SCORE` was refused above, so a stored row is automated only if
      // its User-Agent says so. Dashboard bot counts will fall once this ships: those rows are no
      // longer written at all, which is the point.
      isBot: ua.isBot,
      botScore,
    })

    // Opportunistic retention (Pages Functions have no cron): ~1% of visits trigger the purge.
    if (event.type === 'visit' && Math.random() < 0.01) waitUntil(purgeOld(db).catch(() => undefined))
  } catch (err) {
    console.error('[event] error recording event in D1:', err)
  }

  return NO_CONTENT()
}
