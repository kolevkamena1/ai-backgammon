import { maskSecret } from '@/utils/formatSecret'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type Context = Record<string, unknown>

/** Anything that looks like a credential is masked before it reaches the console. */
const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password)/i

const isDev = import.meta.env.DEV

function redactValue(key: string, value: unknown): unknown {
  if (!SECRET_KEY_PATTERN.test(key)) {
    return value
  }
  return typeof value === 'string' ? maskSecret(value) : '[redacted]'
}

function redact(context: Context): Context {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, redactValue(key, value)]),
  )
}

function emit(level: LogLevel, message: string, context?: Context): void {
  const prefix = '[ai-backgammon]'
  const sink = console[level]

  if (context) {
    sink.call(console, prefix, message, redact(context))
    return
  }
  sink.call(console, prefix, message)
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
