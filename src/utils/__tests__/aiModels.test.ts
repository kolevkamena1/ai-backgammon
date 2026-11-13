import type { AiRequestInit, AiResponse, FetchLike } from '@/types/ai'
import type { AiEngineConfig } from '@/types/settings'
import {
  fetchModelMetadata,
  fetchProviderModels,
  lookupCatalogMetadata,
  parseModelMetadataObject,
  resolveDefaultParams,
  resolveEffectiveParams,
} from '@/utils/aiModels'
import { defaultStrategyPrompt } from '@/utils/aiPrompt'
import { handleProxyRequest, PRODUCTION_POLICY } from '../../../shared/aiProxy.ts'
import { describe, expect, it } from 'vitest'

function mockFetch(
  handler: (envelope: { targetUrl: string; method?: string; headers: Record<string, string>; body?: string }) => {
    status?: number
    body: unknown
  },
): { fetchImpl: FetchLike; calls: Array<{ targetUrl: string; method?: string; body?: string }> } {
  const calls: Array<{ targetUrl: string; method?: string; body?: string }> = []

  const fetchImpl: FetchLike = async (_url: string, init: AiRequestInit): Promise<AiResponse> => {
    const parsed = JSON.parse(init.body) as {
      targetUrl: string
      method?: string
      headers: Record<string, string>
      body?: string
    }
    calls.push({ targetUrl: parsed.targetUrl, method: parsed.method, body: parsed.body })
    const result = handler(parsed)
    const status = result.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => result.body,
      text: async () => JSON.stringify(result.body),
    }
  }

  return { fetchImpl, calls }
}

const baseConfig = (overrides: Partial<AiEngineConfig> = {}): AiEngineConfig => ({
  provider: 'openai',
  apiKey: 'sk-test-1234',
  model: 'gpt-4o-mini',
  baseUrl: '',
  difficulty: 'medium',
  ...overrides,
})

describe('fetchProviderModels', () => {
  it('queries Google Gemini /v1beta/models via GET and extracts token limits and defaults', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      body: {
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            inputTokenLimit: 1_048_576,
            outputTokenLimit: 65_536,
            temperature: 1.0,
            maxTemperature: 2.0,
            topP: 0.95,
            thinking: true,
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/text-embedding-004',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      },
    }))

    const res = await fetchProviderModels(
      baseConfig({ provider: 'google', model: '' }),
      { fetchImpl },
    )

    expect(res.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('GET')
    expect(calls[0].targetUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(res.models).toHaveLength(1)
    expect(res.models[0]).toMatchObject({
      id: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      defaultTemperature: 1.0,
      maxTemperature: 2.0,
      defaultTopP: 0.95,
      supportsThinking: true,
      source: 'endpoint',
    })
  })

  it('queries OpenAI /v1/models and enriches models with catalog metadata when limits are omitted', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      body: {
        data: [
          { id: 'gpt-4o-mini', object: 'model' },
          { id: 'o3-mini', object: 'model' },
        ],
      },
    }))

    const res = await fetchProviderModels(baseConfig(), { fetchImpl })
    expect(res.ok).toBe(true)
    expect(calls[0].targetUrl).toBe('https://api.openai.com/v1/models')
    expect(res.models.map((m) => m.id)).toEqual(['gpt-4o-mini', 'o3-mini'])
    expect(res.models[0].contextWindow).toBe(128_000)
    expect(res.models[1].supportsThinking).toBe(true)
    expect(res.models[1].defaultThinkingLevel).toBe('low')
  })

  it('surfaces relay rejections as proxy-blocked for non-allowlisted public and localhost custom targets', async () => {
    const proxyFetch: FetchLike = async (_url, init) => {
      const outcome = await handleProxyRequest(
        {
          method: init.method,
          url: 'https://backgammon.example/api/ai-proxy',
          headers: { get: (name) => init.headers[name.toLowerCase()] ?? null },
          text: async () => init.body,
        },
        PRODUCTION_POLICY,
        async () => {
          throw new Error('upstream should not be called')
        },
      )
      return {
        ok: outcome.status >= 200 && outcome.status < 300,
        status: outcome.status,
        headers: { get: (name) => outcome.headers[name.toLowerCase()] ?? null },
        json: async () => JSON.parse(outcome.body) as unknown,
        text: async () => outcome.body,
      }
    }

    const publicBlocked = await fetchProviderModels(
      baseConfig({ provider: 'custom', baseUrl: 'https://openrouter.ai/api/v1' }),
      { fetchImpl: proxyFetch },
    )
    expect(publicBlocked.ok).toBe(false)
    expect(publicBlocked.code).toBe('proxy-blocked')
    expect(publicBlocked.error).toContain('AI proxy (target-not-allowed)')
    expect(publicBlocked.error).toContain('openrouter.ai is not in the proxy allowlist')

    const localMetaBlocked = await fetchModelMetadata(
      baseConfig({ provider: 'custom', baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' }),
      'qwen2.5:7b',
      { fetchImpl: proxyFetch },
    )
    expect(localMetaBlocked.ok).toBe(false)
    expect(localMetaBlocked.code).toBe('proxy-blocked')
    expect(localMetaBlocked.error).toContain('AI proxy (target-not-allowed)')
  })
})

describe('fetchModelMetadata', () => {
  it('queries the specific model endpoint and parses Ollama /api/show metadata for custom gateways', async () => {
    const { fetchImpl, calls } = mockFetch((envelope) => {
      if (envelope.targetUrl.endsWith('/api/show')) {
        return {
          body: {
            model_info: {
              'qwen3.context_length': 32_768,
            },
            parameters: 'temperature 0.6\ntop_p 0.9\nnum_ctx 16384',
            capabilities: ['completion', 'thinking'],
          },
        }
      }
      return {
        body: { id: 'qwen3:8b', object: 'model' },
      }
    })

    const res = await fetchModelMetadata(
      baseConfig({
        provider: 'custom',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3:8b',
      }),
      'qwen3:8b',
      { fetchImpl },
    )

    expect(res.ok).toBe(true)
    expect(calls.map((c) => c.targetUrl)).toEqual([
      'http://localhost:11434/v1/models/qwen3%3A8b',
      'http://localhost:11434/api/show',
    ])
    expect(res.metadata.contextWindow).toBe(16_384)
    expect(res.metadata.defaultTemperature).toBe(0.6)
    expect(res.metadata.defaultTopP).toBe(0.9)
    expect(res.metadata.supportsThinking).toBe(true)
  })

  it('parses vLLM and OpenRouter extended model metadata fields directly', () => {
    const meta = parseModelMetadataObject('custom', 'deepseek-r1', {
      id: 'deepseek-r1',
      max_model_len: 65_536,
      max_output_tokens: 8_192,
      default_parameters: { temperature: 0.5, top_p: 0.92 },
      supported_parameters: ['reasoning'],
    })

    expect(meta.contextWindow).toBe(65_536)
    expect(meta.maxOutputTokens).toBe(8_192)
    expect(meta.defaultTemperature).toBe(0.5)
    expect(meta.defaultTopP).toBe(0.92)
    expect(meta.supportsThinking).toBe(true)
  })
})

describe('resolveDefaultParams and resolveEffectiveParams', () => {
  it('pre-fills defaults from difficulty and model metadata, and lets user params override them', () => {
    const metadata = lookupCatalogMetadata('google', 'gemini-2.5-flash')
    const defaults = resolveDefaultParams('medium', metadata)

    expect(defaults).toEqual({
      maxTokens: 2048,
      temperature: 0,
      topP: 0.95,
      contextWindow: 1_048_576,
      thinkingLevel: 'off',
      systemPrompt: defaultStrategyPrompt('medium'),
    })

    const customized = resolveEffectiveParams(
      baseConfig({
        provider: 'google',
        model: 'gemini-2.5-flash',
        difficulty: 'hard',
        params: {
          maxTokens: 8192,
          temperature: 0.4,
          topP: 0.85,
          contextWindow: 65_536,
          thinkingLevel: 'high',
          systemPrompt: 'Play a relentless blitz game.',
        },
      }),
      metadata,
    )

    expect(customized).toEqual({
      maxTokens: 8192,
      temperature: 0.4,
      topP: 0.85,
      contextWindow: 65_536,
      thinkingLevel: 'high',
      systemPrompt: 'Play a relentless blitz game.',
    })
  })
})

