import { BUTTON, CARD } from '@/components/ui/controls'
import Modal from '@/components/ui/Modal'
import { useGame } from '@/hooks/useGame'
import { useGameConfig } from '@/hooks/useGameConfig'
import { useSettings } from '@/hooks/useSettings'
import { logger } from '@/lib/logger'
import type { AiMatchType, GameMode, SeatAssignment } from '@/types/gameConfig'
import { cn } from '@/utils/cn'
import {
  DIFFICULTY_LABELS,
  SEAT_LABELS,
  describeEngine,
  planSeats,
  seatProblems,
} from '@/utils/gameConfig'
import { Bot, Check, KeyRound, Swords, User } from 'lucide-react'
import { useState, type ComponentType, type FormEvent, type SVGProps } from 'react'

interface GameSetupModalProps {
  /** Mounted only while open, so the draft always starts from the stored setup. */
  onClose: () => void
  initialMode?: GameMode
}

interface ChoiceProps {
  group: string
  value: string
  checked: boolean
  title: string
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  onSelect: () => void
  autoFocus?: boolean
}

/** Radio-driven card: real inputs for keyboard/screen-reader use, styled as tiles. */
const Choice = ({ group, value, checked, title, description, icon: Icon, onSelect, autoFocus = false }: ChoiceProps) => (
  <label className={CARD}>
    <input
      type="radio"
      name={group}
      value={value}
      className="sr-only"
      checked={checked}
      onChange={onSelect}
      autoFocus={autoFocus}
    />
    <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
      <Icon className="size-4 text-sky-400" aria-hidden />
      {title}
    </span>
    <span className="text-xs text-slate-400">{description}</span>
  </label>
)

/** Who occupies a seat, with anything still missing listed underneath. */
const SeatCard = ({ seat }: { seat: SeatAssignment }) => {
  const problems = seatProblems(seat)

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        problems.length > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-700 bg-slate-950/60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          {SEAT_LABELS[seat.color]}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-300">
          {seat.kind === 'human' ? (
            <User className="size-3.5" aria-hidden />
          ) : (
            <Bot className="size-3.5" aria-hidden />
          )}
          {seat.label}
        </span>
      </div>

      {seat.kind === 'human' ? (
        <p className="mt-1.5 text-sm text-slate-100">You</p>
      ) : (
        (() => {
          const summary = describeEngine(seat.engine)
          return (
            <div className="mt-1.5 space-y-0.5">
              <p className="text-sm text-slate-100">
                {summary.providerName}
                <span className="ml-1.5 text-xs text-slate-400">
                  {DIFFICULTY_LABELS[summary.difficulty]}
                </span>
              </p>
              {summary.model ? (
                <p className="font-mono text-xs text-slate-400">{summary.model}</p>
              ) : null}
              {summary.endpoint ? (
                <p className="font-mono text-xs break-all text-slate-400">{summary.endpoint}</p>
              ) : null}
              <p className="font-mono text-xs text-slate-500">{summary.maskedKey}</p>
            </div>
          )
        })()
      )}

      {problems.map((problem) => (
        <p key={problem} className="mt-1.5 text-xs text-amber-300">
          {problem}
        </p>
      ))}
    </div>
  )
}

/**
 * Picks who plays each seat. Mode, match type and the opponent credential are all drafts that
 * reach the store only on submit — the same commit-on-submit semantics as SettingsModal — and
 * starting a game snapshots those seats into the (never-persisted) game store.
 * The roster preview uses planSeats(), i.e. the exact function the engine loop will consume.
 */
const GameSetupModal = ({ onClose, initialMode }: GameSetupModalProps) => {
  const { config, saveSetup } = useGameConfig()
  const { settings, openSettings } = useSettings()
  const game = useGame()

  const [mode, setLocalMode] = useState<GameMode>(initialMode ?? config.mode)
  const [aiMatchType, setLocalMatchType] = useState<AiMatchType>(config.aiMatchType)
  const [matchLength, setMatchLength] = useState<number>(config.match?.targetPoints ?? 7)
  const [customPointsInput, setCustomPointsInput] = useState<string>(
    config.match && ![1, 7, 11].includes(config.match.targetPoints)
      ? String(config.match.targetPoints)
      : '5',
  )
  const [enableCrawford, setEnableCrawford] = useState<boolean>(config.match?.enableCrawford ?? true)
  const [error, setError] = useState('')

  const isAiVsAi = mode === 'aiVsAi'
  const isCustomMatch = isAiVsAi && aiMatchType === 'custom'
  const plan = planSeats(settings, { mode, aiMatchType, opponent: config.opponent })

  const effectivePoints = matchLength === -1 ? Math.max(1, parseInt(customPointsInput, 10) || 5) : matchLength

  const handleOpenByokSettings = (): void => {
    saveSetup({
      mode,
      aiMatchType,
      opponent: config.opponent,
      match: { targetPoints: effectivePoints, enableCrawford: isAiVsAi ? false : enableCrawford },
    })
    onClose()
    openSettings()
  }

  const handleSave = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!plan.ready) {
      return
    }

    const setup = {
      mode,
      aiMatchType,
      opponent: config.opponent,
      match: { targetPoints: effectivePoints, enableCrawford: isAiVsAi ? false : enableCrawford },
    }

    try {
      saveSetup(setup)

      if (!game.startNewGame(setup, settings, true)) {
        setError('Both seats need an API key before a game can start.')
        return
      }
      logger.info('game started', { mode, aiMatchType, seatPlanReady: plan.ready, match: setup.match })

      onClose()
    } catch (saveError) {
      setError('This browser refused to store the setup (private mode, or full quota?).')
      logger.error('saving game setup failed', { reason: String(saveError) })
    }
  }

  return (
    <Modal
      titleId="game-setup-title"
      title="New game"
      subtitle="Choose who plays which seat. Manage BYOK 1 & BYOK 2 credentials in Settings."
      icon={Swords}
      onClose={onClose}
      closeLabel="Close game setup"
      panelClassName="max-w-lg"
    >
      <form className="space-y-4" onSubmit={handleSave}>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-medium text-slate-300">Mode</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice
              group="game-mode"
              value="humanVsAi"
              checked={mode === 'humanVsAi'}
              title="Human vs AI"
              description="You play White; BYOK 1 plays Black."
              icon={User}
              onSelect={() => setLocalMode('humanVsAi')}
              autoFocus
            />
            <Choice
              group="game-mode"
              value="aiVsAi"
              checked={isAiVsAi}
              title="AI vs AI"
              description="Spectate two engines playing each other."
              icon={Bot}
              onSelect={() => setLocalMode('aiVsAi')}
            />
          </div>
        </fieldset>

        {isAiVsAi ? (
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-medium text-slate-300">AI engines</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice
                group="ai-match-type"
                value="mirror"
                checked={aiMatchType === 'mirror'}
                title="Single BYOK (Mirror)"
                description="BYOK 1 plays both White and Black."
                icon={Swords}
                onSelect={() => setLocalMatchType('mirror')}
              />
              <Choice
                group="ai-match-type"
                value="custom"
                checked={isCustomMatch}
                title="Two BYOK (BYOK 1 vs 2)"
                description="BYOK 1 plays White; BYOK 2 plays Black."
                icon={Bot}
                onSelect={() => setLocalMatchType('custom')}
              />
            </div>
          </fieldset>
        ) : null}

        {/* Match Set Length & Options */}
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-medium text-slate-300">Game Set &amp; Match Length</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => setMatchLength(1)}
              className={cn(
                'flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-all',
                matchLength === 1
                  ? 'border-sky-500 bg-sky-500/15 text-white font-semibold ring-1 ring-sky-500/50'
                  : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800',
              )}
            >
              <span className="text-xs font-bold">1 Point</span>
              <span className="text-[10px] text-slate-400">Single game</span>
            </button>

            <button
              type="button"
              onClick={() => setMatchLength(7)}
              className={cn(
                'flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-all',
                matchLength === 7
                  ? 'border-sky-500 bg-sky-500/15 text-white font-semibold ring-1 ring-sky-500/50'
                  : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800',
              )}
            >
              <span className="text-xs font-bold">7 Points</span>
              <span className="text-[10px] text-slate-400">First to 7</span>
            </button>

            <button
              type="button"
              onClick={() => setMatchLength(11)}
              className={cn(
                'flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-all',
                matchLength === 11
                  ? 'border-sky-500 bg-sky-500/15 text-white font-semibold ring-1 ring-sky-500/50'
                  : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800',
              )}
            >
              <span className="text-xs font-bold">11 Points</span>
              <span className="text-[10px] text-slate-400">First to 11</span>
            </button>

            <button
              type="button"
              onClick={() => setMatchLength(-1)}
              className={cn(
                'flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-all',
                matchLength === -1
                  ? 'border-sky-500 bg-sky-500/15 text-white font-semibold ring-1 ring-sky-500/50'
                  : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800',
              )}
            >
              <span className="text-xs font-bold">Custom</span>
              <span className="text-[10px] text-slate-400">User defined</span>
            </button>
          </div>

          {matchLength === -1 && (
            <div className="flex items-center gap-2 pt-1">
              <label htmlFor="custom-points-input" className="text-xs text-slate-400">
                Points required to win the set:
              </label>
              <input
                id="custom-points-input"
                type="number"
                min="1"
                max="99"
                value={customPointsInput}
                onChange={(e) => setCustomPointsInput(e.target.value)}
                className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-mono text-white focus:border-sky-500 focus:outline-hidden"
              />
            </div>
          )}

          {!isAiVsAi && effectivePoints > 1 && (
            <label className="flex items-center gap-2 pt-1 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={enableCrawford}
                onChange={(e) => setEnableCrawford(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0"
              />
              <span>Enable Crawford rule (prohibit doubling when 1 point away from winning)</span>
            </label>
          )}
        </fieldset>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-slate-300">Roster</h3>
            <button
              type="button"
              onClick={handleOpenByokSettings}
              className={cn(
                BUTTON,
                'border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-sky-300 hover:bg-slate-800',
              )}
            >
              <KeyRound className="size-3.5" aria-hidden />
              Configure BYOK 1 &amp; 2
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <SeatCard seat={plan.light} />
            <SeatCard seat={plan.dark} />
          </div>
        </div>

        {!plan.ready ? (
          <p className="text-xs text-amber-300">
            One or more AI seats still need credentials — click{' '}
            <strong>Configure BYOK 1 &amp; 2</strong> above to set them in BYOK Settings.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
          >
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={cn(BUTTON, 'text-slate-300 hover:bg-slate-800')}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!plan.ready}
            className={cn(BUTTON, 'bg-sky-600 text-white hover:bg-sky-500')}
          >
            <Check className="size-4" aria-hidden />
            Start game
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default GameSetupModal
