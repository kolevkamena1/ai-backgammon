import Board from '@/components/Board'
import Die from '@/components/Die'
import GameSetupModal from '@/components/GameSetupModal'
import SettingsModal from '@/components/SettingsModal'
import { useGameConfig } from '@/hooks/useGameConfig'
import { useSettings } from '@/hooks/useSettings'
import type { SeatAssignment } from '@/types/gameConfig'
import { cn } from '@/utils/cn'
import { SEAT_LABELS, describeEngine, describeMode, planSeats, seatProblems } from '@/utils/gameConfig'
import { Dices, KeyRound, Settings, ShieldCheck, Sparkles, Swords } from 'lucide-react'

/** One roster line per seat: who plays it, and through which engine. */
function seatText(seat: SeatAssignment): string {
  if (seat.kind === 'human') {
    return seat.label
  }

  const engine = describeEngine(seat.engine)
  return `${seat.label} · ${engine.providerName} · ${engine.maskedKey}`
}

const App = () => {
  const { settings, isConfigured, isSettingsOpen, maskedApiKey, openSettings, closeSettings } =
    useSettings()
  const { config, isSetupOpen, openSetup, closeSetup } = useGameConfig()

  const plan = planSeats(settings, config)
  const blocked = seatProblems(plan.light).length + seatProblems(plan.dark).length

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

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
                blocked > 0
                  ? 'border-slate-600 bg-slate-800 text-slate-300'
                  : 'border-sky-500/40 bg-sky-500/10 text-sky-300',
              )}
            >
              {describeMode(config)}
            </span>

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
              onClick={openSetup}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500"
            >
              <Swords className="size-4" aria-hidden />
              New game
            </button>

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
          aria-label="Dice and match setup (placeholders)"
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
              {describeMode(config)}
            </h2>
            <ul className="mt-2 space-y-1 text-xs text-slate-400">
              <li>
                {SEAT_LABELS.light}: {seatText(plan.light)}
              </li>
              <li>
                {SEAT_LABELS.dark}: {seatText(plan.dark)}
              </li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              {blocked > 0
                ? `${blocked} configuration issue${blocked === 1 ? '' : 's'} — open New game to resolve.`
                : 'Both seats are configured. The inference client arrives in Phase 3.'}
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
          Credentials persist in this browser&rsquo;s <code>localStorage</code> under{' '}
          <code>ai-backgammon:settings</code> (yours) and <code>ai-backgammon:game-config</code>{' '}
          (the Custom-match opponent). Built with Vite + React + Tailwind CSS; deploys to
          Cloudflare Pages.
        </p>
      </footer>

      {isSetupOpen ? <GameSetupModal onClose={closeSetup} /> : null}
      {isSettingsOpen ? <SettingsModal onClose={closeSettings} /> : null}
    </div>
  )
}

export default App
