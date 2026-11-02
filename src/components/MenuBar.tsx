import type { GameMode } from '@/types/gameConfig'
import type { ThemeMode } from '@/types/settings'
import { BOARD_DESIGNS, type BoardDesignId } from '@/utils/boardDesigns'
import { cn } from '@/utils/cn'
import {
  Bot,
  Check,
  ChevronRight,
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

interface MenuItemProps {
  label: string
  icon?: ReactNode
  shortcut?: string
  checked?: boolean
  active?: boolean
  disabled?: boolean
  hasSubmenu?: boolean
  onClick?: () => void
  onMouseEnter?: () => void
}

const MenuItem = ({
  label,
  icon,
  shortcut,
  checked,
  active,
  disabled = false,
  hasSubmenu = false,
  onClick,
  onMouseEnter,
}: MenuItemProps) => {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'group flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm transition-colors',
        disabled
          ? 'cursor-not-allowed text-slate-500 opacity-50'
          : checked
            ? 'bg-sky-500/15 font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-600 hover:text-white'
            : active
              ? 'bg-slate-800/80 font-medium text-slate-100 hover:bg-sky-600 hover:text-white'
              : 'cursor-pointer text-slate-200 hover:bg-sky-600 hover:text-white',
      )}
    >
      <span className="flex items-center gap-2.5">
        <span className="size-4 flex items-center justify-center shrink-0">
          {checked ? (
            <Check className="size-4 stroke-[2.5] text-sky-600 dark:text-sky-400 group-hover:text-white" aria-hidden />
          ) : (
            icon
          )}
        </span>
        <span className="font-medium">{label}</span>
      </span>

      <span className="flex items-center gap-1.5 text-xs text-slate-400 group-hover:text-white/90">
        {shortcut ? <span>{shortcut}</span> : null}
        {hasSubmenu ? <ChevronRight className="size-4 shrink-0" aria-hidden /> : null}
      </span>
    </button>
  )
}

const MenuSeparator = () => (
  <div className="my-1.5 border-t border-slate-700/70" role="separator" />
)

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
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)
  const menuBarRef = useRef<HTMLDivElement | null>(null)

  const closeAll = (): void => {
    setOpenMenu(null)
    setActiveSubmenu(null)
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
    if (openMenu === menu) {
      closeAll()
    } else {
      setOpenMenu(menu)
      setActiveSubmenu(null)
    }
  }

  const handleMenuHeaderHover = (menu: MenuKey): void => {
    if (openMenu !== null && openMenu !== menu) {
      setOpenMenu(menu)
      setActiveSubmenu(null)
    }
  }

  const triggerResetBoardSize = (): void => {
    window.dispatchEvent(new CustomEvent('ai-backgammon:reset-board-size'))
    closeAll()
  }

  return (
    <div
      ref={menuBarRef}
      role="menubar"
      aria-label="Application menu"
      className={cn(
        'relative flex items-center gap-1 text-sm select-none',
        className,
      )}
    >
      {/* 1. GAME MENU */}
      <div className="relative">
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={openMenu === 'game'}
          onClick={() => handleMenuHeaderClick('game')}
          onMouseEnter={() => handleMenuHeaderHover('game')}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-sm font-semibold transition',
            openMenu === 'game'
              ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/50'
              : 'text-slate-200 hover:bg-slate-800/80 hover:text-slate-50',
          )}
        >
          Game
        </button>

        {openMenu === 'game' && (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-1 min-w-[230px] rounded-xl border border-slate-700/80 bg-slate-900/98 p-1.5 shadow-2xl ring-1 ring-black/20 backdrop-blur-xl"
          >
            {/* New Game with Submenu */}
            <div
              className="relative"
              onMouseEnter={() => setActiveSubmenu('new-game')}
              onMouseLeave={() => setActiveSubmenu((curr) => (curr === 'new-game' ? null : curr))}
            >
              <MenuItem
                label="New Game"
                icon={<Swords className="size-4 text-sky-400" aria-hidden />}
                hasSubmenu
                active={activeSubmenu === 'new-game'}
                onClick={() => setActiveSubmenu('new-game')}
              />

              {activeSubmenu === 'new-game' && (
                <div
                  role="menu"
                  className="absolute left-full top-0 -ml-1 min-w-[210px] rounded-xl border border-slate-700/80 bg-slate-900/98 p-1.5 shadow-2xl ring-1 ring-black/20 backdrop-blur-xl"
                >
                  <MenuItem
                    label="Human vs AI"
                    icon={<User className="size-4 text-sky-400" aria-hidden />}
                    onClick={() => {
                      onOpenNewGame('humanVsAi')
                      closeAll()
                    }}
                  />
                  <MenuItem
                    label="AI vs AI"
                    icon={<Bot className="size-4 text-emerald-400" aria-hidden />}
                    onClick={() => {
                      onOpenNewGame('aiVsAi')
                      closeAll()
                    }}
                  />
                  <MenuSeparator />
                  <MenuItem
                    label="Custom Match..."
                    icon={<Dices className="size-4 text-amber-400" aria-hidden />}
                    onClick={() => {
                      onOpenNewGame()
                      closeAll()
                    }}
                  />
                </div>
              )}
            </div>

            <MenuSeparator />

            <MenuItem
              label="Restart Match"
              icon={<RotateCcw className="size-4 text-slate-300" aria-hidden />}
              disabled={!isGameActive}
              onClick={() => {
                onRestartGame()
                closeAll()
              }}
            />

            <MenuItem
              label="Reset to Opening Board"
              icon={<Dices className="size-4 text-slate-300" aria-hidden />}
              disabled={!isGameActive}
              onClick={() => {
                onResetToOpening()
                closeAll()
              }}
            />
          </div>
        )}
      </div>

      {/* 2. VIEW MENU */}
      <div className="relative">
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={openMenu === 'view'}
          onClick={() => handleMenuHeaderClick('view')}
          onMouseEnter={() => handleMenuHeaderHover('view')}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-sm font-semibold transition',
            openMenu === 'view'
              ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/50'
              : 'text-slate-200 hover:bg-slate-800/80 hover:text-slate-50',
          )}
        >
          View
        </button>

        {openMenu === 'view' && (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-1 min-w-[230px] rounded-xl border border-slate-700/80 bg-slate-900/98 p-1.5 shadow-2xl ring-1 ring-black/20 backdrop-blur-xl"
          >
            {/* Board Style Submenu */}
            <div
              className="relative"
              onMouseEnter={() => setActiveSubmenu('board-style')}
              onMouseLeave={() => setActiveSubmenu((curr) => (curr === 'board-style' ? null : curr))}
            >
              <MenuItem
                label="Board Style"
                icon={<Palette className="size-4 text-sky-400" aria-hidden />}
                hasSubmenu
                active={activeSubmenu === 'board-style'}
                onClick={() => setActiveSubmenu('board-style')}
              />

              {activeSubmenu === 'board-style' && (
                <div
                  role="menu"
                  className="absolute left-full top-0 -ml-1 min-w-[310px] rounded-xl border border-slate-700/80 bg-slate-900/98 p-1.5 shadow-2xl ring-1 ring-black/20 backdrop-blur-xl"
                >
                  {BOARD_DESIGNS.map((design) => {
                    const isChecked = boardDesign === design.id
                    return (
                      <button
                        key={design.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isChecked}
                        onClick={() => {
                          onSelectBoardDesign(design.id)
                          closeAll()
                        }}
                        className={cn(
                          'group flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-sky-600 hover:text-white cursor-pointer',
                          isChecked
                            ? 'bg-sky-500/15 font-semibold text-sky-700 dark:text-sky-300'
                            : 'text-slate-200',
                        )}
                      >
                        <span className="flex items-center gap-2.5">
                          <span className="size-4 flex items-center justify-center shrink-0">
                            {isChecked ? (
                              <Check className="size-4 stroke-[2.5] text-sky-600 dark:text-sky-400 group-hover:text-white" aria-hidden />
                            ) : null}
                          </span>
                          <span>{design.name}</span>
                        </span>

                        <span className="flex items-center -space-x-1 shrink-0" aria-hidden>
                          {design.swatches.map((hex, idx) => (
                            <span
                              key={idx}
                              style={{ backgroundColor: hex }}
                              className="size-3.5 rounded-full border border-black/40 shadow-xs"
                            />
                          ))}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <MenuSeparator />

            {/* Color Theme Submenu */}
            <div
              className="relative"
              onMouseEnter={() => setActiveSubmenu('theme')}
              onMouseLeave={() => setActiveSubmenu((curr) => (curr === 'theme' ? null : curr))}
            >
              <MenuItem
                label="Color Theme"
                icon={theme === 'light' ? <Sun className="size-4 text-amber-400" /> : <Moon className="size-4 text-sky-400" />}
                hasSubmenu
                active={activeSubmenu === 'theme'}
                onClick={() => setActiveSubmenu('theme')}
              />

              {activeSubmenu === 'theme' && (
                <div
                  role="menu"
                  className="absolute left-full top-0 -ml-1 min-w-[200px] rounded-xl border border-slate-700/80 bg-slate-900/98 p-1.5 shadow-2xl ring-1 ring-black/20 backdrop-blur-xl"
                >
                  <MenuItem
                    label="Warm Soft Light"
                    icon={<Sun className="size-4 text-amber-400" aria-hidden />}
                    checked={theme === 'light'}
                    onClick={() => {
                      onSetTheme('light')
                      closeAll()
                    }}
                  />
                  <MenuItem
                    label="Midnight Dark"
                    icon={<Moon className="size-4 text-sky-400" aria-hidden />}
                    checked={theme === 'dark'}
                    onClick={() => {
                      onSetTheme('dark')
                      closeAll()
                    }}
                  />
                </div>
              )}
            </div>

            <MenuSeparator />

            <MenuItem
              label="Reset Board Size"
              icon={<Maximize2 className="size-4 text-slate-300" aria-hidden />}
              onClick={triggerResetBoardSize}
            />
          </div>
        )}
      </div>

      {/* 3. OPTIONS MENU */}
      <div className="relative">
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={openMenu === 'options'}
          onClick={() => handleMenuHeaderClick('options')}
          onMouseEnter={() => handleMenuHeaderHover('options')}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-sm font-semibold transition',
            openMenu === 'options'
              ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/50'
              : 'text-slate-200 hover:bg-slate-800/80 hover:text-slate-50',
          )}
        >
          Options
        </button>

        {openMenu === 'options' && (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-1 min-w-[230px] rounded-xl border border-slate-700/80 bg-slate-900/98 p-1.5 shadow-2xl ring-1 ring-black/20 backdrop-blur-xl"
          >
            <MenuItem
              label="BYOK Settings..."
              icon={<Settings className="size-4 text-sky-400" aria-hidden />}
              onClick={() => {
                onOpenSettings()
                closeAll()
              }}
            />
          </div>
        )}
      </div>

      {/* 4. HELP MENU */}
      <div className="relative">
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={openMenu === 'help'}
          onClick={() => handleMenuHeaderClick('help')}
          onMouseEnter={() => handleMenuHeaderHover('help')}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-sm font-semibold transition',
            openMenu === 'help'
              ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/50'
              : 'text-slate-200 hover:bg-slate-800/80 hover:text-slate-50',
          )}
        >
          Help
        </button>

        {openMenu === 'help' && (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-1 min-w-[240px] rounded-xl border border-slate-700/80 bg-slate-900/98 p-1.5 shadow-2xl ring-1 ring-black/20 backdrop-blur-xl"
          >
            <a
              href={GITHUB_README_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeAll}
              className="group flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-sky-600 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <span className="size-4 flex items-center justify-center shrink-0">
                  <HelpCircle className="size-4 text-sky-400 group-hover:text-white" aria-hidden />
                </span>
                <span className="font-medium">README on GitHub</span>
              </span>
              <ExternalLink className="size-4 text-slate-400 group-hover:text-white/90 shrink-0" aria-hidden />
            </a>

            <MenuSeparator />

            <MenuItem
              label="About AI Backgammon..."
              icon={<Info className="size-4 text-amber-400" aria-hidden />}
              onClick={() => {
                onOpenAbout()
                closeAll()
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
