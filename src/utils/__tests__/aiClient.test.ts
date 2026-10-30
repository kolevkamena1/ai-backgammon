import type { AiCallOptions, AiRequestInit, AiResponse, FetchLike } from '@/types/ai'
import type { AiEngineConfig } from '@/types/settings'
import type { BoardState, PlayerColor } from '@/types/game'
import {
  AI_PROXY_PATH,
  AI_TIMEOUT_MS,
  DEFAULT_MODELS,
  extractJsonObject,
  getAiMove,
  isTransient,
  mapHttpError,
  normalizeBaseUrl,
  parseAiMove,
} from '@/utils/aiClient'
// The policies live outside `src` deliberately, but the ordering of the two timeout budgets is a
// contract between the layers, so it is asserted here rather than only restated in a comment.
import { DEV_POLICY, PRODUCTION_POLICY } from '../../../shared/aiProxy.ts'
import { getInitialBoardState, getLegalMoves } from '@/utils/gameLogic'
import { describe, expect, it } from 'vitest'

const KEY = 'sk-test-1234'
const PLAYING: BoardState = { ...getInitialBoardState(), dice: [5], phase: 'playing' }

const engine = (overrides: Partial<AiEngineConfig> = {}): AiEngineConfig => ({
  provider: 'openai',
  apiKey: KEY,
  model: '',
  baseUrl: '',
  ...overrides,
})

interface Recorded {
  url: string
  init: AiRequestInit
}

/**
 * Every provider call is wrapped in an envelope for the relay, so assertions read the inner request
 * rather than the transport: `url` is always `/api/ai-proxy`, and the provider's own URL, headers
 * and body live inside `init.body`.
 */
interface ProxyEnvelope {
  targetUrl: string
  headers: Record<string, string>
  body: string
}

const envelopeOf = (call: Recorded): ProxyEnvelope => JSON.parse(call.init.body) as ProxyEnvelope
const targetOf = (call: Recorded): string => envelopeOf(call).targetUrl
const innerBody = (call: Recorded): unknown => JSON.parse(envelopeOf(call).body) as unknown

function fakeResponse(input: {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  notJson?: boolean
}): AiResponse {
  const status = input.status ?? 200

  return {
    ok: status < 400,
    status,
    headers: { get: (name: string) => input.headers?.[name.toLowerCase()] ?? null },
    json: async () => {
      if (input.notJson || input.body === undefined) {
        throw new Error('body not json')
      }
      return input.body
    },
    text: async () => (typeof input.body === 'string' ? input.body : JSON.stringify(input.body ?? '')),
  }
}

function recorder(respond: (call: Recorded, index: number) => AiResponse | Promise<AiResponse>) {
  const calls: Recorded[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const record = { url, init }
    const index = calls.length
    calls.push(record)
    return respond(record, index)
  }

  return { calls, fetchImpl }
}

const chatReply = (content: string): unknown => ({ choices: [{ message: { content } }] })

const ask = async (
  overrides: Partial<AiEngineConfig> = {},
  board: BoardState = PLAYING,
  player: PlayerColor = 'light',
  respond: (call: Recorded, index: number) => AiResponse | Promise<AiResponse> = () =>
    fakeResponse({ body: chatReply('{"choice": 1}') }),
  options: AiCallOptions = {},
) => {
  const spy = recorder(respond)
  const result = await getAiMove(engine(overrides), board, player, { fetchImpl: spy.fetchImpl, ...options })
  return { result, calls: spy.calls }
}

describe('normalizeBaseUrl', () => {
  it('adds /v1 to a bare host and keeps versioned URLs intact', () => {
    expect(normalizeBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1')
    expect(normalizeBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434/v1')
    expect(normalizeBaseUrl('  https://gateway.local/v1  ')).toBe('https://gateway.local/v1')
    expect(normalizeBaseUrl('https://gateway.local/v1/chat/completions')).toBe('https://gateway.local/v1')
    expect(normalizeBaseUrl('https://x.example/api/v9')).toBe('https://x.example/api/v9')
    expect(normalizeBaseUrl('')).toBe('')
  })
})

describe('mapHttpError', () => {
  it('maps the statuses that matter to an actionable code', () => {
    expect(mapHttpError(401).code).toBe('unauthorized')
    expect(mapHttpError(403).code).toBe('forbidden')
    expect(mapHttpError(404).code).toBe('not-found')
    expect(mapHttpError(429).code).toBe('rate-limited')
    expect(mapHttpError(500).code).toBe('server-error')
    expect(mapHttpError(503).code).toBe('server-error')
    expect(mapHttpError(418).code).toBe('bad-response')
    expect(mapHttpError(401).error).toContain('Invalid API key')
  })

  it('treats only provider-availability failures as retryable', () => {
    expect(isTransient('rate-limited')).toBe(true)
    expect(isTransient('server-error')).toBe(true)
    expect(isTransient('network')).toBe(true)
    expect(isTransient('timeout')).toBe(true)
    expect(isTransient('unauthorized')).toBe(false)
    expect(isTransient('illegal-move')).toBe(false)
    expect(isTransient('missing-key')).toBe(false)
  })
})

describe('getAiMove pre-flight guards', () => {
  it('refuses to send anything when the key is missing', async () => {
    const { result, calls } = await ask({ apiKey: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('missing-key')
      expect(result.error).toBe('An API key is required.')
    }
    expect(calls).toHaveLength(0)
  })

  it('requires a base URL for a custom endpoint and a model for it', async () => {
    const noUrl = await ask({ provider: 'custom' })
    expect(noUrl.result.success).toBe(false)
    if (!noUrl.result.success) {
      expect(noUrl.result.code).toBe('missing-endpoint')
    }
    expect(noUrl.calls).toHaveLength(0)

    const noModel = await ask({ provider: 'custom', baseUrl: 'http://localhost:11434' })
    expect(noModel.result.success).toBe(false)
    if (!noModel.result.success) {
      expect(noModel.result.code).toBe('missing-model')
    }
    expect(noModel.calls).toHaveLength(0)
  })

  it('refuses a finished game, the wrong colour and an empty menu', async () => {
    const finished = await ask({}, { ...PLAYING, phase: 'finished', winner: 'light' })
    expect(finished.result.success).toBe(false)
    if (!finished.result.success) {
      expect(finished.result.code).toBe('aborted')
    }

    const wrongTurn = await ask({}, PLAYING, 'dark')
    expect(wrongTurn.result.success).toBe(false)
    if (!wrongTurn.result.success) {
      expect(wrongTurn.result.code).toBe('illegal-move')
    }

    const noDice = await ask({}, { ...PLAYING, dice: [] })
    expect(noDice.result.success).toBe(false)
    expect(noDice.calls).toHaveLength(0)
  })
})

describe('provider routing', () => {
  it('calls OpenAI with a bearer key, the default model and JSON mode', async () => {
    const { calls } = await ask({ provider: 'openai' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(AI_PROXY_PATH)
    expect(targetOf(calls[0])).toBe('https://api.openai.com/v1/chat/completions')
    expect(envelopeOf(calls[0]).headers.authorization).toBe(`Bearer ${KEY}`)

    const body = innerBody(calls[0]) as Record<string, unknown>
    expect(body.model).toBe(DEFAULT_MODELS.openai)
    expect(body.temperature).toBe(0)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect((body.messages as Array<{ role: string; content: string }>)[0].content).toContain('playing White')
  })

  it('never sends an OpenAI key to the custom base URL', async () => {
    const { calls } = await ask({ provider: 'openai', baseUrl: 'http://attacker.example/v1' })
    // The relay is told to reach the built-in host, so the envelope says the same thing the
    // pre-proxy client would have: an attacker-controlled base URL is never named.
    expect(calls[0].url).toBe(AI_PROXY_PATH)
    expect(targetOf(calls[0])).toBe('https://api.openai.com/v1/chat/completions')
    expect(calls[0].init.body).not.toContain('attacker.example')
  })

  it('calls Anthropic with the version, key and browser-access headers', async () => {
    const { calls } = await ask(
      { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
      PLAYING,
      'light',
      () => fakeResponse({ body: { content: [{ type: 'text', text: '{"choice": 2}' }] } }),
    )

    expect(targetOf(calls[0])).toBe('https://api.anthropic.com/v1/messages')
    expect(envelopeOf(calls[0]).headers['x-api-key']).toBe(KEY)
    expect(envelopeOf(calls[0]).headers['anthropic-version']).toBe('2023-06-01')
    expect(envelopeOf(calls[0]).headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(envelopeOf(calls[0]).headers.authorization).toBeUndefined()

    const body = innerBody(calls[0]) as Record<string, unknown>
    expect(typeof body.system).toBe('string')
    expect(body.messages).toHaveLength(1)
  })

  it('calls Google with the model in the path and the key in a header', async () => {
    const { calls } = await ask(
      { provider: 'google' },
      PLAYING,
      'light',
      () => fakeResponse({ body: { candidates: [{ content: { parts: [{ text: '{"choice": 1}' }] } }] } }),
    )

    expect(calls[0].url).toBe(AI_PROXY_PATH)
    expect(targetOf(calls[0])).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODELS.google}:generateContent`,
    )
    expect(envelopeOf(calls[0]).headers['x-goog-api-key']).toBe(KEY)

    const body = innerBody(calls[0]) as Record<string, unknown>
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0 })
    expect(body.systemInstruction).toBeDefined()
  })

  it('calls a custom gateway on the normalised URL and omits response_format', async () => {
    const { calls } = await ask({ provider: 'custom', baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    expect(targetOf(calls[0])).toBe('http://localhost:11434/v1/chat/completions')

    const body = innerBody(calls[0]) as Record<string, unknown>
    expect(body.model).toBe('qwen2.5:7b')
    expect(body.response_format).toBeUndefined()
  })

  it('turns thinking off for DashScope, whose Qwen3 models otherwise reason for a minute', async () => {
    const { calls } = await ask({
      provider: 'custom',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    })

    expect(targetOf(calls[0])).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions')

    const body = innerBody(calls[0]) as Record<string, unknown>
    expect(body.enable_thinking).toBe(false)
    // Pinned as a literal: 220 was spendable entirely on reasoning_content, leaving no move to parse.
    expect(body.max_tokens).toBe(2048)
  })

  it('still accepts the newer workspace hosts', async () => {
    const { calls } = await ask({
      provider: 'custom',
      baseUrl: 'https://llm-demo.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    })

    expect((innerBody(calls[0]) as Record<string, unknown>).enable_thinking).toBe(false)
  })

  it('withholds the non-standard thinking flag from OpenAI and from other custom gateways', async () => {
    const openai = await ask({ provider: 'openai' })
    expect((innerBody(openai.calls[0]) as Record<string, unknown>).enable_thinking).toBeUndefined()

    // Ollama, vLLM and LM Studio reject unknown fields the same way they reject response_format.
    const ollama = await ask({ provider: 'custom', baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })
    expect((innerBody(ollama.calls[0]) as Record<string, unknown>).enable_thinking).toBeUndefined()
  })

  it('does not mistake a look-alike host for DashScope', async () => {
    const { calls } = await ask({ provider: 'custom', baseUrl: 'https://aliyuncs.com.attacker.test/v1', model: 'm' })
    expect((innerBody(calls[0]) as Record<string, unknown>).enable_thinking).toBeUndefined()
  })

  it('puts the legal menu in the user prompt', async () => {
    const { calls } = await ask()
    const body = innerBody(calls[0]) as { messages: Array<{ content: string }> }
    const legal = getLegalMoves(PLAYING, 'light', PLAYING.dice)

    expect(body.messages[1].content).toContain('Legal moves - pick exactly one')
    legal.forEach((move, index) => {
      expect(body.messages[1].content).toContain(`${index + 1}.`)
      expect(body.messages[1].content).toContain(`using die ${move.die}`)
    })
    expect(body.messages[1].content).not.toContain(KEY)
  })
})

describe('reply parsing', () => {
  const legal = getLegalMoves(PLAYING, 'light', PLAYING.dice)
  const replyWith = (content: string) => () => fakeResponse({ body: chatReply(content) })

  it('accepts the strict move object', async () => {
    const { result } = await ask({}, PLAYING, 'light', replyWith('{"from": 13, "to": 8, "die": 5}'))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.move).toEqual({ from: 13, to: 8, die: 5 })
    }
  })

  it('accepts fenced and prose-wrapped JSON', async () => {
    const fenced = await ask({}, PLAYING, 'light', replyWith('```json\n{"choice": 1}\n```'))
    expect(fenced.result.success).toBe(true)

    const prose = await ask({}, PLAYING, 'light', replyWith('Thinking here. {"choice": 2}. That is best.'))
    expect(prose.result.success).toBe(true)
    if (prose.result.success) {
      expect(prose.result.move).toEqual(legal[1])
    }
  })

  it('coerces stringified numbers', async () => {
    const { result } = await ask({}, PLAYING, 'light', replyWith('{"from": "13", "to": "8", "die": "5"}'))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.move).toEqual({ from: 13, to: 8, die: 5 })
    }
  })

  it('maps a 1-based choice onto the menu', async () => {
    const { result } = await ask({}, PLAYING, 'light', replyWith('{"choice": 2}'))
    expect(legal.length).toBe(2)
    if (result.success) {
      expect(result.move).toEqual(legal[1])
      expect(result.choice).toBe(2)
    } else {
      throw new Error(result.error)
    }
  })

  it('rejects an out-of-range choice', async () => {
    const { result } = await ask({}, PLAYING, 'light', replyWith('{"choice": 99}'))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('illegal-move')
    }
  })

  it('rejects a move that is not in the menu, without leaking the key', async () => {
    const { result } = await ask({}, PLAYING, 'light', replyWith('{"from": 13, "to": 2, "die": 5}'))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('illegal-move')
      expect(result.error).not.toContain(KEY)
    }
  })

  it('separates "not JSON" from "illegal move"', async () => {
    const prose = await ask({}, PLAYING, 'light', replyWith('I would rather pass this turn.'))
    expect(prose.result.success).toBe(false)
    if (!prose.result.success) {
      expect(prose.result.code).toBe('bad-response')
    }
  })

  it('reads a bar re-entry', async () => {
    const barred: BoardState = { ...PLAYING, bar: { light: 1, dark: 0 }, dice: [4] }
    const { result } = await ask({}, barred, 'light', replyWith('{"from": "bar", "to": 21, "die": 4}'))
    expect(result.success).toBe(true)
  })

  it('reads a bear-off', async () => {
    const bearing: BoardState = {
      ...PLAYING,
      points: Array.from({ length: 24 }, (_, index) => (index === 2 ? 3 : 0)),
      off: { light: 12, dark: 0 },
      dice: [3],
    }
    const { result } = await ask({}, bearing, 'light', replyWith('{"from": 3, "to": "off", "die": 3}'))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.move.to).toBe('off')
    }
  })

  it('asks dark for its own seat', async () => {
    const board: BoardState = { ...PLAYING, turn: 'dark' }
    const { result } = await ask({}, board, 'dark', replyWith('{"choice": 1}'))
    expect(result.success).toBe(true)
  })
})

describe('transport failures', () => {
  it('maps 401 without retrying, and never echoes the key', async () => {
    const { result, calls } = await ask({}, PLAYING, 'light', () => fakeResponse({ status: 401 }))
    expect(calls).toHaveLength(1)
    if (!result.success) {
      expect(result.code).toBe('unauthorized')
      expect(result.error).not.toContain(KEY)
      expect(result.retryAfterMs).toBeNull()
    }
  })

  it('maps 404 and 500', async () => {
    const missing = await ask({}, PLAYING, 'light', () => fakeResponse({ status: 404 }))
    if (!missing.result.success) {
      expect(missing.result.code).toBe('not-found')
    }

    const broken = await ask({}, PLAYING, 'light', () => fakeResponse({ status: 503 }))
    expect(broken.calls).toHaveLength(2) // one retry for a transient server error
    if (!broken.result.success) {
      expect(broken.result.code).toBe('server-error')
    }
  })

  it('honours Retry-After and recovers on the second attempt', async () => {
    let attempts = 0
    const { result, calls } = await ask({}, PLAYING, 'light', () => {
      attempts += 1
      if (attempts === 1) {
        return fakeResponse({ status: 429, headers: { 'retry-after': '0' } })
      }
      return fakeResponse({ body: chatReply('{"choice": 1}') })
    })

    expect(calls).toHaveLength(2)
    expect(result.success).toBe(true)
  })

  it('reports a rate limit that does not clear', async () => {
    const { result, calls } = await ask({}, PLAYING, 'light', () =>
      fakeResponse({ status: 429, headers: { 'retry-after': '0' } }),
    )
    expect(calls).toHaveLength(2)
    if (!result.success) {
      expect(result.code).toBe('rate-limited')
      expect(result.retryAfterMs).toBe(0)
    }
  })

  it('reports a relay that cannot be reached', async () => {
    // Provider CORS is no longer a possible cause: the hop is same-origin, so a rejection means the
    // relay itself was unreachable (dev server restarted, offline, or a preview build with no proxy).
    const { result } = await ask({}, PLAYING, 'light', () => {
      throw new TypeError('Failed to fetch')
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('network')
      expect(result.error).toContain('AI proxy')
      expect(result.error).not.toContain(KEY)
    }
    expect(isTransient('network')).toBe(true)
  })

  it('reports a body that is not JSON', async () => {
    const { result } = await ask({}, PLAYING, 'light', () => fakeResponse({ notJson: true }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('bad-response')
    }
  })

  it('survives a non-Error rejection', async () => {
    const spy = recorder(() => {
      throw 'just a string'
    })
    const result = await getAiMove(engine(), PLAYING, 'light', { fetchImpl: spy.fetchImpl })
    expect(result.success).toBe(false)
  })

  it('times out instead of hanging forever', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })

    const result = await getAiMove(engine(), PLAYING, 'light', { fetchImpl: hang, timeoutMs: 10 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('timeout')
    }
  })

  it('cancels when the caller aborts', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5)
    const result = await getAiMove(engine(), PLAYING, 'light', {
      fetchImpl: hang,
      timeoutMs: 5_000,
      signal: controller.signal,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('aborted')
    }
  })

  it('returns immediately for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const spy = recorder(() => fakeResponse({ body: chatReply('{"choice": 1}') }))
    const result = await getAiMove(engine(), PLAYING, 'light', { fetchImpl: spy.fetchImpl, signal: controller.signal })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('aborted')
    }
    expect(spy.calls).toHaveLength(0)
  })
})

describe('CORS relay transport', () => {
  /** A relay rejection: our status, our `x-ai-proxy-error` marker, our message. */
  const rejection =
    (status: number, code: string, message: string) =>
    (): AiResponse =>
      fakeResponse({ status, headers: { 'x-ai-proxy-error': code }, body: { error: { code, message } } })

  it('posts the envelope to the relay, keeping the key out of the transport headers', async () => {
    const { calls } = await ask({ provider: 'openai' })

    expect(calls[0].url).toBe(AI_PROXY_PATH)
    expect(calls[0].init.headers).toEqual({ 'content-type': 'application/json' })
    // The key belongs to the inner request the relay will forward. The same-origin hop carries only
    // a content type, so nothing readable by the transport is a credential.
    expect(envelopeOf(calls[0]).headers.authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.stringify(calls[0].init.headers)).not.toContain(KEY)
  })

  it('carries the provider payload through the envelope untouched', async () => {
    const { calls } = await ask({ provider: 'openai' })
    const inner = JSON.parse(envelopeOf(calls[0]).body) as Record<string, unknown>

    expect(inner.model).toBe(DEFAULT_MODELS.openai)
    expect(inner.response_format).toEqual({ type: 'json_object' })
  })

  it('reports a blocked host as proxy-blocked, not as a provider failure', async () => {
    const { result } = await ask(
      {},
      PLAYING,
      'light',
      rejection(403, 'target-not-allowed', 'The host evil.example is not in the proxy allowlist.'),
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('proxy-blocked')
      expect(result.error).toContain('allowlist')
      // A 403 from our own relay must not read as "the provider refused this key".
      expect(result.error).not.toContain('API key')
    }
  })

  it('does not retry a blocked host', async () => {
    const spy = recorder(rejection(403, 'target-not-allowed', 'blocked by the allowlist'))
    const result = await getAiMove(engine(), PLAYING, 'light', { fetchImpl: spy.fetchImpl })

    expect(result.success).toBe(false)
    expect(spy.calls).toHaveLength(1)
    expect(isTransient('proxy-blocked')).toBe(false)
  })

  it('maps a malformed envelope to proxy-blocked', async () => {
    const { result } = await ask({}, PLAYING, 'light', rejection(400, 'bad-request', 'The request envelope is not valid JSON.'))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('proxy-blocked')
    }
  })

  it('maps an oversized payload to proxy-blocked', async () => {
    const { result } = await ask({}, PLAYING, 'light', rejection(413, 'request-too-large', 'The request envelope is too large.'))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('proxy-blocked')
    }
  })

  it('keeps a relayed provider 401 as a credential problem', async () => {
    const { result } = await ask({}, PLAYING, 'light', () => fakeResponse({ status: 401, body: { error: { message: 'bad key' } } }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('unauthorized')
      expect(result.error).toContain('Invalid API key')
    }
  })

  it('treats an unreachable upstream as retryable and asks again', async () => {
    const spy = recorder((_call, index) =>
      index === 0
        ? fakeResponse({ status: 502, headers: { 'x-ai-proxy-error': 'bad-gateway' }, body: { error: { message: 'unreachable' } } })
        : fakeResponse({ body: chatReply('{"choice": 1}') }),
    )
    const result = await getAiMove(engine(), PLAYING, 'light', { fetchImpl: spy.fetchImpl })

    expect(spy.calls).toHaveLength(2)
    expect(result.success).toBe(true)
  })

  it('maps a relay timeout to the timeout code', async () => {
    const { result } = await ask({}, PLAYING, 'light', rejection(504, 'gateway-timeout', 'The provider did not answer in time.'))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('timeout')
    }
  })

  it('survives a rejection whose body is not JSON', async () => {
    const { result } = await ask({}, PLAYING, 'light', () =>
      fakeResponse({ status: 403, headers: { 'x-ai-proxy-error': 'target-not-allowed' }, notJson: true }),
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('proxy-blocked')
      expect(result.error).toContain('proxy')
    }
  })
})

describe('extractJsonObject', () => {
  it('finds a balanced object and respects strings and nesting', () => {
    expect(extractJsonObject('  {"a":{"b":1}} trailing')).toBe('{"a":{"b":1}}')
    expect(extractJsonObject('text {"error":"has {braces} inside"} more')).toBe(
      '{"error":"has {braces} inside"}',
    )
    expect(extractJsonObject('no object here')).toBeNull()
    expect(extractJsonObject('{unterminated')).toBeNull()
  })
})

describe('parseAiMove', () => {
  const menu = getLegalMoves(PLAYING, 'light', [5])

  it('returns nothing for unusable input', () => {
    expect(parseAiMove('', menu).move).toBeNull()
    expect(parseAiMove('null', menu).move).toBeNull()
    expect(parseAiMove('[1,2]', menu).move).toBeNull()
    expect(parseAiMove('{"from":13}', menu).move).toBeNull()
    expect(parseAiMove('{"from":13,"to":8,"die":0}', menu).move).toBeNull()
    expect(parseAiMove('{"from":13,"to":25,"die":5}', menu).move).toBeNull()
  })

  it('only ever hands back an entry from the menu', () => {
    const parsed = parseAiMove('{"choice": 1}', menu)
    expect(parsed.move).not.toBeNull()
    expect(menu).toContain(parsed.move)
  })
})

describe('explanations', () => {
  const menu = getLegalMoves(PLAYING, 'light', [5])

  it('reads the reason next to a menu choice', () => {
    const parsed = parseAiMove('{"explanation": "I make my five-point.", "choice": 1}', menu)

    expect(parsed.move).toBe(menu[0])
    expect(parsed.choice).toBe(1)
    expect(parsed.explanation).toBe('I make my five-point.')
  })

  it('reads it from a coordinate reply too, and from the aliases models invent', () => {
    const [move] = menu
    expect(
      parseAiMove(`{"explanation": "Advancing.", "from": ${String(move.from)}, "to": ${String(move.to)}, "die": ${move.die}}`, menu)
        .explanation,
    ).toBe('Advancing.')
    expect(parseAiMove('{"choice": 1, "reason": "Tempo."}', menu).explanation).toBe('Tempo.')
    expect(parseAiMove('{"choice": 1, "why": "Safety."}', menu).explanation).toBe('Safety.')
  })

  it('never lets a reason rescue an illegal or unusable reply', () => {
    const invented = parseAiMove('{"explanation": "I built a prime.", "choice": 999}', menu)
    expect(invented.move).toBeNull()
    expect(invented.explanation).toBeNull()

    expect(parseAiMove('{"explanation": "I built a prime."}', menu).move).toBeNull()
  })

  it('collapses layout and cuts a ramble instead of dropping it', () => {
    const wrapped = parseAiMove('{"choice": 1, "explanation": "I  hit\\n a blot \\t today. "}', menu)
    expect(wrapped.explanation).toBe('I hit a blot today.')

    const long = parseAiMove(`{"choice": 1, "explanation": "${'x'.repeat(900)}"}`, menu)
    expect(long.explanation !== null && long.explanation.length).toBeLessThanOrEqual(300)
    expect(long.explanation?.endsWith('\u2026')).toBe(true)
  })

  it('treats a non-string or an empty reason as silence, not as a failure', () => {
    expect(parseAiMove('{"choice": 1, "explanation": 7}', menu).explanation).toBeNull()
    expect(parseAiMove('{"choice": 1, "explanation": "   "}', menu).explanation).toBeNull()
    expect(parseAiMove('{"choice": 1}', menu).explanation).toBeNull()
    // The move still plays: the reason is decoration, and this is the assertion that pins that down.
    expect(parseAiMove('{"choice": 1, "explanation": 7}', menu).move).toBe(menu[0])
  })

  it('hands the reason to the caller of getAiMove', async () => {
    const { result } = await ask({}, PLAYING, 'light', () =>
      fakeResponse({ body: chatReply('{"explanation": "I escape.", "choice": 2}') }),
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.explanation).toBe('I escape.')
    }
  })
})

describe('DEFAULT_MODELS', () => {
  it('covers every selectable provider except the deployment-specific one', () => {
    expect(DEFAULT_MODELS.openai.length).toBeGreaterThan(0)
    expect(DEFAULT_MODELS.anthropic.length).toBeGreaterThan(0)
    expect(DEFAULT_MODELS.google.length).toBeGreaterThan(0)
    expect(DEFAULT_MODELS.custom).toBe('')
  })
})

describe('timeout budgets across the layers', () => {
  // The relay is what actually talks to the provider, so it has to be the one that gives up last.
  // If its ceiling drops below the client's, a patient browser is told "the proxy timed out" while it
  // was still waiting, and a provider 429 carrying a Retry-After is discarded on the way past.
  it('lets the client run out of time before the relay does, in dev and at the edge', () => {
    expect(AI_TIMEOUT_MS).toBeLessThan(DEV_POLICY.timeoutMs)
    expect(AI_TIMEOUT_MS).toBeLessThan(PRODUCTION_POLICY.timeoutMs)
  })

  it('gives a slow reasoning model room to answer at all', () => {
    // A turn is one request plus at most one retry inside this single budget, so it has to cover
    // both attempts. 20 s was the original value and cut off real DashScope answers.
    expect(AI_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })
})

describe('difficulty', () => {
  it('gives hard a bigger reply budget than the other levels', async () => {
    const medium = await ask()
    const hard = await ask({ difficulty: 'hard' })

    expect((innerBody(medium.calls[0]) as Record<string, unknown>).max_tokens).toBe(2048)
    // Pinned as a literal, as 2048 is: this is the number that decides whether a long answer is cut
    // off mid-JSON, and a silent drop back to 2048 would look like a provider bug.
    expect((innerBody(hard.calls[0]) as Record<string, unknown>).max_tokens).toBe(4096)
  })

  it('keeps medium and hard deterministic and lets easy misfire', async () => {
    const easy = await ask({ difficulty: 'easy' })
    const hard = await ask({ difficulty: 'hard' })

    expect((innerBody(easy.calls[0]) as Record<string, unknown>).temperature).toBe(0.8)
    expect((innerBody(hard.calls[0]) as Record<string, unknown>).temperature).toBe(0)
  })

  it('names the playing strength in the system prompt', async () => {
    const { calls } = await ask({ difficulty: 'hard' })
    const body = innerBody(calls[0]) as { messages: Array<{ role: string; content: string }> }
    const system = body.messages[0].content

    expect(system).toContain('Playing strength: hard')
    expect(system).toContain("Analyze the opponent's threats 2 moves ahead")
  })

  it('never re-enables thinking at hard, which is what made a turn hang', async () => {
    const { calls } = await ask({
      provider: 'custom',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      difficulty: 'hard',
    })

    expect((innerBody(calls[0]) as Record<string, unknown>).enable_thinking).toBe(false)
  })

  it('treats a stored config without a difficulty as medium', async () => {
    // A payload written before this field existed has no key at all; the request must look exactly
    // like the current default rather than falling through to a level nobody chose.
    const legacy = { provider: 'openai', apiKey: KEY, model: '', baseUrl: '' } as AiEngineConfig
    const spy = recorder(() => fakeResponse({ body: chatReply('{"choice": 1}') }))
    await getAiMove(legacy, PLAYING, 'light', { fetchImpl: spy.fetchImpl })

    const body = innerBody(spy.calls[0]) as Record<string, unknown>
    expect(body.max_tokens).toBe(2048)
    expect(body.temperature).toBe(0)
    expect((body.messages as Array<{ content: string }>)[0].content).toContain('Playing strength: medium')
  })
})
