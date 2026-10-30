import ByokFields from '@/components/ByokFields'
import { BUTTON } from '@/components/ui/controls'
import Modal from '@/components/ui/Modal'
import { useByokDraft } from '@/hooks/useByokDraft'
import { useSettings } from '@/hooks/useSettings'
import { logger } from '@/lib/logger'
import { DEFAULT_SETTINGS } from '@/state/settingsStore'
import type { AppSettings } from '@/types/settings'
import { cn } from '@/utils/cn'
import { Check, KeyRound, ShieldAlert, Trash } from 'lucide-react'
import { useState, type FormEvent } from 'react'

interface SettingsModalProps {
  /** The modal is mounted only while open, so the form always initialises fresh. */
  onClose: () => void
}

/**
 * The player's personal BYOK bundle. Fields live in ByokFields, dialog chrome in Modal and the
 * draft/trim rules in useByokDraft, so nothing here is duplicated by the game-setup flow.
 */
const SettingsModal = ({ onClose }: SettingsModalProps) => {
  const { settings, saveSettings, clearSettings, isConfigured, maskedApiKey } = useSettings()
  const { draft, patch, reset, commit } = useByokDraft(settings)
  const [error, setError] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    const next: AppSettings = commit()

    try {
      saveSettings(next)
      // The key is deliberately absent; logger redacts credential-shaped fields anyway.
      logger.info('settings saved', { provider: next.provider, model: next.model })
      onClose()
    } catch (saveError) {
      setError('This browser refused to store the settings (private mode, or full quota?).')
      logger.error('saving settings failed', { reason: String(saveError) })
    }
  }

  const handleRemove = (): void => {
    clearSettings()
    reset({ ...DEFAULT_SETTINGS })
    setError('')
    logger.info('stored settings cleared')
  }

  return (
    <Modal
      titleId="settings-title"
      title="BYOK settings"
      subtitle="Pick a provider and paste the key the engine should use."
      icon={KeyRound}
      onClose={onClose}
      closeLabel="Close settings"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <ByokFields
          idPrefix="settings"
          value={draft}
          onChange={patch}
          storedTail={isConfigured ? maskedApiKey.slice(-4) : undefined}
          autoFocusKey
        />

        <div className="flex gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <ShieldAlert className="size-4 shrink-0 text-amber-400" aria-hidden />
          <p className="text-xs leading-relaxed text-slate-400">
            The key is saved in this browser&rsquo;s <code>localStorage</code> and is sent straight to
            your provider from the client. Anyone with access to this device can read it — use a
            dedicated, revocable key.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={handleRemove}
            disabled={!isConfigured}
            className={cn(BUTTON, 'text-red-300 hover:bg-red-500/10')}
          >
            <Trash className="size-4" aria-hidden />
            Remove key
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={cn(BUTTON, 'text-slate-300 hover:bg-slate-800')}
            >
              Cancel
            </button>
            <button type="submit" className={cn(BUTTON, 'bg-sky-600 text-white hover:bg-sky-500')}>
              <Check className="size-4" aria-hidden />
              Save
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

export default SettingsModal
