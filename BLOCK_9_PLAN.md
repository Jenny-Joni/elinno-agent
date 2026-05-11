# BLOCK 9 PLAN — Polish: launch-blocking

> Drafted 2026-05-11 in plan mode. Single artifact covering five sub-tasks
> (9.1–9.5) per BUILD_PLAN v1.2 + HANDOFF 2256-2393. Companion to PRD v1.2
> §5.6/§5.8/§5.9 and the Block 6 v1.2 closeout shape. Same Phase A–E
> verification posture as `curl-matrix-block-6.md`.

| Field | Value |
|---|---|
| Block | 9 — Polish: launch-blocking |
| Branch shape | One branch per sub-task: `block-9-1-connection-ui`, `block-9-2-data-as-of`, `block-9-3-suggested-questions`, `block-9-4-nightly-cron`, `block-9-5-records-skipped` |
| Base | `main` at `a21b19b` (post Block 7+8 skip + Block 9/10 split commits) |
| Sub-task count | 5 |
| Decisions | A–U (21 locked decisions) |
| Verification cells | 36 (across 5 matrices) |
| Carve-out posture | DEFAULT for almost every code commit; AUTO for UI-only commits |

**Phase 0 prerequisite:** Confirm `origin/main` is at `a21b19b` (post
`block-9-scope-split` push of the three doc commits per HANDOFF 2286-2288).
If `origin/main` is still at `c9e240a` (pre-push state), push
`block-9-scope-split` to main first (per-push approval) before starting
any Block 9 sub-task. Every branch in this plan rebases off `a21b19b`;
starting on the wrong base means rebasing all five branches mid-flight.
This is the WORKFLOW.md line 42 "anything that contradicts the working-
tree state" item — surface and resolve before plan-approval closes.

---

## Context

Block 6 ff-merged on 2026-05-11 with Jira tools, per-mode JQL ordering, and
the `{{AVAILABLE_SOURCES}}` system-prompt slot. Production is at `c9e240a` →
post-skip commits at `a21b19b`. Blocks 7 + 8 (Monday + Drive connectors)
deferred to v1.2 per PRD §11.2. The path to a non-Jenny user runs through
Block 9 (this plan) + Block 10 (nice-to-have polish, not launch-blocking).

The five Block 9 sub-tasks address the launch-blocking gaps between "the
product works end-to-end on production for Jenny" and "someone other than
Jenny can sign up, connect Slack + Jira, and operate the product without
the developer adjacent." Specifically:

- **9.1** — Connection management UI is half-built: status pill + last-sync
  time render, disconnect works, but **the manual re-sync endpoint has no
  UI affordance** (admins discovered it by curl during Block 5/6
  verification) and **no rate-limit guard** (PRD §5.6 mandates 1/hour).
  Sync activity log has data but no surface.
- **9.2** — Citations render as chips with title/author but **no
  freshness signal** despite `source_updated_at` already flowing end-to-end
  in the citation payload (HANDOFF 1932). Pure UI surfacing patch.
- **9.3** — A fresh project page renders an empty chat input with no guide
  to what to ask. PRD §5.9 calls out suggested example questions on first
  open. Hardcoded shapes per connector; gated by which connectors are
  active.
- **9.4** — Block 6 carry-forward (HANDOFF 2174): Jira's DESC-fullSync caps
  out at the newest 500 issues; older issues only become discoverable via
  nightly incrementalSync runs. Without cron, a 10k-issue Jira project's
  older 9500 issues are unreachable until manual re-sync is clicked
  repeatedly. Slack also benefits (belt-and-suspenders for webhook misses
  — Block 5 caught one Block-4-era webhook bug at `3cdcea3`).
- **9.5** — `sync_runs.records_updated` overcounts: any ON CONFLICT path
  increments `updated`, even no-op writes. Block 5 + Block 6 both flagged
  this. `sync_runs.records_skipped` column already exists in schema
  (`db/schema-postgres.sql:414-416`); the population logic is missing.

## Goal

Ship the five launch-blocking polish items so that the product onboarding
path works for a non-Jenny user: connection management is visible and
rate-limit-guarded, every AI answer shows when each cited source was last
updated, fresh projects guide users into their first question, nightly
cron keeps data current without manual intervention, and the sync record
counts admins see in the activity log are honest.

**Done when:** Someone other than Jenny can sign up, connect Slack and
Jira, see freshness on every answer, click "Sync now" with a 1/hour
guard, see the last 50 sync runs in a drawer, get suggested questions on
first open, and have nightly sync keep their data current — all on
`elinnoagent.com`, all without the developer adjacent. Mirrors
BUILD_PLAN v1.2 Block 9's done-when (lines 156-157).

---

## Sub-task scope

| Sub-task | One-liner | Surface |
|---|---|---|
| **9.1** | Connection management UI: status, last sync, **Sync now (1/hour)**, **activity drawer**, disconnect | `public/project.html` + `functions/api/projects/[id]/connections/[connId]/sync.js` |
| **9.2** | "Data as of" timestamp per citation chip | `public/project.html` (UI only) + `functions/api/projects/[id]/conversations/[conversationId]/messages.js` (citation enrichment) |
| **9.3** | Suggested example questions on first open of a fresh conversation, gated by connected sources | `public/project.html` (UI only) |
| **9.4** | Nightly cron at 08:00 UTC running incrementalSync for both Slack + Jira | New `workers/cron-scheduler/` + new `functions/api/cron/incremental-sync.js` + new `functions/_lib/cron_auth.js` |
| **9.5** | `records_updated` overcount fix → populate `records_skipped` via WHERE-DO-UPDATE pattern; skip embed on no-op | `functions/_lib/connectors/_shared/entity_writer.js` + `functions/_lib/connectors/slack.js` + `functions/_lib/connectors/jira.js` |

---

## Locked decisions

Letters A–U; cite in commit messages as `feat(block-9-N): … per decision <letter>`.

### 9.5 — records_skipped

**A. Use the WHERE-DO-UPDATE pattern in `upsertEntityRow` to detect no-op writes.**
Modify the `ON CONFLICT DO UPDATE` clause to include a `WHERE entities.<col>
IS DISTINCT FROM EXCLUDED.<col> OR …` predicate over the nine SET columns.
When the proposed row is identical, the UPDATE is suppressed and Postgres
returns the row from RETURNING with its existing `updated_at`. Caller
detects three states via the pair `(xmax = 0, updated_at = NOW())`:

```sql
INSERT INTO entities (…) VALUES (…)
ON CONFLICT (connection_id, source_type, source_id) DO UPDATE
   SET title = EXCLUDED.title,
       content_text = EXCLUDED.content_text,
       author_external_id = EXCLUDED.author_external_id,
       author_display_name = EXCLUDED.author_display_name,
       source_created_at = EXCLUDED.source_created_at,
       source_updated_at = EXCLUDED.source_updated_at,
       metadata = EXCLUDED.metadata,
       raw = EXCLUDED.raw,
       source_url = EXCLUDED.source_url,
       updated_at = NOW()
   WHERE  entities.title              IS DISTINCT FROM EXCLUDED.title
       OR entities.content_text       IS DISTINCT FROM EXCLUDED.content_text
       OR entities.author_external_id IS DISTINCT FROM EXCLUDED.author_external_id
       OR entities.author_display_name IS DISTINCT FROM EXCLUDED.author_display_name
       OR entities.source_created_at  IS DISTINCT FROM EXCLUDED.source_created_at
       OR entities.source_updated_at  IS DISTINCT FROM EXCLUDED.source_updated_at
       OR entities.metadata           IS DISTINCT FROM EXCLUDED.metadata
       OR entities.raw                IS DISTINCT FROM EXCLUDED.raw
       OR entities.source_url         IS DISTINCT FROM EXCLUDED.source_url
RETURNING id,
          (xmax = 0)                              AS inserted,
          (xmax <> 0 AND updated_at = NOW())      AS changed
```

`upsertEntityRow` returns `{ id, inserted, changed }` (was: `{ id, inserted }`).
The `updated_at = NOW()` check is reliable because PostgreSQL's `NOW()`
returns transaction-start time, stable within a single transaction.

**B. Caller logic updates to three-branch.**
Replace `if (upsertResult.inserted) inserted++; else updated++;` in
`slack.js:574-575`, `jira.js:559-561`, `jira.js:641-643` with:

```js
if (result.inserted)     inserted++;
else if (result.changed) updated++;
else                     skipped++;
```

`SyncResult.records_skipped` already accumulated as 0 by all connectors —
just route the skip count into it. `sync_runs.records_skipped` column
already exists (no schema change).

**C. Skip the embed call on `!changed` rows.**
Inside `writeEntityWithEmbedding`: `if (upsertResult.inserted || upsertResult.changed)
await embedEntityRow(…); return upsertResult;` — skip the OpenAI subrequest
when the row is unchanged. Inside `writeEntitiesWithEmbeddingsBatch`: when
building `toEmbed`, additionally filter by `upsert.inserted || upsert.changed`.
The sweep path is untouched (calls `embedEntityRow` directly) and continues
to catch genuinely-missing embeddings on the next sync. Free perf + cost
win on idempotent re-syncs.

**Canary cells for the WHERE-DO-UPDATE + updated_at=NOW() idiom:** **both
V5-2 AND V5-3 must pass on the first run.** V5-2 alone (idempotent re-sync
produces `records_skipped > 0`) is necessary but not sufficient — the
discriminator is V5-3 (one upstream edit produces `records_updated = 1`
EXACTLY). If V5-3 returns 2+ on the first run, that's the signal the
`(xmax <> 0 AND updated_at = NOW())` predicate is false-positiving (e.g.,
another transaction's UPDATE landed on the same row in the same wall-clock
microsecond, leaving the row's existing `updated_at` coincidentally equal
to this transaction's `NOW()`). Extremely unlikely on a single-writer
sync path but the discriminator catches it.

**Fallback (documented in entity_writer.js comment block, NOT shipped
default):** If V5-3 fails the exactness check, fall back to a CTE that
explicitly captures OLD column values from a pre-INSERT subselect (with
`FOR UPDATE` to lock the row) and compares them in the RETURNING clause.
One extra SELECT round-trip, no `updated_at = NOW()` reliance. Swap in
the CTE wholesale — do not try to patch the WHERE clause in place. The
CTE sketch:

```sql
WITH existing AS (
  SELECT title, content_text, /* ... 9 columns ... */
    FROM entities
   WHERE connection_id = $1 AND source_type = $2 AND source_id = $3
   FOR UPDATE
), upserted AS (
  INSERT INTO entities (...) VALUES (...) ON CONFLICT (...) DO UPDATE SET ...
  RETURNING id, (xmax = 0) AS inserted
)
SELECT u.id, u.inserted,
       (e.title IS DISTINCT FROM /* new */ OR ...) AS changed
  FROM upserted u LEFT JOIN existing e ON TRUE
```

### 9.2 — Data-as-of timestamp

**D. Format: relative-in-chip with absolute on hover.**
Append ` · 2h ago` to each citation chip's label (current chip label is
`c.title || c.author || c.source`). The chip's `title=` attribute carries
the absolute ISO timestamp (`May 11, 14:23 UTC`). Per-source, not per-response —
a Slack chip from this morning + a Jira chip from yesterday tell a
different story than a single "oldest source" rollup. PRD §5.6 "judge
freshness at a glance" → relative parses faster than ISO.

**E. Reuse the existing `fmtRelativeShort()` helper.**
Already used at project.html:1273, 1301 for `last_sync_at`. Same helper
for citation timestamps means one source of truth for relative-time
rendering across the page.

**F. Null fallback chain: source_updated_at → connection_last_sync_at → "as of unknown".**
When `c.source_updated_at` is null, render the chip with `· as of last
sync (Xh ago)` using the connection's `last_sync_at`. When both are null,
render `· as of unknown` muted. **Never hide** — silently dropping
freshness undermines the indicator's purpose.

**G. Add `connection_last_sync_at` to the citation payload.**
The fallback in F requires `connection_last_sync_at` to ride on each
citation. The citation enrichment happens in
`functions/api/projects/[id]/conversations/[conversationId]/messages.js`'s
GET handler: when reading the persisted `citations` JSONB column, JOIN
through `entities.connection_id → connections.last_sync_at` and merge per
citation. **NEW SQL query → project-isolation neighborhood → DEFAULT mode.**
The persisted citations in `messages.citations` stay as written by Block 5's
loop.js; the enrichment is read-time, so historical messages benefit
without backfill.

### 9.3 — Suggested questions

**H. Hardcoded suggestion lists, source-gated.**
Per Jenny's selection in plan-mode AskUserQuestion: ship all four shapes.

- **Slack-only connected (2):**
  - "What's been discussed about <topic> this week?"
  - "Summarize the last 24 hours of decisions."
- **Jira-only connected (2):**
  - "How many open tickets are in the active sprint?"
  - "Which issues are blocking?"
- **Both connected (4):** all four above rendered in one rail.
  - **Block 10 candidate flagged:** if user feedback shows the "Both
    connected" rail of four feels redundant (two open-ended Slack
    shapes + two Jira shapes can read as a flat menu rather than a
    curated set), consider curating a 4-item mix that includes a
    cross-source nudge, e.g., "Which Jira issues mention this
    week's Slack discussions?" This is a v1.1 ship-as-locked decision;
    revisit only if onboarding feedback surfaces the friction.
- **Neither connected:** no suggestions; render a state-card "Connect
  Slack or Jira to start asking questions" with a link to the Connections
  tab. Avoids the empty-state with no path forward.

No channel-name / sprint-name interpolation — keeps the LLM-prompt
content static and dodges an extra API call.

**I. Click behavior: fills input, does not submit.**
PRD §5.9 calls them "suggested example questions" not "example answers."
User edits to taste (swap `<topic>`, change time window), then sends.
Auto-submit turns a nudge into accidental token spend. Click handler:
`document.getElementById('chatInput').value = chip.dataset.q;
document.getElementById('chatInput').focus();`

**J. Persistence: show only when active conversation has zero user messages.**
Check: `(messagesById[activeConvId] || []).filter(m => m.role === 'user').length === 0`.
Disappears after first send. Reappears when admin starts a new
conversation. No dismissal state.

**K. Render slot: empty-state branch in `renderChat()` / `renderMessages`,
inserted at `project.html:537` right after `list.scrollTop = list.scrollHeight`.**
`if (msgs.length === 0 && userMessagesEver(activeConvId) === 0)
{ list.innerHTML = renderSuggestionsHtml(connections); }` — replaces the
empty message list with the suggestion grid. When the user sends, the
next `renderChat()` call replaces the suggestions with the actual chat.

### 9.1 — Connection management UI

**L. Per-row "Sync now" button placement.**
Inline with the existing `Disconnect` button on each connection row at
`project.html:1149-1327`. Admin-only via the existing `me.role === 'admin'`
check that already gates `Disconnect`. Tooltip on hover; disabled state when
within 1/hour window.

**M. Server-side 1/hour rate-limit in `sync.js`.**
Insert a guard BEFORE the `INSERT INTO sync_runs` at line 113. Query:
```sql
SELECT MAX(started_at) AS last_full_sync
  FROM sync_runs
 WHERE connection_id = ${connection.id}
   AND project_id    = ${projectId}
   AND sync_mode     = 'full'
```
If `last_full_sync` is within 3600s of `NOW()`, return:
```js
return json({
  ok: false,
  error: 'Rate limit: 1 sync per hour.',
  retry_after_seconds: Math.ceil(3600 - (Date.now() - last_full_sync) / 1000),
  next_available_at: <iso>
}, { status: 429 });
```
Uses `MAX(sync_runs.started_at)` not `connections.last_sync_at` because
the latter is bumped only on non-inert success — a failed sync 5 minutes
ago should still count against the rate limit (it still hit the source
system). `sync_mode = 'full'` scopes the limit to the manual button;
cron-driven `'incremental'` syncs don't reset the clock.

**Defense in depth — keep the `project_id` filter.** `connection_id` is
a UUID and unique across projects, so technically the `project_id` filter
in the rate-limit query is belt-and-suspenders, not load-bearing. **Do
not "optimize" it away.** This is a project-isolation-neighborhood
query per WORKFLOW carve-out rules; the redundant filter is the defense-
in-depth tripwire that catches any future code path that misroutes a
`connection_id` from a different project. Same rule applies to every
other read in this file that includes a `project_id` filter alongside a
UUID lookup.

**N. Client-side button-disabled state.**
On boot, the page already calls GET `/api/projects/:id/connections` and
gets `last_sync_at`. Use that to compute the button's disabled state:
```js
const blockedUntil = connection.last_sync_at
  ? new Date(connection.last_sync_at).getTime() + 3600_000
  : 0;
const blocked = blockedUntil > Date.now();
```
Tooltip: `Next sync available in ${Math.ceil((blockedUntil - Date.now()) / 60000)}m`.
**Caveat:** client uses `last_sync_at` (which doesn't bump on failure)
while server uses `MAX(started_at)` (which does). Client may show
"available" when server returns 429 — surface as a toast. Trade-off
accepted: client doesn't have access to all sync_runs without an extra
query at boot.

**O. Activity drawer, admin-only.**
Add a "View activity" link/button next to each connection row. Click
toggles a collapsible drawer that fetches GET
`/api/projects/:id/connections/:connId/sync-runs` (endpoint already
exists at `sync-runs.js:31-91`) and renders a 50-row table:

| Column | Source |
|---|---|
| When | `fmtRelativeShort(started_at)`, tooltip absolute |
| Status | Pill: `succeeded` (green) / `failed` (red) / `running` (yellow, pulsing) / `cancelled` (gray) |
| Mode | `full` / `incremental` / `webhook` |
| Duration | `finished_at - started_at` formatted as `Xs` or `Xm Ys`; "—" if still running |
| Inserted / Updated / Skipped | The three counts as one line: `+12 / ~3 / ⊘0` |
| Error | If status=failed, italic + red, truncate >120 chars with ellipsis |

UI gates to admin even though endpoint is member-accessible. Tighter
endpoint gate is a Block 10 cleanup, not 9.1's surface.

**P. Disconnect placement unchanged.**
Already rightmost in `connection-actions`. Sanity-check `aria-label` is
present; add `aria-label="Disconnect Slack"` / `"Disconnect Jira"` if
missing.

### 9.4 — Nightly cron

**Q. Architecture: separate Worker shim + HMAC-signed POST to Pages
endpoint** (per Jenny's selection).

New top-level `workers/cron-scheduler/` (sibling to `functions/`, NOT
under it — Pages doesn't deploy this path). The Worker holds zero
user data, only the `CRON_SECRET`; the Pages-side endpoint is the trust
boundary. Connector code stays single-source-of-truth in Pages.

**R. Auth: HMAC-SHA256 over `timestamp + ":" + sha256(body)`, ±5-minute replay window.**
Header: `X-Cron-Auth: t=<unix_ts>,v1=<hex>`. Pages handler:
1. Parse `t` and `v1` from header.
2. Reject if `|now - t| > 300`.
3. Compute expected `v1` over `t + ":" + sha256(body)`.
4. **Constant-time compare** against received `v1`. Use a vetted helper
   — Workers' `crypto.subtle.timingSafeEqual` if available, else a known-
   good constant-time hex comparison. **Do not roll a hand-written
   comparison loop** (timing-attack surface). The `cron_auth.js` jsdoc
   names the chosen helper so a reviewer can verify at a glance.

Both sender (cron Worker) and verifier (Pages) must call
`JSON.stringify(obj)` with **no second arg** (canonical compact form) so
the hashed body bytes match. Encode this rule in `cron_auth.js` jsdoc.

Rotation: generate new secret, set on Pages first, within 5 minutes set
on cron Worker — the 5-minute replay window IS the rotation grace.
Single-fire failure during a botched rotation is recoverable (one missed
nightly sync; next night succeeds).

**S. Endpoint: `POST /api/cron/incremental-sync` at `functions/api/cron/incremental-sync.js`.**
Body: `{ "sources": ["jira" | "slack"], "dry_run": boolean }`. Handler:
1. Verify HMAC via new `_lib/cron_auth.js` helper.
2. Enumerate `connections WHERE deleted_at IS NULL AND status = 'active'
   AND source = ANY($1::text[])`.
3. For each connection: try/catch around `connector.incrementalSync(ctx,
   connection)`. Write a `sync_runs` row (mode='incremental') in 'running'
   state up-front; UPDATE to succeeded/failed at the end of each iteration.
4. Bump `connections.last_sync_at` on non-inert success (same contract as
   `sync.js:183-191`).
5. Return `{ ran: N, succeeded: N, failed: N, runs: [<sync_run_ids>] }`.

NO `requireProjectRole`; this endpoint is the cron auth boundary, not the
session auth boundary.

**Top-of-file SECURITY-CARVE-OUT comment is mandatory.** The enumeration
query in step 2 has **no `project_id` filter by design** — cron sees
every project's connections. This is the inverse case of the project-
isolation neighborhood: rather than scope-by-project, the file
deliberately scopes-by-nothing. Per WORKFLOW.md line 244, every file in
a carve-out neighborhood carries a top-of-file header. For this file the
header reads exactly:

```js
// SECURITY-CARVE-OUT: do not edit in auto mode
// This endpoint DELIBERATELY enumerates connections across all
// projects. Project-isolation enforcement is shifted from the SQL
// WHERE clause to the cron-auth boundary (HMAC + replay window).
// Any change to this file's auth check or enumeration scope is a
// re-lock trigger.
```

**T. Schedule: `0 8 * * *` UTC (08:00 UTC, ~04:00 ET / 01:00 PT —
off-peak for both US user timezones), both Slack + Jira.**

To stay under Workers' 30s CPU budget per invocation, the cron Worker
sends **two POSTs to Pages in parallel** — one with `{"sources":["jira"]}`,
one with `{"sources":["slack"]}` — each its own Pages invocation with
its own 30s budget.

**POSTs issued in parallel via `Promise.allSettled([postJira, postSlack])`
so the cron Worker's own 30s budget covers the slower of the two, not
the sum.** Sequential `await postJira; await postSlack;` would let
a 28s Jira POST leave only ~2s for the Slack POST before the cron Worker
itself times out. `Promise.allSettled` (not `Promise.all`) so one POST
failing doesn't reject the other's result.

If a connections table grows to many active rows per source such that
30s per source still isn't enough, fan out further (per-connection POSTs)
— deferred to Block 10.x or post-v1.1 per §Risks. Implement parallel
per-source fan-out as the Worker's default behavior from day one.

**U. Per-connection failure isolation.**
One connection's `incrementalSync` failing writes its `sync_runs` row
with `status='failed'` and the loop continues to the next connection.
No global abort. Captured failure detail goes into `sync_runs.error`
(verbatim message, same contract as `sync.js:134-148`).

---

## File-level change list

The scope contract per WORKFLOW.md §"Scope expansion during execute" —
any file edit outside this list stops execute and surfaces.

### Branch `block-9-5-records-skipped`

- **`functions/_lib/connectors/_shared/entity_writer.js`** *(modified, DEFAULT)*
  - Update `upsertEntityRow` SQL per decision A (add `WHERE` clause to DO
    UPDATE, return `(xmax = 0) AS inserted, (xmax <> 0 AND updated_at = NOW())
    AS changed`).
  - Return shape change to `{ id, inserted, changed }`. Update jsdoc.
  - In `writeEntityWithEmbedding`: gate embed on `inserted || changed`
    per decision C.
  - In `writeEntitiesWithEmbeddingsBatch`: filter `toEmbed` by `inserted
    || changed`.
  - Add a docblock paragraph naming the fallback CTE pattern (decision A
    notes) — text-only, not the active code.
- **`functions/_lib/connectors/slack.js`** *(modified, DEFAULT)*
  - Three-branch counter logic at lines 567-576 per decision B.
- **`functions/_lib/connectors/jira.js`** *(modified, DEFAULT)*
  - Three-branch counter logic at lines 559-561 and 641-643 per decision B.

### Branch `block-9-2-data-as-of`

- **`functions/api/projects/[id]/conversations/[conversationId]/messages.js`** *(modified, DEFAULT)*
  - Enrich the GET response's `citations` with `connection_last_sync_at`
    per decision G. Adds a JOIN through `entities → connections` scoped
    to `project_id` (project-isolation neighborhood = DEFAULT).
- **`public/project.html`** *(modified, AUTO)*
  - Extend `renderCitationRailHtml()` at lines 570-581: append `· <relative>`
    to each chip label with fallback chain per decisions D + F. Tooltip
    via `title=` attribute (decision D).
- **`public/auth.css`** *(modified, AUTO)*
  - Minor: `.citation-chip-time` muted text style (no new component, just
    a span class).

### Branch `block-9-3-suggested-questions`

- **`public/project.html`** *(modified, AUTO)*
  - Add `renderSuggestionsHtml(connections)` returning the gated grid
    HTML per decision H.
  - Empty-state branch in `renderChat()` / `renderMessages()` at
    project.html:525-538 per decision K.
  - Click handler per decision I: fills `#chatInput`, focuses input,
    does NOT auto-send.
- **`public/auth.css`** *(modified, AUTO)*
  - `.suggestion-grid`, `.suggestion-card`, `.suggestion-card-empty`
    styles.

### Branch `block-9-1-connection-ui`

- **`functions/api/projects/[id]/connections/[connId]/sync.js`** *(modified, DEFAULT)*
  - Insert 1/hour rate-limit guard before the `INSERT INTO sync_runs` at
    line 113 per decision M. Returns 429 with `retry_after_seconds`.
- **`public/project.html`** *(modified, AUTO)*
  - Add "Sync now" button to each connection row (Slack + Jira sections)
    per decision L. Admin-only via existing `me.role === 'admin'` gate
    pattern.
  - Add "View activity" link/button per decision O. Wire
    `renderSyncActivityDrawer(connId)` + `loadSyncRuns(connId)` per
    decision O.
  - Client-side disabled state with tooltip per decision N.
  - Client-side toast for 429 per decision M.
  - Optional `aria-label` additions on Disconnect button per decision P.
- **`public/auth.css`** *(modified, AUTO)*
  - `.sync-activity-drawer`, `.sync-run-row`, `.sync-pill-{succeeded,failed,running,cancelled}` styles.
  - `.connection-row-actions button.sync-now[disabled]` styles.

### Branch `block-9-4-nightly-cron`

- **`workers/cron-scheduler/wrangler.toml`** *(new, AUTO)*
  ```toml
  name = "elinno-agent-cron-scheduler"
  main = "src/index.js"
  compatibility_date = "2026-04-21"

  [triggers]
  crons = ["0 8 * * *"]

  [vars]
  PAGES_BASE_URL = "https://elinnoagent.com"
  CRON_SOURCES_FAN_OUT = "jira,slack"
  # CRON_SECRET set via `wrangler secret put CRON_SECRET`
  ```
- **`workers/cron-scheduler/src/index.js`** *(new, DEFAULT)*
  - ~60 lines. Single `scheduled(event, env, ctx)` export. For each
    source in `CRON_SOURCES_FAN_OUT` (split by comma): build body, compute
    HMAC (decision R) over `timestamp + ":" + sha256(body)`, POST to
    `${PAGES_BASE_URL}/api/cron/incremental-sync` with `X-Cron-Auth`
    header, log result as JSON. SECURITY-CARVE-OUT header comment.
- **`workers/cron-scheduler/package.json`** *(new, AUTO)*
  - Minimal stub: `{"name": "elinno-agent-cron-scheduler", "private": true}`.
- **`workers/cron-scheduler/README.md`** *(new, AUTO)*
  - Deployment story (`wrangler deploy` from this subdir), secret
    rotation steps per decision R, local-test command
    (`wrangler dev --test-scheduled`).
- **`functions/_lib/cron_auth.js`** *(new, DEFAULT)*
  - `verifyCronAuth(request, env)` — pure HMAC + replay-window check per
    decision R. Returns `{ ok, reason }`. SECURITY-CARVE-OUT header.
- **`functions/api/cron/incremental-sync.js`** *(new, DEFAULT)*
  - Per decision S. Imports `getConnector` from
    `_lib/connectors/registry.js`, `verifyCronAuth` from `_lib/cron_auth.js`.
    No `requireProjectRole` (cron auth boundary).
- **`wrangler.toml`** *(Pages root, modified, AUTO)*
  - Comment block update naming `CRON_SECRET` as a secret. No active
    config change — secret is set via `wrangler pages secret put`.

---

## Verification matrix

36 cells total, 5 sub-matrices. Each cell has a one-line "expect"
criterion. Per WORKFLOW §"Mockup and preview review": Claude runs the
matrix automatically AND surfaces the preview URL for Jenny's manual
eyeball before each push-to-main request.

### 9.5 verification (8 cells)

| # | Cell | Expect |
|---|---|---|
| V5-1 | Fresh import on never-synced Jira connection | `records_inserted > 0`, `records_updated = 0`, `records_skipped = 0` in the sync_runs row |
| V5-2 | Idempotent re-sync immediately after V5-1 (no upstream changes) | `records_inserted = 0`, `records_updated = 0`, `records_skipped > 0` and = entity count returned by source page |
| V5-3 | Upstream-edit one Jira issue, re-sync | `records_skipped = N-1`, `records_updated = 1`, `records_inserted = 0` |
| V5-4 | Embed call count drops on idempotent re-sync | Add temporary log counter in `embedTextsBatch`; expect 0 batch-embed calls on V5-2 re-run |
| V5-5 | Slack message_changed webhook idempotency | Re-process the same `message_changed` event (push twice in dev): first time updated++, second time skipped++ |
| V5-6 | Sweep still catches missing embeddings on `!changed` rows | Delete one `entity_embeddings` row for a row that returns `skipped`; trigger sweep; embed re-created |
| V5-7 | Per-action self-review confirms WHERE-clause SQL safety | Inspect the modified SQL in entity_writer.js; verify `IS DISTINCT FROM` correctly handles NULLs in source_updated_at / author / etc |
| V5-8 | Existing Block 5 + 6 verification cells still PASS-runtime | Re-run the 27-cell Block 6 matrix locally — counts should differ in distribution but sums match |

### 9.2 verification (6 cells)

| # | Cell | Expect |
|---|---|---|
| V2-1 | Assistant message with Slack citation (recent message) | Chip label shows `<title> · 2h ago`, hover reveals `May 11, 14:23 UTC` |
| V2-2 | Assistant message with Jira citation (recent update) | Chip label shows `<title> · Yd ago`, hover reveals absolute ts |
| V2-3 | Citation where source_updated_at is null but connection has last_sync_at | Chip shows `<title> · as of last sync (Nh ago)` |
| V2-4 | Citation where both are null | Chip shows `<title> · as of unknown` (muted gray text) |
| V2-5 | GET messages returns citations with connection_last_sync_at | curl GET /messages; jq citations array; each citation has `connection_last_sync_at` (string or null) |
| V2-6 | Cross-project SQL probe of citation enrichment | EXPLAIN ANALYZE the new JOIN; confirm `project_id = $X` filter appears at the **entities OR connections** level (or both — defense in depth). **AND**: synthetic test — manually update one entity's `connection_id` to point at a different project's connection row (in a scratch Neon branch), call GET /messages, assert the enrichment does NOT return a `connection_last_sync_at` from that cross-project connection. The carve-out neighborhood earns the paranoid cell. |

### 9.3 verification (6 cells)

| # | Cell | Expect |
|---|---|---|
| V3-1 | Open fresh project, Slack only connected | 2 Slack-shape chips render in empty chat list |
| V3-2 | Open fresh project, Jira only connected | 2 Jira-shape chips render |
| V3-3 | Open fresh project, both connected | All 4 chips render |
| V3-4 | Open fresh project, 0 connections | "Connect Slack or Jira" state-card with link to Connections tab |
| V3-5 | Click suggestion chip | Fills `#chatInput`, focus moves to input, does NOT auto-send |
| V3-6 | Send first message | Suggestions hide; do not reappear on scroll or until "New conversation" |

### 9.1 verification (10 cells)

| # | Cell | Expect |
|---|---|---|
| V1-1 | curl POST /sync as admin on connection synced 30min ago | 429, `retry_after_seconds ≈ 1800`, no new sync_runs row |
| V1-2 | curl POST /sync as admin on connection synced 61min ago | 200, sync_run row inserted, response shape unchanged from pre-9.1 |
| V1-3 | curl POST /sync where last `sync_run.status='failed'` 5min ago | 429 (rate-limit blocks even on failure) |
| V1-4 | curl POST /sync as member | 403 (admin-only unchanged) |
| V1-5 | curl POST /sync on connection from different project | 404 (project-isolation unchanged) |
| V1-6 | curl GET /sync-runs as member | 200, list ≤50 runs, no `detail` field |
| V1-7 | UI: admin sees "Sync now" button on each connection row | Button rendered for admin, member does not see it |
| V1-8 | UI: button disabled within 1h | `disabled=true`, tooltip "Next sync in Nm" |
| V1-9 | UI: "View activity" drawer opens, shows last 50 runs | Drawer renders sorted desc; duration computed; failed-status error string shown italic+red; **>120-char error strings truncated with ellipsis** per decision O — confirm with a deliberately-long synthetic error message (manual sync_runs row insert) |
| V1-10 | UI: clicking Sync now within 1h window (client-side toggle dodge) | Server returns 429; toast surfaces "Rate limit: next sync in Nm" |

### 9.4 verification (6 cells)

| # | Cell | Expect |
|---|---|---|
| V4-1 | Cron handler fires on schedule | `cd workers/cron-scheduler && wrangler dev --test-scheduled`; hit `http://localhost:8787/__scheduled?cron=0+8+*+*+*`; 200 from Pages, log line in Worker output |
| V4-2 | HMAC rejects bad signature | curl `/api/cron/incremental-sync` directly with `X-Cron-Auth: t=<now>,v1=deadbeef`; expect 401 |
| V4-3 | HMAC rejects stale timestamp | curl with valid signature but `t=<now-600>`; expect 401 (>5 min window) |
| V4-4 | Per-connection sync_run row written | After scheduled fire with 2 Jira + 1 Slack active: `SELECT COUNT(*) FROM sync_runs WHERE sync_mode='incremental' AND started_at > NOW() - INTERVAL '5 min'` returns 3 |
| V4-5 | One connection failure does not block others | Revoke one Jira token (rotate creds in Atlassian); trigger cron; verify bad connection has status='failed' and others succeed |
| V4-6 | `connections.last_sync_at` advances only on success + non-inert | **Wait for the longest-expected incrementalSync to complete** (≤30s per source, so wait ~35-40s post-fire to be safe; or poll `sync_runs.status` until all rows for this fire are non-`'running'`) before snapshotting. Then: failed connection's last_sync_at unchanged; succeeded connections within last minute; Slack with `selected_channel_id IS NULL` not bumped. Without the wait, the check races the still-running syncs. |

---

## Per-commit mode classification

Per WORKFLOW.md §"Carve-out neighborhoods" — freshness-layer + project-
isolation neighborhoods get **DEFAULT mode (no auto)**. The plan top-line
for each branch's lead commit:

| Branch | Lead commit | Mode | Why |
|---|---|---|---|
| `block-9-5-records-skipped` | SQL + return-shape change in `_shared/entity_writer.js` | **DEFAULT** | SECURITY-CARVE-OUT file, embed-on-write path |
| `block-9-5-records-skipped` | Three-branch counters in slack.js + jira.js | **DEFAULT** | Freshness-layer (sync_run record counts shape the freshness display) |
| `block-9-2-data-as-of` | Citation enrichment in messages.js | **DEFAULT** | New WHERE project_id query; project-isolation neighborhood |
| `block-9-2-data-as-of` | UI render in project.html + auth.css | AUTO | UI-only on existing payload + new field |
| `block-9-3-suggested-questions` | All commits | AUTO | UI-only, reads connections array already in scope |
| `block-9-1-connection-ui` | 1/hour rate-limit in sync.js | **DEFAULT** | Reads sync_runs WHERE project_id; project-isolation + freshness-layer |
| `block-9-1-connection-ui` | Sync-now button + activity drawer + CSS | AUTO | UI-only, reads existing endpoints |
| `block-9-4-nightly-cron` | `_lib/cron_auth.js` | **DEFAULT** | New auth surface, carve-out by inception |
| `block-9-4-nightly-cron` | `/api/cron/incremental-sync` | **DEFAULT** | Writes sync_runs + bumps connections.last_sync_at; enumerates connections across all projects (project-isolation carve-out — inverse case: no `project_id` filter applies because cron sees everything) |
| `block-9-4-nightly-cron` | `workers/cron-scheduler/src/index.js` | **DEFAULT** | New deploy artifact; security-adjacent (handles CRON_SECRET) — initial commit DEFAULT, follow-up shim tweaks may switch to AUTO |
| `block-9-4-nightly-cron` | wrangler.toml comment update | AUTO | Comment-only |
| Any | Per-branch closeout commit (curl matrix + HANDOFF addendum) | AUTO | Doc-only |

Plan top-line per branch:
- `block-9-5`: `Execute mode: DEFAULT (security carve-out)`
- `block-9-2`: `Execute mode: MIXED — DEFAULT for messages.js, AUTO for UI`
- `block-9-3`: `Execute mode: AUTO`
- `block-9-1`: `Execute mode: MIXED — DEFAULT for sync.js, AUTO for UI`
- `block-9-4`: `Execute mode: DEFAULT (security carve-out, new deploy artifact)`

---

## Sequencing

Per Jenny's selection: **9.5 → 9.2 → 9.3 → 9.1 → 9.4**.

| Order | Branch | Why this slot |
|---|---|---|
| 1 | `block-9-5-records-skipped` | Smallest surface, ~3 files modified, zero new files. SQL idiom is the riskiest claim — verify cell V5-2 produces non-zero `records_skipped` early so the WHERE-DO-UPDATE pattern proves out before any other work depends on it. Also: shipping 9.5 first makes 9.4's observability honest — cron output will show `records_skipped > 0` after the first nightly fire, the meaningful signal that incremental work is happening. |
| 2 | `block-9-2-data-as-of` | One DEFAULT-mode commit (messages.js enrichment) + one AUTO-mode commit (UI). Smallest UI surface in the run. Makes citation chips meaningful — sets up the freshness signal users need before 9.1's "Sync now" button has visible payoff. |
| 3 | `block-9-3-suggested-questions` | Pure AUTO, no carve-out. Touches only `renderMessages()`'s empty-state branch + a new helper. Zero overlap with 9.2's citation render (different functions in project.html). Unblocks the "non-Jenny user opens a fresh project" path. |
| 4 | `block-9-1-connection-ui` | Largest surface in run (server rate-limit + admin button + activity drawer + CSS). One DEFAULT-mode commit (sync.js) + multiple AUTO commits. By this point 9.2/9.3 have hardened project.html so any regressions surface clearly against the activity-drawer changes. |
| 5 | `block-9-4-nightly-cron` | New deploy artifact + new HMAC auth surface. Heaviest carve-out treatment. Lands last so the underlying data layer (9.5's accurate counts) and surface layer (9.1's activity drawer) are in place to verify the cron is doing meaningful work. |

All five branches base off `main`, ff-merged in order. Branches do NOT
rebase onto each other — each is a standalone fast-forward from the
post-merge tip of the previous one. WORKFLOW §"Doc-only commits" applies:
each branch's HANDOFF closeout + curl matrix commit is doc-only,
separate from the code commits.

Within each branch, the standard WORKFLOW shape applies:
- Branch off post-previous-merge main
- Lock plan (this doc) is the design; no per-branch BLOCK_N_SUBTASK_PLAN.md
- Mode posture per the classification table above
- Verification matrix above is the curl matrix; record results in
  `curl-matrix-block-9-N.md` per Block 6 precedent
- HANDOFF addendum after ff-merge

---

## Out of scope

Belongs to Block 10 (nice-to-have polish, BUILD_PLAN v1.2 §Block 10) or
later:

- **Member "refresh and ask again" action** on each AI response (PRD §5.6;
  Block 10.1).
- **Per-project AI cost cap** with admin notification (Block 10.2).
- **Daily message limits per project** (Block 10.3).
- **"How to add a new connector" guide** (Block 10.4).
- **Sweep-path batching** — extending `writeEntitiesWithEmbeddingsBatch`
  to the embedding-sweep path (Block 10.5).
- **Tool-call trace viewer** — surfacing per-tool errors as `tool_result`
  payloads (Block 10.6).

Other deferrals:

- **Block 5 b1 fixture re-run** (S11/S23 ≥100-entity probe) — separate
  between-blocks task per HANDOFF 1898-1902. Not folded into Block 9
  because the AI fixture work is orthogonal to the polish surface.
- **Tightening `sync-runs` endpoint to admin-only.** Endpoint is
  currently member-accessible; Block 9.1's UI gate is admin-only.
  Tightening the endpoint is a Block 10 cleanup (breaking-change risk
  too high for launch-blocking).
- **15-min Jira incremental cron** (PRD §5.3). v1.1 ships nightly only;
  15-min is a Block 10.x or post-v1.1 add.
- **`connections.next_sync_at` filtering** — column exists, not used. The
  nightly cron runs everything in scope. Filtering by `next_sync_at` is
  the upgrade path for variable per-connector cadences (post-v1.1).
- **WORKFLOW addendum rework queue.** Block 9 surfaces enough new
  WORKFLOW candidates to warrant a separate addendum-rework session
  (already deferred per HANDOFF 2017-2041). Capture findings in HANDOFF
  closeouts, not in WORKFLOW edits during Block 9.
- **No backfill of existing embeddings.** Decision C (skip embed on
  `!changed`) is **forward-only**. Embeddings written before 9.5 lands
  were generated via the old `inserted || updated` path — they remain in
  place, unchanged, and the sweep continues to repair genuinely-missing
  rows as designed. No corrective backfill pass is in scope; no Block 9
  sub-task re-validates pre-9.5 embeddings.

---

## Uncertainty list

Per WORKFLOW.md §Phase 1: "Explicit uncertainty list — 'I'm guessing at
X, please confirm or correct in your review.'"

1. **xmax semantics on Neon's Postgres major version.** Decision A's
   `(xmax = 0)` + `(xmax <> 0 AND updated_at = NOW())` pair is documented
   as load-bearing. On stock Postgres 15+, this works; Neon runs current
   majors but their fork may have subtle differences. **Canary pair is
   V5-2 AND V5-3**, per decision A's strengthened fallback contract.
   V5-2 (idempotent re-sync → `records_skipped > 0`) is necessary but not
   sufficient; **V5-3 (one upstream edit → `records_updated = 1` exactly)
   is the discriminator**. If V5-3 returns 2+, the `updated_at = NOW()`
   comparison is false-positiving — swap to the CTE fallback wholesale,
   do not patch the WHERE clause in place.
2. **`updated_at = NOW()` comparison stability.** Postgres `NOW()` returns
   transaction-start time, stable within a transaction. The RETURNING
   clause evaluates after the SET, so the comparison should be exact.
   But if `updated_at` is stored at lower precision than `NOW()` (e.g.,
   `TIMESTAMP(0)` vs. `TIMESTAMPTZ`), the comparison may fail. **The
   schema at `entities.updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   (assumed; verify in `db/schema-postgres.sql`)** should match `NOW()`'s
   precision. Confirm before locking.
3. **Citation enrichment query cost.** Decision G adds a JOIN to the GET
   messages handler. For a conversation with N messages and M citations
   per message, this adds M lookups. Current Block 5/6 message counts
   are small (Jenny's project ≤100 messages); production cost should be
   negligible. If it surfaces as a latency issue, fall back to enriching
   only the most recent assistant message and skipping older ones.
4. **`wrangler.toml` two-config split.** `/wrangler.toml` (Pages) and
   `/workers/cron-scheduler/wrangler.toml` (cron Worker). Pages build
   reads `pages_build_output_dir = "public"` and doesn't deploy `workers/`.
   Cron Worker deploys separately via `wrangler deploy` from its subdir.
   **Risk:** future-Jenny runs `wrangler deploy` from repo root and is
   confused which config wins. README in `/workers/cron-scheduler/`
   states the two-deploy model; flag for first-day post-9.4 sanity check.
5. **HMAC body normalization.** See decision R — canonical
   `JSON.stringify(obj)` (no second arg) on both sender + verifier;
   encoded in `cron_auth.js` jsdoc. Listed here only as a defense-in-depth
   reminder; the rule is load-bearing and lives in decision R.

---

## Risks

Risk-specific to each sub-task, lightweight (the bigger risks are
captured in §Uncertainty above).

### 9.1
- **Client-side disabled-state false positive on failed sync.** Client
  uses `connections.last_sync_at` (bumps only on success); server uses
  `MAX(sync_runs.started_at)` for `sync_mode='full'` (counts failures).
  Mitigation: server-side 429 is authoritative; client surfaces a toast
  per cell V1-10.
- **Activity drawer fetch on every "View activity" click.** No client-
  side cache. For a heavily-clicked drawer this hits the endpoint
  redundantly. Block 10 candidate if it surfaces; v1.1 accepted.

### 9.2
- **Persisted historical citations don't have `connection_last_sync_at`.**
  Block 5's loop.js writes citations to `messages.citations` without
  that field. Decision G's read-time enrichment back-fills it. Risk:
  if `connections.last_sync_at` has been NULLed by some path (none
  known in current code, but possible in future), the fallback chain
  D→F→"as of unknown" handles it.

### 9.3
- **Hardcoded phrasings drift from PRD vocabulary.** If PRD §5.9's
  example wording changes, the strings here drift. v1.1: 4 strings,
  acceptable. If Block 10 introduces a config-driven suggestion list,
  refactor then.

### 9.4
- **`CRON_SECRET` rotation lag.** If step "set on cron Worker" lags
  more than 5 minutes after "set on Pages," one cron fire fails.
  Recoverable (V4-5 confirms single-fire failure doesn't cascade).
- **Per-source 30s budget.** If Jira's active-connections count grows
  past what `incrementalSync` can complete in 30s, one fan-out POST
  exceeds budget. Mitigation: the cron Worker can be extended to issue
  per-connection POSTs (further fan-out). Block 9.4 ships per-source
  fan-out (two POSTs); per-connection fan-out is a Block 10.x or
  post-v1.1 if needed.

### 9.5
- **WHERE-clause column drift.** If a future migration adds a column to
  `entities` (e.g., `chunk_count`) and the connector's content also
  changes it, the WHERE clause in decision A becomes incomplete and the
  upsert misclassifies real updates as skipped. Mitigation: add a
  jsdoc reminder + a `TODO: when adding columns to entities, update
  the IS DISTINCT FROM list here` comment in entity_writer.js.

---

## Phase-1 exploration log (reference)

Three Explore agents (parallel) mapped:
- Connection UI + manual re-sync surface (9.1 surface).
- Citation freshness + suggested questions surface (9.2 + 9.3).
- Sync orchestration + records_updated surface (9.4 + 9.5).

Critical findings:
- `sync_runs.records_skipped` column already exists (free win for 9.5).
- `source_updated_at` already flows end-to-end through citation payload
  (free win for 9.2 — surfacing only).
- Cloudflare Pages does NOT support Cron Triggers natively (forces 9.4's
  separate-Worker architecture).
- Existing endpoints: GET/POST/DELETE/PATCH connections; POST sync
  (admin-only fullSync); GET sync-runs (member-accessible).
- `_shared/entity_writer.js` already has the embed-on-write helper
  (Block 6's decision M) and the batched variant (Block 6 commit 1d84cf7).

## Phase-2 design log (reference)

Two Plan agents (parallel):
- UI/admin polish (9.1 + 9.2 + 9.3): recommendations on sync-now button
  placement, activity-drawer shape, citation chip format, suggestion
  rendering, source gating.
- Sync-infra polish (9.4 + 9.5): Option C cron architecture, HMAC auth
  shape, exact WHERE-DO-UPDATE SQL fragment, embed-skip on `!changed`.

All recommendations folded into the locked decisions A–U above per
Jenny's plan-mode AskUserQuestion answers (sequencing 9.5→9.2→9.3→9.1→9.4;
Option C cron arch; all 4 suggestion shapes; 08:00 UTC both sources).

---

*End of BLOCK 9 plan draft.*
