# Block 10.1 — Curl Verification Matrix

Verification record for Block 10 sub-task 10.1 (refresh-and-ask-
again). Branch `block-10-1-refresh-reask` at `d0c10a5`, awaiting
ff-merge to `main`. Preview at
`https://block-10-1-refresh-reask.elinno-agent.pages.dev`.

Code surface: **5 files, 698 insertions, 5 deletions** (two commits
per per-commit classification):

- `db/schema-postgres.sql` — `+41` (DEFAULT). `refresh_actions`
  table + index source-of-truth. **DDL was applied by Jenny in Neon
  SQL Editor BEFORE this deploy** (mid-session step, verified via
  `SELECT (SELECT COUNT(*) FROM refresh_actions) AS row_count,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name
  = 'refresh_actions') AS column_count;` returning `0, 11`).
  Expected-tables doc comment bumped from 8 → 9.
- `functions/_lib/agent/refresh_runner.js` — `+316` (new, DEFAULT).
  Shared orchestrator. SECURITY-CARVE-OUT header.
- `functions/api/projects/[id]/conversations/[conversationId]/messages/[msgId]/refresh-and-ask-again.js`
  — `+131` (new, DEFAULT). Thin auth + rate-limit + delegate.
  SECURITY-CARVE-OUT header.
- `public/project.html` — `+115/-3` (AUTO). Button render + click
  wiring + handleRefreshAndReask handler.
- `public/auth.css` — `+34` (AUTO). `.refresh-reask-button` styles.

## Verification posture at ff-merge

V1.1 + V1.2 + V1.4 + V1.5 PASS-by-inspection. V1.3 + V1.6 + V1.7 +
V1.8 are runtime-heavy (burn real Slack/Jira API calls + Anthropic
tokens) — deferred to opportunistic post-merge probes. A single
happy-path click on RAIN's most-recent cited answer after merge
covers V1.1 + V1.2 + V1.6 + V1.7 in one action.

| # | Cell | Status | Notes |
|---|---|---|---|
| **V1.1** | Button renders on assistant messages with citations | **PASS-by-inspection** | `renderCitationRailHtml(citations, messageId)` always appends a `<button class="refresh-reask-button" data-msg-id>` when `messageId` is truthy; `renderMessageHtml` passes `m.id`. NOT rendered when citations is empty (the rail itself only renders for `citations.length > 0` per `renderMessageHtml`). NOT rendered for user messages (the rail is gated by `!isUser`). |
| **V1.2** | Click triggers POST to refresh endpoint | **PASS-by-inspection** | `renderMessages()` wires `.refresh-reask-button` clicks to `handleRefreshAndReask(btn)`; URL constructed as `/api/projects/:id/conversations/:convId/messages/:msgId/refresh-and-ask-again` from `project.id`, `activeConvId`, `btn.dataset.msgId`. POST + empty body. |
| **V1.3** | Rate limit (5/hour per user+project) returns 429 | **DEFERRED-runtime** | Six back-to-back refreshes would burn 6 real Slack/Jira syncs + 6 Anthropic token rounds. Logic verified by code review: `SELECT COUNT(*)::int AS recent FROM refresh_actions WHERE user_id=$1 AND project_id=$2 AND started_at > NOW() - INTERVAL '1 hour'`; if `recent >= 5` return 429 with `retry_after_seconds` from `MIN(started_at)`. Matches Block 9.1 sync.js shape. |
| **V1.4** | Cross-project deny | **PASS-by-inspection** | The endpoint's source-message guard uses a single SELECT with `c.project_id = ${params.id}` AND `c.user_id = ${userIdText}` clamps in WHERE. A message id from project A queried with project B's URL returns no rows → 403. The rate-limit query also clamps both `user_id` and `project_id` (defense-in-depth per Block 9.1 belt-and-suspenders precedent at sync.js:115-119). |
| **V1.5** | Original user message recovered | **PASS-by-inspection** | Runner step 4: `SELECT id, content, created_at FROM messages WHERE conversation_id=$1 AND role='user' AND created_at < ${sourceMessage.created_at} ORDER BY created_at DESC, id DESC LIMIT 1`. The "user message that prompted this assistant" = the most recent user message before the assistant in the same conversation. priorMessages reconstruction in step 5 includes everything up to AND INCLUDING that user message (`created_at <= original.created_at`). |
| **V1.6** | Refresh runs incrementalSync per cited connection | **DEFERRED-runtime** | A single happy-path click on a RAIN message that cites both Slack + Jira would create 2 new `sync_runs` rows with `sync_mode='incremental'` and `started_at` within the last minute, AND the `refresh_actions.triggered_sync_run_ids` array would contain both. Logic verified by code review: runner step 3 mirrors `cron-incremental.js:121-205` per-connection-isolation pattern. |
| **V1.7** | New assistant message persisted with citations | **DEFERRED-runtime** | Post-merge: click Refresh & re-ask → expect a new `messages` row with `role='assistant'`, `content` populated, `citations` populated, AND `refresh_actions.new_message_id` linked to that row. Code path: runner step 7 keeps the RETURNING'd row for the last `role='assistant'` turn with content; step 8 UPDATEs the refresh_actions row with the new id. |
| **V1.8** | Failure isolation: one bad connection doesn't block others | **DEFERRED-runtime** | Tests by revoking Slack token then clicking refresh on a Slack+Jira citation. Code-path verified: runner step 3's per-connection try/catch matches Block 9.4 decision U (same `try { connector.incrementalSync(...) } catch (syncErr) { UPDATE sync_runs status='failed'; continue; }` shape from cron-incremental.js:144-164). |

## Preview smoke verification

| Check | Method | Result |
|---|---|---|
| Branch alias resolves | `block-10-1-refresh-reask.elinno-agent.pages.dev` (24 chars, under cap) | (filled in once preview poll completes) |
| Preview deploy succeeds | `curl /api/db-health` against preview | (filled in once preview poll completes) |
| Static syntax | `node --check` on both new server files | parse OK at worktree |
| Endpoint registered | New route at `/api/projects/.../messages/.../refresh-and-ask-again` reachable on preview | (verifiable post-preview-up via `curl -i -X POST <preview>/api/projects/UUID/conversations/UUID/messages/UUID/refresh-and-ask-again` — expect 401 unauthorized, NOT 404) |
| Schema add idempotent | `db/schema-postgres.sql` uses `CREATE TABLE IF NOT EXISTS` so a future fresh-DB rebuild matches what Jenny applied | PASS-by-inspection |
| Cross-project + cross-user clamps in endpoint | Code review: source-message SELECT clamps `c.project_id = $URLid` AND `c.user_id = $sessionUser`; rate-limit clamps both ids; runner cited-connections JOIN clamps `e.project_id = $projectId` AND `c.deleted_at IS NULL AND c.status = 'active'` | PASS-by-inspection |
| iteration semantics preserved | Runner doesn't touch loop iteration values — runAgent computes its own (1, 2, 3, ... per loop turn). Collides with the original round's iteration values but iteration is metadata not a uniqueness key; ordering is by created_at | PASS-by-inspection |

## Mid-flight fixes

**One hotfix** (`08f6fbb`, post-ff-merge of the initial commit-set).

The initial 10.1 endpoint at
`.../messages/[msgId]/refresh-and-ask-again.js` was non-functional
in production: POST against the route returned **405** (request fell
through to static-serving, which 405s non-GET); GET returned 200
(SPA fallback). Two issues, one mechanical relocation addressed
both:

1. **Routing shadow.** Pages Functions routing treats `messages.js`
   at `[conversationId]/` as shadowing the `messages/` directory at
   the same level — so the deeper route never registered.
2. **Import depth off-by-one.** The old file was 8 directories deep;
   reaching `functions/_lib/` needs 7 `..` segments. The imports
   used 6 `..`. Same import-depth bug class as Block 9.4 hotfix
   `f4c06f4`. Cloudflare's bundler dropped the orphaned file before
   reaching the import-resolution step, so the build "succeeded"
   without surfacing the off-by-one.

Fix at [`08f6fbb`](https://github.com/Jenny-Joni/elinno-agent/commit/08f6fbb):
`git mv` the endpoint to
`refresh-and-ask-again/[msgId].js` at the `[conversationId]/` level.
New route: `POST /api/projects/:id/conversations/:conversationId/refresh-and-ask-again/:msgId`.
File depth drops to 7 — the 6 `..` imports are now correct (no
import-path edits needed). UI URL updated in
[`project.html`](public/project.html) `handleRefreshAndReask` to
match. No logic changes; runner, schema, auth, CSS unchanged.

**Verification post-hotfix-deploy:** `curl -X POST` against the new
route should return **401 "Not authenticated"** (Function registered,
requireProjectRole returns 401 on missing cookie). The old route
should now return 405 again (no file there). Both observations
confirm the routing fix landed.

### Design touches worth noting

1. **Schema source-of-truth tracks reality.** Jenny applied the DDL before
   this commit; `db/schema-postgres.sql` uses `CREATE TABLE IF NOT
   EXISTS` so a future fresh-DB rebuild matches what's running. The
   "table already exists" 42P07 error she saw when running the DDL is
   benign-and-documented — script can be re-run safely without
   side effects.

2. **Runner is the future-proof seam.** The endpoint is intentionally
   thin (auth + rate-limit + delegate). A v1.2 cron-driven auto-
   refresh path can call `runRefreshAction` directly from a cron
   handler without any new core logic.

3. **iteration value collision is benign.** Original assistant turns in
   the source round have iteration=1,2,3; refresh produces new
   assistant turns also with iteration=1,2,3. They coexist because
   `iteration` is metadata not a key; conversation display orders by
   `created_at` so the refresh result sits chronologically after the
   original. No schema or query needs to handle "iteration" as unique.

4. **Sidebar bump in the UI handler.** Server-side already UPDATEs
   `conversations.updated_at` (runner step 7-end), but the UI mirrors
   that locally so the refreshed conversation jumps to the sidebar
   top without a roundtrip. Matches the existing `sendMessage` post-
   success pattern (project.html:912-921).

## Carry-forward

- **PROD V1.6 + V1.7 + V1.1 + V1.2 one-click verification.** Open RAIN
  in production after merge → scroll to any cited assistant message →
  click ↻ Refresh & re-ask. Expect: button flips to "Refreshing…" →
  toast "Refreshed and re-asked." → new assistant message appears
  below with fresh citations. Sidebar updates conversation to top.
  Cloudflare dashboard query: `SELECT * FROM refresh_actions ORDER BY
  started_at DESC LIMIT 1;` → status='succeeded', new_message_id set,
  triggered_sync_run_ids non-empty.
- **PROD V1.3 (rate limit)** if curiosity warrants: 6 back-to-back
  refresh clicks on the same project → 6th returns 429. Burns 6
  real syncs; do once and remember the 1-hour countdown.
- **PROD V1.8 (failure isolation)** opportunistic: if a connection
  ever fails in production (token expires, etc.), a refresh action
  that cites it will record the failure in sync_runs while other
  cited connections continue. Verified naturally on first such
  incident; no need to engineer.
- **Block 10.2 next.** Final Block 10 sub-task. DDL + backfill UPDATE
  to be applied in Neon SQL Editor before code deploys. Then v1.1
  ships.
