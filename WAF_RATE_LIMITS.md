# Edge rate limiting & abuse resistance

The relay (`/api/ai-proxy`) and the telemetry sink (`/api/event`, legacy alias `/api/collect`) are
**public endpoints**. `shared/aiProxy.ts` and the Pages Functions already enforce everything that can
be enforced per-request — SSRF allowlist, https-only, redirect refusal, opaque-origin refusal, header
allowlists, body and response size caps, D1-write refusal for definitely-automated traffic.

What no line of application code can enforce is **volume**. A rate is a property of many requests, and
each Function invocation is stateless, so an attacker driving 10 000 sequential requests is
indistinguishable from a visitor at the application layer. That is what the rules below are for: they
protect **this Cloudflare account** (Functions invocations, D1 writes, subrequest egress, and the bill
that follows), not the visitors — the visitors' keys are their own and never leave their browser.

Configure these in **Cloudflare dashboard → Security → WAF** for the zone that serves the site
(e.g. `kamenonline.com`), *not* in the Pages project settings. Pages Functions inherit the zone's
firewall — but only for traffic that actually passes through it: the DNS record for the domain must be
**proxied (orange cloud)**. A DNS-only record sends requests straight to Pages, the rules below never
run, and nothing in the dashboard will tell you so. Check the record before trusting a limit.

---

## Rule 1 — refuse definitely-automated traffic on the telemetry sink

| | |
| --- | --- |
| **Type** | Custom rule (Security → WAF → Custom rules) |
| **Field** | `cf.bot_management.score` |
| **Expression** | `(http.request.uri.path eq "/api/event" or http.request.uri.path eq "/api/collect") and cf.bot_management.score lt 30` |
| **Action** | Block |

`1–30` is Cloudflare's *definitely automated* band; `30–60` is "likely automated" and verified bots
sit at `50–60`. Staying below 30 means no human on a shared or corporate IP is ever turned away. The
same threshold is enforced in `functions/api/event.ts` (`BOT_REJECT_SCORE`), so this rule is
redundancy, not the only line of defence — see the plan note below.

> **Plan note.** `cf.bot_management.score` is only populated with **Bot Management (Enterprise)**. On
> Free/Pro/Business you cannot reference it in a custom rule; enable **Super Bot Fight Mode** instead
> (Pro/Business) and set *Probably bot traffic* and *Verified bots* to their blocking defaults, and
> rely on Rules 2–3. The Function-level check is then the effective guard, and it degrades safely: no
> score means no rejection, so nothing breaks on a plan without it.

## Rule 2 — rate limit the telemetry sink

| | |
| --- | --- |
| **Type** | Rate limiting rule (Security → WAF → Rate limiting rules) |
| **Expression** | `(http.request.uri.path eq "/api/event" or http.request.uri.path eq "/api/collect") and http.request.method eq "POST"` |
| **With characteristics** | `IP Address` (`ip.src`) |
| **With the limit** | 30 requests per 10 seconds |
| **Action** | Block · **Duration:** 10 seconds |

A legitimate visit costs 1 beacon plus 1–3 per game — a few dozen requests an hour at most. 30/10 s is
far above any real player and far below what it takes to exhaust the D1 daily write quota.

## Rule 3 — rate limit the AI relay (two windows, two rules)

A rate-limiting rule carries **one** window, so the short-burst and sustained ceilings below are two
rules on the same expression.

**3a — burst**

| | |
| --- | --- |
| **Expression** | `http.request.uri.path eq "/api/ai-proxy" and http.request.method eq "POST"` |
| **With characteristics** | `IP Address` (`ip.src`) |
| **With the limit** | 20 requests per 10 seconds |
| **Action** | Block · **Duration:** 10 seconds |

**3b — sustained**

| | |
| --- | --- |
| **Expression** | same as 3a |
| **With characteristics** | `IP Address` (`ip.src`) |
| **With the limit** | 300 requests per 5 minutes |
| **Action** | Block · **Duration:** 5 minutes |

`POST` only is correct and complete: `handleProxyRequest` answers `405` to any other verb, so the
inner `GET` model-list lookups travel *inside* a POST envelope and are covered by these rules.

Why these numbers: one AI move is at most 4 requests (a turn plus its single retry), and an `aiVsAi`
match drives two seats. 20/10 s is roughly five turns a second — unreachable by a human and generous to
a reasoning model that streams. 300/5 min covers a long deep-thinking match with headroom. If a report
ever arrives that a legitimate player hit 3b (most likely carrier NAT or a big corporate egress, where
one IP is many players), raise 3b rather than 3a.

**Use Block, not Challenge, on `/api/ai-proxy`.** A browser cannot render a Cloudflare challenge inside
a `fetch()`, so a challenge only converts a clean rejection into an opaque failure. With Block,
Cloudflare returns `429` plus `Retry-After`, which is the one thing the client already understands.

---

## What a visitor actually sees when a rule fires

Verified against `src/utils/aiClient.ts` rather than assumed:

* `429` on `/api/ai-proxy` is mapped by `mapHttpError` to the `rate-limited` code, which `isTransient()`
  treats as retryable. `withTransientRetry` makes **exactly one** further attempt, honouring
  `Retry-After` (falling back to `AI_RETRY_BASE_MS`, capped at `AI_RETRY_MAX_WAIT_MS` = 15 s). If the
  limit is still in force the turn fails with the existing rate-limit banner and the player can retry —
  no crash, no lost board, no key exposure.
* A `403`/`429` on `/api/event` or `/api/collect` is **invisible to the visitor**: telemetry beacons are
  fire-and-forget and every failure path is swallowed by design.
* `413` (oversized body) and `403` (`automated-visitor`) never reach a real visitor either: a legitimate
  beacon is a few hundred bytes.

## `/api/collect` is a legacy alias — protect it identically

`functions/api/collect.ts` is two lines: `export { onRequestPost } from './event.ts'`. Because it is the
*same handler*, every application-layer rule (origin check, bot-score rejection, size caps) applies to
both paths automatically and can never drift.

**The WAF rules are path-based, so they cannot inherit that.** Both `/api/event` and `/api/collect` are
named explicitly in Rule 1 and Rule 2. A rule matching only `/api/event` leaves an open second door to
the same code — anyone scripting the sink will find it in five minutes. If the alias is ever retired,
delete its clause from both rules rather than leaving a stale path.

---

## Verifying the rules after you create them

1. **The limit must bite.** From one IP, past the burst window:
   `for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<site>/api/ai-proxy -H 'content-type: application/json' -d '{}'; done`
   Expect `400` from the relay for the first batch (an empty envelope is a bad request), then `429` with
   a `retry-after` header once the window is exceeded. Check `cf-ray` on the rejection.
2. **Check the dashboard.** Security → Events should show the triggered rule and the client IP. Events
   logged but nothing blocked means the rule's action or scope is wrong.
3. **The limit must not bite.** Play one full `aiVsAi` match with two reasoning models and confirm no
   turn shows the rate-limit banner.
4. **Telemetry still lands.** Load the site, start a game, close the tab, then check `/stats` for the
   visit and the `abandoned` game_end — proving Rule 2 is not rejecting real players.

---

## Residual risk, stated plainly

Rate limits make abuse expensive; they do not make it impossible. A distributed source can still use the
relay within each IP's allowance, and a non-browser client sends no `Origin` or `Sec-Fetch-Site` at all —
which is why the relay's origin guards — enforced in `shared/aiProxy.ts`, so both the edge Function and
the dev middleware inherit them — are browser-shaped (they stop a hostile page from driving the
endpoint on a visitor's behalf) and these edge rules are the volume control. The relay is unauthenticated
by design: it forwards the caller's *own* key, so no visitor's credential can be read or reused through
it. Making it require a session would be a different product, not a flag in this one.

