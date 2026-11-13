# Full Code Review — ai-backgammon

**Date:** 2026-11-13 · **Commit reviewed:** `9a3ea60` (+ uncommitted `GameLog.tsx` E4 change)
**Scope:** every source file in `shared/`, `functions/`, `src/` (components, hooks, state, utils, lib, stats, types), build/config, `public/_headers`, tests, and the security docs. ~12k lines of application code, 30 test files / 412 tests.

## Verification (run during this review)

| Check | Result |
| --- | --- |
| `npm run typecheck` (`tsc -b`) | ✅ clean |
| `npm run lint` (`eslint .`) | ✅ clean |
| `npm run test` (`vitest run`) | ✅ 406 passed, 6 skipped (relay e2e suite needs `npm run mock:provider`) |

The uncommitted **E4** change (rewind cells → real buttons in `GameLog.tsx`) compiles, lints and passes the full suite. It is complete and internally consistent (`movesClickable`/`canRewind` gating, `disabled` states, aria-labels, focus-visible rings). **Recommend committing it.**

## Status of the previous review pass

Git history shows these findings already fixed and regression-tested: **E1** (hidden validation), **E2** (menubar a11y), **E3** (separator keyboard), **S3** (URL userinfo stripping), **S6** (cert-fetch timeout), **P2** (rAF resize throttle), **P3** (metadata effect deps), **D15** (dock-drag cleanup, cube button, modal focus trap), **C9** (AI double while paused), **C11** (theme contrast), **D14** (stats debounce/batch), **B** (multi-game replay invariants), **A2/B4** (SplitPane). All were re-verified in the current code and tests. **E4** is the in-progress item recovered above.

New findings below use the `R` prefix to avoid colliding with the earlier numbering.

---

## New findings

### R1 · Correctness · MEDIUM — Crawford rule re-triggers after it has been played
`src/state/gameStore.ts:489` (`startNextGameInSet`)

```ts
const isCrawford = match.enableCrawford && !match.isCrawfordGame && (lightNeed === 1 || darkNeed === 1)
```

`isCrawfordGame` only remembers the *previous* game. Official rule: the Crawford game happens **once per match**, the first time either player reaches `target − 1`; every later game is post-Crawford with doubling allowed. Here, if the player who is one point away keeps losing, Crawford re-applies every other game indefinitely.

**Verified with a live probe** (target 5, light stuck at 4): game 2 = Crawford ✅, game 3 = post-Crawford ✅, game 4 = **Crawford again** ❌ (probe asserted `false`, got `true`).

**Fix:** add a persistent `crawfordPlayed: boolean` to `MatchScoreState`, set it when a Crawford game starts, and gate on `!match.crawfordPlayed` instead of `!match.isCrawfordGame`. Keep `isCrawfordGame` for the current-game flag. Add the regression test from R8.

### R2 · UX / correctness · LOW-MEDIUM — `revealFirstInvalidField` focuses the fieldset, not the invalid control
`src/utils/formValidation.ts:17`

```ts
const invalid = form.querySelector<ValidatableControl>(':invalid')
```

Per the HTML spec, `<fieldset>` matches `:invalid` when it contains an invalid control, and it precedes its children in document order. Both forms that use this helper wrap controls in fieldsets (`GameSetupModal` seed/custom-points inputs; `SettingsModal` BYOK 2). **Verified in jsdom:** `form.querySelector(':invalid')` returns `FIELDSET`; the control-only selector returns `INPUT`.

Consequences: `invalid.focus()` is a no-op (fieldset isn't focusable) and `invalid.validationMessage` is `''`, so the user gets the generic "Please review the highlighted fields." instead of e.g. "Value must be less than or equal to 99", and focus never moves. The `<details>` auto-open still works. This is a residual gap in the E1 fix.

**Fix:** `form.querySelector('input:invalid, select:invalid, textarea:invalid')`. Add the unit test from R9.

### R3 · Correctness / docs · LOW — doubling heuristic doc promises a guard that isn't implemented
`src/utils/doublingAi.ts:24, 60, 93`

- The doc comment claims "Loser is not already at match point where doubling would grant free victory without advantage" — no such check exists; `match` is only consulted for Crawford.
- The heuristic ignores cube value and match equity entirely (e.g. it will double at 32→64 on a pure pip-race lead with no gammon potential, and will accept when dropping is correct near match point).
- The accept reason string asserts "Reasonable winning chances (>= 25%)" without computing any equity.

This is a declared heuristic, so the behaviour is acceptable for casual play — but the comment and the reason text overstate it. **Fix:** either implement a minimal match-aware guard (skip doubling when the opponent is at match point and the cube is dead, etc.) or correct the comment/reason wording to say "pip-race heuristic".

### R4 · Accessibility · LOW — redundant keyboard handler on a native button
`src/components/DoublingCube.tsx:65-70`

The interactive cube is a real `<button>` (D15) but also installs `onKeyDown` for Enter/Space with `preventDefault()`. Native buttons already activate on both keys; today the `preventDefault()` suppresses the native click so there is no double-fire, but the pattern is fragile (a future edit removing `preventDefault` would double-propose). **Fix:** delete the handler and rely on native activation; the D15 keyboard test should still pass.

### R5 · Accessibility · LOW — modal focus trap counts controls hidden in collapsed `<details>`
`src/components/ui/Modal.tsx:63`

`FOCUSABLE_SELECTOR` matches elements inside closed `<details>` (they exist in the DOM but are not rendered). If the first/last match is hidden, `.focus()` on it is a no-op and the trap can stall at that boundary. Both BYOK modals keep their inference params in a collapsed `<details>`, so this is reachable. **Fix:** filter candidates by visibility (`el.checkVisibility?.() ?? el.offsetParent !== null`) before computing first/last.

### R6 · Accessibility · INFO — menubar keeps all triggers in the tab order
`src/components/MenuBar.tsx`

E2's arrow/Home/End/Enter/Escape pattern is implemented well, but the WAI-ARIA menubar pattern also calls for roving `tabindex` (one tab stop for the whole bar). All four triggers are currently tabbable. Acceptable deviation; note for a future polish pass.

### R7 · Security · INFO — telemetry sink accepts absent/opaque origins
`shared/analytics.ts:211` (`isSameOrigin`)

`null`/missing/`'null'` Origin is accepted so `sendBeacon` always lands. A sandboxed iframe on another site could therefore inject beacons (data pollution only — no read path, no keys, bot-score and size caps still apply). The trade-off is documented in the code. Optional tightening: reject the literal `'null'` origin (the app itself is never sandboxed) while still allowing a missing header.

### R8 · Tests · MEDIUM — no coverage of the Crawford game flow
`src/state/__tests__/gameStore.matchSets.test.ts`

`enableCrawford` appears only as a config flag; `MatchScoreboard.test.tsx` checks the badge renders. Nothing exercises `startNextGameInSet`'s Crawford computation — which is exactly how R1 slipped through. **Add:** (a) Crawford triggers when either seat first reaches `target − 1`; (b) doubling is refused during it (`proposeDouble` returns false); (c) the next game is post-Crawford; (d) it never re-triggers later in the match (the R1 probe converts directly into this regression test).

### R9 · Tests · LOW — `revealFirstInvalidField` has no unit test
`src/utils/formValidation.ts`

The E1 helper is exercised only indirectly through modal submits. **Add** a jsdom test with an invalid input inside a `<fieldset>` inside a collapsed `<details>`: assert the details opens, the *input* receives focus, and the returned message is the control's own `validationMessage` (this fails today — see R2).

### R10 · Tests · LOW — weak assertion on the doubling heuristic
`src/state/__tests__/gameStore.matchSets.test.ts:184`

`expect(typeof decision.shouldDouble).toBe('boolean')` asserts nothing about behaviour. Construct a position with a clear pip lead and assert `shouldDouble === true`, and a balanced position asserting `false`.

### R11 · Architecture · INFO — types depend on the store
`src/types/gameLog.ts:2` imports `TurnPassReason` from `@/state/gameStore`. Type-only (erased at runtime), but it inverts the intended `types → utils → state` layering. **Fix:** move `TurnPassReason` into `src/types/game.ts` (or `gameLog.ts`) and re-export from the store for compatibility.

### R12 · Architecture · INFO — `gameStore.ts` is 1,282 lines
Cohesive and well-commented, but cube/match scoring (propose/respond/victory/Crawford) is a natural pure-helper extraction (`utils/matchPlay.ts`) that would make R1-style rules testable without driving the whole store. Optional refactor.

### R13 · Performance / DX · INFO — Vitest worker isolation
The test run itself reports ~18 s of the 31 s is per-file worker spawn. `test: { isolate: false }` (or `poolOptions`) would cut CI time substantially; the suites already reset store state in `beforeEach`. Optional.

### R14 · Correctness / docs · INFO — Crawford silently disabled for AI vs AI
`src/state/gameStore.ts:418` forces `enableCrawford = false` when `mode === 'aiVsAi'`, and the setup modal hides the checkbox. Reasonable scope limit, but it is documented nowhere. **Fix:** one line in the README match-play section (see R17) or a hint in the setup modal.

### R15 · Robustness · INFO — pause not enforced at the store boundary
`roll`, `passTurn` and `respondToDouble` do not check `isPaused`/`proposedBy` themselves; the UI (`useGame.canRoll`, `canDouble`) and `runAiTurn` do. Fine for the current single-driver architecture; worth a guard if more callers ever appear.

### R16 · Security · INFO — relay allowlist is hostname-only (any port)
`shared/aiProxy.ts` `classifyTarget` compares `url.hostname` against the allowlist, so `https://api.openai.com:8443/…` passes. The allowed hosts are trusted providers, so the residual is negligible; noting for completeness.

### R17 · Docs · INFO — README never mentions match play / Crawford
`grep -i crawford README.md` → no hits, yet the feature (target points, Crawford, gammon/backgammon grading, cube) is fully implemented and shipped. Add a short "Match play" section, including the R14 limitation. The privacy claims in README/About/footer **were** cross-checked against `telemetry.ts` and `functions/api/event.ts` and are accurate (DNT honoured, dev builds silent, no keys/prompts/positions, server-derived country/ASN, daily-rotating salted IP hash, 90-day retention).

---

## Area assessments

### Rules engine — `src/utils/gameLogic.ts` ✅ excellent
100% pure as required: no mutation of inputs (every mutator copies `points`/`bar`/`off`), randomness injected, no React/DOM/store imports. Verified correct: bar-entry priority; bear-off only from home with the exact die or a larger die when no checker is farther; the **maximum-dice rule** via a ≤4-ply DFS (`diceUsedStartingWith`/`mostDicePlayable`) with the "bearing off the last checker plays all dice" shortcut; the **higher-die rule** when only one of two distinct dice is playable; hit/blot handling; victory grading (single/gammon/backgammon incl. bar and winner-home checks). `applyMove` does structural checks and defers set-legality to `getLegalMoves`, which the store always consults first.

### Game store — `src/state/gameStore.ts` ✅ very good (one rule bug: R1)
Never persisted (keys would otherwise be copied to disk — explicitly documented). Single-flight AI chain with `aiToken` invalidation + `AbortController` cancels on reset/pause/rewind; stale replies are dropped. Snapshot history (`stepHistory`) drives both rewinds with correct roll replay (`recordedRolls`), pre-roll double steps, and declined-double turns that never rolled. Cube flow is correct: propose guards (turn, dice empty, ownership, ≤64, Crawford, paused, in-flight), take transfers ownership, drop awards the **current** stake to the proposer and finishes the game. Match scoring multiplies grade × cube. The C9 pending-offer parking logic is subtle but correct and regression-tested.

### AI transport — `aiClient.ts` / `aiStream.ts` / `aiModels.ts` / `aiPrompt.ts` ✅ excellent
`getAiMove` never throws; every failure is a typed `AiResult`. The model only ever picks from the pre-validated legal menu (`parseAiMove` matches `choice` or `{from,to,die}` against it), so hallucinated coordinates cannot reach the board. Credential hygiene is layered: exact-key redaction, Bearer/`sk-`/`AIza` shapes, URL userinfo, logger key-pattern masking; provider errors are truncated and redacted before UI/log. Retry policy: one retry, transient codes only, `Retry-After` honoured and capped, **never after first streamed byte** (cost protection). Streaming: correct SSE framing (split chunks, multi-line `data:`, comments, `[DONE]`, usage frames), cumulative-vs-incremental tolerance, three-clock budget (connect 60 s / idle 15 s / total 75 s) kept below the relay's ceilings, 4 MB byte cap mirrored on both sides. Request shaping per model class (OpenAI reasoning, Qwen4, Qwen3-hybrid/DashScope, standard) is catalog-driven and well-tested. Prompt v2 stakes line gives the model cube/match context.

### CORS relay — `shared/aiProxy.ts` + both mounts ✅ excellent
Runtime-agnostic core shared by Vite middleware and the Pages Function — the "answering identically" invariant is real and tested. SSRF posture: https-only (http only under DEV policy), exact-host allowlist (no suffix matching), no userinfo, no IP literals/private ranges (incl. IPv6 ULA/link-local and the full 172.16/12 range), redirects never followed, request/response/stream size caps, request/response header allowlists, `no-store` + `nosniff` forced on every outcome (including streams), `x-ai-proxy-error` stripped from pass-throughs. Cross-origin guard lives in the core (Sec-Fetch-Site → opaque origin → host comparison **with port**), ahead of the verb check, inherited by both mounts. The dev middleware additionally refuses oversized bodies mid-upload and guards every exit path against the fatal double `writeHead`. Stream pump respects backpressure and cancels upstream on client disconnect.

### Analytics & admin — `shared/analytics*.ts`, `functions/api/*`, `src/stats/` ✅ very good
Untrusted beacons fully validated (ids, enums, clamped ints, control-char stripping, error-code whitelist); server-derived facts only (country/ASN/IP hash/bot score); `game_end` duration from the server clock; finished never downgraded to abandoned; D1 writes parameterized everywhere; CSV export has formula-injection protection; retention purge is one atomic batch. Access JWT: RS256 pinned, aud/iss/exp/nbf checked, structured failure codes, `unknown_kid` refetch throttled to 1/min per isolate, cert fetch has a 5 s timeout (S6), fail-closed on missing config, dev bypass localhost-only, detailed reasons sanitized and logged edge-side only. Dashboard is a lazy chunk behind Access; fetch layer distinguishes 403/503 causes and handles the Access login redirect.

### React layer — components / hooks ✅ very good
Presentational components with state in stores/hooks as required; `useGame` subscribes field-by-field and deliberately excludes `aiThought` (streaming repaints only `AiThoughtPanel`/`GameLog` via `useAiThought` + `useShallow`); `memo(Board)`/`memo(Point)` preserved with stable callbacks; board resize rAF-throttled with persistence only on pointerup/cancel (P2); dock-drag and split-pane drag clean up window listeners on unmount (D15); modal focus trap/restore (one edge: R5); E4 buttons complete. `createSafeStorage` makes persistence failure non-fatal; both persisted stores sanitize/merge stored payloads defensively (version-bump warning documented).

### Styling — `index.css` ✅ good
Tailwind v4 tokens; light theme remaps the slate ramp while board pieces keep physical contrast via a scoped override; five board designs are pure CSS. Checker rim contrast is deliberate and regression-tested (`CheckerContrast.test.tsx`).

### Tests ✅ strong, two gaps (R8, R9)
412 tests across rules (incl. property-style multi-game replay with re-doubles and declined doubles), transport (routing, redaction, retries, streaming edge cases), relay (guards, allowlist, streaming caps, origin ordering), analytics (validation, hashing, JWT, D1 semantics, retention), stores (AI chain, isolation, rewinds, match sets), components (a11y regressions D15/E1-E3, resize P2, contrast C11), plus Playwright specs and a mock-provider e2e suite. Coverage gaps are precisely where the two verified bugs live.

---

## Recommended next steps (in order)

1. **Commit the E4 change** (verified green).
2. **Fix R1** (Crawford once per match) + **R8** regression tests — the only rule-level defect.
3. **Fix R2** (control-only `:invalid` selector) + **R9** unit test — restores the full E1 behaviour.
4. Sweep the low items: R3 wording/guard, R4 handler removal, R5 visibility filter, R10 assertion.
5. Docs: R14/R17 match-play section; optionally R11 type move, R13 vitest speedup.

*Everything else reviewed is in good shape — no key-leak path, no SSRF hole, no purity violation, and no crash-level defect was found.*

---

## Resolution (2026-11-13, same day)

Implemented and verified after this review (typecheck + lint + full suite green):

| Finding | Resolution |
| --- | --- |
| E4 | Verified complete; committed as-is. |
| R1 + R8 | `crawfordPlayed` added to `MatchScoreState`; Crawford now triggers once per match. New `gameStore.crawford.test.ts` covers the trigger (both seats), doubling refusal during Crawford, post-Crawford re-enable, no re-trigger, the disabled rule, and new-match reset. |
| R2 + R9 | Selector narrowed to `input/select/textarea:invalid`; new `formValidation.test.ts` (jsdom) proves the control — not the fieldset — is focused and its own message returned. |
| R3 + R10 | Doubling docs/reason now describe the pip-race heuristic honestly; matchSets tests assert real decisions (lead → double, balanced → pass, lost bear-off → drop). |
| R4 | **Deviation:** handler kept, not removed — jsdom does not synthesize native clicks from keydown, so the D15 keyboard regression depends on it. The `preventDefault()` single-fire contract is now documented at the call site. |
| R5 | Modal focus trap filters candidates through `isRenderedFocusable` (closed-`<details>` aware, jsdom-safe); new D15 regression test. |
| R11 | `TurnPassReason` moved to `types/gameLog.ts`; the store re-exports it; `GameControls` imports from types. |
| R14 + R17 | README: stale "Known rules gaps" replaced with "Move generation" plus a full "Match play & the doubling cube" section including the AI-vs-AI Crawford limitation; roadmap updated. |
| R6, R7, R12, R13, R15, R16 | Left as documented trade-offs / optional polish (info-level). |
