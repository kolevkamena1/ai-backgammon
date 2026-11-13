import type {
  AiErrorCode,
  AiModelMetadata,
  AiRequestClass,
  AiRequestInit,
  AiResponse,
  FetchLike,
} from '@/types/ai'
import type {
  AiDifficulty,
  AiEngineConfig,
  AiInferenceParams,
  AiProvider,
  AiThinkingLevel,
} from '@/types/settings'
import { logger } from '@/lib/logger'
import {
  AI_MAX_TOKENS,
  AI_MAX_TOKENS_HARD,
  AI_PROXY_PATH,
  AI_TEMPERATURE,
  DEFAULT_MODELS,
  mapProxyFailure,
  normalizeBaseUrl,
} from '@/utils/aiClient'
import { defaultStrategyPrompt, MAX_CUSTOM_SYSTEM_PROMPT_CHARS } from '@/utils/aiPrompt'
import { difficultyOf } from '@/utils/gameConfig'

const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models'
const ANTHROPIC_VERSION = '2023-06-01'
const GOOGLE_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

const METADATA_TIMEOUT_MS = 15_000
const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_TOP_P = 1

export interface ModelQueryOptions {
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

export interface ProviderModelsResult {
  ok: boolean
  models: AiModelMetadata[]
  error: string | null
  code?: AiErrorCode
}

export interface ModelMetadataResult {
  ok: boolean
  metadata: AiModelMetadata
  error: string | null
  code?: AiErrorCode
}

/** Fully resolved inference parameters (never undefined). */
export interface ResolvedInferenceParams {
  maxTokens: number
  temperature: number
  topP: number
  contextWindow: number
  thinkingLevel: AiThinkingLevel
  systemPrompt: string
}

const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init)

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toPositiveInt(value: unknown): number | null {
  const num = toFiniteNumber(value)
  return num !== null && num >= 1 ? Math.trunc(num) : null
}

/**
 * Built-in catalog of known model capabilities. Used to enrich endpoints (such as OpenAI's and
 * Anthropic's `/v1/models/<id>`) that verify the model exists and return its ID/display name, but
 * omit token limits or sampling defaults in the response body.
 */
interface CatalogEntry {
  match: RegExp
  contextWindow: number
  maxOutputTokens: number
  defaultMaxTokens?: number
  defaultTemperature: number
  maxTemperature: number
  defaultTopP: number
  supportsThinking: boolean
  defaultThinkingLevel: AiThinkingLevel
  requestClass?: AiRequestClass
  omitTemperature?: boolean
}

const CATALOG: readonly CatalogEntry[] = [
  // OpenAI reasoning & GPT-5 / GPT-4.1 / GPT-4o series
  {
    match: /^(o1|o3|o4|gpt-5)/i,
    contextWindow: 200_000,
    maxOutputTokens: 32_768,
    defaultTemperature: 1,
    maxTemperature: 2,
    defaultTopP: 1,
    supportsThinking: true,
    defaultThinkingLevel: 'low',
    requestClass: 'openai-reasoning',
    omitTemperature: true,
  },
  {
    match: /^gpt-4\.1/i,
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    defaultTemperature: 0,
    maxTemperature: 2,
    defaultTopP: 1,
    supportsThinking: false,
    defaultThinkingLevel: 'off',
  },
  {
    match: /^gpt-4o/i,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    defaultTemperature: 0,
    maxTemperature: 2,
    defaultTopP: 1,
    supportsThinking: false,
    defaultThinkingLevel: 'off',
  },
  // Anthropic Claude 3.7 / 4 / 4.5 (extended thinking capable) and 3.5 series
  {
    match: /^claude-(3-7|4|sonnet-4|opus-4|haiku-4)/i,
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    defaultTemperature: 0,
    maxTemperature: 1,
    defaultTopP: 1,
    supportsThinking: true,
    defaultThinkingLevel: 'off',
  },
  {
    match: /^claude-3/i,
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    defaultTemperature: 0,
    maxTemperature: 1,
    defaultTopP: 1,
    supportsThinking: false,
    defaultThinkingLevel: 'off',
  },
  // Google Gemini 2.5 / 3 series (thinking capable) and 2.0 series
  {
    match: /^gemini-(2\.5|3)/i,
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    defaultTemperature: 0,
    maxTemperature: 2,
    defaultTopP: 0.95,
    supportsThinking: true,
    defaultThinkingLevel: 'off',
  },
  {
    match: /^gemini-2\.0/i,
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    defaultTemperature: 0,
    maxTemperature: 2,
    defaultTopP: 0.95,
    supportsThinking: false,
    defaultThinkingLevel: 'off',
  },
  // Qwen4 (qwen4-max-preview and successors): max_tokens is the combined thinking+answer budget
  // (default >= 8192); uses reasoning_effort ("low" default, "medium" max) and never thinking_budget.
  {
    match: /qwen4/i,
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    defaultMaxTokens: 8_192,
    defaultTemperature: 0,
    maxTemperature: 2,
    defaultTopP: 0.95,
    supportsThinking: true,
    defaultThinkingLevel: 'low',
    requestClass: 'qwen4',
    omitTemperature: false,
  },
  // Qwen3 / QwQ / DeepSeek R1 (thinking capable open/custom models)
  {
    match: /(qwen3|qwq|deepseek-r1|r1)/i,
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    defaultTemperature: 0.6,
    maxTemperature: 2,
    defaultTopP: 0.95,
    supportsThinking: true,
    defaultThinkingLevel: 'off',
    requestClass: 'qwen3-hybrid',
  },
  // Other Qwen / Llama / Mistral / Gemma models
  {
    match: /(qwen|llama|mistral|mixtral|gemma|deepseek)/i,
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    defaultTemperature: 0,
    maxTemperature: 2,
    defaultTopP: 1,
    supportsThinking: false,
    defaultThinkingLevel: 'off',
  },
]

export function lookupCatalogMetadata(
  provider: AiProvider,
  rawModelId: string,
): AiModelMetadata {
  const id = (rawModelId.trim() || DEFAULT_MODELS[provider] || 'default').replace(/^models\//, '')
  const matched = CATALOG.find((entry) => entry.match.test(id))

  if (matched) {
    return {
      id,
      displayName: id,
      contextWindow: matched.contextWindow,
      maxOutputTokens: matched.maxOutputTokens,
      defaultMaxTokens: matched.defaultMaxTokens ?? null,
      defaultTemperature: matched.defaultTemperature,
      maxTemperature: matched.maxTemperature,
      defaultTopP: matched.defaultTopP,
      supportsThinking: matched.supportsThinking,
      defaultThinkingLevel: matched.defaultThinkingLevel,
      requestClass: matched.requestClass ?? 'standard',
      omitTemperature: matched.omitTemperature ?? false,
      source: 'catalog',
    }
  }

  return {
    id,
    displayName: id,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: provider === 'anthropic' ? 8_192 : 16_384,
    defaultMaxTokens: null,
    defaultTemperature: 0,
    maxTemperature: provider === 'anthropic' ? 1 : 2,
    defaultTopP: DEFAULT_TOP_P,
    supportsThinking: provider === 'custom',
    defaultThinkingLevel: 'off',
    requestClass: 'standard',
    omitTemperature: false,
    source: 'catalog',
  }
}

/**
 * Extracts model metadata from a provider's JSON object (supporting Google Gemini `Model`,
 * OpenAI/Anthropic `Model`, OpenRouter/vLLM/LM Studio extended fields, and Ollama `/api/show`),
 * filling any omitted fields from the catalog fallback.
 */
export function parseModelMetadataObject(
  provider: AiProvider,
  rawModelId: string,
  data: unknown,
): AiModelMetadata {
  const fallback = lookupCatalogMetadata(provider, rawModelId)
  const record = asRecord(data)
  if (record === null) {
    return fallback
  }

  const rawId =
    (typeof record.id === 'string' && record.id) ||
    (typeof record.name === 'string' && record.name) ||
    fallback.id
  const id = rawId.replace(/^models\//, '')
  const base = lookupCatalogMetadata(provider, id)

  const displayName =
    (typeof record.displayName === 'string' && record.displayName.trim()) ||
    (typeof record.display_name === 'string' && record.display_name.trim()) ||
    id

  const topProvider = asRecord(record.top_provider)
  const defaultParams = asRecord(record.default_parameters)
  const modelInfo = asRecord(record.model_info)

  // Ollama `/api/show` stores context window under `<arch>.context_length` inside `model_info`.
  let ollamaContext: number | null = null
  if (modelInfo !== null) {
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.endsWith('.context_length') || key === 'context_length') {
        ollamaContext = toPositiveInt(value)
        if (ollamaContext !== null) {
          break
        }
      }
    }
  }

  // Ollama `/api/show` also returns a Modelfile `parameters` string such as `temperature 0.7\nnum_ctx 32768`.
  let ollamaTemp: number | null = null
  let ollamaTopP: number | null = null
  let ollamaNumCtx: number | null = null
  if (typeof record.parameters === 'string') {
    for (const line of record.parameters.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2) {
        const key = parts[0].toLowerCase()
        const val = parts[1]
        if (key === 'temperature') ollamaTemp = toFiniteNumber(val)
        if (key === 'top_p') ollamaTopP = toFiniteNumber(val)
        if (key === 'num_ctx') ollamaNumCtx = toPositiveInt(val)
      }
    }
  }

  const endpointContextWindow =
    toPositiveInt(record.inputTokenLimit) ??
    toPositiveInt(record.context_length) ??
    toPositiveInt(record.max_model_len) ??
    toPositiveInt(record.context_window) ??
    toPositiveInt(record.max_input_tokens) ??
    toPositiveInt(topProvider?.context_length) ??
    ollamaNumCtx ??
    ollamaContext

  const endpointMaxOutput =
    toPositiveInt(record.outputTokenLimit) ??
    toPositiveInt(record.max_output_tokens) ??
    toPositiveInt(record.max_completion_tokens) ??
    toPositiveInt(record.max_tokens) ??
    toPositiveInt(topProvider?.max_completion_tokens)

  const endpointTemp =
    toFiniteNumber(record.temperature) ??
    toFiniteNumber(defaultParams?.temperature) ??
    ollamaTemp

  const endpointMaxTemp = toFiniteNumber(record.maxTemperature) ?? toFiniteNumber(record.max_temperature)

  const endpointTopP =
    toFiniteNumber(record.topP) ??
    toFiniteNumber(record.top_p) ??
    toFiniteNumber(defaultParams?.top_p) ??
    ollamaTopP

  const capabilities = Array.isArray(record.capabilities) ? record.capabilities : []
  const supportedParams = Array.isArray(record.supported_parameters)
    ? record.supported_parameters
    : []
  const endpointThinking =
    record.thinking === true ||
    typeof asRecord(record.thinking)?.type === 'string' ||
    capabilities.includes('thinking') ||
    capabilities.includes('reasoning') ||
    supportedParams.includes('reasoning') ||
    supportedParams.includes('include_reasoning')

  return {
    id,
    displayName,
    contextWindow: endpointContextWindow ?? base.contextWindow,
    maxOutputTokens: endpointMaxOutput ?? base.maxOutputTokens,
    defaultMaxTokens: base.defaultMaxTokens ?? null,
    defaultTemperature: endpointTemp ?? base.defaultTemperature,
    maxTemperature: endpointMaxTemp ?? base.maxTemperature,
    defaultTopP: endpointTopP ?? base.defaultTopP,
    supportsThinking: endpointThinking || base.supportsThinking,
    defaultThinkingLevel: base.defaultThinkingLevel,
    requestClass: base.requestClass ?? 'standard',
    omitTemperature: base.omitTemperature ?? false,
    source: 'endpoint',
  }
}

function providerHeaders(config: AiEngineConfig): Record<string, string> {
  const apiKey = config.apiKey.trim()
  switch (config.provider) {
    case 'openai':
    case 'custom':
      return apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}
    case 'anthropic':
      return {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    case 'google':
      return { 'x-goog-api-key': apiKey }
  }
}

/**
 * Sends a model-discovery or model-metadata request through the same-origin `/api/ai-proxy` relay.
 * Built-in and `custom` providers alike wrap `targetUrl` inside the JSON envelope; relay rejections
 * (`x-ai-proxy-error`) are mapped to typed `AiErrorCode` values (`proxy-blocked`, `timeout`, `network`)
 * so callers can distinguish relay policy blocks from upstream provider HTTP responses.
 */
async function callProxyJson(args: {
  targetUrl: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: Record<string, unknown>
  fetchImpl: FetchLike
  signal?: AbortSignal
}): Promise<{ ok: true; data: unknown } | { ok: false; error: string; code?: AiErrorCode }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  args.signal?.addEventListener('abort', onAbort, { once: true })

  const envelope: Record<string, unknown> = {
    targetUrl: args.targetUrl,
    method: args.method,
    headers: args.headers,
  }
  if (args.method === 'POST') {
    envelope.body = JSON.stringify(args.body ?? {})
  }

  const init: AiRequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
    signal: controller.signal,
  }

  try {
    const response: AiResponse = await args.fetchImpl(AI_PROXY_PATH, init)
    const proxyErrorCode = response.headers.get('x-ai-proxy-error')
    if (proxyErrorCode !== null) {
      const mapped = await mapProxyFailure(response, proxyErrorCode)
      return { ok: false, error: mapped.error, code: mapped.code }
    }
    if (!response.ok) {
      return { ok: false, error: `Provider responded with status ${response.status}.` }
    }
    const data = await response.json()
    return { ok: true, data }
  } catch (error) {
    logger.debug('model metadata request failed', { target: args.targetUrl, reason: String(error) })
    return { ok: false, error: 'Could not reach the model metadata endpoint.', code: 'network' }
  } finally {
    clearTimeout(timer)
    args.signal?.removeEventListener('abort', onAbort)
  }
}

function listModelsUrl(config: AiEngineConfig): string | null {
  switch (config.provider) {
    case 'openai':
      return `${OPENAI_BASE_URL}/models`
    case 'anthropic':
      return ANTHROPIC_MODELS_URL
    case 'google':
      return GOOGLE_MODELS_URL
    case 'custom': {
      const base = normalizeBaseUrl(config.baseUrl ?? '')
      return base.length > 0 ? `${base}/models` : null
    }
  }
}

function singleModelUrl(config: AiEngineConfig, modelId: string): string | null {
  const cleanId = encodeURIComponent(modelId.replace(/^models\//, ''))
  switch (config.provider) {
    case 'openai':
      return `${OPENAI_BASE_URL}/models/${cleanId}`
    case 'anthropic':
      return `${ANTHROPIC_MODELS_URL}/${cleanId}`
    case 'google':
      return `${GOOGLE_MODELS_URL}/${cleanId}`
    case 'custom': {
      const base = normalizeBaseUrl(config.baseUrl ?? '')
      return base.length > 0 ? `${base}/models/${cleanId}` : null
    }
  }
}

/**
 * If a custom endpoint is an Ollama server (e.g. `http://localhost:11434/v1`), derives its native
 * `/api/show` URL so we can query the Modelfile parameters and context length directly.
 */
function ollamaShowUrl(baseUrl: string): string | null {
  try {
    const parsed = new URL(normalizeBaseUrl(baseUrl))
    if (parsed.hostname.endsWith('.aliyuncs.com') || parsed.hostname === 'api.openai.com') {
      return null
    }
    return `${parsed.origin}/api/show`
  } catch {
    return null
  }
}

/**
 * Queries the provider's models list endpoint (`/v1/models` or `/v1beta/models`) and returns the
 * discovered models along with any metadata the list endpoint includes.
 */
export async function fetchProviderModels(
  config: AiEngineConfig,
  options: ModelQueryOptions = {},
): Promise<ProviderModelsResult> {
  const url = listModelsUrl(config)
  if (url === null) {
    return { ok: false, models: [], error: 'Enter a Base URL first.' }
  }
  if (config.apiKey.trim().length === 0 && config.provider !== 'custom') {
    return { ok: false, models: [], error: 'Enter an API key first.' }
  }

  const outcome = await callProxyJson({
    targetUrl: url,
    method: 'GET',
    headers: providerHeaders(config),
    fetchImpl: options.fetchImpl ?? defaultFetch,
    signal: options.signal,
  })

  if (!outcome.ok) {
    return { ok: false, models: [], error: outcome.error, code: outcome.code }
  }

  const root = asRecord(outcome.data)
  const rawList = Array.isArray(root?.data)
    ? root.data
    : Array.isArray(root?.models)
      ? root.models
      : []

  const models: AiModelMetadata[] = []
  for (const item of rawList) {
    const rec = asRecord(item)
    if (rec === null) continue
    // For Google Gemini, filter to models that support generateContent when the list is present.
    if (
      Array.isArray(rec.supportedGenerationMethods) &&
      !rec.supportedGenerationMethods.includes('generateContent')
    ) {
      continue
    }
    const rawId =
      (typeof rec.id === 'string' && rec.id) ||
      (typeof rec.name === 'string' && rec.name) ||
      ''
    if (rawId.length === 0) continue
    models.push(parseModelMetadataObject(config.provider, rawId, rec))
  }

  return { ok: true, models, error: null }
}

/**
 * Queries the provider's model metadata endpoint for a specific model (e.g.
 * `GET /v1/models/<id>`, `GET /v1beta/models/<id>`, or Ollama `POST /api/show`), falling back to
 * the built-in catalog when the endpoint is unreachable or omits parameter bounds.
 */
export async function fetchModelMetadata(
  config: AiEngineConfig,
  modelId?: string,
  options: ModelQueryOptions = {},
): Promise<ModelMetadataResult> {
  const targetModel = (modelId ?? config.model).trim() || DEFAULT_MODELS[config.provider]
  if (targetModel.length === 0) {
    return {
      ok: false,
      metadata: lookupCatalogMetadata(config.provider, ''),
      error: 'Enter or select a model name first.',
    }
  }

  const fetchImpl = options.fetchImpl ?? defaultFetch
  const headers = providerHeaders(config)
  const url = singleModelUrl(config, targetModel)

  if (url !== null && (config.apiKey.trim().length > 0 || config.provider === 'custom')) {
    const outcome = await callProxyJson({
      targetUrl: url,
      method: 'GET',
      headers,
      fetchImpl,
      signal: options.signal,
    })

    if (outcome.ok) {
      let metadata = parseModelMetadataObject(config.provider, targetModel, outcome.data)

      // If this is a custom endpoint (like Ollama) whose `/v1/models/<id>` omitted context_length,
      // also probe `/api/show` to pull `model_info` and `parameters`.
      const showUrl = config.provider === 'custom' ? ollamaShowUrl(config.baseUrl ?? '') : null
      if (showUrl !== null) {
        const showOutcome = await callProxyJson({
          targetUrl: showUrl,
          method: 'POST',
          headers,
          body: { model: targetModel },
          fetchImpl,
          signal: options.signal,
        })
        if (showOutcome.ok) {
          metadata = parseModelMetadataObject(config.provider, targetModel, showOutcome.data)
        }
      }

      return { ok: true, metadata, error: null }
    }

    // For custom gateways that only implement `GET /v1/models` (or Ollama `/api/show`) and 404 on
    // `GET /v1/models/<id>`, try `/api/show` before falling back to the catalog.
    if (config.provider === 'custom') {
      const showUrl = ollamaShowUrl(config.baseUrl ?? '')
      if (showUrl !== null) {
        const showOutcome = await callProxyJson({
          targetUrl: showUrl,
          method: 'POST',
          headers,
          body: { model: targetModel },
          fetchImpl,
          signal: options.signal,
        })
        if (showOutcome.ok) {
          return {
            ok: true,
            metadata: parseModelMetadataObject(config.provider, targetModel, showOutcome.data),
            error: null,
          }
        }
      }
    }

    return {
      ok: false,
      metadata: lookupCatalogMetadata(config.provider, targetModel),
      error: outcome.error,
      code: outcome.code,
    }
  }

  return {
    ok: false,
    metadata: lookupCatalogMetadata(config.provider, targetModel),
    error: 'Configure an API key to query live endpoint metadata; showing catalog defaults.',
  }
}

/**
 * Computes the default inference parameters for a given difficulty and model metadata, before any
 * user overrides are applied.
 */
export function resolveDefaultParams(
  difficulty: AiDifficulty,
  metadata?: AiModelMetadata | null,
): ResolvedInferenceParams {
  const baseMaxTokens = Math.max(
    difficulty === 'hard' ? AI_MAX_TOKENS_HARD : AI_MAX_TOKENS,
    metadata?.defaultMaxTokens ?? 0,
  )
  const maxOutputLimit = metadata?.maxOutputTokens ?? null
  const maxTokens =
    maxOutputLimit !== null ? Math.min(baseMaxTokens, maxOutputLimit) : baseMaxTokens

  // Easy uses 0.8 so the model plays loosely; Medium and Hard use 0 unless the model metadata
  // specifies a non-zero required temperature (such as o1/o3/GPT-5 at 1).
  const maxTemp = metadata?.maxTemperature ?? 2
  const rawTemp =
    difficulty === 'easy'
      ? AI_TEMPERATURE.easy
      : (metadata?.defaultTemperature ?? AI_TEMPERATURE[difficulty])
  const temperature = Math.min(Math.max(0, rawTemp), maxTemp)

  const topP = metadata?.defaultTopP ?? DEFAULT_TOP_P
  const contextWindow = metadata?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const thinkingLevel: AiThinkingLevel = metadata?.defaultThinkingLevel ?? 'off'

  return {
    maxTokens,
    temperature,
    topP,
    contextWindow,
    thinkingLevel,
    systemPrompt: defaultStrategyPrompt(difficulty),
  }
}

/**
 * Merges the user's custom `config.params` over the defaults resolved from `difficulty` and model
 * metadata.
 */
export function resolveEffectiveParams(
  config: AiEngineConfig,
  metadata?: AiModelMetadata | null,
): ResolvedInferenceParams {
  const defaults = resolveDefaultParams(difficultyOf(config), metadata)
  const custom: AiInferenceParams | undefined = config.params

  if (custom === undefined) {
    return defaults
  }

  return {
    maxTokens:
      typeof custom.maxTokens === 'number' && Number.isFinite(custom.maxTokens) && custom.maxTokens >= 64
        ? Math.trunc(custom.maxTokens)
        : defaults.maxTokens,
    temperature:
      typeof custom.temperature === 'number' && Number.isFinite(custom.temperature) && custom.temperature >= 0
        ? custom.temperature
        : defaults.temperature,
    topP:
      typeof custom.topP === 'number' && Number.isFinite(custom.topP) && custom.topP > 0 && custom.topP <= 1
        ? custom.topP
        : defaults.topP,
    contextWindow:
      typeof custom.contextWindow === 'number' &&
      Number.isFinite(custom.contextWindow) &&
      custom.contextWindow >= 512
        ? Math.trunc(custom.contextWindow)
        : defaults.contextWindow,
    thinkingLevel:
      custom.thinkingLevel === 'off' ||
      custom.thinkingLevel === 'low' ||
      custom.thinkingLevel === 'medium' ||
      custom.thinkingLevel === 'high'
        ? custom.thinkingLevel
        : defaults.thinkingLevel,
    systemPrompt:
      typeof custom.systemPrompt === 'string' && custom.systemPrompt.trim().length > 0
        ? custom.systemPrompt.slice(0, MAX_CUSTOM_SYSTEM_PROMPT_CHARS)
        : defaults.systemPrompt,
  }
}

