import type { BoardState, DieFace, DiceRoll, Move, MoveSource } from '@/types/game'
import type { GameConfigSnapshot, SeatPlan } from '@/types/gameConfig'
import type { AiEngineConfig } from '@/types/settings'
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
  startNewGame: (config: GameConfigSnapshot, personal: AiEngineConfig) => boolean
  roll: () => DieFace[] | null
  makeMove: (move: Move) => boolean
  selectPoint: (from: MoveSource | null) => void
  passTurn: () => void
  resetGame: () => void
}

/**
 * Active game state. NOT persisted: `seatPlan` holds `AiEngineConfig` objects — API keys — so
 * writing this store to localStorage would create a third copy of your credentials for no
 * benefit. All rules live in `utils/gameLogic.ts`; this file only sequences them.
 */
export const useGameStore = create<GameStoreState>()((set, get) => ({
  board: null,
  seatPlan: null,
  config: null,
  lastRoll: null,
  history: [],
  selectedFrom: null,
  turnPassed: null,

  startNewGame: (config, personal) => {
    const seatPlan = planSeats(personal, config)

    if (seatPlan.ready === false) {
      logger.warn('refusing to start: seat configuration incomplete', {
        mode: config.mode,
        aiMatchType: config.aiMatchType,
      })
      return false
    }

    set({
      board: getInitialBoardState(),
      seatPlan,
      config,
      lastRoll: null,
      history: [],
      selectedFrom: null,
      turnPassed: null,
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
      })
      return dice
    }

    set({ board: rolled, lastRoll: pair, selectedFrom: null, turnPassed: null })
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
    set({ board: endTurn(board), selectedFrom: null, turnPassed: null })
  },

  resetGame: () => {
    set({
      board: null,
      seatPlan: null,
      config: null,
      lastRoll: null,
      history: [],
      selectedFrom: null,
      turnPassed: null,
    })
  },
}))
