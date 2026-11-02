import { MAX_BODY_BYTES, hashIp, isSameOrigin, parseEvent, parseUserAgent, utcDay } from '../../shared/analytics.ts'
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
 * `POST /api/collect` - the anonymous telemetry sink. Fail-soft by design: analytics must never
 * break the game, so every problem (no D1 binding, bad payload, DB error) answers 204 and the
 * visitor never notices. Only the request itself is trusted for country/ASN/IP; the body supplies
 * nothing but validated, enumerated facts about the session and the game.
 */
export const onRequestPost = async ({ request, env, waitUntil }: PagesContext): Promise<Response> => {
  const db = env.DB
  if (db === undefined) {
    console.error('[collect] env.DB is not bound. Ensure D1 binding "DB" is attached in Cloudflare Pages Settings -> Functions.')
    return NO_CONTENT()
  }

  const origin = request.headers.get('origin')
  if (!isSameOrigin(origin, request.url)) {
    console.warn('[collect] origin mismatch:', { origin, url: request.url })
    return NO_CONTENT()
  }

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return NO_CONTENT()

  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return NO_CONTENT()

    const event = parseEvent(JSON.parse(text))
    if (event === null) {
      console.warn('[collect] invalid event body payload')
      return NO_CONTENT()
    }

    const ua = parseUserAgent(request.headers.get('user-agent'))
    const botScore = request.cf?.botManagement?.score ?? null
    const ipHash = await hashIp(request.headers.get('cf-connecting-ip'), env.ANALYTICS_SALT, utcDay(new Date()))

    await recordEvent(db, event, {
      ipHash,
      country: request.cf?.country ?? null,
      asn: request.cf?.asn ?? null,
      asOrg: request.cf?.asOrganization ?? null,
      deviceType: ua.deviceType,
      browser: ua.browser,
      os: ua.os,
      isBot: ua.isBot || (botScore !== null && botScore < 30),
      botScore,
    })

    // Opportunistic retention (Pages Functions have no cron): ~1% of visits trigger the purge.
    if (event.type === 'visit' && Math.random() < 0.01) waitUntil(purgeOld(db).catch(() => undefined))
  } catch (err) {
    console.error('[collect] error recording event in D1:', err)
  }

  return NO_CONTENT()
}

