import ByokFields from '@/components/ByokFields'
import { BUTTON } from '@/components/ui/controls'
import Modal from '@/components/ui/Modal'
import { useByokDraft } from '@/hooks/useByokDraft'
import { useGameConfig } from '@/hooks/useGameConfig'
import { useSettings } from '@/hooks/useSettings'
import { logger } from '@/lib/logger'
import { DEFAULT_OPPONENT_CONFIG } from '@/state/gameConfigStore'
import { DEFAULT_SETTINGS } from '@/state/settingsStore'
import type { AiEngineConfig, AppSettings } from '@/types/settings'
import { cn } from '@/utils/cn'
import { ArrowLeftRight, Check, Copy, KeyRound, ShieldAlert, Trash } from 'lucide-react'
import { useState, type FormEvent } from 'react'

interface SettingsModalProps {
  /** The modal is mounted only while open, so the form always initialises fresh. */
  onClose: () => void
}

function cloneEngineConfig(source: AiEngineConfig): AiEngineConfig {
  return {
    ...source,
    params: source.params ? { ...source.params } : undefined,
  }
}

/**
 * Side-by-side BYOK configuration for BYOK 1 (Primary engine) and BYOK 2 (Secondary engine),
 * controlled by a top-level "Use two different BYOK" toggle.
 */
const SettingsModal = ({ onClose }: SettingsModalProps) => {
  const { settings, saveSettings, clearSettings, isConfigured, maskedApiKey } = useSettings()
  const {
    config,
    mode,
    aiMatchType,
    opponent,
    opponentConfigured,
    maskedOpponentKey,
    saveSetup,
    clearOpponent,
  } = useGameConfig()

  const byok1 = useByokDraft(settings)
  const byok2 = useByokDraft(opponent)
  const [useTwoByok, setUseTwoByok] = useState<boolean>(aiMatchType === 'custom')
  const [error, setError] = useState('')
  const byok1SeatColor =
    !useTwoByok && mode === 'humanVsAi' && (config.humanColor ?? 'light') === 'light'
      ? 'dark'
      : 'light'

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    const nextByok1: AppSettings = byok1.commit()
    const nextByok2: AiEngineConfig = byok2.commit()
    const nextMatchType = useTwoByok ? 'custom' : 'mirror'

    try {
      saveSettings(nextByok1)
      saveSetup({
        mode,
        aiMatchType: nextMatchType,
        opponent: nextByok2,
      })
      // The key is deliberately absent; logger redacts credential-shaped fields anyway.
      logger.info('settings saved', {
        provider: nextByok1.provider,
        model: nextByok1.model,
        useTwoByok,
        secondProvider: useTwoByok ? nextByok2.provider : 'mirror',
      })
      onClose()
    } catch (saveError) {
      setError('This browser refused to store the settings (private mode, or full quota?).')
      logger.error('saving settings failed', { reason: String(saveError) })
    }
  }

  const handleRemoveByok1 = (): void => {
    clearSettings()
    byok1.reset({ ...DEFAULT_SETTINGS })
    setError('')
    logger.info('stored BYOK 1 settings cleared')
  }

  const handleRemoveByok2 = (): void => {
    clearOpponent()
    byok2.reset({ ...DEFAULT_OPPONENT_CONFIG })
    setError('')
    logger.info('stored BYOK 2 settings cleared')
  }

  const handleCopyByok1ToByok2 = (): void => {
    byok2.reset(cloneEngineConfig(byok1.draft))
    setError('')
  }

  const handleSwapByok = (): void => {
    const first = cloneEngineConfig(byok1.draft)
    const second = cloneEngineConfig(byok2.draft)
    byok1.reset(second)
    byok2.reset(first)
    setError('')
  }

  return (
    <Modal
      titleId="settings-title"
      title="BYOK settings"
      subtitle="Configure one AI engine for all seats, or enable a second BYOK engine side-by-side."
      icon={KeyRound}
      onClose={onClose}
      closeLabel="Close settings"
      panelClassName="max-w-6xl"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-2.5">
          <label
            htmlFor="settings-use-two-byok"
            className="flex cursor-pointer items-center gap-2.5 select-none"
          >
            <input
              id="settings-use-two-byok"
              type="checkbox"
              checked={useTwoByok}
              onChange={(event) => setUseTwoByok(event.target.checked)}
              className="size-4 rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-2 focus:ring-sky-500/40"
            />
            <span className="text-sm font-semibold text-slate-100">
              Use two different BYOK
            </span>
            <span className="text-xs text-slate-400">
              —{' '}
              {useTwoByok
                ? 'BYOK 1 plays White and BYOK 2 plays Black in AI vs AI matches.'
                : 'BYOK 2 is disabled; BYOK 1 powers every AI seat.'}
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyByok1ToByok2}
              disabled={!useTwoByok}
              title="Copy provider, API key, model, and parameters from BYOK 1 into BYOK 2"
              className={cn(
                BUTTON,
                'border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800',
              )}
            >
              <Copy className="size-3.5 text-sky-400" aria-hidden />
              Copy BYOK 1 → BYOK 2
            </button>
            <button
              type="button"
              onClick={handleSwapByok}
              disabled={!useTwoByok}
              title="Swap BYOK 1 and BYOK 2 configurations"
              className={cn(
                BUTTON,
                'border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800',
              )}
            >
              <ArrowLeftRight className="size-3.5 text-sky-400" aria-hidden />
              Swap 1 ↔ 2
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* BYOK 1 Panel */}
          <section
            aria-labelledby="byok1-heading"
            className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/40 p-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="byok1-heading" className="text-sm font-semibold text-slate-100">
                    BYOK 1
                  </h3>
                  <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">
                    {useTwoByok ? 'White (AI vs AI) · AI (Human vs AI)' : 'All AI seats'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleRemoveByok1}
                  disabled={!isConfigured && byok1.draft.apiKey.trim().length === 0}
                  className={cn(BUTTON, 'px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10')}
                >
                  <Trash className="size-3.5" aria-hidden />
                  Remove key
                </button>
              </div>

              <ByokFields
                idPrefix="settings-byok1"
                value={byok1.draft}
                onChange={byok1.patch}
                storedTail={isConfigured ? maskedApiKey.slice(-4) : undefined}
                autoFocusKey
                seatColor={byok1SeatColor}
              />
            </div>
          </section>

          {/* BYOK 2 Panel */}
          <section
            aria-labelledby="byok2-heading"
            className={cn(
              'flex flex-col justify-between rounded-xl border p-4 transition',
              useTwoByok
                ? 'border-slate-800 bg-slate-950/40'
                : 'border-slate-800/60 bg-slate-950/20',
            )}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    id="byok2-heading"
                    className={cn(
                      'text-sm font-semibold',
                      useTwoByok ? 'text-slate-100' : 'text-slate-400',
                    )}
                  >
                    BYOK 2
                  </h3>
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                      useTwoByok
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-slate-700 bg-slate-800/80 text-slate-400',
                    )}
                  >
                    {useTwoByok ? 'Black (AI vs AI)' : 'Disabled · Mirroring BYOK 1'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleRemoveByok2}
                  disabled={
                    !useTwoByok || (!opponentConfigured && byok2.draft.apiKey.trim().length === 0)
                  }
                  className={cn(BUTTON, 'px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10')}
                >
                  <Trash className="size-3.5" aria-hidden />
                  Remove key
                </button>
              </div>

              <fieldset
                disabled={!useTwoByok}
                aria-disabled={!useTwoByok}
                className={cn(
                  'space-y-3 transition-opacity',
                  !useTwoByok && 'pointer-events-none select-none opacity-40 grayscale',
                )}
              >
                <ByokFields
                  idPrefix="settings-byok2"
                  value={byok2.draft}
                  onChange={byok2.patch}
                  storedTail={opponentConfigured ? maskedOpponentKey.slice(-4) : undefined}
                  disabled={!useTwoByok}
                  seatColor="dark"
                />
              </fieldset>
            </div>
          </section>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-2.5">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <ShieldAlert className="size-3.5 shrink-0 text-amber-400" aria-hidden />
            <span>
              Keys are stored in <code>localStorage</code> and relayed via same-origin{' '}
              <code>/api/ai-proxy</code> (never logged). Use dedicated, revocable keys.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={cn(BUTTON, 'px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={cn(BUTTON, 'bg-sky-600 px-3.5 py-1.5 text-xs text-white hover:bg-sky-500')}
            >
              <Check className="size-3.5" aria-hidden />
              Save settings
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

export default SettingsModal
