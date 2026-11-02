import AboutModal from '@/components/AboutModal'
import Board from '@/components/Board'
import GameControls from '@/components/GameControls'
import GameLog from '@/components/GameLog'
import GameSetupModal from '@/components/GameSetupModal'
import MenuBar from '@/components/MenuBar'
import SettingsModal from '@/components/SettingsModal'
import SplitPane from '@/components/SplitPane'
import { useGame } from '@/hooks/useGame'
import { useAiTurn } from '@/hooks/useAiTurn'
import { useGameConfig } from '@/hooks/useGameConfig'
import { useSettings } from '@/hooks/useSettings'
import { startTelemetry } from '@/utils/telemetry'
import type { GameMode } from '@/types/gameConfig'
import { Dices } from 'lucide-react'
import { useEffect, useState } from 'react'

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

  // Anonymous usage stats for the site admin (see utils/telemetry.ts for exactly what is sent).
  useEffect(() => startTelemetry(), [])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-900/95 shadow-md backdrop-blur-md shrink-0">
        <div className="flex w-full items-center justify-between px-3 sm:px-4 py-2">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* 'AI Backgammon' branding at the start of the line - most lefthand */}
            <div className="flex items-center gap-2.5 pr-3 sm:pr-4 border-r border-slate-700/60 shrink-0">
              <Dices className="size-5 text-amber-400 shrink-0" aria-hidden />
              <div className="flex flex-col">
                <h1 className="text-sm font-bold tracking-tight text-slate-50 leading-tight">
                  AI Backgammon
                </h1>
                <p className="text-[10px] text-slate-400 leading-none hidden md:block">
                  Bring-your-own-key inference · Classic rules, turns & live AI seats
                </p>
              </div>
            </div>

            {/* Menu items on the exact same level */}
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
        className="relative flex flex-1 min-h-0 w-full overflow-hidden"
      >
        <SplitPane
          defaultSplitPercent={74}
          minSplitPercent={55}
          maxSplitPercent={85}
          className="h-full w-full"
          left={
            <div className="flex h-full w-full items-center justify-center">
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
            </div>
          }
          right={
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
              <div className="shrink-0">
                <GameControls />
              </div>
              <GameLog />
            </div>
          }
        />
      </main>

      <footer className="border-t border-slate-800 px-4 py-1.5 shrink-0 bg-slate-900/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <p>
            Created by <span className="font-semibold text-slate-300">Kamen Kolev</span> ·{' '}
            <a
              href="https://www.kamenonline.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:underline"
            >
              www.kamenonline.com
            </a>
          </p>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/kolevkamena1/ai-backgammon"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-slate-200 hover:underline"
            >
              GitHub Repository
            </a>
            <span>·</span>
            <span>Vite + React + Tailwind CSS</span>
            <span>·</span>
            <span title="Anonymous, cookieless: country, network, device type, game mode and outcome. Never your API keys or the IP address itself. Honours Do Not Track.">
              Anonymous usage stats
            </span>
          </div>
        </div>
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
