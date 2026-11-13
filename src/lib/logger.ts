import { maskSecret, stripUrlUserinfo } from '@/utils/formatSecret'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type Context = Record<string, unknown>

/** Anything that looks like a credential is masked before it reaches the console. */
const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password)/i

const isDev = import.meta.env.DEV

function redactValue(key: string, value: unknown, seen = new WeakSet<object>()): unknown {
  if (SECRET_KEY_PATTERN.test(key)) {
    return typeof value === 'string' ? maskSecret(value) : '[redacted]'
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      return '[circular]'
    }
    seen.add(value)
    if (Array.isArray(value)) {
      return value.map((item, index) => redactValue(String(index), item, seen))
    }
    return redact(value as Context, seen)
  }
  if (typeof value === 'string') {
    return stripUrlUserinfo(value)
  }
  return value
}

/** Recursively redacts credentials and masks secret values in context objects. */
export function redact(context: Context, seen = new WeakSet<object>()): Context {
  seen.add(context)
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, redactValue(key, value, seen)]),
  )
}

function emit(level: LogLevel, message: string, context?: Context): void {
  const prefix = '[ai-backgammon]'
  const sink = console[level]
  const safeMessage = stripUrlUserinfo(message)

  if (context) {
    sink.call(console, prefix, safeMessage, redact(context))
    return
  }
  sink.call(console, prefix, safeMessage)
}

/**
 * Project-wide logger (see .clinerules: no stray `console.*` in app code).
 * `debug` is dropped from production builds; credential-shaped context is always redacted.
 */
export const logger = {
  debug: (message: string, context?: Context): void => {
    if (isDev) {
      emit('debug', message, context)
    }
  },
  info: (message: string, context?: Context): void => emit('info', message, context),
  warn: (message: string, context?: Context): void => emit('warn', message, context),
  error: (message: string, context?: Context): void => emit('error', message, context),
}
