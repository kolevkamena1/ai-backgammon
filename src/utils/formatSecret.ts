const MASK = '\u2022'

/**
 * Renders a secret for display without ever exposing the whole value — used by the settings
 * UI and by the logger's redaction pass. Only the tail is shown, which is enough for a user
 * to recognise which key they saved.
 */
export function maskSecret(secret: string, visibleChars = 4): string {
  if (secret.length === 0) {
    return ''
  }
  if (secret.length <= visibleChars) {
    return MASK.repeat(secret.length)
  }
  return MASK.repeat(visibleChars) + secret.slice(-visibleChars)
}

/**
 * Strips embedded URL userinfo (`https://user:pass@host/...` -> `https://host/...`)
 * before logging or displaying any URL or text containing URLs.
 */
export function stripUrlUserinfo(input: string): string {
  return input.replace(/\b(https?:\/\/)[^\s/@]+@(?=[^\s/]+)/gi, '$1')
}
