import { BUTTON, FIELD } from '@/components/ui/controls'
import type { AiModelMetadata } from '@/types/ai'
import type { PlayerColor } from '@/types/game'
import type {
  AiDifficulty,
  AiEngineConfig,
  AiInferenceParams,
  AiProvider,
  AiThinkingLevel,
} from '@/types/settings'
import { DEFAULT_MODELS } from '@/utils/aiClient'
import {
  fetchModelMetadata,
  fetchProviderModels,
  lookupCatalogMetadata,
  resolveDefaultParams,
  resolveEffectiveParams,
} from '@/utils/aiModels'
import {
  buildSystemPrompt,
  MAX_CUSTOM_SYSTEM_PROMPT_CHARS,
  SYSTEM_PROMPT_PRESETS,
} from '@/utils/aiPrompt'
import { cn } from '@/utils/cn'
import {
  AI_DIFFICULTIES,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_LABELS,
  parseDifficulty,
  SEAT_LABELS,
} from '@/utils/gameConfig'
import { ChevronDown, Eye, EyeOff, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

interface ByokFieldsProps {
  /** Prefixes every element id so two instances can coexist without colliding. */
  idPrefix: string
  value: AiEngineConfig
  /** Emits only what changed; the owner keeps the whole draft. */
  onChange: (changes: Partial<AiEngineConfig>) => void
  /** Last characters of an already-stored key; switches the hint to "replace" wording. */
  storedTail?: string
  keyPlaceholder?: string
  /** Focus the key field on mount (Settings does; the setup modal must not steal focus). */
  autoFocusKey?: boolean
  /** Disables all controls and suppresses background endpoint metadata requests. */
  disabled?: boolean
  /** Which seat color this engine plays in the system-prompt preview (defaults to 'light'). */
  seatColor?: PlayerColor
}

const PROVIDERS: ReadonlyArray<{ value: AiProvider; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
]

const THINKING_LEVELS: ReadonlyArray<{ value: AiThinkingLevel; label: string }> = [
  { value: 'off', label: 'Off (fastest)' },
  { value: 'low', label: 'Low (~1k budget)' },
  { value: 'medium', label: 'Medium (~2k budget)' },
  { value: 'high', label: 'High (~4k budget)' },
]

const MODEL_HINTS: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  google: 'gemini-2.0-flash',
  custom: 'model id served by your endpoint',
}

/** The <select> yields a plain string, so narrow it back, keeping the current value if odd. */
function parseProvider(value: string, fallback: AiProvider): AiProvider {
  const match = PROVIDERS.find((provider) => provider.value === value)
  return match ? match.value : fallback
}

function parseThinkingLevel(value: string, fallback: AiThinkingLevel): AiThinkingLevel {
  const match = THINKING_LEVELS.find((entry) => entry.value === value)
  return match ? match.value : fallback
}

/**
 * The BYOK inputs — provider, playing strength, API key, model discovery + metadata lookup,
 * Base URL (for `custom`), and customizable inference parameters pre-filled from model metadata.
 */
const ByokFields = ({
  idPrefix,
  value,
  onChange,
  storedTail,
  keyPlaceholder = 'sk-\u2026',
  autoFocusKey = false,
  disabled = false,
  seatColor = 'light',
}: ByokFieldsProps) => {
  const [revealKey, setRevealKey] = useState(false)
  const [availableModels, setAvailableModels] = useState<AiModelMetadata[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [endpointMetadata, setEndpointMetadata] = useState<AiModelMetadata | null>(null)
  const [metadataNotice, setMetadataNotice] = useState<string | null>(null)

  const hasStoredKey = Boolean(storedTail)
  const id = (name: string): string => `${idPrefix}-${name}`

  const difficulty: AiDifficulty = value.difficulty ?? DEFAULT_DIFFICULTY
  const difficultyBlurb =
    AI_DIFFICULTIES.find((entry) => entry.value === difficulty)?.blurb ?? ''

  const effectiveModel = value.model.trim() || DEFAULT_MODELS[value.provider]
  const canQueryEndpoint =
    !disabled &&
    value.apiKey.trim().length > 0 &&
    (value.provider !== 'custom' || (value.baseUrl ?? '').trim().length > 0)

  const metadata: AiModelMetadata =
    (endpointMetadata !== null && endpointMetadata.id === effectiveModel
      ? endpointMetadata
      : null) ??
    availableModels.find((entry) => entry.id === effectiveModel) ??
    lookupCatalogMetadata(value.provider, effectiveModel)

  // Query the live model metadata endpoint (debounced) whenever credentials and a model name exist.
  useEffect(() => {
    const targetModel = value.model.trim() || DEFAULT_MODELS[value.provider]
    if (!canQueryEndpoint || targetModel.length === 0) {
      return
    }

    const endpointConfig: AiEngineConfig = {
      provider: value.provider,
      model: value.model,
      apiKey: value.apiKey,
      baseUrl: value.baseUrl,
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoadingMetadata(true)
      void fetchModelMetadata(endpointConfig, targetModel, { signal: controller.signal }).then(
        (res) => {
          if (controller.signal.aborted) {
            return
          }
          setLoadingMetadata(false)
          if (res.ok) {
            setEndpointMetadata(res.metadata)
            setMetadataNotice(
              `Loaded metadata for ${res.metadata.displayName} from provider endpoint.`,
            )
          }
        },
      )
    }, 350)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value.provider, value.model, value.apiKey, value.baseUrl, canQueryEndpoint])

  const handleLoadModels = async (): Promise<void> => {
    setLoadingModels(true)
    setMetadataNotice(null)
    const result = await fetchProviderModels(value)
    setLoadingModels(false)

    if (!result.ok) {
      setMetadataNotice(result.error)
      return
    }

    setAvailableModels(result.models)
    const currentId = value.model.trim() || DEFAULT_MODELS[value.provider]
    const matched = result.models.find((entry) => entry.id === currentId) ?? result.models[0]
    if (matched) {
      setEndpointMetadata(matched)
      if (value.model.trim().length === 0) {
        onChange({ model: matched.id })
      }
    }
    setMetadataNotice(
      result.models.length > 0
        ? `Discovered ${result.models.length} model${result.models.length === 1 ? '' : 's'} from provider.`
        : 'Provider returned an empty model list.',
    )
  }

  const handleFetchMetadataNow = async (): Promise<void> => {
    setLoadingMetadata(true)
    setMetadataNotice(null)
    const result = await fetchModelMetadata(value, effectiveModel)
    setLoadingMetadata(false)
    setEndpointMetadata(result.metadata)
    setMetadataNotice(
      result.ok
        ? `Loaded live metadata for ${result.metadata.displayName}.`
        : (result.error ?? 'Showing catalog defaults for this model.'),
    )
  }

  const defaults = resolveDefaultParams(difficulty, metadata)
  const effective = resolveEffectiveParams(value, metadata)
  const hasCustomParams = value.params !== undefined && Object.keys(value.params).length > 0

  const patchParams = (changes: Partial<AiInferenceParams>): void => {
    const merged: AiInferenceParams = { ...(value.params ?? {}), ...changes }
    onChange({ params: merged })
  }

  const resetParams = (): void => {
    onChange({ params: undefined })
  }

  return (
    <div className="space-y-3">
      {/* Row 1: Provider & Difficulty side-by-side */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={id('provider')} className="mb-1 block text-xs font-medium text-slate-300">
            AI provider
          </label>
          <select
            id={id('provider')}
            className={cn(FIELD, 'py-1.5 text-xs')}
            value={value.provider}
            onChange={(event) => {
              const nextProvider = parseProvider(event.target.value, value.provider)
              setAvailableModels([])
              setMetadataNotice(null)
              onChange({ provider: nextProvider })
            }}
          >
            {PROVIDERS.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={id('difficulty')}
            className="mb-1 block text-xs font-medium text-slate-300"
          >
            AI difficulty
          </label>
          <select
            id={id('difficulty')}
            title={difficultyBlurb}
            className={cn(FIELD, 'py-1.5 text-xs')}
            value={difficulty}
            onChange={(event) =>
              onChange({ difficulty: parseDifficulty(event.target.value, difficulty) })
            }
          >
            {AI_DIFFICULTIES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label} — {entry.blurb}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: API Key (full panel width so keys are never cramped) */}
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label htmlFor={id('api-key')} className="text-xs font-medium text-slate-300">
            API key
          </label>
          <span className="text-[11px] text-slate-400">
            {hasStoredKey ? `Stored key ends in ${storedTail}` : 'Required to enable seat'}
          </span>
        </div>
        <div className="relative">
          <input
            id={id('api-key')}
            type={revealKey ? 'text' : 'password'}
            // A non-standard name keeps password managers from autofilling a secret.
            name={`${idPrefix}-byok-key`}
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocusKey}
            placeholder={
              hasStoredKey ? 'paste a new key to replace the stored one' : keyPlaceholder
            }
            className={cn(FIELD, 'py-1.5 pr-9 font-mono text-xs')}
            value={value.apiKey}
            onChange={(event) => onChange({ apiKey: event.target.value })}
          />
          <button
            type="button"
            onClick={() => setRevealKey((current) => !current)}
            aria-label={revealKey ? 'Hide API key' : 'Show API key'}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition hover:text-slate-100"
          >
            {revealKey ? (
              <EyeOff className="size-3.5" aria-hidden />
            ) : (
              <Eye className="size-3.5" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {/* Row 3 (Custom provider only): Base URL */}
      {value.provider === 'custom' ? (
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={id('base-url')} className="text-xs font-medium text-slate-300">
              Base URL
            </label>
            <span className="text-[11px] text-slate-400">
              OpenAI-compatible endpoint with <code>/v1</code> suffix
            </span>
          </div>
          <input
            id={id('base-url')}
            // type="text" on purpose: type="url" adds native form validation that would
            // reject the scheme-less endpoints people paste (localhost:11434/v1).
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className={cn(FIELD, 'py-1.5 font-mono text-xs')}
            placeholder="http://localhost:11434/v1"
            value={value.baseUrl ?? ''}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
          />
        </div>
      ) : null}

      {/* Row 4: Model & Endpoint Discovery (full panel width so buttons never overflow) */}
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={id('model')} className="text-xs font-medium text-slate-300">
            Model <span className="text-slate-500">(optional)</span>
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleLoadModels()}
              disabled={loadingModels || !canQueryEndpoint}
              className={cn(
                BUTTON,
                'border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800',
              )}
              title="Fetch available models from provider"
            >
              <RefreshCw className={cn('size-3', loadingModels && 'animate-spin')} aria-hidden />
              {loadingModels ? 'Loading…' : 'Fetch models'}
            </button>
            <button
              type="button"
              onClick={() => void handleFetchMetadataNow()}
              disabled={disabled || loadingMetadata || effectiveModel.length === 0}
              className={cn(
                BUTTON,
                'border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800',
              )}
              title="Query token limits and parameter defaults for this model"
            >
              <Sparkles className="size-3 text-sky-400" aria-hidden />
              {loadingMetadata ? 'Querying…' : 'Query metadata'}
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            id={id('model')}
            list={availableModels.length > 0 ? id('model-list') : undefined}
            className={cn(FIELD, 'py-1.5 text-xs')}
            placeholder={MODEL_HINTS[value.provider]}
            autoComplete="off"
            spellCheck={false}
            value={value.model}
            onChange={(event) => onChange({ model: event.target.value })}
          />
          {availableModels.length > 0 ? (
            <>
              <datalist id={id('model-list')}>
                {availableModels.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.displayName}
                  </option>
                ))}
              </datalist>
              <label htmlFor={id('model-select')} className="sr-only">
                Select discovered model
              </label>
              <select
                id={id('model-select')}
                className={cn(FIELD, 'max-w-[13rem] py-1.5 text-xs')}
                value={value.model.trim() || DEFAULT_MODELS[value.provider]}
                onChange={(event) => onChange({ model: event.target.value })}
              >
                {availableModels.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.displayName}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
        {metadataNotice ? (
          <p className="mt-1 text-[11px] text-sky-300">{metadataNotice}</p>
        ) : null}
      </div>

      {/* Inference Parameters & System Prompt */}
      {/* Collapsed by default; the submit helper auto-expands it if a param is invalid (E1). */}
      <details className="group space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-200">
            <SlidersHorizontal className="size-3.5 text-sky-400" aria-hidden />
            Inference parameters
            <span className="font-normal text-[11px] text-slate-400">
              · <span className="font-mono text-slate-300">{metadata.id}</span> (
              {metadata.source === 'endpoint' ? 'endpoint' : 'catalog'})
              {metadata.contextWindow !== null
                ? ` · ${metadata.contextWindow.toLocaleString()} ctx`
                : ''}
            </span>
            <ChevronDown
              className="size-3.5 text-slate-400 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </span>

          {hasCustomParams ? (
            <button
              type="button"
              onClick={resetParams}
              className={cn(BUTTON, 'px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800')}
            >
              <RotateCcw className="size-3" aria-hidden />
              Reset defaults
            </button>
          ) : null}
        </summary>

        {/* 3-column grid so every input & label has ample room */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div>
            <label
              htmlFor={id('context-window')}
              className="mb-1 block text-[11px] font-medium text-slate-300"
            >
              Context window{' '}
              <span className="text-slate-500">
                (def {Math.round(defaults.contextWindow / 1024)}k)
              </span>
            </label>
            <input
              id={id('context-window')}
              type="number"
              required
              min={512}
              max={metadata.contextWindow ?? 2_000_000}
              // step=1: catalog/default values (e.g. 128000) are not all multiples of 512, and a
              // stepMismatch here silently blocked submit inside the collapsed <details> (E1).
              step={1}
              className={cn(FIELD, 'px-2.5 py-1.5 font-mono text-xs')}
              value={effective.contextWindow}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10)
                if (Number.isFinite(parsed) && parsed >= 512) {
                  patchParams({ contextWindow: parsed })
                }
              }}
            />
          </div>

          <div>
            <label
              htmlFor={id('max-tokens')}
              className="mb-1 block text-[11px] font-medium text-slate-300"
            >
              Max output <span className="text-slate-500">(def {defaults.maxTokens})</span>
            </label>
            <input
              id={id('max-tokens')}
              type="number"
              required
              min={64}
              max={metadata.maxOutputTokens ?? 65_536}
              // step=1: the shipped default (2048) and most catalog values are off a 128 grid
              // (min 64), which made the untouched form un-submittable (E1, P0).
              step={1}
              className={cn(FIELD, 'px-2.5 py-1.5 font-mono text-xs')}
              value={effective.maxTokens}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10)
                if (Number.isFinite(parsed) && parsed >= 64) {
                  patchParams({ maxTokens: parsed })
                }
              }}
            />
          </div>

          <div className="col-span-2 sm:col-span-1">
            <label
              htmlFor={id('thinking-level')}
              className="mb-1 block text-[11px] font-medium text-slate-300"
            >
              Thinking <span className="text-slate-500">(def {defaults.thinkingLevel})</span>
            </label>
            <select
              id={id('thinking-level')}
              className={cn(FIELD, 'px-2.5 py-1.5 text-xs')}
              value={effective.thinkingLevel}
              onChange={(event) =>
                patchParams({
                  thinkingLevel: parseThinkingLevel(event.target.value, effective.thinkingLevel),
                })
              }
            >
              {THINKING_LEVELS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={id('temperature')}
              className="mb-1 block text-[11px] font-medium text-slate-300"
            >
              Temperature{' '}
              <span className="text-slate-500">
                (0–{metadata.maxTemperature ?? 2}, def {defaults.temperature})
              </span>
            </label>
            <input
              id={id('temperature')}
              type="number"
              min={0}
              max={metadata.maxTemperature ?? 2}
              step={0.1}
              className={cn(FIELD, 'px-2.5 py-1.5 font-mono text-xs')}
              value={effective.temperature}
              onChange={(event) => {
                const parsed = Number.parseFloat(event.target.value)
                if (Number.isFinite(parsed) && parsed >= 0) {
                  patchParams({ temperature: parsed })
                }
              }}
            />
          </div>

          <div>
            <label
              htmlFor={id('top-p')}
              className="mb-1 block text-[11px] font-medium text-slate-300"
            >
              Top-P <span className="text-slate-500">(0.05–1, def {defaults.topP})</span>
            </label>
            <input
              id={id('top-p')}
              type="number"
              min={0.05}
              max={1}
              step={0.05}
              className={cn(FIELD, 'px-2.5 py-1.5 font-mono text-xs')}
              value={effective.topP}
              onChange={(event) => {
                const parsed = Number.parseFloat(event.target.value)
                if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) {
                  patchParams({ topP: parsed })
                }
              }}
            />
          </div>
        </div>

        {/* System Prompt */}
        <div className="space-y-2 border-t border-slate-800/70 pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={id('system-prompt')} className="text-xs font-medium text-slate-300">
              System prompt <span className="text-slate-500">(strategy &amp; persona)</span>
            </label>
            <span className="font-mono text-[11px] text-slate-500">
              {effective.systemPrompt.length}/{MAX_CUSTOM_SYSTEM_PROMPT_CHARS}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => patchParams({ systemPrompt: undefined })}
              className={cn(
                BUTTON,
                'border px-2 py-0.5 text-[11px]',
                value.params?.systemPrompt === undefined ||
                  value.params.systemPrompt.trim() === defaults.systemPrompt.trim()
                  ? 'border-sky-600 bg-sky-700 text-white'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800',
              )}
              title={`Default strategy for ${DIFFICULTY_LABELS[difficulty]} difficulty`}
            >
              Default ({DIFFICULTY_LABELS[difficulty]})
            </button>
            {SYSTEM_PROMPT_PRESETS.map((preset) => {
              const active = value.params?.systemPrompt?.trim() === preset.prompt.trim()
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => patchParams({ systemPrompt: preset.prompt })}
                  className={cn(
                    BUTTON,
                    'border px-2 py-0.5 text-[11px]',
                    active
                      ? 'border-sky-600 bg-sky-700 text-white'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800',
                  )}
                  title={preset.prompt}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          <textarea
            id={id('system-prompt')}
            rows={2}
            maxLength={MAX_CUSTOM_SYSTEM_PROMPT_CHARS}
            className={cn(FIELD, 'resize-y py-1.5 font-sans text-xs leading-relaxed')}
            placeholder={defaults.systemPrompt}
            value={effective.systemPrompt}
            onChange={(event) => patchParams({ systemPrompt: event.target.value })}
          />

          <details className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-2.5 py-1 text-[11px]">
            <summary className="cursor-pointer select-none font-medium text-slate-400 hover:text-slate-200">
              Preview full system prompt ({SEAT_LABELS[seatColor]} seat · includes board rules &amp; JSON move contract)
            </summary>
            <pre className="mt-1.5 max-h-36 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-slate-300">
              {buildSystemPrompt(seatColor, difficulty, value.params?.systemPrompt)}
            </pre>
          </details>
        </div>
      </details>
    </div>
  )
}

export default ByokFields
