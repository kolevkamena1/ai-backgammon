import type { AiErrorInfo, AiResult } from '@/types/ai'
import type { BoardState, DieFace, DiceRoll, Move, MoveSource, PlayerColor } from '@/types/game'
import type { GameConfigSnapshot, SeatAssignment, SeatPlan } from '@/types/gameConfig'
import type { AiEngineConfig } from '@/types/settings'
import { AI_MOVE_DELAY_MS, getAiMove } from '@/utils/aiClient'
import { logger } from '@/lib/logger'
import { planSeats } from '@/utils/gameConfig'
import {
  applyMove,
  canPlay,
  endTurn,
  expandRoll,
  getInitialBoardState,
  getLegalMoves,
  rollPair,
} from '@/utils/gameLogic'
import { create } from 'zustand'

/** Why the last turn ended early, so the UI can explain it instead of looking broken. */
export type TurnPassReason = 'unplayable-roll' | 'stranded-dice'

/** Four dice is the most one turn can hold; the spare guards against a runaway loop. */
export const MAX_AI_MOVES_PER_TURN = 5

interface GameStoreState {
  /** Null until a game is started, so the board can fall back to the opening layout. */
  board: BoardState | null
  /**
   * Resolved ONCE at start by `planSeats()`. Deliberately a snapshot: editing Settings or the
   * game config mid-game must not change who is playing which seat.
   */
  seatPlan: SeatPlan | null
  config: GameConfigSnapshot | null
  lastRoll: DiceRoll | null
  history: Move[]
  /** Transient click-to-move selection: a point number, or `'bar'`. */
  selectedFrom: MoveSource | null
  /** Non-null right after an automatic pass; cleared by the next roll, move or reset. */
  turnPassed: TurnPassReason | null
  /** True while a move request is in flight; the UI shows a pulse and freezes interaction. */
  isAiThinking: boolean
  /** The last inference failure, kept until dismissed, retried or superseded by a new roll. */
  lastAiError: AiErrorInfo | null
  /** Pacing between moves inside one AI turn, so a human can follow the board. Tests set 0. */
  aiMoveDelayMs: number
  startNewGame: (config: GameConfigSnapshot, personal: AiEngineConfig) => boolean
  roll: () => DieFace[] | null
  makeMove: (move: Move) => boolean
  selectPoint: (from: MoveSource | null) => void
  passTurn: () => void
  /** Ask the seat to act for exactly one move. No-op unless that seat is an AI. */
  aiMakeMove: () => Promise<boolean>
  /** Roll if needed, then keep asking until the turn is handed over. Single-flight. */
  runAiTurn: () => Promise<void>
  dismissAiError: () => void
  retryAiTurn: () => void
  resetGame: () => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Active game state. NOT persisted: `seatPlan` holds `AiEngineConfig` objects — API keys — so
 * writing this store to localStorage would create a third copy of your credentials for no
 * benefit. All rules live in `utils/gameLogic.ts` and all transport in `utils/aiClient.ts`;
 * this file only sequences them.
 */
export const useGameStore = create<GameStoreState>()((set, get) => {
  /**
   * Bumped whenever a game starts or is abandoned. A reply that arrives after the bump belongs to
   * a board that no longer exists, so it is dropped instead of moving pieces in a new game.
   */
  let aiToken = 0
  let controller: AbortController | null = null

  /** Cancels anything in flight and invalidates its result. */
  const cancelAi = (): void => {
    controller?.abort()
    controller = null
    aiToken += 1
  }

  const seatToAct = (): SeatAssignment | null => {
    const { board, seatPlan } = get()
    return board !== null && seatPlan !== null ? seatPlan[board.turn] : null
  }

  /** One request + one validated move, sharing the bookkeeping between both AI entry points. */
  const takeOneMove = async (
    engine: AiEngineConfig,
    color: PlayerColor,
    token: number,
  ): Promise<'moved' | 'stop'> => {
    const snapshot = get().board

    if (snapshot === null || snapshot.phase === 'finished' || snapshot.turn !== color) {
      return 'stop'
    }

    const result: AiResult = await getAiMove(engine, snapshot, color, {
      signal: controller?.signal,
    })

    // The game was abandoned or restarted while the request was in flight.
    if (token !== aiToken) {
      logger.debug('discarding ai reply for a superseded game', { seat: color })
      return 'stop'
    }

    if (result.success === false) {
      set({ lastAiError: { message: result.error, code: result.code } })
      logger.error('ai move failed', { code: result.code, provider: engine.provider, seat: color })
      return 'stop'
    }

    if (get().makeMove(result.move) === false) {
      // Defensive: `getAiMove` only returns menu entries, so this means the rules and the menu
      // disagreed, which is a bug worth surfacing rather than silently retrying.
      set({
        lastAiError: {
          message: 'The rules engine rejected the move the model chose.',
          code: 'illegal-move',
        },
      })
      logger.error('ai move rejected by the rules engine', { seat: color })
      return 'stop'
    }

    return 'moved'
  }

  return {
    board: null,
    seatPlan: null,
    config: null,
    lastRoll: null,
    history: [],
    selectedFrom: null,
    turnPassed: null,
    isAiThinking: false,
    lastAiError: null,
    aiMoveDelayMs: AI_MOVE_DELAY_MS,

    startNewGame: (config, personal) => {
      const seatPlan = planSeats(personal, config)

      if (seatPlan.ready === false) {
        logger.warn('refusing to start: seat configuration incomplete', {
          mode: config.mode,
          aiMatchType: config.aiMatchType,
        })
        return false
      }

      cancelAi()
      set({
        board: getInitialBoardState(),
        seatPlan,
        config,
        lastRoll: null,
        history: [],
        selectedFrom: null,
        turnPassed: null,
        isAiThinking: false,
        lastAiError: null,
      })
      logger.debug('game started', { mode: config.mode, aiMatchType: config.aiMatchType })
      return true
    },

    roll: () => {
      const { board } = get()

      if (board === null || board.phase === 'finished') {
        return null
      }
      if (board.dice.length > 0) {
        logger.warn('roll refused: dice still to play')
        return null
      }

      const pair = rollPair()
      const dice = expandRoll(pair)
      const rolled: BoardState = { ...board, dice, phase: 'playing' }

      // Real rule, and it keeps the UI from dead-ending: a roll that fits nothing passes.
      if (canPlay(rolled, rolled.turn, dice) === false) {
        logger.debug('rolled but nothing is playable; turn passes', { dice })
        set({
          board: endTurn(rolled),
          lastRoll: pair,
          selectedFrom: null,
          turnPassed: 'unplayable-roll',
          lastAiError: null,
        })
        return dice
      }

      set({ board: rolled, lastRoll: pair, selectedFrom: null, turnPassed: null, lastAiError: null })
      logger.debug('rolled', { dice })
      return dice
    },

    makeMove: (move) => {
      const { board, history } = get()

      if (board === null || board.phase === 'finished') {
        logger.warn('move refused: no active game')
        return false
      }

      const player = board.turn
      const legal = getLegalMoves(board, player, board.dice).some(
        (candidate) =>
          candidate.from === move.from && candidate.to === move.to && candidate.die === move.die,
      )

      if (legal === false) {
        logger.warn('illegal move refused', {
          from: String(move.from),
          to: String(move.to),
          die: move.die,
        })
        return false
      }

      try {
        let next = applyMove(board, move, player)

        // Stranded dice: still our turn, dice left, but nothing can be played with them.
        const stranded =
          next.phase !== 'finished' && next.turn === player && next.dice.length > 0 &&
          canPlay(next, player, next.dice) === false

        if (stranded) {
          logger.debug('no move left with the remaining dice; turn passes', { remaining: next.dice })
          next = endTurn(next)
        }

        set({
          board: next,
          history: [...history, move],
          selectedFrom: null,
          turnPassed: stranded ? 'stranded-dice' : null,
          lastAiError: null,
        })

        if (next.phase === 'finished' && next.winner !== null) {
          logger.info('game finished', { winner: next.winner, moves: history.length + 1 })
        }
        return true
      } catch (error) {
        // Rules errors never surface to the UI as raw messages (see .clinerules).
        logger.error('applying move failed', { reason: String(error) })
        return false
      }
    },

    selectPoint: (from) => {
      // Clicking the same source again clears the selection.
      set((state) => ({ selectedFrom: state.selectedFrom === from ? null : from }))
    },

    passTurn: () => {
      const { board } = get()
      if (board === null || board.phase === 'finished') {
        return
      }
      set({ board: endTurn(board), selectedFrom: null, turnPassed: null, lastAiError: null })
    },

    aiMakeMove: async () => {
      const seat = seatToAct()

      if (seat === null || seat.kind !== 'ai' || get().isAiThinking) {
        return false
      }

      const token = aiToken
      set({ isAiThinking: true, lastAiError: null })

      try {
        return (await takeOneMove(seat.engine, seat.color, token)) === 'moved'
      } finally {
        if (token === aiToken) {
          set({ isAiThinking: false })
        }
      }
    },

    runAiTurn: async () => {
      const seat = seatToAct()
      const board = get().board

      if (seat === null || seat.kind !== 'ai' || board === null || board.phase === 'finished') {
        return
      }
      // Single flight: React may mount the trigger twice, and two components can observe the
      // same turn. Only one request chain may ever be in progress.
      if (get().isAiThinking) {
        return
      }

      const token = aiToken
      controller?.abort()
      controller = new AbortController()
      set({ isAiThinking: true, lastAiError: null })

      try {
        // Nobody else can roll for an AI seat, and a turn cannot start without dice.
        if (get().board?.dice.length === 0) {
          get().roll()
        }

        for (let step = 0; step < MAX_AI_MOVES_PER_TURN; step += 1) {
          const current = get().board

          if (
            current === null ||
            current.phase === 'finished' ||
            current.turn !== seat.color ||
            getLegalMoves(current, seat.color, current.dice).length === 0
          ) {
            break
          }

          if ((await takeOneMove(seat.engine, seat.color, token)) === 'stop') {
            break
          }
          if (token !== aiToken) {
            return
          }

          const after = get().board
          if (after === null || after.phase === 'finished' || after.turn !== seat.color) {
            break
          }

          if (get().aiMoveDelayMs > 0) {
            await sleep(get().aiMoveDelayMs)
          }
        }
      } finally {
        if (token === aiToken) {
          set({ isAiThinking: false })
          controller = null
        }
      }
    },

    dismissAiError: () => {
      set({ lastAiError: null })
    },

    retryAiTurn: () => {
      set({ lastAiError: null })
      void get().runAiTurn()
    },

    resetGame: () => {
      cancelAi()
      set({
        board: null,
        seatPlan: null,
        config: null,
        lastRoll: null,
        history: [],
        selectedFrom: null,
        turnPassed: null,
        isAiThinking: false,
        lastAiError: null,
      })
    },
  }
})
