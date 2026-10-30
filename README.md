# ai-backgammon

AI-powered (BYOK) Backgammon.

**Current status: Phase 1 — scaffold, UI shell and game-mode configuration.**
The board renders 24 placeholder points, Settings holds your personal BYOK, and *New game*
configures who plays which seat. There is **no** game logic, move validation, dice rolling or AI
inference yet.

## Tech stack

| Concern     | Choice |
| ----------- | -------------------------------------------------------- |
| Build/dev   | Vite 8 (Rolldown) + React 19 + TypeScript 5.9 (strict) |
| Styling     | Tailwind CSS 4 via `@tailwindcss/vite` (no `tailwind.config.js`) |
| Client state| Zustand 5 + `persist` middleware |
| Icons       | lucide-react |
| Hosting     | Cloudflare Pages (static assets, no Functions yet) |

Node 22 is required (`.nvmrc`, `package.json` `engines`): `nvm use`.

## Commands

```bash
npm install          # install dependencies
npm run dev          # dev server on http://localhost:5173
npm run typecheck    # tsc -b (no emit) — 0 errors required
npm run lint         # eslint .
npm run build        # typecheck + production bundle into dist/
npm run preview      # serve the built dist/ locally
npm run pages:local  # build + serve through wrangler pages dev (Cloudflare-like)
npm run pages:deploy # build + publish to Cloudflare Pages (needs `npx wrangler login`)
```

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

*New game* only **saves** a setup today — the CTA says "Save setup". Starting a match is Phase 2/3
work. "Save setup" stays disabled while any AI seat is missing a key (or a Base URL for a custom
endpoint), and each seat card lists exactly what is missing.

## Layout

```
src/
├── components/
│   ├── ui/             Modal.tsx (dialog chrome), controls.ts (shared class tokens)
│   ├── ByokFields.tsx  provider / key / model / conditional Base URL — reused twice
│   ├── Board.tsx  Point.tsx  Checker.tsx  Die.tsx
│   ├── SettingsModal.tsx    personal BYOK
│   └── GameSetupModal.tsx   mode + match type + opponent BYOK + roster preview
├── hooks/          useSettings, useGameConfig, useByokDraft, useEscapeKey
├── lib/logger.ts   console wrapper that redacts credential-shaped fields
├── state/          createSafeStorage.ts, settingsStore.ts, gameConfigStore.ts
├── types/          game.ts, settings.ts (AiEngineConfig), gameConfig.ts
└── utils/          gameConfig.ts (planSeats/validateEngine/describe*), cn.ts, formatSecret.ts
```

Path alias `@/…` maps to `src/…` and is declared in **both** `vite.config.ts` (`resolve.alias`)
and `tsconfig.app.json` (`compilerOptions.paths`) so Vite and `tsc -b` agree.

## BYOK configuration and security

* Two `localStorage` entries: **`ai-backgammon:settings`** (your provider/key/model/base URL) and
  **`ai-backgammon:game-config`** (mode, match type and the opponent's key/model/base URL). Both
  are written by Zustand's `persist` middleware, and both use `partialize` so modal visibility
  and store actions never reach disk.
* A **mirror match stores no second credential**: `planSeats()` hands the same engine object to
  both seats, so there is nothing to keep in sync and no extra copy of your key.
* Keys live in the browser in plain text. That is inherent to a client-only BYOK app: anyone with
  access to this device (or an XSS bug) can read them. Use dedicated, revocable keys, and add a
  Pages Function proxy later if that trade-off stops being acceptable.
* Every persisted store shares `createSafeStorage`, which swallows and logs storage failures
  (private mode, storage disabled, quota exceeded) instead of crashing — settings then stay in
  memory for the session.
* `src/lib/logger.ts` masks any context field matching
  `api[-_]?key|authorization|token|secret|password`; UI surfaces show only the last four
  characters (`maskSecret`).
* `.env*` and `.dev.vars` are gitignored. No secret belongs in the repo — nothing here needs one.
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

`public/_redirects` (`/* /index.html 200`) provides the single-page fallback and
`public/_headers` sets `nosniff`, `DENY` framing, a strict referrer policy and a locked-down
permissions policy. Both are copied into `dist/` by Vite. A CSP is deliberately **not** enabled:
Tailwind injects inline `<style>` tags during dev/HMR, so add one with `style-src 'unsafe-inline'`
only once the production CSS pipeline is stable.

## Roadmap

1. **Phase 2 — game core:** `src/state/gameStore.ts`, dice rolling in `src/utils/dice.ts`, move
   generation/validation, then Vitest coverage for every pure function (starting with the
   already-pure `planSeats`/`validateEngine`).
2. **Phase 3 — BYOK engine:** per-provider clients fed from `planSeats()` (one engine for mirror,
   two for custom), move explanations streamed into the side panel, optional Pages Function
   proxy.
3. **Phase 4 — polish:** spectator controls for AI vs AI, drag-and-drop, animations,
   accessibility pass, persistence of games.
