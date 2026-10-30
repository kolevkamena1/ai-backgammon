import type { FetchLike } from '@/types/ai'
import type { AiEngineConfig } from '@/types/settings'
import type { BoardState } from '@/types/game'
import { AI_PROXY_PATH, getAiMove } from '@/utils/aiClient'
import { applyMove, endTurn, getInitialBoardState, getLegalMoves, rollDice } from '@/utils/gameLogic'
import { describe, expect, it } from 'vitest'

/**
 * Live relay checks. Opt-in, because they need servers that a normal `npm run test` must not assume:
 *
 *   # 1. mock OpenAI-compatible provider   -> npm run mock:provider           (port 4111)
 *   # 2. dev relay                         -> npm run dev                     (port 5173)
 *   # 3. production relay                  -> npm run pages:local             (port 8788)
 *   # then, from a fourth shell (bash syntax below; in PowerShell use $env:NAME = 'value'):
 *   AI_PROXY_E2E_ORIGIN=http://localhost:5173 \
 *   AI_PROXY_E2E_EDGE_ORIGIN=http://localhost:8788 \
 *   npm run test -- src/utils/__tests__/aiProxy.e2e.test.ts
 *
 * Step 1 is `scripts/mockprovider.mjs`. Step 3 is `wrangler pages dev dist`, which mounts
 * `functions/` and so answers with the production policy - that is what the last two cases check,
 * and it is why they expect a private http target to be refused there while succeeding in dev.
 *
 * These are the only tests that exercise the real transport stack; everything else injects `fetch`.
 */
/**
 * Env access without the `process` global. This suite runs in vitest's `node` environment, but it is
 * still part of the `tsconfig.app.json` program, which deliberately leaves `@types/node` out so app
 * code cannot reach Node globals from a browser bundle. Reading through a structural type keeps both
 * guarantees: no new `types` entry, and no `any`.
 */
interface NodeProcessLike {
  env?: Record<string, string | undefined>
}

const env: Record<string, string | undefined> =
  (globalThis as { process?: NodeProcessLike }).process?.env ?? {}

const DEV_ORIGIN = env.AI_PROXY_E2E_ORIGIN ?? ''
const EDGE_ORIGIN = env.AI_PROXY_E2E_EDGE_ORIGIN ?? ''
const PROVIDER = env.AI_PROXY_E2E_PROVIDER ?? 'http://127.0.0.1:4111/v1/chat/completions'

/** The client posts a relative path; in Node that needs the origin a browser would supply. */
function relayFetch(origin: string, seen: string[]): FetchLike {
  return (path, init) => {
    seen.push(path)
    return globalThis
      .fetch(origin + path, init)
      .then(async (response): Promise<Awaited<ReturnType<FetchLike>>> => ({
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        json: () => response.json(),
        text: () => response.text(),
      }))
  }
}

/** A position with one die and at least one legal move, for the single-request checks. */
const playingBoard = (): BoardState => ({ ...getInitialBoardState(), dice: [5], phase: 'playing' })

const engine = (baseUrl: string): AiEngineConfig => ({
  provider: 'custom',
  apiKey: 'sk-e2e-not-a-real-key',
  model: 'mock-model',
  baseUrl,
})

const describeIf = (origin: string) => (origin.length === 0 ? describe.skip : describe)

describeIf(DEV_ORIGIN)('relay end-to-end through the dev middleware', () => {
  it('plays a full AI-vs-AI game with every call going through /api/ai-proxy', async () => {
    const seen: string[] = []
    const relay = relayFetch(DEV_ORIGIN, seen)
    let board: BoardState = getInitialBoardState()
    let requests = 0

    // The mock answers `{"choice": 1}`, so each engine takes the first legal move it is offered:
    // deterministic progress, guaranteed bear-off, no dependence on a real provider.
    for (let ply = 0; ply < 600 && board.phase !== 'finished'; ply += 1) {
      if (board.dice.length === 0) {
        board = { ...board, dice: rollDice() }
      }

      const legal = getLegalMoves(board, board.turn, board.dice)
      if (legal.length === 0) {
        board = endTurn(board)
        continue
      }

      const result = await getAiMove(engine(PROVIDER), board, board.turn, { fetchImpl: relay })
      requests += 1
      if (!result.success) {
        throw new Error(`turn ${requests} (${board.turn}) failed: ${result.code} - ${result.error}`)
      }

      board = applyMove(board, result.move, board.turn)
    }

    expect(board.phase).toBe('finished')
    expect(board.winner).not.toBeNull()
    expect(requests).toBeGreaterThan(20)
    // Not one request left the app directly for a provider host: the relay path is the only target.
    expect(new Set(seen).size).toBe(1)
    expect(seen[0]).toBe(AI_PROXY_PATH)
  }, 120_000)

  it('surfaces a provider credential failure through the relay as unauthorized', async () => {
    // `normalizeBaseUrl` appends /v1, so the mock is reached on the standard chat path and rejects
    // the key the way a real provider does - by header, not by URL.
    const result = await getAiMove({ ...engine(PROVIDER), apiKey: 'wrong-key' }, playingBoard(), 'light', {
      fetchImpl: relayFetch(DEV_ORIGIN, []),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('unauthorized')
      expect(result.error).toContain('Invalid API key')
      expect(result.error).not.toContain('sk-e2e')
    }
  })

  it('reports an unreachable provider as a retryable network failure', async () => {
    const result = await getAiMove(engine('http://127.0.0.1:4199'), playingBoard(), 'light', {
      fetchImpl: relayFetch(DEV_ORIGIN, []),
      timeoutMs: 5_000,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('network')
    }
  })
})

describeIf(EDGE_ORIGIN)('relay end-to-end through the Pages Function', () => {
  it('blocks a private target at the edge with the typed proxy-blocked code', async () => {
    // The same call that succeeds against the dev middleware: the edge refuses it, and the client
    // reports that as its own failure rather than as something the provider said.
    const result = await getAiMove(engine('http://127.0.0.1:4111'), playingBoard(), 'light', {
      fetchImpl: relayFetch(EDGE_ORIGIN, []),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('proxy-blocked')
      expect(result.error).toContain('https')
    }
  })

  it('still relays an allowlisted host, keeping the provider status verbatim', async () => {
    const result = await getAiMove(
      engine('https://api.openai.com/v1'),
      playingBoard(),
      'light',
      { fetchImpl: relayFetch(EDGE_ORIGIN, []) },
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      // A bogus key is the whole point here: the answer came from OpenAI, not from the relay.
      expect(result.code).toBe('unauthorized')
    }
  })
})
