import type { BoardState, DieFace } from '@/types/game'
import {
  AI_JSON_CONTRACT,
  AI_PROMPT_VERSION,
  AI_REPLY_CONTRACT,
  buildMovePrompt,
  buildSystemPrompt,
  defaultStrategyPrompt,
  describeMove,
  renderPoints,
  renderPosition,
  SYSTEM_PROMPT_PRESETS,
} from '@/utils/aiPrompt'
import { applyMove, createSeededRng, endTurn, expandRoll, getInitialBoardState, getLegalMoves, rollPair } from '@/utils/gameLogic'
import { describe, expect, it } from 'vitest'

const OPENING = getInitialBoardState()
const openingMoves = getLegalMoves(OPENING, 'light', [5])

describe('describeMove', () => {
  it('formats point, bar and bear-off sources', () => {
    expect(describeMove({ from: 13, to: 8, die: 5 })).toBe('point 13 -> point 8 using die 5')
    expect(describeMove({ from: 'bar', to: 19, die: 6 })).toBe('bar -> point 19 using die 6')
    expect(describeMove({ from: 3, to: 'off', die: 4 })).toBe('point 3 -> off (bear off) using die 4')
  })
})

describe('buildSystemPrompt', () => {
  const light = buildSystemPrompt('light')

  it('names the seat being played and forbids inventing moves', () => {
    expect(light).toContain('playing White')
    expect(light).toContain('Never invent a move')
    expect(light).toContain('already validated by the rules engine')
  })

  it('states the JSON contract and the no-prose rule', () => {
    expect(light).toContain(AI_JSON_CONTRACT)
    expect(light).toContain('ONLY a single JSON object')
    expect(light).toContain('no markdown fences')
    expect(light).toContain('"choice"')
  })

  it('differs per seat', () => {
    expect(buildSystemPrompt('dark')).toContain('playing Black')
    expect(buildSystemPrompt('dark')).not.toContain('playing White')
  })
})

describe('difficulty', () => {
  it('quotes the chosen level verbatim, and only that level', () => {
    const easy = buildSystemPrompt('light', 'easy')
    const medium = buildSystemPrompt('light', 'medium')
    const hard = buildSystemPrompt('light', 'hard')

    expect(easy).toContain('Play casually. Make standard moves without deep strategy.')
    expect(medium).toContain('Play strategically. Prioritize making points and hitting blots.')
    expect(hard).toContain("Analyze the opponent's threats 2 moves ahead")

    // The levels must not bleed into each other: an Easy prompt that still asks for prime-building
    // would play nothing like the option the user picked.
    expect(easy).not.toContain('2 moves ahead')
    expect(easy).not.toContain('Play strategically')
    expect(medium).not.toContain('Play casually')
    expect(hard).not.toContain('Play casually')
  })

  it('defaults to medium when a caller passes no level', () => {
    // Configs stored before the field existed reach here with `difficulty` undefined, so the
    // no-argument call is the real path, not a convenience.
    expect(buildSystemPrompt('light')).toBe(buildSystemPrompt('light', 'medium'))
  })

  it('keeps the rules and the menu contract at every level', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const prompt = buildSystemPrompt('light', difficulty)
      expect(prompt).toContain('already validated by the rules engine')
      expect(prompt).toContain('Never invent a move')
      expect(prompt).toContain(AI_JSON_CONTRACT)
    }
  })
})

describe('renderPoints', () => {
  it('describes all 24 points, six per row, with signs', () => {
    const text = renderPoints(OPENING)
    const rows = text.split('\n')
    expect(rows).toHaveLength(4)
    expect(text).toContain('1:-2')
    expect(text).toContain('6:+5')
    expect(text).toContain('24:+2')
    expect(text).toContain('13:+5')
    expect(text).toContain('19:-5')
    for (let index = 1; index <= 24; index += 1) {
      expect(text).toContain(`${index}:`)
    }
  })

  it('prints zero as a bare 0', () => {
    expect(renderPoints(OPENING)).toContain('2:0')
  })
})

describe('renderPosition', () => {
  const text = renderPosition(OPENING, 'light', openingMoves)

  it('reports the seat, direction and home board', () => {
    expect(text).toContain('Turn: White (light)')
    expect(text).toContain('24 -> 1, bearing off past point 1')
    expect(text).toContain('home board is points 1-6')
    expect(text).toContain('Opponent: Black')
  })

  it('lists the dice still to play', () => {
    const board = { ...OPENING, dice: [5, 5, 5, 5] as DieFace[] }
    expect(renderPosition(board, 'light', getLegalMoves(board, 'light', board.dice))).toContain(
      'Dice still to play: 5, 5, 5, 5',
    )
    expect(renderPosition(OPENING, 'light', [])).toContain('Dice still to play: none')
  })

  it('reports bar and bear-off counts', () => {
    const board: BoardState = {
      ...OPENING,
      bar: { light: 2, dark: 0 },
      off: { light: 1, dark: 3 },
      dice: [4],
    }
    const rendered = renderPosition(board, 'light', getLegalMoves(board, 'light', board.dice))
    expect(rendered).toContain('On the bar - White 2, Black 0')
    expect(rendered).toContain('Borne off - White 1, Black 3')
  })

  it('enumerates the legal menu one-based and matches the engine output', () => {
    expect(text).toContain(`pick exactly one of these ${openingMoves.length} numbered options`)
    openingMoves.forEach((move, index) => {
      expect(text).toContain(`${index + 1}. ${describeMove(move)}`)
    })
  })

  it('says the turn passes when nothing is playable', () => {
    expect(renderPosition(OPENING, 'light', [])).toContain('(none - the turn passes)')
  })
})

describe('buildMovePrompt', () => {
  const prompt = buildMovePrompt(OPENING, 'light', openingMoves)

  it('asks for a reason before the move', () => {
    const system = buildSystemPrompt('light')
    expect(system).toContain(AI_REPLY_CONTRACT)
    // Order is the whole point of the wording: streamed, an explanation written after the choice
    // would arrive too late to show while the player waits.
    expect(system.indexOf('explanation')).toBeLessThan(system.indexOf(AI_JSON_CONTRACT))
    expect(system).toContain('no markdown fences')
    expect(system).toContain('ONLY a single JSON object')
  })

  it('tailors the sentence to the level', () => {
    expect(buildSystemPrompt('light', 'easy')).toContain('Say plainly which checker you moved')
    expect(buildSystemPrompt('light', 'medium')).toContain('Name the tactic')
    expect(buildSystemPrompt('light', 'hard')).toContain('the threat you are answering')
  })

  it('returns both halves and ends with the JSON-only instruction', () => {
    expect(prompt.system.length).toBeGreaterThan(0)
    expect(prompt.user.endsWith('Reply with the JSON object only.')).toBe(true)
  })

  it('stays small enough to send on every move', () => {
    expect(prompt.system.length + prompt.user.length).toBeLessThan(3000)
  })

  it('carries no credentials', () => {
    const both = `${prompt.system}\n${prompt.user}`
    expect(both).not.toMatch(/sk-/)
    expect(both).not.toMatch(/api[-_]?key/i)
  })

  it('incorporates a custom system prompt while keeping the JSON move contract intact', () => {
    const custom = 'Play like an aggressive blitz grandmaster and explain pip equity.'
    const system = buildSystemPrompt('light', 'medium', custom)

    expect(system).toContain(custom)
    expect(system).toContain(AI_REPLY_CONTRACT)
    expect(system).toContain(AI_JSON_CONTRACT)
    expect(system).toContain('Never invent a move')

    // Passing the default strategy prompt for the level produces the exact legacy string.
    expect(buildSystemPrompt('light', 'medium', defaultStrategyPrompt('medium'))).toBe(
      buildSystemPrompt('light', 'medium'),
    )

    for (const preset of SYSTEM_PROMPT_PRESETS) {
      const presetSystem = buildSystemPrompt('dark', 'hard', preset.prompt)
      expect(presetSystem).toContain(preset.prompt)
      expect(presetSystem).toContain(AI_JSON_CONTRACT)
    }
  })

  it('includes a concise stakes line with cube value/owner, match score/target, and states doubling disabled during Crawford (C8)', () => {
    expect(AI_PROMPT_VERSION).toBe('2')
    const withStakes = buildMovePrompt(OPENING, 'light', openingMoves, 'medium', undefined, {
      cube: { value: 4, owner: 'dark', proposedBy: null },
      match: {
        light: 6,
        dark: 4,
        targetPoints: 7,
        gameIndex: 5,
        matchWinner: null,
        enableCrawford: true,
        isCrawfordGame: true,
        crawfordPlayed: true,
        lastVictory: null,
      },
    })

    expect(withStakes.user).toContain('Cube 4 (owned by Black)')
    expect(withStakes.user).toContain('White 6-4 Black')
    expect(withStakes.user).toContain('7 pts')
    expect(withStakes.user).toContain('doubling disabled')

    const nonCrawford = buildMovePrompt(OPENING, 'dark', getLegalMoves(OPENING, 'dark', [3]), 'hard', undefined, {
      cube: { value: 2, owner: 'light', proposedBy: null },
      match: {
        light: 2,
        dark: 1,
        targetPoints: 5,
        gameIndex: 2,
        matchWinner: null,
        enableCrawford: true,
        isCrawfordGame: false,
        crawfordPlayed: false,
        lastVictory: null,
      },
    })
    expect(nonCrawford.user).toContain('Cube 2 (owned by White)')
    expect(nonCrawford.user).toContain('White 2-1 Black (target 5 pts).')
    expect(nonCrawford.user).not.toContain('doubling disabled')

    // Sanity-play 3 complete seeded games generating the v2 move prompt on every ply
    for (const seed of [7, 42, 99]) {
      const rng = createSeededRng(seed)
      let board = getInitialBoardState()
      let plies = 0
      while (board.phase !== 'finished' && plies < 600) {
        if (board.dice.length === 0) {
          board = { ...board, dice: expandRoll(rollPair(rng)), phase: 'playing' }
        }
        const legal = getLegalMoves(board, board.turn, board.dice)
        if (legal.length === 0) {
          board = endTurn(board)
          continue
        }
        const p = buildMovePrompt(board, board.turn, legal, 'medium', undefined, {
          cube: { value: 2, owner: 'light', proposedBy: null },
          match: {
            light: 4,
            dark: 3,
            targetPoints: 5,
            gameIndex: 4,
            matchWinner: null,
            enableCrawford: true,
            isCrawfordGame: true,
            crawfordPlayed: true,
            lastVictory: null,
          },
        })
        expect(p.user).toContain('Stakes: Cube 2 (owned by White)')
        expect(p.user).toContain('doubling disabled')
        board = applyMove(board, legal[0], board.turn)
        plies += 1
      }
      expect(board.phase).toBe('finished')
    }
  })
})
