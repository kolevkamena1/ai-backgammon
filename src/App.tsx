import AboutModal from '@/components/AboutModal'
import Board from '@/components/Board'
import GameControls from '@/components/GameControls'
import GameSetupModal from '@/components/GameSetupModal'
import MenuBar from '@/components/MenuBar'
import SettingsModal from '@/components/SettingsModal'
import { useGame } from '@/hooks/useGame'
import { useAiTurn } from '@/hooks/useAiTurn'
import { useGameConfig } from '@/hooks/useGameConfig'
import { useSettings } from '@/hooks/useSettings'
import type { GameMode, SeatAssignment } from '@/types/gameConfig'
import { SEAT_LABELS, describeEngine, describeMode, planSeats, seatProblems } from '@/utils/gameConfig'
import { Dices, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

/** One roster line per seat: who plays it, and through which engine. */
function seatText(seat: SeatAssignment): string {
  if (seat.kind === 'human') {
    return seat.label
  }

  const engine = describeEngine(seat.engine)
  return `${seat.label} · ${engine.providerName} · ${engine.maskedKey}`
}

const PANEL = 'rounded-xl border border-slate-800 bg-slate-900/60 p-4'

const App = () => {
  const {
    settings,
    theme,
    boardDesign,
    isSettingsOpen,
    setTheme,
    setBoardDesign,
    openSettings,
    closeSettings,
  } = useSettings()
  const { config, isSetupOpen, openSetup, closeSetup } = useGameConfig()
  const game = useGame()

  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [setupInitialMode, setSetupInitialMode] = useState<GameMode | undefined>(undefined)

  const handleOpenNewGame = (preferredMode?: GameMode): void => {
    setSetupInitialMode(preferredMode)
    openSetup()
  }

  const handleRestartGame = (): void => {
    if (game.active) {
      game.startNewGame(game.config ?? config, settings)
    }
  }

  const handleResetToOpening = (): void => {
    game.resetGame()
  }

  // Keep the root <html data-theme="..."> attribute synced with the user's chosen theme.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Exactly one AI driver for the whole app; the store itself guards single-flight.
  useAiTurn()

  // The saved config is a preview; a started game keeps its own snapshot so later edits cannot
  // swap the player out from under the board.
  const previewPlan = planSeats(settings, config)
  const plan = game.seatPlan ?? previewPlan
  const blocked = seatProblems(plan.light).length + seatProblems(plan.dark).length

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/90 shadow-md backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-50">
              <Dices className="size-6 text-amber-400" aria-hidden />
              AI Backgammon
            </h1>
            <p className="text-xs text-slate-400">Bring-your-own-key inference · Classic rules, turns & live AI seats</p>
          </div>
        </div>

        <div className="border-t border-slate-800/80 bg-slate-950/40">
          <div className="mx-auto w-full max-w-5xl px-3 py-1">
            <MenuBar
              isGameActive={game.active}
              onOpenNewGame={handleOpenNewGame}
              onRestartGame={handleRestartGame}
              onResetToOpening={handleResetToOpening}
              boardDesign={boardDesign}
              onSelectBoardDesign={setBoardDesign}
              theme={theme}
              onSetTheme={setTheme}
              onOpenSettings={openSettings}
              onOpenAbout={() => setIsAboutOpen(true)}
            />
          </div>
        </div>
      </header>

      <main
        data-board-design={boardDesign}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center gap-5 px-4 py-5"
      >
        <Board
          board={game.board ?? undefined}
          turn={game.board?.turn ?? null}
          legalTargets={game.legalTargets}
          selectableSources={game.selectableSources}
          selectedFrom={game.selectedFrom}
          onSelectPoint={game.handlePointClick}
          onDragStartSource={game.handlePointDragStart}
          onDropTarget={game.handlePointDrop}
          design={boardDesign}
        />

        <section aria-label="Game controls and match setup" className="grid w-full max-w-3xl gap-3 sm:grid-cols-2">
          <GameControls />

          <div className={PANEL}>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Sparkles className="size-4 text-sky-400" aria-hidden />
              {describeMode(config)}
              {game.active ? <span className="font-normal text-slate-400">· in progress</span> : null}
            </h2>

            <ul className="mt-2 space-y-1 text-xs text-slate-400">
              <li>
                {SEAT_LABELS.light}: {seatText(plan.light)}
                {game.board?.turn === 'light' ? <span className="text-sky-300"> · to act</span> : null}
              </li>
              <li>
                {SEAT_LABELS.dark}: {seatText(plan.dark)}
                {game.board?.turn === 'dark' ? <span className="text-sky-300"> · to act</span> : null}
              </li>
            </ul>

            <p className="mt-2 text-xs text-slate-500">
              {blocked > 0
                ? `${blocked} configuration issue${blocked === 1 ? '' : 's'} — open New game to resolve.`
                : game.isFinished
                  ? 'Match finished. Start a new game to play again.'
                  : game.active
                    ? 'Both seats are set. Move by clicking a checker, then a green triangle.'
                    : 'Both seats are configured. Start a game to roll.'}
            </p>


          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800 px-4 py-3">
        <p className="mx-auto max-w-5xl text-xs text-slate-500">
          Credentials persist in this browser&rsquo;s <code>localStorage</code> under{' '}
          <code>ai-backgammon:settings</code> (yours) and <code>ai-backgammon:game-config</code>{' '}
          (the Custom-match opponent). The board in progress is never persisted. Built with Vite +
          React + Tailwind CSS; deploys to Cloudflare Pages.
        </p>
      </footer>

      {isSetupOpen ? (
        <GameSetupModal initialMode={setupInitialMode} onClose={closeSetup} />
      ) : null}
      {isSettingsOpen ? <SettingsModal onClose={closeSettings} /> : null}
      {isAboutOpen ? <AboutModal onClose={() => setIsAboutOpen(false)} /> : null}
    </div>
  )
}

export default App
