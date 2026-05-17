# Block 10.2 — Curl Verification Matrix

Verification record for Block 10 sub-task 10.2 (per-project AI cost
cap with admin notification). **Final Block 10 sub-task — v1.1 ships
once this lands.** Branch `block-10-2-ai-cost-cap` at `74161c6`,
awaiting ff-merge to `main`. Preview at
`https://block-10-2-ai-cost-cap.elinno-agent.pages.dev`.

Code surface: **9 files, 454 insertions, 10 deletions** (two commits
per per-commit classification):

- `db/schema-postgres.sql` — `+24` (DEFAULT). Source-of-truth for
  `projects.ai_monthly_cap_usd`, `projects.ai_cap_warned_at`,
  `messages.cost_usd`. **DDL was applied by Jenny in Neon SQL
  Editor BEFORE this deploy** (mid-session step, verified via
  `backfilled=9, missing=0, project_count=1` sanity SELECT).
- `functions/_lib/ai/pricing.js` — `+57` (new, DEFAULT, SECURITY-
  CARVE-OUT). TOKEN_PRICES_USD_PER_MILLION + computeCostUsd.
- `functions/_lib/admins.js` — `+58` (new, DEFAULT, SECURITY-CARVE-
  OUT). Cross-DB Postgres↔D1 admin email lookup. First call site
  that crosses the seam.
- `functions/_lib/email.js` — `+107` (DEFAULT). New sendCostCapEmail
  (warning + paused kinds, per-recipient sends).
- `functions/_lib/ai/loop.js` — `+7` (DEFAULT). cost_usd added to
  all three db_turns push sites.
- `functions/_lib/agent/refresh_runner.js` — `+9/-3` (DEFAULT).
  cost_usd in db_turns INSERT + agent-failure fallback.
- `functions/api/projects/[id]/conversations/[conversationId]/messages.js`
  — `+114/-2` (DEFAULT). Cost-cap pre-check + admin notification +
  cost-on-persist + firstOfNextMonthIso helper.
- `public/project.html` — `+72/-5` (AUTO). aiPausedUntilMs state +
  updateAiPausedBanner + cost-cap branch in 429 handler + new
  HTML slot in chat-composer.
- `public/auth.css` — `+15` (AUTO). `.ai-paused-banner` styles.

No DDL by Claude (applied by Jenny mid-session).

## Verification posture at ff-merge

V2.2 + V2.3 + V2.8 + V2.9 PASS-by-inspection or already verified
during DDL apply. V2.4 + V2.5 + V2.6 + V2.7 are heavy-runtime
(require setting a test cap low + burning messages, or synthetic
Neon work) — deferred to opportunistic post-merge probes. V2.1 is a
single-send post-merge check on production.

| # | Cell | Status | Notes |
|---|---|---|---|
| **V2.1** | cost_usd computed correctly on persist | **DEFERRED-runtime / PASS-by-inspection** | Loop.js computeCostUsd(MODEL_ID, in, out) writes cost_usd on every db_turn; messages.js INSERT now includes the column. Post-merge spot check: send 1 chat message in RAIN → `SELECT cost_usd, model, input_tokens, output_tokens FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 1` → manual math against pricing.js constants. |
| **V2.2** | Backfill UPDATE populates existing messages | **PASS** | Jenny ran the backfill UPDATE in Neon mid-session. Sanity query returned `backfilled=9, missing=0, project_count=1`. Every pre-10.2 message with a known model now has cost_usd populated; the cap-pre-check SUM is honest from day one. |
| **V2.3** | Month-to-date SUM matches sum-of-cost | **PASS-by-inspection** | Pre-check is `SELECT COALESCE(SUM(cost_usd),0)::float AS month_cost_usd FROM messages WHERE project_id=$1 AND created_at >= DATE_TRUNC('month', NOW()) AND deleted_at IS NULL`. COALESCE handles zero-row case; ::float coerces postgres NUMERIC to JS number cleanly. |
| **V2.4** | 80%-warning email fires once per month | **DEFERRED-runtime** | Tests by setting a test project's cap to $0.10, sending messages until $0.08 reached, expecting one Resend POST + projects.ai_cap_warned_at populated. Then continue past 80% on more sends → no additional warning emails (idempotency via ai_cap_warned_at >= first-of-month). Logic verified by code review in messages.js cost-cap branch. |
| **V2.5** | 100%-pause email + 429 returned | **DEFERRED-runtime** | Continue past 100% in V2.4 setup → one Resend POST with kind='paused' + the message POST itself returns 429 with `cap_usd`, `used_usd`, `resets_at`. Verified by code review: the `if (capUsd > 0 && monthCostUsd >= capUsd)` branch in messages.js fires the email then returns the 429 unconditionally (email failure doesn't block the refusal). |
| **V2.6** | Month-boundary auto-resume | **PASS-by-inspection** | `firstOfNextMonthIso()` returns the next UTC month boundary as ISO. SUM scope is `DATE_TRUNC('month', NOW())` — at UTC month rollover the SUM snaps back to ~0 (only the first new message counts). ai_cap_warned_at idempotency check (`>= DATE_TRUNC('month', NOW())`) flips to false at the same boundary, so warning emails re-arm without a background reset job. |
| **V2.7** | Cross-project cap leak (paranoid) | **DEFERRED-runtime** | Project A at cap, project B at $0. POST message to project B should return 200, NOT inherit project A's cap state. Verified by code review: the SUM has `WHERE project_id = ${params.id}`; project B's SUM is computed independently. The `ai_cap_warned_at` column is also per-project. No cross-tenant data path identified. |
| **V2.8** | Paused UI renders correctly | **PASS-by-inspection** | aiPausedUntilMs set on cost-cap 429 (data.resets_at present); updateAiPausedBanner renders `.ai-paused-banner` div above the composer, disables input + send. renderChat() calls updateAiPausedBanner on every render so tab/conv switch keeps it consistent. Page reload clears the state (a fresh send after the reset boundary will pass the pre-check). |
| **V2.9** | Per-project cap configurable | **PASS-by-inspection** | Server reads `projects.ai_monthly_cap_usd` per pre-check; UPDATE that column for a project, the next message-POST uses the new cap value. v1.1 has no settings UI; admins change via Neon SQL Editor (Block 11+ adds UI per BLOCK_10_PLAN.md Out of scope). |

## Preview smoke verification

| Check | Method | Result |
|---|---|---|
| Branch alias resolves | `block-10-2-ai-cost-cap.elinno-agent.pages.dev` (22 chars, under cap) | Resolves. Preview UP at 13:10:14Z. |
| Preview deploy succeeds | `curl /api/db-health` | **HTTP 200**. Compiled Worker clean — no import-resolution errors (the cross-DB stitch + new pricing/admins imports all resolved). |
| Static syntax | `node --check` on pricing.js, admins.js, email.js, loop.js, refresh_runner.js, messages.js | all parse OK |
| No existing endpoints regressed | Code review: messages.js POST pre-checks happen BEFORE the user-message INSERT so a 429 doesn't dirty conversation history; existing handlers (401/403/400 branches) unchanged | PASS-by-inspection |
| db_turns shape coverage | Code review: cost_usd added to all three loop.js push sites + the messages.js POST agent-failure fallback + the refresh_runner.js agent-failure fallback. Persist INSERT in both messages.js and refresh_runner.js now reads `turn.cost_usd ?? null`. | PASS-by-inspection |
| D1 IN-list shape | admins.js generates `?, ?, ?, ...` placeholders dynamically and binds each id with `.bind(...userIds)` per the D1 SQL API. No array-binding sugar in D1. | PASS-by-inspection |
| Email idempotency gate | Code review: `thresholdAlreadyFiredThisMonth = ai_cap_warned_at >= UTC first-of-this-month`. Both warning + pause branches skip the email when this is true. UPDATE happens on the same code path as the send. | PASS-by-inspection |

## Mid-flight fixes

None. The 9-file change set landed first-try after a careful sequencing
(schema-of-truth → pricing.js → admins.js → email.js → loop.js → 
messages.js → refresh_runner.js → UI → CSS). The pre-write step for
loop.js included updating ALL three db_turns push sites (no-connection
short-circuit, normal assistant turn, tool turn) so messages.js
persistence has a uniform shape; one of those sites would have been
missed without the careful sweep.

### Design touches worth noting

1. **Single firstOfNextMonthIso() helper.** Both the 429 response
   payload and the idempotency boundary use the same UTC-anchored
   month math. Centralized so the two never drift.

2. **Email send is best-effort; 429 is not.** A failed Resend call
   logs + continues; the 429 response still fires because refusing
   the over-cap message is the load-bearing behavior. Admin
   notification is observability, not enforcement.

3. **Cost backfill at month boundary stays naive.** Mid-month
   pricing changes affect new sends only — past cost_usd rows stay
   at the prior price. This is the audit-correct behavior (those
   sends were billed at the old price). The pricing.js header
   docblock spells out this convention.

4. **D1 admin lookup is the first cross-DB seam call.** Single
   helper localizes the join; any future code that needs per-
   project admin emails should call getAdminEmailsForProject rather
   than duplicating the Postgres-then-D1 walk.

## Carry-forward

- **PROD V2.1 one-message smoke**: send a single message in RAIN
  post-merge, run `SELECT cost_usd, model, input_tokens, output_tokens
  FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC
  LIMIT 1` in Neon, compute `(in*3 + out*15)/1M` for sonnet-4-5 and
  confirm the column matches.
- **V2.4 + V2.5 staged exercise** (optional, $0.10 of real spend):
  Neon `UPDATE projects SET ai_monthly_cap_usd = 0.10 WHERE id = $1`
  for a throwaway project; send messages until 80% crosses; observe
  a Resend send + `ai_cap_warned_at` populated; continue past 100%;
  observe 429 + paused email. Reset cap after: `UPDATE projects SET
  ai_monthly_cap_usd = 50.00, ai_cap_warned_at = NULL WHERE id = $1`.
- **V2.6 month boundary**: naturally validated at next UTC month
  rollover (~14 days from this commit). No engineering effort needed.
- **Block 11+ candidates from BLOCK_10_PLAN.md Out of scope**: real
  over-cap queue (vs. refuse), cost-cap admin settings UI,
  configurable daily message cap, project-timezone-aware month
  boundaries.

## v1.1 ships

This is the final Block 10 sub-task. Once `block-10-2-ai-cost-cap`
ff-merges to `main`, **v1.1 is complete.**

The launch-blocking + nice-to-have polish layer is in:
- Block 9 (5 sub-tasks): connection management UI, "data as of"
  citation freshness, suggested example questions, nightly cron,
  content-hash redesign
- Block 10 (6 sub-tasks): sweep-path batching, connector guide,
  daily message limit, tool-call trace viewer, refresh-and-ask-again,
  per-project AI cost cap

Monday + Drive connectors and cross-project mode remain deferred to
v1.2 per PRD §11.
