import { FIELD, HINT, LABEL } from '@/components/ui/controls'
import type { AiDifficulty, AiEngineConfig, AiProvider } from '@/types/settings'
import { AI_DIFFICULTIES, DEFAULT_DIFFICULTY, parseDifficulty } from '@/utils/gameConfig'
import { cn } from '@/utils/cn'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

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
}

const PROVIDERS: ReadonlyArray<{ value: AiProvider; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
]

const MODEL_HINTS: Record<AiProvider, string> = {
  openai: 'gpt-5.1',
  anthropic: 'claude-sonnet-4-5',
  google: 'gemini-2.5-flash',
  custom: 'model id served by your endpoint',
}

/** The <select> yields a plain string, so narrow it back, keeping the current value if odd. */
function parseProvider(value: string, fallback: AiProvider): AiProvider {
  const match = PROVIDERS.find((provider) => provider.value === value)
  return match ? match.value : fallback
}

/**
 * The BYOK inputs — provider, playing strength, API key, model, and the Base URL that only appears
 * for `custom`. Fully controlled: no persistence, no notices, no buttons (the host owns those).
 * Shared by Settings and the Custom-opponent block of the setup modal, which is why a seat's
 * difficulty is carried on `AiEngineConfig` instead of in a UI-only setting.
 */
const ByokFields = ({
  idPrefix,
  value,
  onChange,
  storedTail,
  keyPlaceholder = 'sk-\u2026',
  autoFocusKey = false,
}: ByokFieldsProps) => {
  const [revealKey, setRevealKey] = useState(false)
  const hasStoredKey = Boolean(storedTail)
  const id = (name: string): string => `${idPrefix}-${name}`

  // Read through a default so an engine saved before this field existed still renders a real option
  // instead of falling back to the browser's first one and quietly changing the level.
  const difficulty: AiDifficulty = value.difficulty ?? DEFAULT_DIFFICULTY
  const difficultyBlurb =
    AI_DIFFICULTIES.find((entry) => entry.value === difficulty)?.blurb ?? ''

  return (
    <>
      <div>
        <label htmlFor={id('provider')} className={LABEL}>
          AI provider
        </label>
        <select
          id={id('provider')}
          className={FIELD}
          value={value.provider}
          onChange={(event) =>
            onChange({ provider: parseProvider(event.target.value, value.provider) })
          }
        >
          {PROVIDERS.map((provider) => (
            <option key={provider.value} value={provider.value}>
              {provider.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={id('difficulty')} className={LABEL}>
          AI difficulty
        </label>
        <select
          id={id('difficulty')}
          className={FIELD}
          value={difficulty}
          onChange={(event) =>
            onChange({ difficulty: parseDifficulty(event.target.value, difficulty) })
          }
        >
          {AI_DIFFICULTIES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
        <p className={HINT}>{difficultyBlurb}</p>
      </div>

      <div>
        <label htmlFor={id('api-key')} className={LABEL}>
          API key
        </label>
        <div className="relative">
          <input
            id={id('api-key')}
            type={revealKey ? 'text' : 'password'}
            // A non-standard name keeps password managers from autofilling a secret.
            name={`${idPrefix}-byok-key`}
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocusKey}
            placeholder={hasStoredKey ? 'paste a new key to replace the stored one' : keyPlaceholder}
            className={cn(FIELD, 'pr-10 font-mono')}
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
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>
        <p className={HINT}>
          {hasStoredKey
            ? `A key ending ${storedTail} is already stored in this browser.`
            : 'Leave empty to keep the AI engine disabled.'}
          </p>
      </div>

      <div>
        <label htmlFor={id('model')} className={LABEL}>
          Model <span className="text-slate-500">(optional)</span>
        </label>
        <input
          id={id('model')}
          className={FIELD}
          placeholder={MODEL_HINTS[value.provider]}
          autoComplete="off"
          spellCheck={false}
          value={value.model}
          onChange={(event) => onChange({ model: event.target.value })}
        />
      </div>

      {value.provider === 'custom' ? (
        <div>
          <label htmlFor={id('base-url')} className={LABEL}>
            Base URL
          </label>
          <input
            id={id('base-url')}
            // type="text" on purpose: type="url" adds native form validation that would
            // reject the scheme-less endpoints people paste (localhost:11434/v1).
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className={cn(FIELD, 'font-mono')}
            placeholder="http://localhost:11434/v1"
            value={value.baseUrl ?? ''}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
          />
          <p className={HINT}>
            OpenAI-compatible endpoint, including the <code>/v1</code> suffix (Ollama, vLLM,
            LM Studio). Ignored by the built-in providers.
          </p>
        </div>
      ) : null}
    </>
  )
}

export default ByokFields
