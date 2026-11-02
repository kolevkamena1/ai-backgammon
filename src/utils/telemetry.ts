import { useGameStore } from '@/state/gameStore'
import type { AnalyticsEvent, GameEndEvent, StatsGameMode } from '@/types/stats'
import { describeEngine } from '@/utils/gameConfig'

/**
 * Anonymous, cookieless usage telemetry for the admin dashboard (`/stats`).
 *
 * What leaves the browser: a random per-tab session id (`sessionStorage`, gone when the tab
 * closes), the referrer HOST, language, viewport, and coarse facts about each game (mode, AI
 * provider/model/difficulty, outcome, counts). What never does: API keys, endpoints, prompts, AI
 * explanations, board positions, or any persistent identifier. IP, country and AS are resolved by
 * the server from the request itself. Do Not Track is honoured, and dev builds send nothing.
 */

const COLLECT_URL = '/api/collect'
const SESSION_KEY = 'ai-backgammon:session'

interface GameTracker {
  gameId: string
  undoCount: number
  pauseCount: number
  aiErrors: Record<string, number>
  ended: boolean
  last: Pick<GameEndEvent, 'turns' | 'moves' | 'winner'>
}

function enabled(): boolean {
  return !import.meta.env.DEV
}

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing !== null) return existing
    const created = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, created)
    return created
  } catch {
    // Storage blocked: an ephemeral id still groups this page load's events.
    return crypto.randomUUID()
  }
}

function send(event: AnalyticsEvent): void {
  const body = JSON.stringify(event)
  try {
    if (navigator.sendBeacon(COLLECT_URL, new Blob([body], { type: 'application/json' }))) return
  } catch {
    // Fall through to fetch.
  }
  void fetch(COLLECT_URL, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(
    () => undefined,
  )
}

function referrerHost(): string | null {
  try {
    const host = document.referrer === '' ? null : new URL(document.referrer).hostname
    return host === null || host === location.hostname ? null : host
  } catch {
    return null
  }
}

function appearance(): { boardStyle: string | null; theme: string | null } {
  return {
    boardStyle: document.querySelector<HTMLElement>('[data-board-design]')?.dataset.boardDesign ?? null,
    theme: document.documentElement.dataset.theme ?? null,
  }
}

function describeEngines(): { provider: string | null; model: string | null; difficulty: string | null } {
  const plan = useGameStore.getState().seatPlan
  if (plan === null) return { provider: null, model: null, difficulty: null }

  const engines = [plan.light, plan.dark].flatMap((seat) => (seat.kind === 'ai' ? [seat.engine] : []))
  const unique = (values: string[]): string | null => {
    const set = [...new Set(values.filter((v) => v !== ''))]
    return set.length === 0 ? null : set.join('+')
  }

  return {
    provider: unique(engines.map((e) => e.provider)),
    model: unique(engines.map((e) => describeEngine(e).model)),
    difficulty: unique(engines.map((e) => describeEngine(e).difficulty)),
  }
}

/** Starts tracking; returns a cleanup. Mount once, from the game app only (never from /stats). */
export function startTelemetry(): () => void {
  if (!enabled()) return () => undefined

  const sid = sessionId()
  let tracker: GameTracker | null = null

  send({
    type: 'visit',
    sessionId: sid,
    referrerHost: referrerHost(),
    utmSource: new URLSearchParams(location.search).get('utm_source'),
    language: navigator.language,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    landingPath: location.pathname,
  })

  const endGame = (outcome: GameEndEvent['outcome']): void => {
    if (tracker === null || tracker.ended) return
    tracker.ended = true
    send({
      type: 'game_end',
      sessionId: sid,
      gameId: tracker.gameId,
      outcome,
      winner: tracker.last.winner,
      turns: tracker.last.turns,
      moves: tracker.last.moves,
      undoCount: tracker.undoCount,
      pauseCount: tracker.pauseCount,
      aiErrors: tracker.aiErrors,
    })
  }

  const unsubscribe = useGameStore.subscribe((state, previous) => {
    if (state.gameId !== previous.gameId) {
      // A new game (or a reset) closes whatever was open as abandoned.
      endGame('abandoned')
      tracker = null

      if (state.gameId !== null && state.config !== null) {
        const engines = describeEngines()
        tracker = {
          gameId: state.gameId,
          undoCount: 0,
          pauseCount: 0,
          aiErrors: {},
          ended: false,
          last: { turns: 0, moves: 0, winner: null },
        }
        send({
          type: 'game_start',
          sessionId: sid,
          gameId: state.gameId,
          mode: state.config.mode as StatsGameMode,
          matchType: state.config.mode === 'aiVsAi' ? state.config.aiMatchType : null,
          aiProvider: engines.provider,
          aiModel: engines.model,
          difficulty: engines.difficulty,
          ...appearance(),
        })
      }
      return
    }

    if (tracker === null || tracker.ended) return

    if (!previous.isPaused && state.isPaused) tracker.pauseCount += 1
    if (state.currentStepIndex < previous.currentStepIndex) tracker.undoCount += 1
    if (state.lastAiError !== null && state.lastAiError !== previous.lastAiError) {
      const code = state.lastAiError.code
      tracker.aiErrors[code] = (tracker.aiErrors[code] ?? 0) + 1
    }

    tracker.last = {
      turns: Math.max(0, state.turnNumber - 1),
      moves: state.history.length,
      winner: state.board?.winner ?? null,
    }
    if (state.board?.phase === 'finished') endGame('finished')
  })

  // The tab closing mid-game is the common way a game is "abandoned"; sendBeacon survives unload.
  const onPageHide = (): void => endGame('abandoned')
  window.addEventListener('pagehide', onPageHide)

  return () => {
    unsubscribe()
    window.removeEventListener('pagehide', onPageHide)
  }
}

