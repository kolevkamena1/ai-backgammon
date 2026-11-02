/**
 * Cloudflare Access verification, defence in depth.
 *
 * The Access policy on `/stats*` and `/api/stats*` is the front door; this module is the second
 * lock. Access forwards a signed JWT in `Cf-Access-Jwt-Assertion`, and the stats API refuses to
 * answer unless that token verifies (RS256 signature, issuer, audience, expiry) - so a policy that
 * is later deleted or misconfigured fails closed instead of exposing visitor data.
 */

export interface AccessConfig {
  /** e.g. `myteam.cloudflareaccess.com` */
  teamDomain: string
  /** The Access application's AUD tag. */
  audience: string
}

export interface Jwk {
  kid: string
  kty: string
  n: string
  e: string
  alg?: string
}

export interface AccessIdentity {
  email: string | null
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)))
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function cleanTeamDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/+$/, '').trim()
}

export type VerifyResult =
  | { ok: true; identity: AccessIdentity }
  | { ok: false; reason: string }

export async function verifyAccessJwtDetail(
  token: string | null,
  config: AccessConfig,
  getKeys: () => Promise<Jwk[]>,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (token === null || token === '') {
    return {
      ok: false,
      reason: 'missing_jwt_header (Request has no Cf-Access-Jwt-Assertion. Ensure your Cloudflare Access application path includes both /stats* and /api/stats*)',
    }
  }
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed_jwt_token' }

  const header = decodeJson(parts[0])
  const payload = decodeJson(parts[1])
  if (header === null || payload === null) return { ok: false, reason: 'malformed_jwt_payload' }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: `unsupported_algorithm_${String(header.alg)}` }

  const team = cleanTeamDomain(config.teamDomain)
  const aud = config.audience.trim()

  const audience = payload.aud
  const audiences = Array.isArray(audience) ? audience : [audience]
  if (!audiences.includes(aud)) {
    return {
      ok: false,
      reason: `audience_mismatch (Expected ${aud.slice(0, 10)}..., but token has ${audiences.map((a) => typeof a === 'string' ? a.slice(0, 10) + '...' : String(a)).join(', ')}. Check ACCESS_AUD variable.)`,
    }
  }
  if (payload.iss !== `https://${team}`) {
    return {
      ok: false,
      reason: `issuer_mismatch (Expected https://${team}, but token issuer is ${String(payload.iss)}. Check ACCESS_TEAM_DOMAIN variable.)`,
    }
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    return { ok: false, reason: 'jwt_expired' }
  }
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds + 60) {
    return { ok: false, reason: 'jwt_not_yet_valid' }
  }

  const keys = await getKeys()
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA')
  if (jwk === undefined) return { ok: false, reason: `unknown_kid_${header.kid}` }

  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )
    if (!valid) return { ok: false, reason: 'invalid_signature' }
    return { ok: true, identity: { email: typeof payload.email === 'string' ? payload.email : null } }
  } catch (err) {
    return { ok: false, reason: `verification_exception: ${err instanceof Error ? err.message : 'unknown'}` }
  }
}

export async function verifyAccessJwt(
  token: string | null,
  config: AccessConfig,
  getKeys: () => Promise<Jwk[]>,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<AccessIdentity | null> {
  const result = await verifyAccessJwtDetail(token, config, getKeys, nowSeconds)
  return result.ok ? result.identity : null
}

