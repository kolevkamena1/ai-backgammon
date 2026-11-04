import AboutModal from '@/components/AboutModal'
import Board from '@/components/Board'
import GameControls from '@/components/GameControls'
import GameLog from '@/components/GameLog'
import GameSetupModal from '@/components/GameSetupModal'
import MatchScoreboard from '@/components/MatchScoreboard'
import MenuBar from '@/components/MenuBar'
import SettingsModal from '@/components/SettingsModal'
import SplitPane from '@/components/SplitPane'
import { useGame } from '@/hooks/useGame'
import { useAiTurn } from '@/hooks/useAiTurn'
import { useGameConfig } from '@/hooks/useGameConfig'
import { useSettings } from '@/hooks/useSettings'
import { startTelemetry } from '@/utils/telemetry'
import type { GameMode } from '@/types/gameConfig'
import { cn } from '@/utils/cn'
import { Dices, GripVertical, PanelBottom, PanelLeft, PanelRight, PanelTop } from 'lucide-react'
import { useEffect, useState } from 'react'

const App = () => {
  const {
    settings,
    theme,
    boardDesign,
    panelPosition,
    isSettingsOpen,
    setTheme,
    setBoardDesign,
    setPanelPosition,
    openSettings,
    closeSettings,
  } = useSettings()
  const { config, isSetupOpen, openSetup, closeSetup } = useGameConfig()
  const game = useGame()

  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [setupInitialMode, setSetupInitialMode] = useState<GameMode | undefined>(undefined)
  const [draggingSource, setDraggingSource] = useState<'panel' | 'board' | null>(null)

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
              panelPosition={panelPosition}
              onSetPanelPosition={setPanelPosition}
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
          panelPosition={panelPosition}
          onDropPanel={setPanelPosition}
          draggingSource={draggingSource}
          setDraggingSource={setDraggingSource}
          className="h-full w-full"
          board={
            <div className="flex h-full w-full min-h-0 min-w-0 flex-col items-center justify-start overflow-hidden gap-2">
              {/* Draggable Board Header */}
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', 'board-panel')
                  e.dataTransfer.effectAllowed = 'move'
                  setDraggingSource('board')
                }}
                onDragEnd={() => setDraggingSource(null)}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return
                  const startX = e.clientX
                  const startY = e.clientY
                  let hasStarted = false

                  const handlePointerMove = (moveEvent: PointerEvent) => {
                    const deltaX = Math.abs(moveEvent.clientX - startX)
                    const deltaY = Math.abs(moveEvent.clientY - startY)
                    if ((deltaX > 20 || deltaY > 20) && !hasStarted) {
                      hasStarted = true
                      setDraggingSource('board')
                    }
                  }

                  const handlePointerUp = (upEvent: PointerEvent) => {
                    window.removeEventListener('pointermove', handlePointerMove)
                    window.removeEventListener('pointerup', handlePointerUp)
                    if (hasStarted) {
                      setDraggingSource(null)
                      const w = window.innerWidth
                      const h = window.innerHeight
                      const x = upEvent.clientX
                      const y = upEvent.clientY
                      const distLeft = x
                      const distRight = w - x
                      const distTop = y
                      const distBottom = h - y
                      const minDist = Math.min(distLeft, distRight, distTop, distBottom)

                      // Moving board to an edge docks board there (so log panel goes to opposite)
                      if (minDist === distLeft) setPanelPosition('right')
                      else if (minDist === distRight) setPanelPosition('left')
                      else if (minDist === distTop) setPanelPosition('bottom')
                      else if (minDist === distBottom) setPanelPosition('top')
                    }
                  }

                  window.addEventListener('pointermove', handlePointerMove)
                  window.addEventListener('pointerup', handlePointerUp)
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/80 shadow-xs cursor-grab active:cursor-grabbing select-none hover:border-slate-700 transition-colors shrink-0 max-w-5xl"
                title="Drag and drop board to reposition layout, or choose a dock option"
              >
                <div className="flex items-center gap-1.5">
                  <GripVertical className="size-4 text-slate-400 group-hover:text-amber-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Backgammon Board
                  </span>
                </div>

                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span className="hidden sm:inline mr-1 text-[10px] text-slate-500">Board Dock:</span>
                  <button
                    type="button"
                    onClick={() => setPanelPosition('right')}
                    className={cn(
                      'rounded p-1 transition-colors hover:text-sky-300 hover:bg-slate-800 cursor-pointer',
                      panelPosition === 'right' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400',
                    )}
                    title="Dock Board on Left (Log on Right)"
                  >
                    <PanelLeft className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelPosition('left')}
                    className={cn(
                      'rounded p-1 transition-colors hover:text-sky-300 hover:bg-slate-800 cursor-pointer',
                      panelPosition === 'left' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400',
                    )}
                    title="Dock Board on Right (Log on Left)"
                  >
                    <PanelRight className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelPosition('bottom')}
                    className={cn(
                      'rounded p-1 transition-colors hover:text-sky-300 hover:bg-slate-800 cursor-pointer',
                      panelPosition === 'bottom' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400',
                    )}
                    title="Dock Board on Top (Log on Bottom)"
                  >
                    <PanelTop className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelPosition('top')}
                    className={cn(
                      'rounded p-1 transition-colors hover:text-sky-300 hover:bg-slate-800 cursor-pointer',
                      panelPosition === 'top' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400',
                    )}
                    title="Dock Board on Bottom (Log on Top)"
                  >
                    <PanelBottom className="size-3.5" />
                  </button>
                </div>
              </div>

              {game.match && game.match.targetPoints > 1 && (
                <div className="shrink-0 w-full flex justify-center">
                  <MatchScoreboard
                    match={game.match}
                    seatPlan={game.seatPlan}
                    diceConfig={game.config?.dice}
                  />
                </div>
              )}
              <div className="flex flex-1 min-h-0 min-w-0 w-full overflow-auto">
                <div className="m-auto flex items-center justify-center p-1">
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
                    cube={game.cube}
                    canDouble={game.canDouble}
                    onDouble={() => game.proposeDouble(game.board!.turn)}
                  />
                </div>
              </div>
            </div>
          }
          panel={
            <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden">
              {/* Draggable panel dock bar */}
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', 'log-panel')
                  e.dataTransfer.effectAllowed = 'move'
                  setDraggingSource('panel')
                }}
                onDragEnd={() => setDraggingSource(null)}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return
                  const startX = e.clientX
                  const startY = e.clientY
                  let hasStarted = false

                  const handlePointerMove = (moveEvent: PointerEvent) => {
                    const deltaX = Math.abs(moveEvent.clientX - startX)
                    const deltaY = Math.abs(moveEvent.clientY - startY)
                    if ((deltaX > 20 || deltaY > 20) && !hasStarted) {
                      hasStarted = true
                      setDraggingSource('panel')
                    }
                  }

                  const handlePointerUp = (upEvent: PointerEvent) => {
                    window.removeEventListener('pointermove', handlePointerMove)
                    window.removeEventListener('pointerup', handlePointerUp)
                    if (hasStarted) {
                      setDraggingSource(null)
                      const w = window.innerWidth
                      const h = window.innerHeight
                      const x = upEvent.clientX
                      const y = upEvent.clientY
                      const distLeft = x
                      const distRight = w - x
                      const distTop = y
                      const distBottom = h - y
                      const minDist = Math.min(distLeft, distRight, distTop, distBottom)

                      if (minDist === distLeft) setPanelPosition('left')
                      else if (minDist === distRight) setPanelPosition('right')
                      else if (minDist === distTop) setPanelPosition('top')
                      else if (minDist === distBottom) setPanelPosition('bottom')
                    }
                  }

                  window.addEventListener('pointermove', handlePointerMove)
                  window.addEventListener('pointerup', handlePointerUp)
                }}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/80 shadow-xs cursor-grab active:cursor-grabbing select-none hover:border-slate-700 transition-colors shrink-0"
                title="Drag and drop to dock on Left, Right, Top, or Bottom"
              >
                <div className="flex items-center gap-1.5">
                  <GripVertical className="size-4 text-slate-400 group-hover:text-sky-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Game Log &amp; Controls
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span className="hidden sm:inline mr-1 text-[10px] text-slate-500">Log Dock:</span>
                  <button
                    type="button"
                    onClick={() => setPanelPosition('left')}
                    className={cn(
                      'rounded p-1 transition-colors hover:text-sky-300 hover:bg-slate-800 cursor-pointer',
                      panelPosition === 'left' ? 'text-sky-400 bg-sky-500/10' : 'text-slate-400',
                    )}
                    title="Dock Log on Left"
                  >
                    <PanelLeft className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelPosition('right')}
                    className={cn(
                      'rounded p-1 transition-colors hover:text-sky-300 hover:bg-slate-800 cursor-pointer',
                      panelPosition === 'right' ? 'text-sky-400 bg-sky-500/10' : 'text-slate-400',
                    )}
                    title="Dock Log on Right"
                  >
                    <PanelRight className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelPosition('top')}
                    className={cn(
                      'rounded p-1 transition-colors hover:text-sky-300 hover:bg-slate-800 cursor-pointer',
                      panelPosition === 'top' ? 'text-sky-400 bg-sky-500/10' : 'text-slate-400',
                    )}
                    title="Dock Log on Top"
                  >
                    <PanelTop className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelPosition('bottom')}
                    className={cn(
                      'rounded p-1 transition-colors hover:text-sky-300 hover:bg-slate-800 cursor-pointer',
                      panelPosition === 'bottom' ? 'text-sky-400 bg-sky-500/10' : 'text-slate-400',
                    )}
                    title="Dock Log on Bottom"
                  >
                    <PanelBottom className="size-3.5" />
                  </button>
                </div>
              </div>

              {/* Panel content: side-by-side on wide/stacked layouts, stacked on narrow column layouts */}
              {panelPosition === 'top' || panelPosition === 'bottom' ? (
                <div className="flex flex-col sm:flex-row gap-3 min-h-0 flex-1 overflow-hidden">
                  <div className="shrink-0 w-full sm:w-80 md:w-96 overflow-y-auto">
                    <GameControls />
                  </div>
                  <div className="flex-1 min-h-0 min-w-0">
                    <GameLog />
                  </div>
                </div>
              ) : (
                <>
                  <div className="shrink-0">
                    <GameControls />
                  </div>
                  <GameLog />
                </>
              )}
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
            <span title="Anonymous, cookieless: country, network, device type, game mode and outcome. Never your API keys or the IP address itself. Honours browser Do Not Track settings.">
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
