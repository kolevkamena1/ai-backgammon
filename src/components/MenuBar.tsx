import type { GameMode } from '@/types/gameConfig'
import type { ThemeMode } from '@/types/settings'
import { BOARD_DESIGNS, type BoardDesignId } from '@/utils/boardDesigns'
import { cn } from '@/utils/cn'
import {
  Bot,
  Check,
  Dices,
  ExternalLink,
  HelpCircle,
  Info,
  Maximize2,
  Moon,
  Palette,
  RotateCcw,
  Settings,
  Sun,
  Swords,
  User,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GITHUB_README_URL } from './AboutModal'

interface MenuBarProps {
  isGameActive: boolean
  onOpenNewGame: (mode?: GameMode) => void
  onRestartGame: () => void
  onResetToOpening: () => void
  boardDesign: BoardDesignId
  onSelectBoardDesign: (id: BoardDesignId) => void
  theme: ThemeMode
  onSetTheme: (theme: ThemeMode) => void
  onOpenSettings: () => void
  onOpenAbout: () => void
  className?: string
}

type MenuKey = 'game' | 'view' | 'options' | 'help'

interface MegaItemProps {
  title: string
  subtitle: string
  icon: ReactNode
  onClick?: () => void
  disabled?: boolean
  checked?: boolean
  swatches?: readonly string[]
  external?: boolean
  href?: string
}

const MegaItem = ({
  title,
  subtitle,
  icon,
  onClick,
  disabled = false,
  checked,
  swatches,
  external = false,
  href,
}: MegaItemProps) => {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex size-10 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-800/80 text-sky-400 group-hover:border-sky-500/50 group-hover:bg-sky-500/10 group-hover:text-sky-300 transition-colors">
          {icon}
        </div>
        {checked !== undefined && checked && (
          <span className="flex items-center gap-1 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400 border border-sky-500/30">
            <Check className="size-3 stroke-[2.5]" /> Active
          </span>
        )}
        {swatches && (
          <div className="flex items-center -space-x-1" aria-hidden>
            {swatches.map((hex, idx) => (
              <span
                key={idx}
                style={{ backgroundColor: hex }}
                className="size-3.5 rounded-full border border-black/50 shadow-xs"
              />
            ))}
          </div>
        )}
        {external && (
          <ExternalLink className="size-4 text-slate-400 group-hover:text-sky-400 transition-colors" />
        )}
      </div>

      <div className="mt-2.5 space-y-0.5">
        <div className="flex items-center gap-1 text-xs font-bold text-slate-100 group-hover:text-sky-300 transition-colors">
          <span>{title}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400 group-hover:text-slate-300">
          {subtitle}
        </p>
      </div>
    </>
  )

  const commonClass = cn(
    'group flex flex-col justify-start rounded-xl p-3 text-left transition-all',
    disabled
      ? 'opacity-40 cursor-not-allowed bg-transparent'
      : 'cursor-pointer hover:bg-slate-800/90 active:scale-[0.98]',
    checked && 'ring-1 ring-sky-500/50 bg-sky-500/5',
  )

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className={commonClass}
      >
        {content}
      </a>
    )
  }

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={commonClass}
    >
      {content}
    </button>
  )
}

export default function MenuBar({
  isGameActive,
  onOpenNewGame,
  onRestartGame,
  onResetToOpening,
  boardDesign,
  onSelectBoardDesign,
  theme,
  onSetTheme,
  onOpenSettings,
  onOpenAbout,
  className,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null)
  const menuBarRef = useRef<HTMLDivElement | null>(null)

  const closeAll = (): void => {
    setOpenMenu(null)
  }

  // Handle clicking outside to close open menus
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent): void => {
      if (menuBarRef.current && !menuBarRef.current.contains(event.target as Node)) {
        closeAll()
      }
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeAll()
      }
    }

    if (openMenu !== null) {
      window.addEventListener('pointerdown', handleOutsideClick)
      window.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      window.removeEventListener('pointerdown', handleOutsideClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenu])

  const handleMenuHeaderClick = (menu: MenuKey): void => {
    setOpenMenu((curr) => (curr === menu ? null : menu))
  }

  const handleMenuHeaderHover = (menu: MenuKey): void => {
    if (openMenu !== null && openMenu !== menu) {
      setOpenMenu(menu)
    }
  }

  const triggerResetBoardSize = (): void => {
    window.dispatchEvent(new CustomEvent('ai-backgammon:reset-board-size'))
    closeAll()
  }

  const navButtonClass = (menu: MenuKey) =>
    cn(
      'relative z-30 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors rounded-t-lg select-none',
      openMenu === menu
        ? 'bg-slate-900 text-sky-400 border-t border-x border-slate-700/80 shadow-md'
        : 'text-slate-300 hover:text-white hover:bg-slate-800/60',
    )

  return (
    <div
      ref={menuBarRef}
      role="menubar"
      aria-label="Application menu"
      className={cn('relative flex items-center gap-1.5', className)}
    >
      {/* 1. GAME TAB */}
      <div>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={openMenu === 'game'}
          onClick={() => handleMenuHeaderClick('game')}
          onMouseEnter={() => handleMenuHeaderHover('game')}
          className={navButtonClass('game')}
        >
          Game
        </button>
      </div>

      {/* 2. VIEW TAB */}
      <div>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={openMenu === 'view'}
          onClick={() => handleMenuHeaderClick('view')}
          onMouseEnter={() => handleMenuHeaderHover('view')}
          className={navButtonClass('view')}
        >
          View
        </button>
      </div>

      {/* 3. OPTIONS TAB */}
      <div>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={openMenu === 'options'}
          onClick={() => handleMenuHeaderClick('options')}
          onMouseEnter={() => handleMenuHeaderHover('options')}
          className={navButtonClass('options')}
        >
          Options
        </button>
      </div>

      {/* 4. HELP TAB */}
      <div>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={openMenu === 'help'}
          onClick={() => handleMenuHeaderClick('help')}
          onMouseEnter={() => handleMenuHeaderHover('help')}
          className={navButtonClass('help')}
        >
          Help
        </button>
      </div>

      {/* ============================================================== */}
      {/* MEGA-DROPDOWN PANEL CONTAINER                                   */}
      {/* ============================================================== */}
      {openMenu !== null && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+2px)] z-50 w-[min(92vw,860px)] rounded-b-2xl rounded-tr-2xl border border-slate-700/80 bg-slate-900/98 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {/* GAME MEGA MENU */}
          {openMenu === 'game' && (
            <div className="space-y-3">
              <div className="border-b border-slate-800 pb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Start New Match
                </span>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <MegaItem
                    title="Human vs AI"
                    subtitle="Play against your configured AI engine"
                    icon={<User className="size-5 text-sky-400" />}
                    onClick={() => {
                      onOpenNewGame('humanVsAi')
                      closeAll()
                    }}
                  />
                  <MegaItem
                    title="AI vs AI"
                    subtitle="Simulate and watch two AI models play"
                    icon={<Bot className="size-5 text-emerald-400" />}
                    onClick={() => {
                      onOpenNewGame('aiVsAi')
                      closeAll()
                    }}
                  />
                  <MegaItem
                    title="Custom Match..."
                    subtitle="Configure custom seats, engines, & rules"
                    icon={<Swords className="size-5 text-amber-400" />}
                    onClick={() => {
                      onOpenNewGame()
                      closeAll()
                    }}
                  />
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Match Actions
                </span>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <MegaItem
                    title="Restart Match"
                    subtitle="Restart the current game with the same opponents"
                    icon={<RotateCcw className="size-5 text-slate-300" />}
                    disabled={!isGameActive}
                    onClick={() => {
                      onRestartGame()
                      closeAll()
                    }}
                  />
                  <MegaItem
                    title="Reset to Opening Board"
                    subtitle="Abandon game and reset checkers to initial setup"
                    icon={<Dices className="size-5 text-slate-300" />}
                    disabled={!isGameActive}
                    onClick={() => {
                      onResetToOpening()
                      closeAll()
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* VIEW MEGA MENU */}
          {openMenu === 'view' && (
            <div className="space-y-4">
              {/* Board Style Selection */}
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Board Style & Material
                </span>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {BOARD_DESIGNS.map((design) => (
                    <MegaItem
                      key={design.id}
                      title={design.name}
                      subtitle={design.subtitle}
                      icon={<Palette className="size-5 text-sky-400" />}
                      checked={boardDesign === design.id}
                      swatches={design.swatches}
                      onClick={() => {
                        onSelectBoardDesign(design.id)
                        closeAll()
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Theme & Display Options */}
              <div className="border-t border-slate-800 pt-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Display & Theme
                </span>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <MegaItem
                    title="Warm Soft Light"
                    subtitle="Linen & cream palette with rich contrast"
                    icon={<Sun className="size-5 text-amber-400" />}
                    checked={theme === 'light'}
                    onClick={() => {
                      onSetTheme('light')
                      closeAll()
                    }}
                  />
                  <MegaItem
                    title="Midnight Dark"
                    subtitle="Deep slate tones for dark-mode gaming"
                    icon={<Moon className="size-5 text-sky-400" />}
                    checked={theme === 'dark'}
                    onClick={() => {
                      onSetTheme('dark')
                      closeAll()
                    }}
                  />
                  <MegaItem
                    title="Reset Board Size"
                    subtitle="Restore default dimensions for the board pane"
                    icon={<Maximize2 className="size-5 text-slate-300" />}
                    onClick={triggerResetBoardSize}
                  />
                </div>
              </div>
            </div>
          )}

          {/* OPTIONS MEGA MENU */}
          {openMenu === 'options' && (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Preferences & AI Configuration
              </span>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <MegaItem
                  title="BYOK Settings..."
                  subtitle="Configure your OpenAI, Anthropic, Gemini, or custom AI keys & models"
                  icon={<Settings className="size-5 text-sky-400" />}
                  onClick={() => {
                    onOpenSettings()
                    closeAll()
                  }}
                />
              </div>
            </div>
          )}

          {/* HELP MEGA MENU */}
          {openMenu === 'help' && (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Support & Documentation
              </span>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <MegaItem
                  title="README on GitHub"
                  subtitle="Browse game rules, architecture, API proxy, and setup instructions"
                  icon={<HelpCircle className="size-5 text-sky-400" />}
                  external
                  href={GITHUB_README_URL}
                  onClick={closeAll}
                />
                <MegaItem
                  title="About AI Backgammon..."
                  subtitle="View version details, license, and author attribution"
                  icon={<Info className="size-5 text-amber-400" />}
                  onClick={() => {
                    onOpenAbout()
                    closeAll()
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
