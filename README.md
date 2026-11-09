# ai-backgammon

[![Play Live](https://img.shields.io/badge/Play_Live-backgammon.kamenonline.com-0284c7?style=flat&logo=cloudflare&logoColor=white)](https://backgammon.kamenonline.com/)
[![CI](https://github.com/kolevkamena1/ai-backgammon/actions/workflows/ci.yml/badge.svg)](https://github.com/kolevkamena1/ai-backgammon/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)

AI-powered (BYOK) Backgammon — **[Play live at backgammon.kamenonline.com](https://backgammon.kamenonline.com/)**

[![AI Backgammon gameplay](./public/og-preview.png)](https://backgammon.kamenonline.com/)

**Current status: Phase 4 & core Phase 5 shipped — rules, turn flow, BYOK inference, the CORS relay,
configurable strength, move explanations, streamed reasoning, spectator controls, drag-and-drop,
checker animations, and a 4-way dockable workspace.**
Rolling, legal moves, hitting, bar re-entry and bearing off are real and covered by tests, and a
human can play a full game by clicking or dragging checkers across the board. AI seats play
themselves: every move is requested with your own key, relayed through the same-origin
`/api/ai-proxy` endpoint, chosen from the legal move menu, and re-validated by the rules engine
before it touches the board. In `npm run dev` you can still roll and move for any seat by hand.

Each AI seat also plays at a chosen **difficulty** (Easy, Medium, Hard), says **why** it made the move
it made, and writes that sentence on screen **while the provider is still streaming it**.

## Tech stack

| Concern     | Choice |
| ----------- | -------------------------------------------------------- |
| Build/dev   | Vite 8 (Rolldown) + React 19 + TypeScript 5.9 (strict) |
| Styling     | Tailwind CSS 4 via `@tailwindcss/vite` (no `tailwind.config.js`) |
| Client state| Zustand 5 + `persist` middleware |
| Icons       | lucide-react |
| Inference   | Native `fetch` per provider — OpenAI, Anthropic, Google, any OpenAI-compatible endpoint (DashScope included). No SDK. |
| Relay       | One runtime-agnostic core, `shared/aiProxy.ts`, mounted twice: a Vite dev middleware and a Cloudflare Pages Function. |
| Testing     | Vitest 5 — `environment: 'node'` for the pure rules engine, the seat planning and the proxy core, jsdom for the component tests |
| Hosting     | Cloudflare Pages — static assets plus Pages Functions under `functions/api/` ([backgammon.kamenonline.com](https://backgammon.kamenonline.com/)) |

Node 22 is required (`.nvmrc`, `package.json` `engines`): `nvm use`.

## Commands

```bash
npm install          # install dependencies
npm run dev          # dev server on http://localhost:5173
npm run typecheck    # tsc -b (no emit) — 0 errors required
npm run lint         # eslint .
npm run test         # vitest run (346 passed + 6 skipped: rules, seats, click-to-move, AI client,
                     # AI turn driver, proxy core, SSE stream parsing — the 6 skipped are the opt-in
                     # relay e2e suite, which runs live when its origins are set)
npm run test:watch   # vitest in watch mode
npm run build        # typecheck + production bundle into dist/
npm run preview      # serve the built dist/ locally — carries no relay, see "CORS relay" below
npm run mock:provider# stand-in OpenAI-compatible provider on 127.0.0.1:4111 for the relay e2e suite
                     # (streams SSE too; MOCK_STREAM_DELAY_MS paces it, ?stall=N hangs it)
npm run pages:local  # build + serve through wrangler pages dev (Cloudflare-like, mounts functions/)
npm run pages:deploy # build + publish to Cloudflare Pages (needs `npx wrangler login`)
```

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request into it:
`npm ci` → `npm run typecheck` → `npm run lint` → `npm run test` →
`npm audit --audit-level=high`. The Node version is read from `.nvmrc` rather than repeated in the
workflow, so CI and a local checkout cannot drift into two different runtimes. `tsc -b` covers
`functions/**` and `shared/**` as well as `src/` (see `tsconfig.node.json`), so the relay and the
stats route are typechecked here too, not only the browser bundle.

Three of those choices are about untrusted code rather than convenience:

- **`pull_request`, never `pull_request_target`, plus `permissions: contents: read`.** The workflow
  executes the contributor's checkout with no write token and no secrets, so a compromised step has
  nothing to exfiltrate and cannot push anything back.
- **Actions are pinned to commit SHAs**, and `.github/dependabot.yml` includes a `github-actions`
  ecosystem so those pins still move — a pin nobody updates just becomes the reason it gets removed.
- **`npm ci`, not `npm install`.** It refuses a tree that does not match the committed
  `package-lock.json` and never rewrites it, so a dependency that appeared since the commit cannot
  slip into a green run.

`audit` gates on high and critical only: turning CI red over a low-severity advisory in a dev-only
dependency trains people to merge through red, which costs more than the advisory does.

Dependabot checks npm and GitHub Actions weekly (Sunday 04:00 UTC), collapsing every patch and minor
bump into one grouped PR per ecosystem and capping open PRs (5 for npm, 3 for actions) so the queue
stays readable instead of being switched off.

Deploying stays manual (`npm run pages:deploy`): a green run means the code was verified, not that
anything was published.

**One flaky test was fixed here, and its shape is worth knowing.**
`src/state/__tests__/gameStore.replay.test.ts` derived its move from whatever `roll()` returned, and
`roll()` used `Math.random()` — a first die of 5 points at position 19, which holds five dark checkers
at the opening, so `makeMove` refused and the rewind assertions failed roughly one run in six. The
config now pins `dice: { mode: 'seeded', seed: 42 }`, which opens [4, 3] and is deterministic; measured
before the change, 6 of 24 runs failed, after it, 0 of 24.

## Game modes

| Mode | Seats | Credentials used |
| --- | --- | --- |
| **Human vs AI** | White = you, Black = AI | personal BYOK |
| **AI vs AI · Mirror** | both seats = one engine | personal BYOK only — **no second key is stored** |
| **AI vs AI · Custom** | White = personal AI, Black = opponent AI | personal BYOK **+** opponent BYOK |

Seats are `light`/`dark` throughout the domain (`src/types/game.ts`); "White"/"Black" are display
labels only, so the board and the setup can never disagree about colours.

Configuration lives in `src/state/gameConfigStore.ts`, and the mapping from configuration to
seats is the pure function `planSeats()` in `src/utils/gameConfig.ts`. The setup modal's roster
preview and the future engine loop both call that same function, so what you see is literally
what will run.

*New game* now **starts** the match: the CTA reads "Start game", which saves the setup and then
snapshots `planSeats()` into the game store — so editing settings mid-game cannot swap a player
out from under the board. Every mode starts now, AI vs AI included: when the seat to act is an
AI, `useAiTurn` drives the whole turn — roll, then one request per die — until the turn is handed
over. The CTA stays disabled while any AI seat is missing a key (or a Base
URL for a custom endpoint), and each seat card lists exactly what is missing.

## Playing the game

`src/utils/gameLogic.ts` is the whole rules engine: pure functions, no React, no DOM, no store
imports, with the random source injected so dice can be made deterministic in tests.
`src/state/gameStore.ts` only sequences those functions, and `src/hooks/useGame.ts` derives the
legal moves and the click handling that the components consume.

Conventions worth knowing before editing either file:

* `BoardState.points` holds **signed** counts — positive is light (White), negative is dark
  (Black). `ownerOf()` and `toPointViews()` translate that back into the `Point` view model.
* Light runs 24 → 1 and bears off past point 1; dark runs 1 → 24 and bears off past point 24.
  `DIRECTION`, `BAR_OUTSIDE` and `HOME_BOARD` are the only places those facts are written down.
* A `Move` carries the `die` it pays with, because bearing off may spend a larger die than the
  distance and doubles leave several equal dice to choose from.
* `applyMove` returns a new board, never mutates its input, spends exactly one die, and hands the
  turn over when the last die is played.

### Known rules gaps

Generation is **move-at-a-time**: after each `applyMove` the options are re-derived from the new
position, which is what click-to-move needs, while `getLegalMoves()` searches the full turn so
both sequence-level rules (playing the maximum number of dice and preferring the larger die when
only one fits) are enforced. The opening single-die roll, undo, the doubling cube and match scoring
are still absent.

## AI inference

Four files, none of which knows about React:

| File | Role |
| --- | --- |
| `src/utils/aiPrompt.ts` | Every word the model sees. Pure string building. |
| `src/utils/aiClient.ts` | `getAiMove()` routes to one handler per provider, then POSTs the call to the relay. |
| `src/utils/aiStream.ts` | Reads a streamed reply: SSE framing, deltas, byte cap. Pure text plumbing. |
| `src/state/gameStore.ts` | `runAiTurn()` sequences roll, request, validate, apply. |

### The menu is the whole trick

The prompt carries the position **and the numbered list of legal moves from `getLegalMoves()`**, so
the model only has to pick an entry it cannot get wrong. The reply is parsed leniently (markdown
fences, prose around the JSON, stringified numbers, or `{"choice": n}` instead of coordinates), but
the parser returns a move **only if it appears in that menu**. Whatever a model hallucinates, it
cannot reach `applyMove`.

### Playing strength

`AiEngineConfig.difficulty` is `'easy' | 'medium' | 'hard'`, chosen per seat in the Settings modal and
in the Custom-opponent block of the setup modal (both render `ByokFields`). It is carried on the engine
config rather than a UI setting so that it snapshots with the seat: editing Settings mid-game must not
retune a match that is already running, and a Custom match may put two different levels on the board.

| Level | System-prompt instruction (`DIFFICULTY_INSTRUCTIONS`) | Reply budget | Temperature |
| --- | --- | --- | --- |
| Easy | play casually, standard moves, no deep strategy | 2048 | 0.8 |
| Medium | play strategically: make points, hit blots | 2048 | 0 |
| Hard | attack and defend, read the opponent 2 moves ahead, build primes, block the escape, take calculated risks | 4096 | 0 |

Thinking (`enable_thinking`) stays **off at every level**. Enabling it on Qwen3 was measured spending
tens of seconds on `reasoning_content` before a move appeared, which is the hang Phase 3.1 removed;
Hard therefore gets its extra strength from the prompt and a larger reply budget, not from a longer
wall-clock. Medium and Hard keep `temperature: 0` because a deterministic engine is what the app has
always been; Easy is the one level that samples, because a capable model told to "play casually" at
temperature 0 still plays near-optimally and the words would change nothing.

A stored config from before this field has no `difficulty` key at all. `difficultyOf()` supplies
`medium` and it is read through that one function everywhere, so no branch has to restate the default
— and the settings store's persist `version` stays at 1, because an optional field is a compatible
change (see *BYOK configuration and security*).

### Move explanations

Alongside the move, the model is asked for one sentence saying why it chose it:

```json
{ "explanation": "I make my five-point to shut Black in.", "choice": 7 }
```

The field is requested **first** in the object, because the reply is streamed (see *Streaming*): a
model that writes the choice before the reason would leave the player staring at a spinner until the
last token. `explanation` is accepted from `explanation`, `reason` or `why`, is whitespace-collapsed
and cut at 300 characters (`AI_EXPLANATION_MAX_CHARS`) with an ellipsis, and is typed
`string | null`. The wording of the sentence follows the chosen level, via `EXPLANATION_HINTS`.

What makes this safe to put on screen:

* **It cannot affect the game.** `parseAiMove` returns the move only when it is on the legal menu,
  exactly as before; the explanation rides along on `AiMoveSuccess` and is read only by the UI.
* **Silence is not a failure.** A model that ignores the field, or fills it with a number, plays its
  move and simply shows no panel. No fallback text is invented on its behalf.
* **A reason is never shown for a move that did not happen.** A rejected or hallucinated choice, a
  transport failure and a reply from an abandoned game all clear the panel instead of leaving a
  justification pointing at a position that no longer exists.
* **Nobody is trusted to be right about why.** The claim itself is not validated — only the move is.
  A model that lies about its reasoning cannot change the board, and the panel is labelled as what
  the engine *says*, not as an analysis.

The sentence is held in `gameStore.aiThought` (`{ seat, text, phase }`) and rendered by
`src/components/AiThoughtPanel.tsx` inside the game-controls panel. It is transient like the board:
never persisted, cleared by a human move (its position is gone), by `resetGame`, and by the dismiss
button. It names the **seat** that spoke, because in an AI vs AI match the two sides can justify
contradictory plans.

### Streaming

While the engine is composing its reply the player watches it write. The client asks the provider for
SSE, the relay pipes the bytes through, and the sentence paints as it lands.

```
provider  --SSE-->  relay (Pages Function / Vite middleware)  --SSE-->  readProviderStream()  -->  gameStore.aiThought  -->  AiThoughtPanel
```

* **Asking**: `stream: true` plus `stream_options: { include_usage: true }` go in the *provider* body,
  and `stream: true` also goes in the envelope so the relay knows to pipe instead of buffer. Only
  `openai` and `custom` are offered this (`supportsStreaming`): Anthropic and Google frame streams
  differently (`content_block_delta`, `alt=sse`) and stay buffered on purpose, which is a scope limit,
  not an oversight. A caller that passes no `onDelta` gets the old byte-for-byte request.
* **Deciding**: the response is treated as a stream when the *content type* says so, never when a body
  happens to exist — every `fetch` response has a body. A gateway that ignores the `stream` flag and
  answers with ordinary JSON is therefore still parsed correctly.
* **Parsing**: `src/utils/aiStream.ts` is the whole SSE layer, and it is pure. It rejoins frames split
  anywhere (mid-token, mid-escape, mid multi-byte character), honours the blank-line event boundary,
  ignores comments and unused fields, tolerates a cumulative gateway instead of an incremental one,
  and separates `delta.reasoning_content` from `delta.content` — the second is what the panel shows,
  the first is discarded.
* **Never on a partial reply**: the assembled text goes through the same `parseAiMove` and the same
  legal-menu validation as a buffered answer. A truncated stream fails the turn with `bad-response` or
  `network`; it cannot move a checker, and it is never silently retried once bytes have arrived.
* **Caps**: the relay counts bytes as they pass (`maxStreamBytes`, 4 MB) and stops the stream at the
  cap — it cannot send a 413 by then, because the status line and headers are already on the wire. The
  client mirrors the cap so it stops first and fails the turn itself.
* **Pacing**: deltas carry the *cumulative* sentence, and the store repaints at most every 80 ms. A
  dropped frame costs a stutter, never a word, and the final explanation overwrites everything anyway.

Two things this took a live measurement to find out, both now asserted in tests:

* **`wrangler pages dev` does stream.** Probed against the mock provider paced at 250 ms per frame:
  first byte at ~40 ms, whole body at ~2.4 s, `Transfer-Encoding: chunked`, upstream
  `content-type: text/event-stream` relayed, `cache-control: no-store` still set. A buffering Function
  would have reported the first byte at the end. That is the go/no-go gate this feature was built
  behind, and the same timing is asserted in the opt-in e2e suite rather than left as a claim.
* **The runtime brand-checks streams.** Handing `new Response(...)` a duck-typed `{ getReader() }`
  object — which is what the runtime-agnostic core hands back — silently produced the body
  `"[object Object]"` at the edge, and `Readable.fromWeb(...)` on the same object killed the dev
  server outright with `ERR_HTTP_HEADERS_SENT` when the failure reached the catch that wrote a second
  status line. Both mounts now pump bytes through a real stream object of their own runtime, and the
  dev relay's failure path checks `res.headersSent` before writing anything.

### Providers

| Provider | Endpoint | Auth | Default model |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `Authorization: Bearer` | `gpt-4o-mini` |
| Anthropic | `https://api.anthropic.com/v1/messages` | `x-api-key` + `anthropic-version` + `anthropic-dangerous-direct-browser-access` | `claude-3-5-haiku-latest` |
| Google | `.../v1beta/models/<model>:generateContent` | `x-goog-api-key` | `gemini-2.0-flash` |
| Custom | `<baseUrl>/chat/completions` (`/v1` appended when absent) | `Authorization: Bearer` | none — you must set one |

Requests use `temperature: 0` except at Easy (0.8, so it genuinely misfires) and a 2048-token output
cap (`AI_MAX_TOKENS`; Hard gets 4096) — deliberately generous,
because a reasoning model bills its `reasoning_content` against that same budget and 220 tokens could
be consumed entirely by thinking before any move was emitted. `response_format: json_object` goes to
OpenAI and Google but **not** to custom gateways, which often reject the field, and
`enable_thinking: false` goes only to DashScope hosts, for the same reason. The Anthropic
browser-access header is required, or the call is refused outright from a page. The relay forwards
every header in that table, so a provider's own contract does not change because the call is relayed
rather than made from the page.

### Failure handling

`getAiMove` never throws. Every path resolves to an `AiResult`: success with a legal `Move`, or
failure with a human message plus an `AiErrorCode` — `unauthorized`, `rate-limited`, `not-found`,
`server-error`, `network`, `timeout`, `aborted`, `bad-response`, `illegal-move`, `missing-key`,
`missing-endpoint`, `missing-model`, `unsupported-provider`, `proxy-blocked`.

* **Timeout**: 60 s by default (`AI_TIMEOUT_MS`), through an internal `AbortController` that also
  relays a caller signal. That budget covers the retry as well, because the timer starts before
  `withTransientRetry`. The relay waits slightly longer — 65 s, `RELAY_TIMEOUT_MS`, in dev and at the
  edge — so a turn that runs out of time is reported by the client as `timeout` rather than as a
  `gateway-timeout` from the proxy; the relay reports its own cap as `gateway-timeout`, which the
  client maps back to `timeout` anyway.
  A **streamed** reply is measured by three clocks instead of one, because "slow" and "stalled" are
  different problems: 60 s still applies to the first byte, then `AI_STREAM_IDLE_MS` (15 s, restarted
  by every chunk) decides whether the model has stopped talking, and `AI_STREAM_TOTAL_MS` (75 s) is the
  absolute ceiling. The relay gives a stream the same generous shape — `streamTimeoutMs` (90 s) rather
  than 65 s, because one abort signal covers the whole subrequest including the body — and still
  outlasts the client, so the layering rule above keeps holding.
* **Retry**: exactly one, and only for transient codes (429, 5xx, network, timeout), honouring
  `Retry-After`. Auth and protocol errors are never retried, and **neither is a stream that already
  started**: once a byte has arrived the turn is not replayed, because those tokens were paid for and
  the player watched them land.
* **Stop, do not guess**: a failed request ends the turn and shows a banner with Retry / Dismiss
  (plus Open Settings for credential-shaped codes). Nothing falls back to a random legal move,
  because a silent fallback hides a broken key.
* **Pacing**: `aiMoveDelayMs` (400 ms) between moves, so a human can follow an AI turn.
* **Stale replies**: a turn counter plus an abort make a reply that lands after `resetGame` or a new
  game a no-op, instead of moving pieces on a different board.
* **Single flight**: two triggers cannot spend one turn, which is what makes a StrictMode
  double-mount harmless.
* **Cost**: a turn is at most 4 requests and a game a few hundred, all billed to your own key.

## CORS relay (`/api/ai-proxy`)

DashScope answers a chat completion perfectly and sends **no CORS headers at all**, so a browser
call to it dies in the preflight — before the key is ever sent. The relay removes that whole class of
failure: the client posts its provider call to a same-origin path and something outside the browser
makes the call. Same-origin takes CORS out of the conversation entirely, which is why **no
`Access-Control-Allow-Origin` header is emitted anywhere**. A wildcard would hand every website the
visitor happens to open a relay for that visitor's own keys, and that is not a trade-off worth the
convenience.

### One core, two mounts

```
browser                                    relay (same origin)              provider

aiClient.postJson   --POST /api/ai-proxy-->  handleProxyRequest  --fetch-->  api.openai.com
  { targetUrl, headers, body }              shared/aiProxy.ts               DashScope, ...
                                            <-- status + body, unchanged ---
```

| Mount | Where | Answers on |
| --- | --- | --- |
| `aiProxyDevMiddleware()` | `vite.config.ts`, `apply: 'serve'` | `npm run dev` (port 5173) |
| `onRequest` | `functions/api/ai-proxy/[[path]].ts` | `npm run pages:local` (8788) and any deployed Pages site |

`shared/aiProxy.ts` knows nothing about either runtime: no `node:*` import, no Workers types, no
SDKs. A caller hands in a structural `{ method, url, headers.get(), text() }` and adapts the returned
`ProxyOutcome` to its own response type. That single decision is what lets one file serve both
places, what lets `tsconfig.node.json` typecheck `shared/` and `functions/` with no Workers-specific
config (`@cloudflare/workers-types` is deliberately not a dependency), and what makes the core
unit-testable without a network: `handleProxyRequest` takes `fetch` as its third argument, so
`shared/__tests__/aiProxy.test.ts` covers the policy, the cross-origin guard, the relay paths and the
streaming paths in 48 tests.

The envelope is `{ targetUrl, headers, body, stream? }` (`ProxyEnvelope`) — **the credential travels
inside this object**. The relay never reads the incoming request's own `Authorization` header, so a key
put on the call to `/api/ai-proxy` is not forwarded, by design. `stream` is strictly a boolean, is
validated before the target is classified, and changes only how the answer travels: it cannot move a
byte past the allowlist (a test pins that down for both policies).

Only seven request headers are ever forwarded and everything else is dropped: `authorization`,
`content-type`, `accept`, `x-api-key`, `x-goog-api-key`, `anthropic-version`,
`anthropic-dangerous-direct-browser-access`. Names are matched case-insensitively, because that is
how header fields work, and are always sent upstream in that canonical lower-case form; one header
written two ways resolves last-one-wins. `accept` is there so a caller can ask for
`text/event-stream` — several OpenAI-compatible gateways only switch to SSE when the request says so,
and it is an end-to-end content-negotiation header that carries no credential and cannot influence
which host is contacted. Only `content-type`, `retry-after` and `x-request-id` come
back, so a provider's `Retry-After` survives the hop and the client's 429 handling still works; a
provider's status and body otherwise pass through untouched, which is what keeps `mapHttpError`
reading real provider answers.

### Dev and production are the same code under different policies

| | `DEV_POLICY` — Vite middleware | `PRODUCTION_POLICY` — Pages Function |
| --- | --- | --- |
| Plain `http` targets | allowed | refused, https only |
| Loopback / private targets | allowed | refused |
| Host allowlist | not enforced | enforced, exact match |
| Cross-origin browser request | refused | refused |
| Upstream timeout | 65 s buffered, 90 s streamed | 65 s buffered, 90 s streamed (both above the client's 60 s) |
| Envelope / response cap | 64 KB / 1 MB, 4 MB streamed | 64 KB / 1 MB, 4 MB streamed |

Dev is your own machine, already reachable from your own browser, so the host list is not a security
boundary there, and the generous timeout stops a slow local model load from turning into a proxy
failure stacked on top of a client failure. The Pages Function always uses `PRODUCTION_POLICY`.

The **cross-origin row is identical on purpose, and it is the exception to the paragraph above.** It
lives in the shared core behind `policy.rejectCrossOrigin` — set on in both policies — because the host
list being deliberately open in dev is exactly what makes the origin guard matter there: any page the
developer has open can address `localhost:5173`, so without the guard a hostile site could blind-POST
through a relay that reaches private space. A guard copied into one mount and not the other is how the
two mounts stopped answering identically in the first place. The dev middleware also refuses an
oversized body *mid-upload* rather than after buffering it, since a cap the process can only measure
once the whole body is in memory is not a memory limit at all.

Two consequences worth knowing: `npm run preview` **serves no relay at all** — the middleware is
`apply: 'serve'`, so a previewed `dist/` has no `/api/ai-proxy` and every AI seat fails with
`network`; and a LAN gateway such as `http://192.168.0.12:11434` works in dev and is refused at the
edge, where that address is either private or not on the allowlist.

### Allowlist

`DEFAULT_ALLOWED_HOSTS` in `shared/aiProxy.ts` is `api.openai.com`, `api.anthropic.com`,
`generativelanguage.googleapis.com`, `dashscope.aliyuncs.com`, `dashscope-intl.aliyuncs.com` and the
workspace host `token-plan.ap-southeast-1.maas.aliyuncs.com`.
`AI_PROXY_ALLOWED_HOSTS` is **merged over** those defaults by `parseAllowedHosts` — comma or space
separated, lower-cased, de-duplicated — never instead of them, so adding your own gateway cannot
silently un-list OpenAI. Hosts are matched exactly, because a suffix match would accept
`api.openai.com.attacker.test`. Private and loopback targets stay blocked whatever is listed. The dev
middleware ignores the variable and always uses `DEV_POLICY`.

Set it in the Pages dashboard under *Settings → Environment variables* (production and preview are
separate), or locally in `.env` for `npm run pages:local`. Wrangler also reads `.dev.vars`; pick one,
because when a `.dev.vars` file exists wrangler ignores `.env` files entirely. Neither file needs a
secret — this variable only names hosts, which is why `.env.example` documents it in plain sight.

### What the relay refuses, and why

The endpoint is public. Without the rules below it would be an open SSRF relay that anyone could
drive through this project's Cloudflare account, so `classifyTarget()` and `handleProxyRequest()`
refuse:

* a browser request from anywhere but this site: `Sec-Fetch-Site: cross-site`, the opaque
  `Origin: null` a sandboxed document produces, or an `Origin` whose host — **port included**, so a
  preview build on `:4173` cannot pose as the dev server on `:5173`. This is checked first, before the
  verb and before the target is classified, and it lives in the core so both mounts inherit it. A
  non-browser client sends neither header and is let through to the allowlist, which is what actually
  constrains where a request may go;
* a `targetUrl` that is not an absolute URL, has no host, or carries `user:password@` credentials;
* plain `http` at the edge;
* IP literals (`127.0.0.1`, `[::1]`, anything containing `:`) and every range `isPrivateHost()`
  knows: `localhost` and `*.localhost`, `::`, `127.`, `10.`, `192.168.`, `169.254.` — the cloud
  metadata address — `0.`, `172.16.0.0/12`, `fc00::/7` and `fe80::/10`;
* any host not exactly on the allowlist;
* **redirects, never followed**: the upstream call is made with `redirect: 'manual'` and a 3xx answer
  is refused outright, because following one would let an allowlisted host hop to an internal one;
* an envelope over 64 KB, a provider answer over 1 MB, a non-`POST`, and any `content-type` that is
  not JSON.

Every refusal carries `x-ai-proxy-error`, and that header is stripped from pass-through responses, so
its presence means *the relay* said no rather than the provider. Nothing in `shared/` logs a reason:
the module is bundled for the edge, where `src/lib/logger.ts` does not exist, and a message string
could be echoed back to a caller. `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` ride
on every outcome, set inside `shared/aiProxy.ts` — they cannot live in `public/_headers`, because
Cloudflare documents that `_headers` rules are not applied to responses generated by Pages Functions.
Without `nosniff`, an allowlisted host that ever answered `text/html` would be rendered as *this*
origin, which is the origin holding the visitor's key in `localStorage`.

All of the above is decided **per request**. What no per-request check can express is volume: a rate is
a property of many requests, and each Function invocation is stateless. The Cloudflare dashboard rules
that cap `/api/ai-proxy` and the telemetry sink per client IP — with the reasoning behind every
threshold — are in [`WAF_RATE_LIMITS.md`](./WAF_RATE_LIMITS.md).

| `x-ai-proxy-error` | HTTP | Becomes `AiErrorCode` | Retried |
| --- | --- | --- | --- |
| `bad-request` | 400 | `proxy-blocked` | never |
| `method-not-allowed` | 405 | `proxy-blocked` | never |
| `target-not-allowed` | 403 | `proxy-blocked` | never |
| `request-too-large` / `response-too-large` | 413 | `proxy-blocked` | never |
| `bad-gateway` | 502 | `network` | once |
| `gateway-timeout` | 504 | `timeout` | once |

`proxy-blocked` is deliberately not transient — retrying a refusal cannot help, only Settings can —
so the banner shows **Open Settings** beside Retry instead of burning a second request. A rejection
with no `x-ai-proxy-error` at all means the relay itself was unreachable: that is `network`, and it
is the one code that can no longer mean "the provider refused CORS".

### Alibaba Cloud DashScope, step by step

DashScope publishes an OpenAI-compatible path, so it is just a `custom` provider: no dependency, no
code change, and **no environment variable to set** because both of its hosts are already in
`DEFAULT_ALLOWED_HOSTS`.

1. Create a key in Alibaba Cloud **Model Studio** (Bailian) → *API Key*. It looks like `sk-…`.
2. In the app, open *Settings* and set Provider to **Custom**, then:
   * **Base URL** — `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` for the International
     (Singapore) region, or `https://dashscope.aliyuncs.com/compatible-mode/v1` for mainland China.
     Use the region that issued the key: a key created in one console is refused by the other.
   * **Model** — `qwen-plus`, `qwen-turbo`, `qwen-max` or any model enabled for your account. This is
     required: `custom` has no default, and an empty model fails with `missing-model` rather than a
     guess.
   * **API key** — the one from step 1.
3. Start a game. Each request goes to `/api/ai-proxy`, and the relay posts
   `Authorization: Bearer sk-…` to `https://dashscope-…/compatible-mode/v1/chat/completions`.

**Qwen3 thinks until you tell it not to.** A Qwen3 model in mixed-thinking mode reasons first, and
DashScope bills those tokens against `max_tokens`, so a small cap can be spent before a move exists
and a synchronous call that keeps reasoning is indistinguishable from a hang. `chatBody` therefore
sends `enable_thinking: false` — a documented DashScope body field, **not** an OpenAI one, which an
OpenAI SDK has to pass through `extra_body` — whenever the Base URL host is `aliyuncs.com` or a real
sub-domain of it, and never otherwise: OpenAI, Ollama, vLLM and LM Studio reject unknown fields, which
is the same reason `response_format` is withheld from custom gateways. Thinking-only models such as
`qwq-*` cannot disable reasoning, so choose a mixed-mode model like `qwen-plus` for this app. Either
way the move arrives in `content`, because `extractChatText` never reads `reasoning_content`.

Newer accounts are directed at workspace hosts of the form
`https://<workspaceId>.<region>.maas.aliyuncs.com/compatible-mode/v1`. The client sends the flag to
those, and `token-plan.ap-southeast-1.maas.aliyuncs.com` is allowlisted by default — but any *other*
workspace host is refused by the **relay** until you add that exact host to
`AI_PROXY_ALLOWED_HOSTS`, because the allowlist matches host names exactly and has no wildcard.

`normalizeBaseUrl` makes step 2 forgiving: a trailing slash is stripped, `…/compatible-mode` gets
`/v1` appended, and a pasted `…/v1/chat/completions` is reduced to its root and re-suffixed — all
three land on the same `…/compatible-mode/v1/chat/completions`. `response_format: json_object` is
**not** sent for a custom provider, because Qwen deployments reject that field inconsistently; the
lenient parser (`{"choice": n}` or bare coordinates, markdown fences and surrounding prose
tolerated) is what makes the reply usable, and `getLegalMoves()` still rejects anything not on the
menu.

You can prove the relay without opening the browser. With `npm run dev` and `npm run mock:provider`
running:

```bash
curl -sS -i -X POST http://localhost:5173/api/ai-proxy \
  -H 'content-type: application/json' \
  -d '{"targetUrl":"http://127.0.0.1:4111/v1/chat/completions","headers":{"authorization":"Bearer sk-e2e-not-a-real-key","x-forwarded-for":"1.2.3.4"},"body":"{\"model\":\"probe\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"}'
```

That returns the mock's completion, and `/v1/echo` instead of `/v1/chat/completions` shows exactly
which headers crossed the relay — `authorization` present but `x-forwarded-for` gone. Swap in your
DashScope URL and key to exercise the real provider the same way. Then read the codes as a diagnosis
rather than noise: `proxy-blocked` is the policy refusing the target (edit the Base URL), `network`
is the relay or the provider being unreachable (check the endpoint and the region), and
`unauthorized` came from the provider itself — which means the relay worked. Worth reading closely:
an `unauthorized` whose provider message says *you didn't provide an API key* means no credential
arrived at all, so check the envelope's `headers` object rather than the key you pasted.

## Layout

```
shared/
└── aiProxy.ts        the relay core: policy, allowlist, SSRF rules, handleProxyRequest (+ __tests__/)
functions/api/ai-proxy/
└── [[path]].ts       Pages Function — reads AI_PROXY_ALLOWED_HOSTS, mounts the core at the edge
src/
├── components/
│   ├── ui/             Modal.tsx (dialog chrome), controls.ts (shared class tokens)
│   ├── ByokFields.tsx  provider / difficulty / key / model / conditional Base URL — reused twice
│   ├── Board.tsx  Point.tsx  Checker.tsx  Die.tsx
│   ├── GameControls.tsx   turn status, dice in hand, roll/pass and winner notices
│   ├── AiThoughtPanel.tsx what the engine said about the move it made
│   ├── SettingsModal.tsx    personal BYOK
│   └── GameSetupModal.tsx   mode + match type + opponent BYOK + roster preview
├── hooks/          useAiTurn, useGame, useSettings, useGameConfig, useByokDraft, useEscapeKey
├── lib/logger.ts   console wrapper that redacts credential-shaped fields
├── state/          createSafeStorage.ts, settingsStore.ts, gameConfigStore.ts, gameStore.ts (+ __tests__/)
├── types/          game.ts, settings.ts (AiEngineConfig), gameConfig.ts, ai.ts (AiErrorCode)
└── utils/          gameConfig.ts, gameLogic.ts, aiClient.ts, aiPrompt.ts, aiStream.ts, cn.ts,
                  formatSecret.ts (+ __tests__/, incl. the opt-in aiProxy.e2e.test.ts)
public/             _headers (static assets only), _redirects, favicon.svg — copied into dist/
scripts/            mockprovider.mjs — dev-only stand-in provider (buffered and SSE), never imported, bundled or deployed
vite.config.ts      mounts the same relay core on /api/ai-proxy for `npm run dev`
wrangler.toml       pages_build_output_dir = "./dist", compatibility_date
.env.example        documents AI_PROXY_ALLOWED_HOSTS — a host list, not a secret
WAF_RATE_LIMITS.md  Cloudflare dashboard rules capping request volume on /api/* (edge, not code)
```

Path alias `@/…` maps to `src/…` and is declared in **both** `vite.config.ts` (`resolve.alias`)
and `tsconfig.app.json` (`compilerOptions.paths`) so Vite and `tsc -b` agree.

## BYOK configuration and security

* Two `localStorage` entries: **`ai-backgammon:settings`** (your provider, key, model, base URL and
  difficulty) and **`ai-backgammon:game-config`** (mode, match type and the opponent's
  key/model/base URL). Both are written by Zustand's `persist` middleware, and both use `partialize`
  so modal visibility and store actions never reach disk.
* The board in progress is **never** persisted: `gameStore` holds the resolved `seatPlan`, which
  contains the engines API keys, so writing it out would create a third copy of your
  credentials. Refresh the page and the game is gone; the two entries above are not.
* A **mirror match stores no second credential**: `planSeats()` hands the same engine object to
  both seats, so there is nothing to keep in sync and no extra copy of your key.
* `aiClient` sends a key only to the endpoint of the provider you selected: `baseUrl` is honoured
  **only** for `provider: 'custom'`, so an OpenAI or Anthropic key can never be posted to a host
  you did not choose (a test pins that down). The relay then checks that host again against its own
  allowlist, so a wrong Base URL has to pass two independent gates before a key travels. Prompts,
  log lines and UI errors carry no credential.
* The relay does **not** hide a key. The browser still holds it in plain text in `localStorage` and
  the relay forwards `Authorization` verbatim, so anyone with access to this device (or an XSS bug)
  can still read it. What the relay buys is CORS-free providers, one place to enforce which hosts a
  key may be sent to, and no provider request made from the page itself. Use dedicated, revocable
  keys; a server-side key store would be a different app, not a flag in this one.
* Every persisted store shares `createSafeStorage`, which swallows and logs storage failures
  (private mode, storage disabled, quota exceeded) instead of crashing — settings then stay in
  memory for the session.
* `src/lib/logger.ts` masks any context field matching
  `api[-_]?key|authorization|token|secret|password`; UI surfaces show only the last four
  characters (`maskSecret`).
* `.env*` and `.dev.vars*` are gitignored. No secret belongs in the repo and nothing here needs one:
  the only variable the app reads, `AI_PROXY_ALLOWED_HOSTS`, names hosts rather than credentials, and
  `.env.example` documents it in plain sight.
* Bump a store's persist `version` **only** for an incompatible shape change, and pair it with
  `migrate`: a version mismatch with no migrate makes Zustand discard the payload, silently
  wiping saved keys. Adding an optional field needs no bump.

## Styling notes (Tailwind CSS v4)

There is no `tailwind.config.js` or PostCSS config. Theme tokens live in `src/index.css` inside an
`@theme` block and become utilities automatically — `--color-point-dark` gives `bg-point-dark`,
`text-point-dark`, and opacity variants like `bg-board-field/70`. Board triangles are drawn with
Tailwind arbitrary `[clip-path:...]` properties in `Point.tsx`, and the selectable mode cards use
the `has-[:checked]:` variant over visually-hidden radios (`sr-only`) so they stay real form
controls.

**Checkers are rimmed against the point they stand on, not against each other.** A `#f8fafc` disc on
the `#f2dcb4` cream triangle needs a near-black edge to be readable, and a `#111827` disc on the
`#b5502a` terracotta one needs a near-white edge, so `Checker.tsx` uses `border-slate-900` and
`border-slate-50` with `shadow-md shadow-black/45` for lift. The rim is a `border-2` rather than a
`ring`, because a ring sits outside the disc and steals width from 16 px of checker. Those three
numbers are coupled by arithmetic — six visible discs at `size-4` plus `gap-0.5` must fit under the
point label inside `QUADRANT`'s height — and `src/components/__tests__/CheckerContrast.test.tsx`
pins the class contract, because jsdom applies no CSS and the mismatch only becomes visible as
checkers painted past the apex.

## Deploying to Cloudflare Pages

`wrangler.toml` is the source of truth: `pages_build_output_dir = "./dist"`. `vite.config.ts` keeps
`base: '/'` — a relative base would break asset URLs whenever the SPA fallback below serves
`index.html` for an unknown path.

**Direct upload**

```bash
npx wrangler login
npx wrangler pages project create          # production branch: main
npm run pages:deploy
```

**Git integration** — create the Pages project from this repo, then set
*Build command* `npm run build` and *Build output directory* `dist`.

**Functions** need no configuration: Pages compiles the root `functions/` directory automatically, so
both the direct upload (`npm run pages:deploy` bundles it alongside the `dist/` assets) and the Git
integration serve `POST /api/ai-proxy`. Rules in `public/_redirects` are not applied to requests a
Function serves, so the SPA fallback cannot swallow `/api/*` — verified locally, where `GET` on that
path answers the relay's own 405 rather than an `index.html`.

Set `AI_PROXY_ALLOWED_HOSTS` as a Pages environment variable if you need a host beyond the six
defaults; production and preview are configured separately. `npm run pages:local` is the way to test
all of this before deploying — it builds, then serves `dist/` through `wrangler pages dev`, mounting
`functions/` and reading `.env` on port 8788. One wrangler quirk to expect in that output: it reports
`/* /index.html 200` as an infinite loop and logs `Parsed 0 valid redirect rules`, yet still serves
the app shell for an unknown path. Pages production parses the file itself, so check the rule once on
the first preview deployment; it never affects `/api/*` either way, because Functions win.

`public/_redirects` (`/* /index.html 200`) provides the single-page fallback and
`public/_headers` sets `nosniff`, `DENY` framing, a strict referrer policy and a locked-down
permissions policy. Both are copied into `dist/` by Vite. Those rules cover **static assets only**:
Pages does not apply `_headers` to a Functions response, which is why the relay attaches
`Cache-Control: no-store` in code. A CSP is deliberately **not** enabled:
Tailwind injects inline `<style>` tags during dev/HMR, so add one with `style-src 'unsafe-inline'`
only once the production CSS pipeline is stable.

## Admin stats (`/stats`)

A private dashboard for the site owner: sessions, visitors, country/AS, referrers, devices, and per-game
mode, AI provider/level, duration, turns, undo/pause counts and **finished vs. abandoned**.

**Privacy by design.** Cookieless; the random session id lives in `sessionStorage` (gone with the tab).
The IP is stored only as `HMAC(secret, day|ip)` truncated to 64 bits — it rotates daily, so unique
visitors per day are countable but nobody can be followed across days. Country and AS come from
Cloudflare's request metadata. API keys, endpoints, prompts, AI explanations and board positions are
never sent. Browser Do Not Track settings are honoured and `npm run dev` sends nothing. Raw rows are deleted after 90 days
(rolled into `daily_stats` first). The About dialog and footer tell visitors this.

| Piece | File |
| --- | --- |
| Beacon client | `src/utils/telemetry.ts` |
| Ingest (`POST /api/collect`, fail-soft) | `functions/api/collect.ts` |
| Admin API (`GET /api/stats/{summary,sessions,games,export}`) | `functions/api/stats/[[path]].ts` |
| Validation / hashing / UA / CSV, SQL, Access JWT | `shared/analytics*.ts` |
| Dashboard | `src/stats/StatsPage.tsx` (lazy chunk, not loaded by players) |
| Schema | `migrations/0001_init.sql` |

### One-time Cloudflare setup

1. **Database** — `npx wrangler d1 create ai-backgammon-stats`, paste the `database_id` into the
   `[[d1_databases]]` block in `wrangler.toml` (uncomment it), then
   `npx wrangler d1 migrations apply ai-backgammon-stats --remote`.
2. **Secret** — Pages → Settings → Variables: add `ANALYTICS_SALT` (long random string, *encrypted*).
3. **Custom domain** — Pages → Custom domains → `backgammon.kamenonline.com`.
4. **Protect it** — Zero Trust → Access → Applications → *Self-hosted*. Add **two** paths on
   `backgammon.kamenonline.com`: `/stats*` and `/api/stats*`. Policy: *Allow* → Emails → your address
   only. Copy the application's **Audience (AUD) tag** and your team domain.
5. **Pin the app to the policy** — Pages variables: `ACCESS_TEAM_DOMAIN` (`yourteam.cloudflareaccess.com`)
   and `ACCESS_AUD`. The API verifies the Access JWT itself (signature, issuer, audience, expiry), so
   if the Access policy is ever deleted or mistyped the API **fails closed** (403) rather than leaking.
   The 403 body says only `insufficient_permissions`: the detailed reason (which unset variable, which
   AUD prefix) is a configuration oracle for whoever the policy was meant to keep out, so it goes to
   the edge log instead. The fetched key set is cached for an hour, and a token naming a `kid` the
   cache does not have — Access rotating its signing keys — triggers one forced refetch before the
   request is refused, so a rotation cannot lock the admin out for an hour while the reason string
   blames their token. If the cert endpoint itself is unreachable that is our outage and not a
   permission problem, so the API answers `503 { error: 'jwks_unavailable' }` rather than throwing (an
   uncaught rejection at the edge would surface as an opaque Pages 1101) and the dashboard says to
   retry shortly instead of telling you to go attach a D1 binding.
6. **Protect the preview URL too** — the `*.pages.dev` hostname serves the same functions; add the same
   Access application for it (or disable preview deployments' public access).

Test locally with real SQL: `npm test` runs the data layer against in-memory SQLite. For an end-to-end
local run use `npm run pages:local` with `STATS_DEV_BYPASS=1` in `.env` (honoured on localhost only).

## Roadmap

1. **Phase 2 — game core: done.** `src/utils/gameLogic.ts` holds the rules (not the `dice.ts`
   first sketched), `src/state/gameStore.ts` sequences them, `src/hooks/useGame.ts` feeds the
   components, and Vitest covers the engine, the seat planning and click-to-move.
2. **Phase 3 — BYOK engine: done.** `aiClient.ts` covers OpenAI, Anthropic, Google and any
   OpenAI-compatible endpoint and is fed from the snapshotted `seatPlan`; `aiPrompt.ts` holds the
   wording; `runAiTurn` + `useAiTurn` drive a turn.
3. **Phase 3.1 — CORS relay: done.** `shared/aiProxy.ts` answers on `/api/ai-proxy` from a Vite
   middleware in dev and a Pages Function at the edge, so DashScope and any OpenAI-compatible
   gateway work through one same-origin path under an allowlisted, SSRF-hardened policy.
4. **Phase 4 — intelligence and transparency: done.** `AiEngineConfig.difficulty` picks the playing
   strength per seat (`DIFFICULTY_INSTRUCTIONS`, the Hard reply budget, Easy's temperature); the model
   now answers with an `explanation` next to the move, `gameStore.aiThought` holds it, and
   `AiThoughtPanel` shows it — written on screen as it streams, because the relay pipes SSE through
   instead of buffering it. What is left of Phase 3's list: nothing; the side-panel explanations this
   section used to promise are in.
5. **Phase 5 — polish: in progress.** Shipped: spectator controls (`Pause`/`Resume` and step-by-step
   `Undo`/`Redo` replay), checker drag-and-drop, smooth checker move animations, five handcrafted board
   designs, and a resizable 4-way dockable workspace (`SplitPane` — left, right, top, bottom). Remaining:
   accessibility pass and persistence of games.

## Author & Links

- **Live App:** [backgammon.kamenonline.com](https://backgammon.kamenonline.com/)
- **Author & Developer:** Kamen Kolev
- **Website:** [www.kamenonline.com](https://www.kamenonline.com)
- **Repository:** [https://github.com/kolevkamena1/ai-backgammon](https://github.com/kolevkamena1/ai-backgammon)

