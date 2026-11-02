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
        'group flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
        disabled
          ? 'cursor-not-allowed text-slate-500 opacity-60'
          : 'cursor-pointer text-slate-200 hover:bg-sky-600 hover:text-white',
      )}
    >
      <span className="flex items-center gap-2">
        <span className="size-4 flex items-center justify-center shrink-0">
          {checked ? (
            <Check className="size-3.5 stroke-[2.5]" aria-hidden />
          ) : (
            icon
          )}
        </span>
        <span className="font-medium">{label}</span>
      </span>

      <span className="flex items-center gap-1.5 text-[11px] text-slate-400 group-hover:text-white/80">
        {shortcut ? <span>{shortcut}</span> : null}
        {hasSubmenu ? <ChevronRight className="size-3.5 shrink-0" aria-hidden /> : null}
      </span>
    </button>
  )
}

const MenuSeparator = () => (
  <div className="my-1 border-t border-slate-700/60" role="separator" />
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
        'relative flex items-center gap-0.5 border-b border-slate-800 bg-slate-900/95 px-2 py-0.5 text-xs select-none backdrop-blur-sm',
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
            'rounded px-2.5 py-1 font-medium transition',
            openMenu === 'game'
              ? 'bg-sky-600 text-white'
              : 'text-slate-200 hover:bg-slate-800 hover:text-white',
          )}
        >
          Game
        </button>

        {openMenu === 'game' && (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-0.5 min-w-[210px] rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl backdrop-blur-md"
          >
            {/* New Game with Submenu */}
            <div
              className="relative"
              onMouseEnter={() => setActiveSubmenu('new-game')}
              onMouseLeave={() => setActiveSubmenu((curr) => (curr === 'new-game' ? null : curr))}
            >
              <MenuItem
                label="New Game"
                icon={<Swords className="size-3.5 text-sky-400" aria-hidden />}
                hasSubmenu
                onClick={() => setActiveSubmenu('new-game')}
              />

              {activeSubmenu === 'new-game' && (
                <div
                  role="menu"
                  className="absolute left-full top-0 -ml-1 min-w-[190px] rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl backdrop-blur-md"
                >
                  <MenuItem
                    label="Human vs AI"
                    icon={<User className="size-3.5 text-sky-400" aria-hidden />}
                    onClick={() => {
                      onOpenNewGame('humanVsAi')
                      closeAll()
                    }}
                  />
                  <MenuItem
                    label="AI vs AI"
                    icon={<Bot className="size-3.5 text-emerald-400" aria-hidden />}
                    onClick={() => {
                      onOpenNewGame('aiVsAi')
                      closeAll()
                    }}
                  />
                  <MenuSeparator />
                  <MenuItem
                    label="Custom Match..."
                    icon={<Dices className="size-3.5 text-amber-400" aria-hidden />}
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
              icon={<RotateCcw className="size-3.5" aria-hidden />}
              disabled={!isGameActive}
              onClick={() => {
                onRestartGame()
                closeAll()
              }}
            />

            <MenuItem
              label="Reset to Opening Board"
              icon={<Dices className="size-3.5" aria-hidden />}
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
            'rounded px-2.5 py-1 font-medium transition',
            openMenu === 'view'
              ? 'bg-sky-600 text-white'
              : 'text-slate-200 hover:bg-slate-800 hover:text-white',
          )}
        >
          View
        </button>

        {openMenu === 'view' && (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-0.5 min-w-[210px] rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl backdrop-blur-md"
          >
            {/* Board Style Submenu */}
            <div
              className="relative"
              onMouseEnter={() => setActiveSubmenu('board-style')}
              onMouseLeave={() => setActiveSubmenu((curr) => (curr === 'board-style' ? null : curr))}
            >
              <MenuItem
                label="Board Style"
                icon={<Palette className="size-3.5 text-sky-400" aria-hidden />}
                hasSubmenu
                onClick={() => setActiveSubmenu('board-style')}
              />

              {activeSubmenu === 'board-style' && (
                <div
                  role="menu"
                  className="absolute left-full top-0 -ml-1 min-w-[280px] rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl backdrop-blur-md"
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
                          'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-sky-600 hover:text-white',
                          isChecked ? 'font-semibold text-white' : 'text-slate-200',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="size-3.5 flex items-center justify-center shrink-0">
                            {isChecked ? <Check className="size-3.5 stroke-[2.5]" aria-hidden /> : null}
                          </span>
                          <span>{design.name}</span>
                        </span>

                        <span className="flex items-center -space-x-1 shrink-0" aria-hidden>
                          {design.swatches.map((hex, idx) => (
                            <span
                              key={idx}
                              style={{ backgroundColor: hex }}
                              className="size-2.5 rounded-full border border-black/40"
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
                icon={theme === 'light' ? <Sun className="size-3.5 text-amber-400" /> : <Moon className="size-3.5 text-sky-400" />}
                hasSubmenu
                onClick={() => setActiveSubmenu('theme')}
              />

              {activeSubmenu === 'theme' && (
                <div
                  role="menu"
                  className="absolute left-full top-0 -ml-1 min-w-[170px] rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl backdrop-blur-md"
                >
                  <MenuItem
                    label="Warm Soft Light"
                    icon={<Sun className="size-3.5 text-amber-400" aria-hidden />}
                    checked={theme === 'light'}
                    onClick={() => {
                      onSetTheme('light')
                      closeAll()
                    }}
                  />
                  <MenuItem
                    label="Midnight Dark"
                    icon={<Moon className="size-3.5 text-sky-400" aria-hidden />}
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
              icon={<Maximize2 className="size-3.5" aria-hidden />}
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
            'rounded px-2.5 py-1 font-medium transition',
            openMenu === 'options'
              ? 'bg-sky-600 text-white'
              : 'text-slate-200 hover:bg-slate-800 hover:text-white',
          )}
        >
          Options
        </button>

        {openMenu === 'options' && (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-0.5 min-w-[210px] rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl backdrop-blur-md"
          >
            <MenuItem
              label="BYOK Settings..."
              icon={<Settings className="size-3.5 text-sky-400" aria-hidden />}
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
            'rounded px-2.5 py-1 font-medium transition',
            openMenu === 'help'
              ? 'bg-sky-600 text-white'
              : 'text-slate-200 hover:bg-slate-800 hover:text-white',
          )}
        >
          Help
        </button>

        {openMenu === 'help' && (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-0.5 min-w-[220px] rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl backdrop-blur-md"
          >
            <a
              href={GITHUB_README_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeAll}
              className="group flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-sky-600 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="size-4 flex items-center justify-center shrink-0">
                  <HelpCircle className="size-3.5 text-sky-400 group-hover:text-white" aria-hidden />
                </span>
                <span className="font-medium">README on GitHub</span>
              </span>
              <ExternalLink className="size-3.5 text-slate-400 group-hover:text-white/80 shrink-0" aria-hidden />
            </a>

            <MenuSeparator />

            <MenuItem
              label="About AI Backgammon..."
              icon={<Info className="size-3.5 text-amber-400" aria-hidden />}
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
