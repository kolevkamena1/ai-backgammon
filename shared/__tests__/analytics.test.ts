import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, createSign } from 'node:crypto'
import { hashIp, isSameOrigin, parseEvent, parseFilters, parseUserAgent, toCsv } from '../analytics.ts'
import { verifyAccessJwt, type Jwk } from '../analyticsAuth.ts'

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
    expect(isSameOrigin('https://backgamm.kamenonline.com', 'https://backgamm.kamenonline.com/api/collect')).toBe(true)
    expect(isSameOrigin('https://evil.example', 'https://backgamm.kamenonline.com/api/collect')).toBe(false)
    expect(isSameOrigin(null, 'https://backgamm.kamenonline.com/api/collect')).toBe(true)
  })

  it('bounds filters', () => {
    expect(parseFilters(new URLSearchParams('days=9999&country=bg&mode=x&bots=1'))).toMatchObject({ days: 90, country: 'BG', mode: null, includeBots: true })
    expect(parseFilters(new URLSearchParams('country=bulgaria')).country).toBeNull()
  })

  it('neutralises CSV formula injection and quotes commas', () => {
    expect(toCsv([{ a: '=HYPERLINK("x")', b: 'x,y', c: null }])).toBe('a,b,c\n"\'=HYPERLINK(""x"")","x,y",')
  })
})

describe('verifyAccessJwt', () => {
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
})

