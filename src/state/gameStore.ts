import type { AiDelta, AiErrorInfo, AiResult } from '@/types/ai'
import type { BoardState, DieFace, DiceRoll, Move, MoveSource, PlayerColor } from '@/types/game'
import type { GameConfigSnapshot, SeatAssignment, SeatPlan } from '@/types/gameConfig'
import type { GameSnapshot, MoveRecord } from '@/types/gameLog'
import type { DoublingCubeState, GameVictory, MatchScoreState } from '@/types/gameMatch'
import type { AiEngineConfig } from '@/types/settings'
import {
  AI_MOVE_DELAY_MS,
  extractPartialExplanation,
  getAiMove,
  supportsStreaming,
} from '@/utils/aiClient'
import { evaluateAiAcceptDouble, evaluateAiShouldDouble } from '@/utils/doublingAi'
import { logger } from '@/lib/logger'
import { planSeats } from '@/utils/gameConfig'
import {
  applyMove,
  canPlay,
  createSeededRng,
  endTurn,
  evaluateVictoryGrade,
  expandRoll,
  formatMove,
  getInitialBoardState,
  getLegalMoves,
  isHitMove,
  rollPair,
  type RandomSource,
} from '@/utils/gameLogic'
import { create } from 'zustand'

/** Why the last turn ended early, so the UI can explain it instead of looking broken. */
export type TurnPassReason = 'unplayable-roll' | 'stranded-dice'

/**
 * What the engine said about its move. Transient by design â€” the store is never persisted, and a
 * rationale about a position that no longer exists is worse than no rationale, so it is cleared on
 * a human move, an abandoned game and a new game.
 */
export interface AiThought {
  /** Which seat said it: in an AI vs AI match the two seats can say contradictory things. */
  seat: PlayerColor
  /** Live streamed text while `phase` is `streaming`, the model's sentence when it is `final`. */
  text: string
  phase: 'streaming' | 'final'
}

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
  /** The engine's own words about the move it just made, or the text arriving for the next one. */
  aiThought: AiThought | null
  /** Pacing between moves inside one AI turn, so a human can follow the board. Tests set 0. */
  aiMoveDelayMs: number
  /** True when the game flow or AI auto-advance is paused by user. */
  isPaused: boolean
  /** Unique per started game (null when none); lets telemetry tell one game from the next. */
  gameId: string | null
  /** 1-based turn sequence counter. */
  turnNumber: number
  /**
   * Every roll of the game, indexed by `turnNumber - 1`. A turn whose roll is already recorded
   * replays it instead of rolling fresh, which is how "rewind, keep dice" reproduces the sequence.
   */
  recordedRolls: DiceRoll[]
  /** Step-by-step game state history (roll, move, pass); the source of the game log. */
  stepHistory: GameSnapshot[]
  /** Index of the latest snapshot in stepHistory (always the last one: rewinds truncate). */
  currentStepIndex: number
  /** Doubling cube state (value 1..64, owner, and active pending offer). */
  cube: DoublingCubeState
  /** Overall match set score state across multiple games. */
  match: MatchScoreState | null
  /** Pseudo-random generator for seeded dice, or null for manual dice input. */
  rng: RandomSource | null
  startNewGame: (config: GameConfigSnapshot, personal: AiEngineConfig, resetMatch?: boolean) => boolean
  /** Starts the next game in an active match set, keeping accumulated set points. */
  startNextGameInSet: () => boolean
  /** Proposes a doubling of the stake (value x2) to the opponent. */
  proposeDouble: (proposer: PlayerColor) => boolean
  /** Responds to a pending double offer: accept (Take) or decline (Drop/Resign). */
  respondToDouble: (responder: PlayerColor, accept: boolean, reasoning?: string) => void
  roll: (customPair?: DiceRoll) => DieFace[] | null
  makeMove: (move: Move) => boolean
  selectPoint: (from: MoveSource | null) => void
  passTurn: () => void
  /** Ask the seat to act for exactly one move. No-op unless that seat is an AI. */
  aiMakeMove: () => Promise<boolean>
  /** Roll if needed, then keep asking until the turn is handed over. Single-flight. */
  runAiTurn: () => Promise<void>
  dismissAiError: () => void
  retryAiTurn: () => void
  /** Hides the thought panel without touching the board. */
  clearAiThought: () => void
  resetGame: () => void
  togglePause: () => void
  setPaused: (paused: boolean) => void
  /**
   * Deletes the moves of turn `turnNumber` and of every later turn, but keeps their dice: the
   * board returns to the moment right after that turn's roll and the recorded rolls replay in
   * order. Refused while an AI request is in flight. Leaves the game paused.
   */
  rewindMovesFrom: (turnNumber: number) => boolean
  /**
   * Deletes turn `turnNumber` and every later turn, dice included: the board returns to the
   * moment before that turn's roll and every roll from there on is random again. Refused while
   * an AI request is in flight. Leaves the game paused.
   */
  rewindRollsFrom: (turnNumber: number) => boolean
}

/**
 * How often an arriving sentence may repaint the panel. The store is written with the CUMULATIVE text,
 * so a skipped frame costs a stutter and never a missing word, and the final explanation overwrites
 * everything anyway. A chatty model can deliver a token every few milliseconds; a React commit every
 * few milliseconds is not something a board interaction should have to compete with.
 */
const AI_THOUGHT_THROTTLE_MS = 80

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Index of the snapshot that rolled the dice for `turnNumber`: the first step logged under that
 * turn (step 0 is the opening layout, never a roll). -1 when the turn has not been rolled.
 */
function findRollStep(stepHistory: GameSnapshot[], turnNumber: number): number {
  return stepHistory.findIndex(
    (snap) =>
      snap.stepIndex > 0 &&
      snap.turnNumber === turnNumber &&
      snap.lastMove === undefined &&
      snap.description.startsWith('Rolled'),
  )
}

/**
 * Active game state. NOT persisted: `seatPlan` holds `AiEngineConfig` objects â€” API keys â€” so
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

    // Live text: opened before the request so the panel is already there when the first words land,
    // and only for providers whose SSE this client can actually read. On the buffered path nothing is
    // shown until the move is known, which is the honest version of "thinking".
    if (supportsStreaming(engine.provider)) {
      set({ aiThought: { seat: color, text: '', phase: 'streaming' } })
    }

    let lastPaint = 0
    const onDelta = (delta: AiDelta): void => {
      // Reasoning deltas are ignored on purpose: thinking is off at every difficulty, and even if a
      // gateway sent them, provider internals are not something to print on a game board.
      if (delta.kind !== 'explanation' || token !== aiToken) {
        return
      }

      const partial = extractPartialExplanation(delta.text)
      if (partial === null) {
        return
      }

      const now = Date.now()
      if (now - lastPaint < AI_THOUGHT_THROTTLE_MS) {
        return
      }
      lastPaint = now
      set({ aiThought: { seat: color, text: partial, phase: 'streaming' } })
    }

    const result: AiResult = await getAiMove(engine, snapshot, color, {
      signal: controller?.signal,
      onDelta,
    })

    // The game was abandoned or restarted while the request was in flight.
    if (token !== aiToken) {
      logger.debug('discarding ai reply for a superseded game', { seat: color })
      return 'stop'
    }

    if (result.success === false) {
      // The failure banner replaces any earlier rationale: the position it described never got to
      // happen, and two explanations on screen would read as one of them being a lie.
      set({ lastAiError: { message: result.error, code: result.code }, aiThought: null })
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
        aiThought: null,
      })
      logger.error('ai move rejected by the rules engine', { seat: color })
      return 'stop'
    }

    // Only after the move is on the board: a reason for a move that did not happen is worse than no
    // reason at all. Silence (the model ignored the field, or filled it with junk) also clears the
    // placeholder the stream opened, so the panel never freezes on a half-sentence that was never a
    // reply â€” the move played, the engine just had nothing to say about it.
    const thought =
      result.explanation === null
        ? null
        : { seat: color, text: result.explanation, phase: 'final' as const }

    // Also persist the thought onto the latest snapshot in stepHistory so it stays visible in the log
    const { stepHistory, currentStepIndex } = get()
    if (result.explanation !== null && stepHistory[currentStepIndex]) {
      const updatedHistory = [...stepHistory]
      updatedHistory[currentStepIndex] = {
        ...updatedHistory[currentStepIndex],
        aiThought: result.explanation,
      }
      set({ aiThought: thought, stepHistory: updatedHistory })
    } else {
      set({ aiThought: thought })
    }

    return 'moved'
  }

  /**
   * Makes `kept` the whole history and puts the board back to its last snapshot. Shared by both
   * rewinds; anything in flight is cancelled and the game is left paused until Resume.
   */
  const restore = (kept: GameSnapshot[], turnNumber: number, recordedRolls: DiceRoll[]): void => {
    const last = kept[kept.length - 1]

    cancelAi()
    set({
      board: last.board,
      lastRoll: last.lastRoll,
      cube: last.cube ?? get().cube,
      history: kept.flatMap((snap) =>
        snap.lastMove ? [{ from: snap.lastMove.from, to: snap.lastMove.to, die: snap.lastMove.die }] : [],
      ),
      selectedFrom: null,
      turnPassed: null,
      isAiThinking: false,
      lastAiError: null,
      aiThought: null,
      isPaused: true,
      turnNumber,
      recordedRolls,
      stepHistory: kept,
      currentStepIndex: kept.length - 1,
    })
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
    aiThought: null,
    aiMoveDelayMs: AI_MOVE_DELAY_MS,
    isPaused: false,
    gameId: null,
    turnNumber: 1,
    recordedRolls: [],
    stepHistory: [],
    currentStepIndex: 0,
    cube: {
      value: 1,
      owner: 'centered',
      proposedBy: null,
    },
    match: null,
    rng: null,

    startNewGame: (config, personal, resetMatch = true) => {
      const seatPlan = planSeats(personal, config)

      if (seatPlan.ready === false) {
        logger.warn('refusing to start: seat configuration incomplete', {
          mode: config.mode,
          aiMatchType: config.aiMatchType,
        })
        return false
      }

      let rng: RandomSource | null = Math.random
      if (config.dice?.mode === 'seeded') {
        const seed = config.dice.seed ?? 1
        rng = createSeededRng(seed)
      } else if (config.dice?.mode === 'manual') {
        rng = null
      }

      cancelAi()
      const initialBoard = getInitialBoardState()
      const initialSnapshot: GameSnapshot = {
        stepIndex: 0,
        turnNumber: 1,
        player: 'light',
        board: initialBoard,
        lastRoll: null,
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        cube: { value: 1, owner: 'centered', proposedBy: null },
        aiThought: null,
        description: 'Game started',
        at: Date.now(),
      }

      const matchConfig = config.match ?? { targetPoints: 1, enableCrawford: false }
      const isAiVsAi = config.mode === 'aiVsAi'
      const enableCrawford = isAiVsAi ? false : matchConfig.enableCrawford

      let matchState = get().match
      if (resetMatch || matchState === null || matchState.targetPoints !== matchConfig.targetPoints) {
        matchState = {
          light: 0,
          dark: 0,
          targetPoints: matchConfig.targetPoints,
          gameIndex: 1,
          matchWinner: null,
          enableCrawford,
          isCrawfordGame: false,
          lastVictory: null,
        }
      }

      set({
        board: initialBoard,
        seatPlan,
        config,
        lastRoll: null,
        history: [],
        selectedFrom: null,
        turnPassed: null,
        isAiThinking: false,
        lastAiError: null,
        aiThought: null,
        isPaused: false,
        gameId: crypto.randomUUID(),
        turnNumber: 1,
        recordedRolls: [],
        stepHistory: [initialSnapshot],
        currentStepIndex: 0,
        cube: {
          value: 1,
          owner: 'centered',
          proposedBy: null,
        },
        match: matchState,
        rng,
      })
      logger.debug('game started', { mode: config.mode, aiMatchType: config.aiMatchType, matchState })
      return true
    },

    startNextGameInSet: () => {
      const { config, match } = get()
      if (config === null || match === null || match.matchWinner !== null) {
        return false
      }

      const initialBoard = getInitialBoardState()
      const initialSnapshot: GameSnapshot = {
        stepIndex: 0,
        turnNumber: 1,
        player: 'light',
        board: initialBoard,
        lastRoll: null,
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        cube: { value: 1, owner: 'centered', proposedBy: null },
        aiThought: null,
        description: `Game ${match.gameIndex + 1} started`,
        at: Date.now(),
      }

      // Check if next game is Crawford game:
      // When Crawford is enabled and either player is exactly 1 point away from match target
      const lightNeed = match.targetPoints - match.light
      const darkNeed = match.targetPoints - match.dark
      const isCrawford = match.enableCrawford && !match.isCrawfordGame && (lightNeed === 1 || darkNeed === 1)

      const updatedMatch: MatchScoreState = {
        ...match,
        gameIndex: match.gameIndex + 1,
        isCrawfordGame: isCrawford,
        lastVictory: null,
      }

      cancelAi()
      set({
        board: initialBoard,
        lastRoll: null,
        history: [],
        selectedFrom: null,
        turnPassed: null,
        isAiThinking: false,
        lastAiError: null,
        aiThought: null,
        isPaused: false,
        gameId: crypto.randomUUID(),
        turnNumber: 1,
        recordedRolls: [],
        stepHistory: [initialSnapshot],
        currentStepIndex: 0,
        cube: {
          value: 1,
          owner: 'centered',
          proposedBy: null,
        },
        match: updatedMatch,
      })
      return true
    },

    proposeDouble: (proposer) => {
      const { board, cube, isAiThinking, match } = get()
      if (
        board === null ||
        board.phase === 'finished' ||
        board.dice.length > 0 ||
        board.turn !== proposer ||
        isAiThinking ||
        cube.value >= 64 ||
        cube.proposedBy !== null ||
        (cube.owner !== 'centered' && cube.owner !== proposer) ||
        match?.isCrawfordGame
      ) {
        return false
      }

      const nextCube: DoublingCubeState = {
        ...cube,
        proposedBy: proposer,
      }
      const currentHistory = get().stepHistory
      const nextIndex = currentHistory.length
      const targetValue = cube.value * 2

      const proposeSnapshot: GameSnapshot = {
        stepIndex: nextIndex,
        turnNumber: get().turnNumber,
        player: proposer,
        board,
        lastRoll: null,
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        cubeAction: {
          type: 'propose',
          player: proposer,
          value: targetValue,
          at: Date.now(),
        },
        cube: nextCube,
        aiThought: null,
        description: `${proposer === 'light' ? 'White' : 'Black'} proposed double to ${targetValue}`,
        at: Date.now(),
      }

      set({
        cube: nextCube,
        stepHistory: [...currentHistory, proposeSnapshot],
        currentStepIndex: nextIndex,
      })
      logger.info('double proposed', { proposer, currentCube: cube.value, targetValue })

      // If the respondent is an AI seat, evaluate and respond immediately!
      const responder: PlayerColor = proposer === 'light' ? 'dark' : 'light'
      const respondentSeat = get().seatPlan?.[responder]
      if (respondentSeat && respondentSeat.kind === 'ai') {
        const acceptDecision = evaluateAiAcceptDouble(board, responder)
        get().respondToDouble(responder, acceptDecision.accept, acceptDecision.reason)
      }

      return true
    },

    respondToDouble: (responder, accept, reasoning) => {
      const { board, cube, match } = get()
      if (board === null || cube.proposedBy === null || cube.proposedBy === responder) {
        return
      }

      const proposer = cube.proposedBy
      const currentHistory = get().stepHistory
      const nextIndex = currentHistory.length

      if (accept) {
        // Player accepts (Take): cube value doubles, responder now owns the cube
        const nextValue = cube.value * 2
        const nextCube: DoublingCubeState = {
          value: nextValue,
          owner: responder,
          proposedBy: null,
        }
        const acceptSnapshot: GameSnapshot = {
          stepIndex: nextIndex,
          turnNumber: get().turnNumber,
          player: responder,
          board,
          lastRoll: null,
          diceRemaining: [],
          selectedFrom: null,
          turnPassed: null,
          cubeAction: {
            type: 'accept',
            player: responder,
            value: nextValue,
            reasoning,
            at: Date.now(),
          },
          cube: nextCube,
          aiThought: reasoning ?? null,
          description: `${responder === 'light' ? 'White' : 'Black'} accepted double (${nextValue}x)`,
          at: Date.now(),
        }

        set({
          cube: nextCube,
          stepHistory: [...currentHistory, acceptSnapshot],
          currentStepIndex: nextIndex,
        })
        logger.info('double accepted', { responder, newValue: nextValue, reasoning })
      } else {
        // Player declines (Drop / Resign): proposer wins current cube points immediately
        const pointsWon = cube.value
        const victory: GameVictory = {
          winner: proposer,
          loser: responder,
          grade: 'single',
          basePoints: 1,
          cubeMultiplier: cube.value,
          totalPoints: pointsWon,
          reason: 'resigned-double',
        }

        const nextBoard: BoardState = {
          ...board,
          phase: 'finished',
          winner: proposer,
          dice: [],
        }

        let updatedMatch = match
        if (match) {
          const newLight = match.light + (proposer === 'light' ? pointsWon : 0)
          const newDark = match.dark + (proposer === 'dark' ? pointsWon : 0)
          const matchWon = newLight >= match.targetPoints ? 'light' : newDark >= match.targetPoints ? 'dark' : null
          updatedMatch = {
            ...match,
            light: newLight,
            dark: newDark,
            matchWinner: matchWon,
            lastVictory: victory,
          }
        }

        const nextCube: DoublingCubeState = {
          ...cube,
          proposedBy: null,
        }

        const declineSnapshot: GameSnapshot = {
          stepIndex: nextIndex,
          turnNumber: get().turnNumber,
          player: responder,
          board: nextBoard,
          lastRoll: null,
          diceRemaining: [],
          selectedFrom: null,
          turnPassed: null,
          cubeAction: {
            type: 'decline',
            player: responder,
            value: cube.value,
            reasoning,
            at: Date.now(),
          },
          cube: nextCube,
          aiThought: reasoning ?? null,
          description: `${responder === 'light' ? 'White' : 'Black'} declined double`,
          at: Date.now(),
        }

        cancelAi()
        set({
          board: nextBoard,
          cube: nextCube,
          stepHistory: [...currentHistory, declineSnapshot],
          currentStepIndex: nextIndex,
          match: updatedMatch,
        })
        logger.info('double declined; game finished', { winner: proposer, pointsWon, reasoning })
      }
    },

    roll: (customPair) => {
      const { board, turnNumber, recordedRolls, stepHistory, currentStepIndex, rng } = get()

      if (board === null || board.phase === 'finished') {
        return null
      }
      if (board.dice.length > 0) {
        logger.warn('roll refused: dice still to play')
        return null
      }

      // Exact replay: if we undid and are rolling on a turn that already had a recorded roll, replay it.
      const turnIdx = turnNumber - 1
      let pair: DiceRoll
      let updatedRolls = recordedRolls

      if (customPair) {
        pair = customPair
        updatedRolls = [...recordedRolls.slice(0, turnIdx), pair]
      } else if (turnIdx >= 0 && turnIdx < recordedRolls.length) {
        pair = recordedRolls[turnIdx]
      } else {
        const activeRng = rng ?? Math.random
        pair = rollPair(activeRng)
        updatedRolls = [...recordedRolls, pair]
      }

      const dice = expandRoll(pair)
      const rolled: BoardState = { ...board, dice, phase: 'playing' }

      const baseHistory =
        currentStepIndex < stepHistory.length - 1
          ? stepHistory.slice(0, currentStepIndex + 1)
          : stepHistory

      // Real rule, and it keeps the UI from dead-ending: a roll that fits nothing passes.
      if (canPlay(rolled, rolled.turn, dice) === false) {
        logger.debug('rolled but nothing is playable; turn passes', { dice })
        const nextBoard = endTurn(rolled)
        const snapshot: GameSnapshot = {
          stepIndex: baseHistory.length,
          turnNumber,
          player: rolled.turn,
          board: nextBoard,
          lastRoll: pair,
          diceRemaining: [],
          selectedFrom: null,
          turnPassed: 'unplayable-roll',
          aiThought: null,
          description: `Rolled ${pair[0]}-${pair[1]} (Pass)`,
          at: Date.now(),
        }

        set({
          board: nextBoard,
          lastRoll: pair,
          selectedFrom: null,
          turnPassed: 'unplayable-roll',
          lastAiError: null,
          turnNumber: turnNumber + 1,
          recordedRolls: updatedRolls,
          stepHistory: [...baseHistory, snapshot],
          currentStepIndex: snapshot.stepIndex,
        })
        return dice
      }

      const snapshot: GameSnapshot = {
        stepIndex: baseHistory.length,
        turnNumber,
        player: rolled.turn,
        board: rolled,
        lastRoll: pair,
        diceRemaining: dice,
        selectedFrom: null,
        turnPassed: null,
        aiThought: null,
        description: `Rolled ${pair[0]}-${pair[1]}`,
        at: Date.now(),
      }

      set({
        board: rolled,
        lastRoll: pair,
        selectedFrom: null,
        turnPassed: null,
        lastAiError: null,
        recordedRolls: updatedRolls,
        stepHistory: [...baseHistory, snapshot],
        currentStepIndex: snapshot.stepIndex,
      })
      logger.debug('rolled', { dice })
      return dice
    },

    makeMove: (move) => {
      const { board, history, turnNumber, stepHistory, currentStepIndex } = get()

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
        const isHit = isHitMove(board, move, player)
        const formatted = formatMove(move, isHit)
        const moveRecord: MoveRecord = {
          from: move.from,
          to: move.to,
          die: move.die,
          isHit,
          formatted,
        }

        let next = applyMove(board, move, player)

        // A human move ends the story the engine was telling: its last sentence describes a
        // position that is now gone. The AI's own move keeps it, because `takeOneMove` writes the
        // fresh sentence immediately after this call returns.
        const actor = get().seatPlan?.[player]
        const keepThought = actor !== undefined && actor.kind === 'ai'

        // Stranded dice: still our turn, dice left, but nothing can be played with them.
        const stranded =
          next.phase !== 'finished' &&
          next.turn === player &&
          next.dice.length > 0 &&
          canPlay(next, player, next.dice) === false

        if (stranded) {
          logger.debug('no move left with the remaining dice; turn passes', { remaining: next.dice })
          next = endTurn(next)
        }

        const baseHistory =
          currentStepIndex < stepHistory.length - 1
            ? stepHistory.slice(0, currentStepIndex + 1)
            : stepHistory

        const nextSnapshot: GameSnapshot = {
          stepIndex: baseHistory.length,
          turnNumber,
          player,
          board: next,
          lastRoll: get().lastRoll,
          diceRemaining: [...next.dice],
          selectedFrom: null,
          turnPassed: stranded ? 'stranded-dice' : null,
          // Always empty here: `takeOneMove` writes this move's own explanation onto this snapshot
          // once the move is on the board. Copying the live thought would hand the PREVIOUS move's
          // reasoning to a move the model said nothing about.
          aiThought: null,
          description: formatted,
          lastMove: moveRecord,
          at: Date.now(),
        }

        const nextTurnNumber = next.turn !== player ? turnNumber + 1 : turnNumber

        set({
          board: next,
          history: [...history, move],
          selectedFrom: null,
          turnPassed: stranded ? 'stranded-dice' : null,
          lastAiError: null,
          aiThought: keepThought ? get().aiThought : null,
          turnNumber: nextTurnNumber,
          stepHistory: [...baseHistory, nextSnapshot],
          currentStepIndex: nextSnapshot.stepIndex,
        })

        if (next.phase === 'finished' && next.winner !== null) {
          const winner = next.winner
          const loser: PlayerColor = winner === 'light' ? 'dark' : 'light'
          const grade = evaluateVictoryGrade(next, winner)
          const basePoints: 1 | 2 | 3 = grade === 'single' ? 1 : grade === 'gammon' ? 2 : 3
          const cubeMult = get().cube.value
          const totalPoints = basePoints * cubeMult

          const victory: GameVictory = {
            winner,
            loser,
            grade,
            basePoints,
            cubeMultiplier: cubeMult,
            totalPoints,
            reason: 'bear-off',
          }

          const currentMatch = get().match
          let updatedMatch = currentMatch
          if (currentMatch) {
            const newLight = currentMatch.light + (winner === 'light' ? totalPoints : 0)
            const newDark = currentMatch.dark + (winner === 'dark' ? totalPoints : 0)
            const matchWon = newLight >= currentMatch.targetPoints ? 'light' : newDark >= currentMatch.targetPoints ? 'dark' : null
            updatedMatch = {
              ...currentMatch,
              light: newLight,
              dark: newDark,
              matchWinner: matchWon,
              lastVictory: victory,
            }
          }

          set({ match: updatedMatch })
          logger.info('game finished', { winner, grade, basePoints, cubeMult, totalPoints, match: updatedMatch })
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
      const { board, turnNumber, stepHistory, currentStepIndex } = get()
      if (board === null || board.phase === 'finished') {
        return
      }
      const next = endTurn(board)
      const baseHistory =
        currentStepIndex < stepHistory.length - 1
          ? stepHistory.slice(0, currentStepIndex + 1)
          : stepHistory

      const snapshot: GameSnapshot = {
        stepIndex: baseHistory.length,
        turnNumber,
        player: board.turn,
        board: next,
        lastRoll: get().lastRoll,
        diceRemaining: [],
        selectedFrom: null,
        turnPassed: null,
        aiThought: null,
        description: 'Passed turn',
        at: Date.now(),
      }

      set({
        board: next,
        selectedFrom: null,
        turnPassed: null,
        lastAiError: null,
        turnNumber: turnNumber + 1,
        stepHistory: [...baseHistory, snapshot],
        currentStepIndex: snapshot.stepIndex,
      })
    },

    aiMakeMove: async () => {
      const seat = seatToAct()

      if (seat === null || seat.kind !== 'ai' || get().isAiThinking || get().isPaused) {
        return false
      }

      const token = aiToken
      controller?.abort()
      controller = new AbortController()
      set({ isAiThinking: true, lastAiError: null })

      try {
        return (await takeOneMove(seat.engine, seat.color, token)) === 'moved'
      } finally {
        if (token === aiToken) {
          set({ isAiThinking: false })
          controller = null
        }
      }
    },

    runAiTurn: async () => {
      const seat = seatToAct()
      const board = get().board

      if (
        seat === null ||
        seat.kind !== 'ai' ||
        board === null ||
        board.phase === 'finished' ||
        get().isPaused
      ) {
        return
      }

      // If an opponent double is pending response, AI responder must decide before anything else
      const pendingOffer = get().cube.proposedBy
      if (pendingOffer !== null && pendingOffer !== seat.color) {
        const acceptDecision = evaluateAiAcceptDouble(board, seat.color)
        get().respondToDouble(seat.color, acceptDecision.accept)
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
        // AI double evaluation before rolling
        if (get().board?.dice.length === 0) {
          const currentCube = get().cube
          const currentMatch = get().match
          const doubleDecision = evaluateAiShouldDouble(board, seat.color, currentCube, currentMatch)

          if (doubleDecision.shouldDouble) {
            get().proposeDouble(seat.color)
            const opponentColor: PlayerColor = seat.color === 'light' ? 'dark' : 'light'
            const opponentSeat = get().seatPlan?.[opponentColor]
            // If opponent is also AI, resolve immediately
            if (opponentSeat && opponentSeat.kind === 'ai') {
              const oppAccept = evaluateAiAcceptDouble(board, opponentColor)
              get().respondToDouble(opponentColor, oppAccept.accept)
            }
            // If double was declined, game finished; stop here
            if (get().board?.phase === 'finished') {
              return
            }
          }

          // Nobody else can roll for an AI seat, and a turn cannot start without dice.
          // In manual mode, the human inputs the dice for AI turns as well!
          if (get().config?.dice?.mode !== 'manual') {
            if (get().board?.dice.length === 0 && get().cube.proposedBy === null) {
              get().roll()
            }
          }

          if (get().board?.dice.length === 0) {
            return
          }
        }

        for (let step = 0; step < MAX_AI_MOVES_PER_TURN; step += 1) {
          if (get().isPaused) {
            break
          }

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

    clearAiThought: () => {
      set({ aiThought: null })
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
        aiThought: null,
        isPaused: false,
        gameId: null,
        turnNumber: 1,
        recordedRolls: [],
        stepHistory: [],
        currentStepIndex: 0,
        cube: {
          value: 1,
          owner: 'centered',
          proposedBy: null,
        },
        match: null,
        rng: null,
      })
    },

    togglePause: () => {
      const nextPaused = !get().isPaused
      if (nextPaused) {
        cancelAi()
      }
      set({ isPaused: nextPaused })
    },

    setPaused: (paused: boolean) => {
      if (paused) {
        cancelAi()
      }
      set({ isPaused: paused })
    },

    rewindMovesFrom: (turnNumber) => {
      const { stepHistory, recordedRolls } = get()
      const rollIndex = findRollStep(stepHistory, turnNumber)

      if (get().isAiThinking || rollIndex === -1) {
        return false
      }

      // A playable roll restores the position with the same dice in hand. A roll that passed
      // automatically has no "after the roll" position to stand on, so it goes back to before the
      // roll: the recorded dice are kept, so the replay rolls (and passes) exactly the same.
      const rolled = stepHistory[rollIndex]
      const keep = rolled.turnPassed === 'unplayable-roll' ? rollIndex : rollIndex + 1

      restore(stepHistory.slice(0, keep), turnNumber, recordedRolls)
      logger.debug('rewound moves, dice kept', { turnNumber })
      return true
    },

    rewindRollsFrom: (turnNumber) => {
      const { stepHistory, recordedRolls } = get()
      const rollIndex = findRollStep(stepHistory, turnNumber)

      if (get().isAiThinking || rollIndex === -1) {
        return false
      }

      // Forgetting the rolls of this turn and later is what makes the next roll random again.
      restore(stepHistory.slice(0, rollIndex), turnNumber, recordedRolls.slice(0, turnNumber - 1))
      logger.debug('rewound moves and dice', { turnNumber })
      return true
    },
  }
})
