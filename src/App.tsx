import Board from '@/components/Board'
import Die from '@/components/Die'
import SettingsModal from '@/components/SettingsModal'
import { useSettings } from '@/hooks/useSettings'
import { cn } from '@/utils/cn'
import { Dices, KeyRound, Settings, ShieldCheck, Sparkles } from 'lucide-react'

const App = () => {
  const { isConfigured, isSettingsOpen, maskedApiKey, openSettings, closeSettings } = useSettings()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-800 bg-slate-900/70">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-50">
              <Dices className="size-5 text-amber-400" aria-hidden />
              AI Backgammon
            </h1>
            <p className="text-sm text-slate-400">
              Bring-your-own-key inference. Scaffold only — no game logic yet.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
                isConfigured
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
              )}
            >
              {isConfigured ? (
                <ShieldCheck className="size-3.5" aria-hidden />
              ) : (
                <KeyRound className="size-3.5" aria-hidden />
              )}
              {isConfigured ? `Key saved · ${maskedApiKey}` : 'No API key configured'}
            </span>

            <button
              type="button"
              onClick={openSettings}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 transition hover:border-slate-600 hover:bg-slate-700"
            >
              <Settings className="size-4" aria-hidden />
              Settings
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center gap-6 px-4 py-6">
        <Board />

        <section
          aria-label="Dice and AI controls (placeholders)"
          className="grid w-full max-w-3xl gap-3 sm:grid-cols-2"
        >
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Dice</h2>
              <p className="text-xs text-slate-400">Static faces — rolling comes with game logic.</p>
            </div>
            <div className="flex items-center gap-2">
              <Die value={6} />
              <Die value={2} used label="Die showing 2, already spent" />
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Sparkles className="size-4 text-sky-400" aria-hidden />
              AI move suggestions
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {isConfigured
                ? 'Key detected. The inference client is not wired up in this phase.'
                : 'Add an API key in Settings to enable the engine later.'}
            </p>
            <button
              type="button"
              disabled
              className="mt-3 inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-500"
            >
              Ask the AI (coming soon)
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800 px-4 py-3">
        <p className="mx-auto max-w-5xl text-xs text-slate-500">
          Settings persist in this browser&rsquo;s <code>localStorage</code> under{' '}
          <code>ai-backgammon:settings</code>. Built with Vite + React + Tailwind CSS; deploys to
          Cloudflare Pages.
        </p>
      </footer>

      {isSettingsOpen ? <SettingsModal onClose={closeSettings} /> : null}
    </div>
  )
}

export default App
