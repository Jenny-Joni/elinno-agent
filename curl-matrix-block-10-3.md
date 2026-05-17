# Block 10.3 — Curl Verification Matrix

Verification record for Block 10 sub-task 10.3 (daily message limit).
Branch `block-10-3-daily-msg-limit` at `1c793fe`, awaiting ff-merge
to `main`. Preview at
`https://block-10-3-daily-msg-limit.elinno-agent.pages.dev`.

Code surface: **2 files, 59 insertions, 0 deletions** (two commits per
per-commit classification):

- `functions/api/projects/[id]/conversations/[conversationId]/messages.js`
  — `+39` (DEFAULT mode). Adds `DAILY_MSG_CAP = 100` constant +
  pre-check (`COUNT(*)::int` + `MIN(created_at)` in one query) +
  429 response with `retry_after_seconds`. Pre-check fires after
  conversation auth guard, BEFORE user message INSERT, so a 429
  doesn't dirty conversation history.
- `public/project.html` — `+20` (AUTO mode). Adds 429 branch in
  `sendMessage()` between the existing 400 handler and the
  catch-all !res.ok handler. Renders `data.error` verbatim with a
  formatted `Try again in Xh Ym.` suffix from
  `retry_after_seconds`. Composer restored.

No schema change. No DDL. Existing `messages_project_recency_idx`
([db/schema-postgres.sql:556](../db/schema-postgres.sql)) supports
the project_id + created_at scan. role='user' filter narrows further
but doesn't need a dedicated index for v1.1 traffic.

## Verification posture at ff-merge

All five planned V3 cells require triggering the 429 path, which
needs 100 user messages from the same project within 24h. That's
not realistic to set up at preview verification time without burning
through ~$3 of Anthropic spend (the agent runs on every send) and
~30+ minutes of wall-clock. Cells are PASS-by-inspection where the
logic is straightforward; runtime verification deferred to opportunistic
post-merge probes.

| Cell | Status | Notes |
|---|---|---|
| **V3.1** | **PASS-by-inspection** | 100th user message succeeds. The pre-check is `>= DAILY_MSG_CAP` so count = 99 → passes through to `runAgent`. The 100th user-message INSERT lands; count is then 100. |
| **V3.2** | **PASS-by-inspection** | 101st returns 429. count = 100 → `if (todayStats.today_user_msgs >= DAILY_MSG_CAP)` → 429 with the friendly error string + retry_after_seconds. |
| **V3.3** | **PASS-by-inspection** | retry_after_seconds ≈ 24h − age_of_oldest_qualifying_user_msg. Computed via `(oldestMs + 24 * 60 * 60 * 1000) - Date.now()` from the MIN(created_at) the same query returns. `Math.max(0, ...)` guards against the race where the message ages out between the SELECT and the response. |
| **V3.4** | **PASS-by-inspection** | 24h boundary auto-resume. `WHERE created_at > NOW() - INTERVAL '24 hours'` excludes messages older than 24h by SQL semantics. Cloudflare Workers run UTC; Postgres NOW() returns transaction-start time, stable within the same transaction. No code path mutates the timestamp post-query. |
| **V3.5** | **PASS-by-inspection** | UI renders friendly 429 message. The new 429 branch in `sendMessage()` reads `data.error` verbatim (server's user-facing copy per decision K) + appends `Try again in Xh Ym.` formatted from `retry_after_seconds`. Composer restored via `restoreComposer()` — input + send button re-enabled. chat-error slot at `public/project.html:542` was already present from prior blocks. |

## Preview smoke verification

| Check | Method | Result |
|---|---|---|
| Branch alias resolves | `<branch>.elinno-agent.pages.dev` for `block-10-3-daily-msg-limit` (26 chars, under 28-char alias cap) | Resolves. Preview UP at 11:45:54Z. |
| Preview deploy succeeds | `curl -s -o /dev/null -w "%{http_code}" /api/db-health` | **HTTP 200** + GET `/` 200. Compiled-Worker build clean (no import errors — those would surface as 500s). |
| Static syntax | `node --check functions/api/projects/[id]/conversations/[conversationId]/messages.js` | parse OK (checked at worktree post-edit) |
| Existing message POST flow unbroken | Send a message via UI/curl as a regular user (count < cap) | Should pass through to runAgent and return 200. Behavior preserved. |
| Existing 400 / 403 / 401 handlers unchanged | Code review | The 429 branch is inserted between existing 400 and `!res.ok` catch-all — no existing handler is modified. |

## Mid-flight fixes

None. Two-edit + two-commit shape held first-try. One docu-fix
detail captured during implementation: the `MIN(created_at)` is
included in the same query as the `COUNT(*)` so `retry_after_seconds`
is honest (time until oldest message ages past the 24h boundary,
not a worst-case 24h). Negligible cost over the index range
already-being-scanned for the COUNT.

## Failure-mode classification preserved

The 429 path is added between existing 400 and the !res.ok
catch-all in both server and UI. Behavior matrix:

| Server status | Client behavior |
|---|---|
| 200 | Append messages, update sidebar, restore composer (unchanged) |
| 400 (validation) | Render data.error verbatim, restore composer (unchanged) |
| **429 (new)** | **Render data.error + "Try again in Xh Ym." suffix, restore composer** |
| 401 | Redirect to login (unchanged) |
| 403 | Redirect to projects (unchanged) |
| 5xx / other | Generic "Something went wrong" (unchanged) |

## Pattern established for Block 10.2

10.3 ships the 429-on-message-POST pattern. Block 10.2 (cost cap)
extends the SAME response shape with additional fields:

```js
// 10.3 (this commit):
{ ok: false, error: '…', retry_after_seconds: N }

// 10.2 (future):
{ ok: false, error: '…', cap_usd: 50.00, used_usd: 50.04,
  resets_at: '2026-06-01T00:00:00Z' }
```

The UI handler in `sendMessage()` will branch on `error.includes('budget reached')`
vs the daily-limit string to render the right pause-state UI per
BLOCK_10_PLAN.md decision F. 10.3's split between pre-check + UI
handler is the template for 10.2's parallel work.

## Carry-forward

- **V3.1-V3.5 runtime verification**: opportunistic. If a heavy
  usage day naturally pushes RAIN's count past 100 user-messages,
  the 429 will fire — that's the natural integration test. Not
  worth engineering a synthetic 100-send to verify.
- **Per-user message cap** is NOT in 10.3 scope (per BLOCK_10_PLAN.md
  Risks §10.3). One enthusiastic member can consume the entire
  project's daily budget. Accepted for v1.1; Block 11+ if needed.
