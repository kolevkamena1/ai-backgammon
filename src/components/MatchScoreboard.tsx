import type { FC } from 'react'
import type { MatchScoreState } from '@/types/gameMatch'
import type { DiceConfig, SeatPlan } from '@/types/gameConfig'
import { cn } from '@/utils/cn'

interface MatchScoreboardProps {
  match: MatchScoreState
  seatPlan?: SeatPlan | null
  diceConfig?: DiceConfig
  className?: string
}

export const MatchScoreboard: FC<MatchScoreboardProps> = ({
  match,
  seatPlan,
  diceConfig,
  className,
}) => {
  const whiteSeat = seatPlan?.light
  const darkSeat = seatPlan?.dark

  const whiteLabel = whiteSeat ? whiteSeat.label : 'White'
  const whiteSub = whiteSeat?.kind === 'ai' ? 'AI' : whiteSeat ? 'You' : undefined

  const blackLabel = darkSeat ? darkSeat.label : 'Black'
  const blackSub = darkSeat?.kind === 'ai' ? 'AI' : darkSeat ? 'Opponent' : undefined

  const whitePercent = Math.min(100, Math.round((match.light / match.targetPoints) * 100))
  const darkPercent = Math.min(100, Math.round((match.dark / match.targetPoints) * 100))

  return (
    <div
      role="region"
      aria-label={`Match score: White ${match.light}, Black ${match.dark}. Target: ${match.targetPoints} points`}
      className={cn(
        'flex w-full max-w-2xl flex-col items-center rounded-xl border border-slate-700/80 bg-slate-900/90 px-5 py-2.5 shadow-xl backdrop-blur-md transition-all',
        className,
      )}
    >
      {/* Top row: White Score · VS / Game · Black Score */}
      <div className="flex w-full items-center justify-between gap-4">
        {/* White side */}
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block size-4 shrink-0 rounded-full border-2 border-amber-300 bg-amber-100 shadow-sm"
          />
          <div className="flex flex-col text-left">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
              {whiteLabel}
            </span>
            {whiteSub && <span className="text-[10px] text-slate-400 leading-none">{whiteSub}</span>}
          </div>
          <span className="font-mono text-3xl font-extrabold text-amber-300 tabular-nums drop-shadow-sm ml-1">
            {match.light}
          </span>
        </div>

        {/* Center: Game indicator & Dice mode */}
        <div className="flex flex-col items-center gap-1">
          <span className="rounded-full border border-slate-700 bg-slate-800/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
            Game {match.gameIndex}
          </span>
          {diceConfig?.mode === 'seeded' && diceConfig.seed !== undefined && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-mono text-amber-300 border border-amber-500/30">
              Seed #{diceConfig.seed}
            </span>
          )}
          {diceConfig?.mode === 'manual' && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300 border border-emerald-500/30">
              Manual Dice
            </span>
          )}
        </div>

        {/* Black side */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-3xl font-extrabold text-sky-300 tabular-nums drop-shadow-sm mr-1">
            {match.dark}
          </span>
          <div className="flex flex-col text-right">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-200">
              {blackLabel}
            </span>
            {blackSub && <span className="text-[10px] text-slate-400 leading-none">{blackSub}</span>}
          </div>
          <span
            aria-hidden
            className="inline-block size-4 shrink-0 rounded-full border-2 border-slate-600 bg-slate-950 shadow-sm"
          />
        </div>
      </div>

      {/* Bottom section: Target points to win + progress tracks */}
      <div className="mt-2 flex w-full flex-col items-center gap-1.5 border-t border-slate-800/80 pt-1.5">
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-slate-300">
          <span>
            First to <strong className="font-bold text-slate-50">{match.targetPoints} points</strong> wins the match
          </span>

          {match.isCrawfordGame && (
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300 border border-amber-500/30">
              Crawford Game · Doubling disabled
            </span>
          )}

          {match.matchWinner && (
            <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 border border-emerald-500/30">
              🏆 {match.matchWinner === 'light' ? 'White' : 'Black'} Wins the Set!
            </span>
          )}
        </div>

        {/* Progress track */}
        <div className="flex w-full max-w-sm items-center gap-2">
          {/* White progress */}
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-500"
              style={{ width: `${whitePercent}%`, marginLeft: 'auto' }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-500 shrink-0 font-medium">
            {match.targetPoints} pts to win
          </span>
          {/* Black progress */}
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-200 transition-all duration-500"
              style={{ width: `${darkPercent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default MatchScoreboard

