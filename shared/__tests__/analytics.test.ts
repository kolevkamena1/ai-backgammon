import { describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync, createSign } from 'node:crypto'
import { hashIp, isSameOrigin, parseEvent, parseFilters, parseUserAgent, sanitizeLog, toCsv } from '../analytics.ts'
import { verifyAccessJwt, verifyAccessJwtDetail, type Jwk } from '../analyticsAuth.ts'
import { onRequestGet } from '../../functions/api/stats/[[path]].ts'

const SID = 'abcdef12-3456-7890-abcd-ef1234567890'

describe('parseEvent', () => {
  it('accepts a valid game_start and rejects unknown modes', () => {
    const ok = parseEvent({ type: 'game_start', sessionId: SID, gameId: SID, mode: 'humanVsAi', matchType: null, aiProvider: 'openai' })
    expect(ok).toMatchObject({ type: 'game_start', mode: 'humanVsAi', aiProvider: 'openai' })
    expect(parseEvent({ type: 'game_start', sessionId: SID, gameId: SID, mode: 'hack' })).toBeNull()
  })

  it('rejects bad ids, unknown types and non-objects', () => {
    expect(parseEvent({ type: 'visit', sessionId: 'x' })).toBeNull()
    expect(parseEvent({ type: 'nope', sessionId: SID })).toBeNull()
    expect(parseEvent('str')).toBeNull()
    expect(parseEvent(null)).toBeNull()
  })

  it('clamps numbers, strips control characters and the query string', () => {
    const visit = parseEvent({ type: 'visit', sessionId: SID, landingPath: '/a?token=secret', utmSource: 'x\ny', viewportWidth: 99999999, referrerHost: 'Example.COM' })
    expect(visit).toMatchObject({ landingPath: '/a', utmSource: 'xy', viewportWidth: 20000, referrerHost: 'example.com' })
    // A host that is not a plain hostname (e.g. a smuggled URL) is dropped.
    expect(parseEvent({ type: 'visit', sessionId: SID, referrerHost: 'http://evil/x' })).toMatchObject({ referrerHost: null })
  })

  it('keeps only well-formed error codes', () => {
    const end = parseEvent({ type: 'game_end', sessionId: SID, gameId: SID, outcome: 'abandoned', aiErrors: { timeout: 2, 'Bad Code!': 5, network: -1 } })
    expect(end).toMatchObject({ aiErrors: { timeout: 2 } })
  })

  it('does not let a client claim an in-progress outcome', () => {
    expect(parseEvent({ type: 'game_end', sessionId: SID, gameId: SID, outcome: 'in_progress' })).toBeNull()
  })
})

describe('hashIp', () => {
  it('is stable within a day, differs across days and salts, and needs a secret', async () => {
    const a = await hashIp('203.0.113.7', 'secret', '2026-11-02')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(await hashIp('203.0.113.7', 'secret', '2026-11-02')).toBe(a)
    expect(await hashIp('203.0.113.7', 'secret', '2026-11-03')).not.toBe(a)
    expect(await hashIp('203.0.113.7', 'other', '2026-11-02')).not.toBe(a)
    expect(await hashIp('203.0.113.7', undefined, '2026-11-02')).toBeNull()
    expect(await hashIp(null, 'secret', '2026-11-02')).toBeNull()
  })
})

describe('parseUserAgent', () => {
  it('classifies browsers, devices and bots', () => {
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120')).toMatchObject({ browser: 'Edge', os: 'Windows', deviceType: 'desktop' })
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17 Mobile Safari/604')).toMatchObject({ os: 'iOS', deviceType: 'mobile' })
    expect(parseUserAgent('Googlebot/2.1')).toMatchObject({ isBot: true, deviceType: 'bot' })
    expect(parseUserAgent(null).deviceType).toBe('unknown')
  })
})

describe('misc helpers', () => {
  it('checks same-origin beacons', () => {
    expect(isSameOrigin('https://backgammon.kamenonline.com', 'https://backgammon.kamenonline.com/api/collect')).toBe(true)
    expect(isSameOrigin('https://evil.example', 'https://backgammon.kamenonline.com/api/collect')).toBe(false)
    expect(isSameOrigin(null, 'https://backgammon.kamenonline.com/api/collect')).toBe(true)
    expect(isSameOrigin('null', 'https://backgammon.kamenonline.com/api/collect')).toBe(true)
  })

  it('bounds filters', () => {
    expect(parseFilters(new URLSearchParams('days=9999&country=bg&mode=x&bots=1'))).toMatchObject({ days: 90, country: 'BG', mode: null, includeBots: true })
    expect(parseFilters(new URLSearchParams('country=bulgaria')).country).toBeNull()
  })

  it('neutralises CSV formula injection and quotes commas', () => {
    expect(toCsv([{ a: '=HYPERLINK("x")', b: 'x,y', c: null }])).toBe('a,b,c\n"\'=HYPERLINK(""x"")","x,y",')
  })
})

describe('Access JWT verification', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }), kid: 'k1' } satisfies Jwk
  const config = { teamDomain: 'team.cloudflareaccess.com', audience: 'aud123' }
  const keys = async (): Promise<Jwk[]> => [jwk]
  const now = 1_800_000_000

  const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  function sign(payload: object, header: object = { alg: 'RS256', kid: 'k1' }): string {
    const input = `${b64(header)}.${b64(payload)}`
    const signature = createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')
    return `${input}.${signature}`
  }
  const good = { aud: ['aud123'], iss: 'https://team.cloudflareaccess.com', exp: now + 600, email: 'me@example.com' }

  it('accepts a valid token and returns the email', async () => {
    expect(await verifyAccessJwt(sign(good), config, keys, now)).toEqual({ email: 'me@example.com' })
  })

  it('rejects wrong audience, issuer, expiry, algorithm and tampering', async () => {
    expect(await verifyAccessJwt(sign({ ...good, aud: ['other'] }), config, keys, now)).toBeNull()
    expect(await verifyAccessJwt(sign({ ...good, iss: 'https://evil.example' }), config, keys, now)).toBeNull()
    expect(await verifyAccessJwt(sign({ ...good, exp: now - 1 }), config, keys, now)).toBeNull()
    expect(await verifyAccessJwt(sign(good, { alg: 'none', kid: 'k1' }), config, keys, now)).toBeNull()
    const token = sign(good)
    const [h, , s] = token.split('.')
    expect(await verifyAccessJwt(`${h}.${b64({ ...good, email: 'evil@example.com' })}.${s}`, config, keys, now)).toBeNull()
    expect(await verifyAccessJwt(null, config, keys, now)).toBeNull()
    expect(await verifyAccessJwt('a.b', config, keys, now)).toBeNull()
  })

  it('rejects a token whose key id is unknown', async () => {
    expect(await verifyAccessJwt(sign(good, { alg: 'RS256', kid: 'zzz' }), config, keys, now)).toBeNull()
  })

  // The stats route reacts to `unknown_kid` by refetching the cert set, because a rotated key would
  // otherwise lock every admin out until the cache expired. That makes the structured `code` a
  // contract, not a debug string - it has to survive any rewording of the human-readable `reason`.
  it('reports a structured code for a key id the cached set does not know', async () => {
    const result = await verifyAccessJwtDetail(sign(good, { alg: 'RS256', kid: 'zzz' }), config, keys, now)

    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.code).toBe('unknown_kid')
      expect(result.reason).toContain('unknown_kid_zzz')
    }
  })

  it('reports missing_jwt_header, audience_mismatch and expiry as codes', async () => {
    const none = await verifyAccessJwtDetail(null, config, keys, now)
    expect(none.ok === false && none.code).toBe('missing_jwt_header')

    const wrongAud = await verifyAccessJwtDetail(sign({ ...good, aud: ['other'] }), config, keys, now)
    expect(wrongAud.ok === false && wrongAud.code).toBe('audience_mismatch')

    const stale = await verifyAccessJwtDetail(sign({ ...good, exp: now - 1 }), config, keys, now)
    expect(stale.ok === false && stale.code).toBe('jwt_expired')
  })

  it('hands back the identity when the token verifies', async () => {
    expect(await verifyAccessJwtDetail(sign(good), config, keys, now)).toEqual({
      ok: true,
      identity: { email: 'me@example.com' },
    })
  })

  it('passes an AbortSignal.timeout when fetching Access certs in onRequestGet (S6)', async () => {
    const validNow = Math.floor(Date.now() / 1000)
    const liveToken = sign({
      aud: ['aud123'],
      iss: 'https://s6-team.cloudflareaccess.com',
      exp: validNow + 600,
      email: 'admin@example.com',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    try {
      const req = new Request('https://backgammon.kamenonline.com/api/stats/summary', {
        headers: { 'cf-access-jwt-assertion': liveToken },
      })
      await onRequestGet({
        request: req,
        env: {
          ACCESS_TEAM_DOMAIN: 's6-team.cloudflareaccess.com',
          ACCESS_AUD: 'aud123',
        },
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        'https://s6-team.cloudflareaccess.com/cdn-cgi/access/certs',
      )
      const init = fetchSpy.mock.calls[0]?.[1]
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('sanitizeLog', () => {
  it('removes the control characters that would forge extra log lines', () => {
    expect(sanitizeLog('https://a.test\r\nFORGED: injected entry\u0000')).toBe(
      'https://a.testFORGED: injected entry',
    )
  })

  it('bounds the length so one hostile header cannot bloat the log', () => {
    expect(sanitizeLog('x'.repeat(500))).toHaveLength(100)
    expect(sanitizeLog('y'.repeat(500), 20)).toHaveLength(20)
  })

  it('leaves an ordinary value untouched', () => {
    expect(sanitizeLog('https://kamenonline.com/api/event')).toBe('https://kamenonline.com/api/event')
  })
})

