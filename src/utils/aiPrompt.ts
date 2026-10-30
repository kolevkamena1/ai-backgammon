import type { BoardState, Move, PlayerColor } from '@/types/game'
import type { AiDifficulty } from '@/types/settings'
import { HOME_BOARD, otherPlayer } from '@/utils/gameLogic'

/**
 * Every word the AI sees, in one file, so the prompt can be tuned without touching transport or
 * rules. Pure string building: no fetch, no store, no side effects.
 *
 * The anti-hallucination lever is that the model is handed the **already validated** legal-move
 * list and only has to pick an entry from it, so it can never invent coordinates that the rules
 * engine would reject.
 */

/** The JSON contract quoted in the system prompt. */
export const AI_JSON_CONTRACT =
  '{"from": <point number or "bar">, "to": <point number or "off">, "die": <1-6>}'

/**
 * What the model is actually asked for: a reason, then the move. `explanation` comes FIRST because
 * the reply is streamed — a model that answers `choice` first would show the player nothing until
 * the very last token. `AI_JSON_CONTRACT` and a bare `{"choice": n}` stay accepted, since a model
 * that ignores the new wording must still be able to play.
 */
export const AI_REPLY_CONTRACT =
  '{"explanation": "<one short sentence saying why this move is best>", "choice": <the move number from the list, 1-based>}'

/** Asked of the model. The parser (`utils/aiClient.ts`) tolerates more than this, never less. */
export const EXPLANATION_CHAR_BUDGET = 200

/**
 * How the sentence should read at each level. The strength line above it sets the play; this sets
 * the register, so Hard explains a two-move idea and Easy just says what moved.
 */
export const EXPLANATION_HINTS: Record<AiDifficulty, string> = {
  easy: 'Say plainly which checker you moved and where it landed.',
  medium: 'Name the tactic: the point you made, the blot you hit, the builder you kept.',
  hard: "Name the threat you are answering or the trap you are setting, in the opponent's terms.",
}

export interface AiPrompt {
  system: string
  user: string
}

const SEAT_NAME: Record<PlayerColor, string> = { light: 'White', dark: 'Black' }
const POINTS_PER_ROW = 6

/**
 * The one lever that turns "any capable model" into a chosen playing strength, quoted verbatim so
 * the three levels can be tuned without touching anything else. `hard` is the only level that asks
 * for lookahead, and `utils/aiClient.ts` gives it a larger reply budget to match.
 */
export const DIFFICULTY_INSTRUCTIONS: Record<AiDifficulty, string> = {
  easy: 'Play casually. Make standard moves without deep strategy.',
  medium: 'Play strategically. Prioritize making points and hitting blots.',
  // Double-quoted on purpose: the wording carries an apostrophe, and a single-quoted string would
  // have to escape it twice over (here and in any copy of the text).
  hard: "Play aggressively and defensively. Analyze the opponent's threats 2 moves ahead. Prioritize building primes and blocking the opponent's escape. Take calculated risks to win.",
}

/** `bar -> 19 using die 6`, `13 -> 8 using die 5`, `3 -> off (bear off) using die 3`. */
export function describeMove(move: Move): string {
  const from = move.from === 'bar' ? 'bar' : `point ${move.from}`
  const to = move.to === 'off' ? 'off (bear off)' : `point ${move.to}`
  return `${from} -> ${to} using die ${move.die}`
}

/**
 * All 24 points as signed counts, six per line. `+` is White, `-` is Black, bare `0` is empty
 * (see `types/game.ts` for why the array is signed).
 */
export function renderPoints(board: BoardState): string {
  const cells = board.points.map(
    (value, position) => `${position + 1}:${value > 0 ? `+${value}` : `${value}`}`,
  )

  const rows: string[] = []
  for (let start = 0; start < cells.length; start += POINTS_PER_ROW) {
    rows.push(`  ${cells.slice(start, start + POINTS_PER_ROW).join('  ')}`)
  }

  return rows.join('\n')
}

/** The position, the dice in hand and the numbered menu of legal moves. */
export function renderPosition(
  board: BoardState,
  player: PlayerColor,
  legalMoves: readonly Move[],
): string {
  const [first, last] = HOME_BOARD[player]
  const toward =
    player === 'light'
      ? '24 -> 1, bearing off past point 1'
      : '1 -> 24, bearing off past point 24'

  const menu =
    legalMoves.length === 0
      ? '  (none - the turn passes)'
      : legalMoves.map((move, index) => `  ${index + 1}. ${describeMove(move)}`).join('\n')

  return [
    `Turn: ${SEAT_NAME[player]} (${player}). Choose one move for ${SEAT_NAME[player]}.`,
    `Your direction of travel is ${toward}. Your home board is points ${first}-${last}.`,
    `Dice still to play: ${board.dice.length === 0 ? 'none' : board.dice.join(', ')}.`,
    `On the bar - White ${board.bar.light}, Black ${board.bar.dark}.`,
    `Borne off - White ${board.off.light}, Black ${board.off.dark}.`,
    'Points (index:count, + is White, - is Black, 0 is empty):',
    renderPoints(board),
    `Opponent: ${SEAT_NAME[otherPlayer(player)]}.`,
    '',
    `Legal moves - pick exactly one of these ${legalMoves.length} numbered options:`,
    menu,
  ].join('\n')
}

/**
 * The rules of the game plus the strength of play. `difficulty` defaults to the middle level so
 * every existing caller (and every test) keeps working while the setup flow gains a selector.
 */
export function buildSystemPrompt(player: PlayerColor, difficulty: AiDifficulty = 'medium'): string {
  return [
    `You are a backgammon engine playing ${SEAT_NAME[player]}. Reply with exactly one move.`,
    `Playing strength: ${difficulty}. ${DIFFICULTY_INSTRUCTIONS[difficulty]}`,
    'Numbering runs 1 to 24. Positive counts on a point are White checkers, negative are Black.',
    'A checker on the bar must be re-entered before anything else may move.',
    'Bearing off is written as "to": "off".',
    '',
    'The position comes with a numbered list of legal moves already validated by the rules engine.',
    'Choose exactly one entry from that list. Never invent a move, a point or a die value.',
    '',
    'Return ONLY a single JSON object, no prose around it, no markdown fences. Write the reason',
    'first and then the move, so the sentence arrives before the choice:',
    AI_REPLY_CONTRACT,
    `The explanation is one sentence, under ${EXPLANATION_CHAR_BUDGET} characters, first person, and carries no`,
    `double quotes inside it. ${EXPLANATION_HINTS[difficulty]}`,
    'The move may be given in full instead as',
    AI_JSON_CONTRACT,
  ].join('\n')
}

/**
 * The full request for one move. `legalMoves` must come from `getLegalMoves()` for the same
 * board, so the menu shown here and the validation in `aiClient.ts` can never disagree.
 */
export function buildMovePrompt(
  board: BoardState,
  player: PlayerColor,
  legalMoves: readonly Move[],
  difficulty: AiDifficulty = 'medium',
): AiPrompt {
  return {
    system: buildSystemPrompt(player, difficulty),
    user: `${renderPosition(board, player, legalMoves)}\n\nChoose one now. Reply with the JSON object only.`,
  }
}
