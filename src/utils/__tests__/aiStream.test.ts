import type { AiDelta, AiResponse, AiStreamBudget, AiStreamChunk, AiStreamReader } from '@/types/ai'
import {
  appendPiece,
  createSseSplitter,
  isEventStream,
  readProviderStream,
  readStreamDeltas,
} from '@/utils/aiStream'
import { describe, expect, it } from 'vitest'

/**
 * `utils/aiStream.ts` is the one place that turns a model's bytes into a sentence the player can read,
 * so every case here is something a real gateway does. Nothing in this file touches the network: the
 * response is the structural `AiResponse` the transport layer declares, fed chunk by chunk.
 */

const frame = (payload: string): string => `data: ${payload}\n\n`
/** The chunk shape a gateway sends, written once so the assertions quote it rather than retyping it. */
const payloadOf = (piece: string): string =>
  `{"choices":[{"index":0,"delta":{"content":${JSON.stringify(piece)}},"finish_reason":null}]}`
const contentFrame = (piece: string): string => frame(payloadOf(piece))

function readerOf(chunks: (string | Uint8Array)[]): AiStreamReader & { cancelled: () => boolean } {
  const bytes = chunks.map((chunk) =>
    typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
  )
  let index = 0
  let cancelled = false

  return {
    cancelled: () => cancelled,
    async read(): Promise<AiStreamChunk> {
      if (index >= bytes.length) {
        return { done: true }
      }
      const value = bytes[index]
      index += 1
      return { done: false, value }
    },
    async cancel(): Promise<void> {
      cancelled = true
    },
  }
}

function responseWith(reader: AiStreamReader): AiResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
    body: { getReader: () => reader },
    json: async () => ({}),
    text: async () => '',
  }
}

const silentBudget = (): AiStreamBudget & { firsts: number; beats: number } => {
  const budget = {
    firsts: 0,
    beats: 0,
    firstByte(): void {
      budget.firsts += 1
    },
    activity(): void {
      budget.beats += 1
    },
  }
  return budget
}

const MAX = 1024 * 1024

describe('isEventStream', () => {
  it('recognises the type with parameters and in any case, and nothing else', () => {
    expect(isEventStream('text/event-stream')).toBe(true)
    expect(isEventStream('text/event-stream; charset=utf-8')).toBe(true)
    expect(isEventStream('TEXT/EVENT-STREAM')).toBe(true)
    expect(isEventStream('application/json')).toBe(false)
    expect(isEventStream(null)).toBe(false)
  })
})

describe('createSseSplitter', () => {
  it('emits only frames that are complete, holding a partial line until its terminator lands', () => {
    const splitter = createSseSplitter()
    const whole = contentFrame('hel') + contentFrame('lo')

    // Split at an awkward spot: inside the JSON, inside the quoting, and inside the blank line.
    expect(splitter.push(whole.slice(0, 40))).toEqual([])
    const mid = splitter.push(whole.slice(40, 80))
    const rest = splitter.push(whole.slice(80))

    expect([...mid, ...rest]).toEqual([payloadOf('hel'), payloadOf('lo')])
    expect(splitter.end()).toEqual([])
  })

  it('joins a multi-line data field with newlines, as the SSE spec requires', () => {
    const splitter = createSseSplitter()
    const events = splitter.push('data: {"a":1}\ndata: {"b":2}\n\n')

    expect(events).toEqual(['{"a":1}\n{"b":2}'])
  })

  it('skips comment keep-alives and fields it does not use', () => {
    const splitter = createSseSplitter()
    expect(splitter.push(': ping\n\n')).toEqual([])
    expect(splitter.push('event: message\nid: 7\n\n')).toEqual([])
    expect(splitter.push(contentFrame('x'))).toEqual([payloadOf('x')])
  })

  it('accepts CRLF and a lone CR as line endings', () => {
    const crlf = createSseSplitter()
    expect(crlf.push('data: one\r\n\r\n')).toEqual(['one'])

    const cr = createSseSplitter()
    expect(cr.push('data: two\r\r')).toEqual(['two'])
  })

  it('flushes a final frame that arrived without its blank line', () => {
    const splitter = createSseSplitter()
    expect(splitter.push('data: tail')).toEqual([])
    expect(splitter.end()).toEqual(['tail'])
  })
})

describe('readStreamDeltas', () => {
  it('reads content and the reasoning field DashScope uses', () => {
    expect(
      readStreamDeltas('{"choices":[{"index":0,"delta":{"content":"move now"},"finish_reason":null}]}'),
    ).toEqual({ content: 'move now', reasoning: '' })
    expect(
      readStreamDeltas('{"choices":[{"index":0,"delta":{"reasoning_content":"counting"}}]}'),
    ).toEqual({ content: '', reasoning: 'counting' })
  })

  it('treats the usage frame and malformed JSON as no text', () => {
    expect(readStreamDeltas('{"choices":[],"usage":{"total_tokens":9}}')).toEqual({
      content: '',
      reasoning: '',
    })
    expect(readStreamDeltas('not json')).toEqual({ content: '', reasoning: '' })
    expect(readStreamDeltas('null')).toEqual({ content: '', reasoning: '' })
    expect(readStreamDeltas('{"error":{"message":"boom"}}')).toEqual({ content: '', reasoning: '' })
  })
})

describe('appendPiece', () => {
  it('appends an increment', () => {
    expect(appendPiece('I make', ' my point.')).toBe('I make my point.')
    expect(appendPiece('', 'start')).toBe('start')
    expect(appendPiece('same', '')).toBe('same')
  })

  it('replaces with a cumulative resend instead of doubling it', () => {
    // What a non-incremental gateway sends: every event carries the reply so far.
    expect(appendPiece('I make', 'I make my point.')).toBe('I make my point.')
  })
})

describe('readProviderStream', () => {
  it('assembles the reply and reports every cumulative step on the way', async () => {
    const chunks = [contentFrame('{"ex'), contentFrame('planation": "hi"}'), 'data: [DONE]\n\n']
    const seen: AiDelta[] = []
    const budget = silentBudget()

    const result = await readProviderStream(responseWith(readerOf(chunks)), {
      maxBytes: MAX,
      budget,
      onDelta: (delta) => seen.push(delta),
    })

    expect(result.content).toBe('{"explanation": "hi"}')
    expect(result.closed).toBe(true)
    expect(result.failed).toBe(false)
    expect(result.truncated).toBe(false)
    // Each report is the whole text so far, so a dropped frame can never lose a word.
    expect(seen.map((delta) => delta.text)).toEqual(['{"ex', '{"explanation": "hi"}'])
    expect(seen.every((delta) => delta.kind === 'explanation')).toBe(true)
  })

  it('keeps a frame that arrives in three pieces, including mid-escape', async () => {
    const one = contentFrame('I hit your blot.')
    const pieces = [one.slice(0, 21), one.slice(21, 60), one.slice(60)]

    const result = await readProviderStream(responseWith(readerOf(pieces)), {
      maxBytes: MAX,
      budget: silentBudget(),
    })

    expect(result.content).toBe('I hit your blot.')
  })

  it('separates reasoning from the reply, and does not blend them', async () => {
    const kinds: AiDelta['kind'][] = []
    const result = await readProviderStream(
      responseWith(
        readerOf([
          'data: {"choices":[{"index":0,"delta":{"reasoning_content":"counting pips"}}]}\n\n',
          'data: {"choices":[{"index":0,"delta":{"content":"the move"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
      { maxBytes: MAX, budget: silentBudget(), onDelta: (delta) => kinds.push(delta.kind) },
    )

    expect(result.reasoning).toBe('counting pips')
    expect(result.content).toBe('the move')
    expect(kinds).toEqual(['reasoning', 'explanation'])
  })

  it('hands the budgets to the caller: one first byte, then a beat per chunk', async () => {
    const budget = silentBudget()

    await readProviderStream(responseWith(readerOf([contentFrame('a'), contentFrame('b'), 'data: [DONE]\n\n'])), {
      maxBytes: MAX,
      budget,
    })

    expect(budget.firsts).toBe(1)
    expect(budget.beats).toBe(3)
  })

  it('stops at the byte cap, cancels the reader and says the reply was truncated', async () => {
    const reader = readerOf([contentFrame('a'.repeat(200)), contentFrame('b'.repeat(200))])
    const budget = silentBudget()

    const result = await readProviderStream(responseWith(reader), {
      maxBytes: 150,
      budget,
    })

    expect(result.truncated).toBe(true)
    expect(result.closed).toBe(false)
    expect(reader.cancelled()).toBe(true)
    // The cap is what protects the relay, and the client mirrors it so it stops first.
    expect(result.bytes).toBeGreaterThan(150)
  })

  it('reports a reader that dies as a failure, without inventing text', async () => {
    let reads = 0
    const reader: AiStreamReader = {
      async read(): Promise<AiStreamChunk> {
        reads += 1
        if (reads === 1) {
          return { done: false, value: new TextEncoder().encode(contentFrame('half a sent')) }
        }
        // What a real abort looks like from the inside: the pending read rejects.
        throw new DOMException('The user aborted a request.', 'AbortError')
      },
      cancel: () => undefined,
    }

    const result = await readProviderStream(responseWith(reader), { maxBytes: MAX, budget: silentBudget() })

    expect(result.failed).toBe(true)
    expect(result.closed).toBe(false)
    // Whatever did land is still returned: a complete object that parsed before the break is playable,
    // and it is `aiClient.ts` that decides, not the reader.
    expect(result.content).toContain('half a sent')
  })

  it('refuses a response with no body rather than throwing at the caller', async () => {
    const headless: AiResponse = { ...responseWith(readerOf([])), body: undefined }

    const result = await readProviderStream(headless, { maxBytes: MAX, budget: silentBudget() })

    expect(result.failed).toBe(true)
    expect(result.content).toBe('')
  })

  it('decodes a character split across two chunks without corrupting it', async () => {
    const encoded = new TextEncoder().encode(contentFrame('I built a prime — six points'))
    const first = encoded.slice(0, 90)
    const second = encoded.slice(90)

    const result = await readProviderStream(responseWith(readerOf([first, second])), {
      maxBytes: MAX,
      budget: silentBudget(),
    })

    expect(result.content).toBe('I built a prime — six points')
    expect(result.content).not.toContain('\uFFFD')
  })
})