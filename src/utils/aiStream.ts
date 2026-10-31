import type { AiDelta, AiResponse, AiStreamBudget } from '@/types/ai'
import { logger } from '@/lib/logger'

/**
 * Reading an OpenAI-compatible streaming reply. Kept apart from `aiClient.ts` because this half is
 * pure text plumbing — no fetch, no providers, no game rules — and because every tricky line in here
 * is a boundary case a real model produces and a mocked one does not: an SSE frame split across two
 * network chunks, a multi-line `data:`, a comment keep-alive, a usage event with no choices, and a
 * gateway that resends the whole reply instead of the increment.
 *
 * Nothing in this file decides whether a move plays. It hands back text; `aiClient.ts` parses that
 * with the same lenient parser the buffered path uses and validates it against the legal menu, so a
 * truncated or malformed stream fails the turn instead of playing half an answer.
 */

const DONE_SENTINEL = '[DONE]'
/** Content types that mean "the body is a series of SSE frames". Checked, never assumed. */
const EVENT_STREAM = 'text/event-stream'

export function isEventStream(contentType: string | null): boolean {
  return contentType !== null && contentType.toLowerCase().includes(EVENT_STREAM)
}

/**
 * Splits an incoming byte stream into SSE `data` payloads. Fed arbitrary text slices; emits complete
 * events only, holding a partial line back until its terminator arrives.
 */
export interface SseSplitter {
  /** Text decoded from one chunk; returns the event payloads that became complete. */
  push(text: string): string[]
  /** Stream ended: flushes a final event that was not followed by a blank line. */
  end(): string[]
}

function takeField(line: string): { field: string; value: string } | null {
  const colon = line.indexOf(':')

  if (colon === -1) {
    // A line with no colon is a field name with an empty value, per the SSE spec.
    return line.length === 0 ? null : { field: line, value: '' }
  }

  const field = line.slice(0, colon)
  const rawValue = line.slice(colon + 1)

  return { field, value: rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue }
}

export function createSseSplitter(): SseSplitter {
  let pending = ''
  let dataLines: string[] = []

  const flushEvent = (out: string[]): void => {
    if (dataLines.length === 0) {
      return
    }
    out.push(dataLines.join('\n'))
    dataLines = []
  }

  const consume = (text: string, out: string[]): void => {
    pending += text

    for (;;) {
      // One terminator at a time, never a run of them: in SSE the blank line IS the event boundary, so
      // collapsing `\n\n` into a single separator would swallow every event boundary in the stream.
      const match = /\r\n|\r|\n/.exec(pending)

      if (match === null || match.index === undefined) {
        return
      }

      const line = pending.slice(0, match.index)
      pending = pending.slice(match.index + match[0].length)

      if (line.length === 0) {
        flushEvent(out)
        continue
      }
      if (line.startsWith(':')) {
        continue
      }

      const parsed = takeField(line)
      if (parsed !== null && parsed.field === 'data') {
        dataLines.push(parsed.value)
      }
    }
  }

  return {
    push(text: string): string[] {
      const out: string[] = []
      consume(text, out)
      return out
    },
    end(): string[] {
      const out: string[] = []
      if (pending.length > 0) {
        const trailing = pending
        pending = ''
        consume(`${trailing}\n`, out)
      }
      flushEvent(out)
      return out
    },
  }
}

/** The two text fields a streamed chat chunk can carry. Anything else in the chunk is ignored. */
export interface StreamDeltas {
  content: string
  reasoning: string
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * One SSE payload to its text deltas. Malformed JSON reads as empty: a chunk we cannot interpret is
 * not worth failing a turn over, because the assembled reply is validated as a whole at the end.
 */
export function readStreamDeltas(payload: string): StreamDeltas {
  const empty: StreamDeltas = { content: '', reasoning: '' }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return empty
  }

  const root = asRecord(parsed)
  if (root === null) {
    return empty
  }

  const choices = root.choices
  const first = Array.isArray(choices) ? asRecord(choices[0]) : null
  const delta = asRecord(first?.delta)

  // The final `include_usage` chunk carries `choices: []`, and DashScope's closing chunk carries an
  // empty delta. Both are normal, and neither has text in it.
  return {
    content: readText(delta?.content),
    reasoning: readText(delta?.reasoning_content),
  }
}

/**
 * Append, tolerating a gateway that streams cumulatively instead of incrementally.
 *
 * `incremental_output` is a DashScope-native parameter and is not part of the OpenAI contract, so some
 * OpenAI-compatible servers resend the whole reply in every event. Plain concatenation would show the
 * sentence twice; if the new text starts with everything already collected, the longer string is the
 * right answer in both readings.
 */
export function appendPiece(accumulated: string, piece: string): string {
  if (piece.length === 0) {
    return accumulated
  }
  if (accumulated.length > 0 && piece.startsWith(accumulated)) {
    return piece
  }
  return accumulated + piece
}

export interface StreamReadResult {
  content: string
  reasoning: string
  bytes: number
  /** The byte cap cut the body off. The caller must not treat the text as complete. */
  truncated: boolean
  /** The reader threw: aborted by a timeout or by the player, or the connection broke. */
  failed: boolean
  /** `[DONE]` arrived, or the body ended cleanly. */
  closed: boolean
}

/**
 * Drain a streamed response into reply text, reporting progress as it arrives.
 *
 * `budget` is what keeps a stream honest: the caller's connect timer is retired here on the first byte
 * and the idle timer restarts on every chunk, so a model that answers slowly but continuously is never
 * mistaken for one that has stopped.
 */
export async function readProviderStream(
  response: AiResponse,
  args: { maxBytes: number; budget: AiStreamBudget; onDelta?: (delta: AiDelta) => void },
): Promise<StreamReadResult> {
  const body = response.body
  const result: StreamReadResult = {
    content: '',
    reasoning: '',
    bytes: 0,
    truncated: false,
    failed: false,
    closed: false,
  }

  if (body === undefined || body === null) {
    return { ...result, failed: true }
  }

  const reader = body.getReader()
  const splitter = createSseSplitter()
  // `stream: true` stops a multi-byte character split across two chunks from becoming U+FFFD.
  const decoder = new TextDecoder('utf-8')
  let sawFirstByte = false

  const handlePayload = (payload: string): boolean => {
    if (payload.trim() === DONE_SENTINEL) {
      return true
    }

    const deltas = readStreamDeltas(payload)
    const contentBefore = result.content
    const reasoningBefore = result.reasoning

    result.content = appendPiece(result.content, deltas.content)
    result.reasoning = appendPiece(result.reasoning, deltas.reasoning)

    if (result.reasoning !== reasoningBefore) {
      args.onDelta?.({ kind: 'reasoning', text: result.reasoning })
    }
    if (result.content !== contentBefore) {
      args.onDelta?.({ kind: 'explanation', text: result.content })
    }

    return false
  }

  for (;;) {
    let chunk
    try {
      chunk = await reader.read()
    } catch {
      // An abort surfaces as a rejection here. `aiClient.ts` already knows whether it was a timeout,
      // so there is nothing to add to the message; the turn just has to stop pretending it can read.
      result.failed = true
      break
    }

    if (chunk.done === true) {
      result.closed = true
      break
    }

    result.bytes += chunk.value?.byteLength ?? 0

    if (!sawFirstByte) {
      sawFirstByte = true
      args.budget.firstByte()
    }
    args.budget.activity()

    if (result.bytes > args.maxBytes) {
      result.truncated = true
      try {
        await reader.cancel('stream over the client limit')
      } catch {
        // A reader that refuses to be cancelled is not worth another failure path: the loop breaks.
      }
      break
    }

    const text = decoder.decode(chunk.value ?? new Uint8Array(0), { stream: true })
    for (const payload of splitter.push(text)) {
      if (handlePayload(payload)) {
        result.closed = true
      }
    }

    if (result.closed) {
      break
    }
  }

  // Only a clean end has anything left to flush: after an abort or a truncation the tail is either
  // unknowable or deliberately discarded, and re-parsing it would invent text the model never sent.
  if (result.closed && !result.failed && !result.truncated) {
    for (const payload of splitter.end()) {
      handlePayload(payload)
    }
  }

  logger.debug('streamed provider reply', {
    bytes: String(result.bytes),
    content: String(result.content.length),
    reasoning: String(result.reasoning.length),
    truncated: String(result.truncated),
    failed: String(result.failed),
  })

  return result
}