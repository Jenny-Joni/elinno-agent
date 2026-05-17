# How to add a new connector

This guide is the operational reference for building a new Elinno Agent
connector. Audience: future Jenny + Claude in v1.2 Monday + Drive
sessions; secondary, any future contributor. Every reference here
points at real code in the repo so the guide stays grounded; when the
code moves, the guide moves with it (see [§13 Checklist](#13-checklist)
for the maintenance contract).

The reference connectors:
- `dummy` — minimal scaffold ([functions/_lib/connectors/dummy.js](../functions/_lib/connectors/dummy.js))
- `slack` — OAuth + webhooks ([functions/_lib/connectors/slack.js](../functions/_lib/connectors/slack.js))
- `jira` — API token + paginated REST + no webhooks ([functions/_lib/connectors/jira.js](../functions/_lib/connectors/jira.js))

When a section below says "see Slack" or "see Jira," open those files
and read the matching surface there. The interface contract is small;
the connector-specific code does most of the work.

---

## 1. Connector interface contract

Every connector is a JS object implementing the `Connector` typedef in
[functions/_lib/connectors/types.js](../functions/_lib/connectors/types.js):

| Method | Required? | Purpose |
|---|---|---|
| `getMetadata()` | Yes | Static `{ source, displayName, authKind, description? }`. Drives the Connections-tab picker. No `ctx` (decision H exception). |
| `startAuth(ctx)` | Yes | OAuth: returns `{ authUrl, state }`. Token: returns `{ credentials: {...} }` immediately. |
| `completeAuth(ctx, params)` | Yes | OAuth: exchanges code for tokens. Token: accepts the token from the admin and returns `{ credentials, accountInfo }`. |
| `refreshAuth(ctx, credentials)` | Yes | OAuth with refresh tokens: refreshes. No-op for non-refreshing auths (Slack long-lived xoxb, Jira API token). |
| `testConnection(ctx, connection)` | Yes | Round-trip the credentials against the source. Decrypts internally. |
| `fullSync(ctx, connection)` | Yes | Backfill. Returns `SyncResult { records_inserted, records_updated, records_skipped, cursor_after?, detail? }`. |
| `incrementalSync(ctx, connection)` | Yes | Catch-up from `connection.last_sync_cursor`. Same return shape. |
| `handleWebhook(ctx, request)` | Optional | Real-time push. Slack only in v1.1. Returns a Response. |

Key constraints (read the typedef header for the full version):
- **Ctx-first** ([types.js:35-48](../functions/_lib/connectors/types.js)).
  Every method except `getMetadata` takes `ctx = { env, request, sql,
  projectId, connectionId? }` first.
- **Ctx is IDs-only** ([types.js:27-33](../functions/_lib/connectors/types.js)).
  No user or project objects. If you need a name later, add the
  specific field then with a reason.
- **Connectors decrypt internally** ([types.js:13-25](../functions/_lib/connectors/types.js)).
  The handler hands you the full `connections` row including the
  encrypted-credential triple. Call `decrypt(env, connection,
  aadFor(connection))` yourself. The API handler never sees plaintext
  credentials.
- **No `sql.end()`**. The handler opens and closes the postgres
  client. The connector must not.

### Pluggable through `registry.js`

Connectors are registered in [registry.js:25-31](../functions/_lib/connectors/registry.js):

```js
const connectors = { dummy, slack, jira };
```

Adding a new connector = three lines: import + entry + the new `source`
value in the schema CHECK constraint (already done for `monday` +
`drive` in [db/schema-postgres.sql](../db/schema-postgres.sql)).

---

## 2. OAuth callback pattern (reference: Slack + Jira)

Two complete reference flows live in the codebase. Pick the one that
matches your source.

### OAuth with a long-lived token (Slack)

Slack's bot tokens (`xoxb-…`) don't expire. The OAuth flow is one
round-trip; no refresh logic needed. See [slack.js](../functions/_lib/connectors/slack.js)
for the full implementation.

Shape:
1. `startAuth(ctx)` builds the consent URL and returns `{ authUrl,
   state }`. The handler persists the anti-CSRF state in
   `pending_oauth_state` ([db/migrations/2026-05-04-pending-oauth-state.sql](../db/migrations/2026-05-04-pending-oauth-state.sql))
   and redirects to `authUrl`.
2. The admin clicks "Allow." Slack redirects back to your registered
   callback URL with `?code=...&state=...`.
3. `completeAuth(ctx, { code })` calls `oauth.v2.access`, gets the
   `access_token` (bot token) + `team` info, returns `{ credentials:
   { access_token }, accountInfo: { id: team.id, displayName:
   team.name } }`.
4. Handler encrypts `credentials` via [crypto.js:178](../functions/_lib/crypto.js)
   `encrypt()` and INSERTs the connections row.
5. `refreshAuth` is a no-op for long-lived tokens.

**Scope discipline.** Request the smallest set you actually need.
Slack's locked scopes (Block 4 decision B-revised): `channels:read`,
`channels:history`, `users:read`. User scopes: NONE.

### Token-based auth (Jira)

Jira's API tokens are stable and don't expire (Atlassian rotates them
manually). No browser dance — admin pastes the token into the UI. See
[jira.js](../functions/_lib/connectors/jira.js).

Shape:
1. `startAuth(ctx)` returns `{ credentials: {} }` immediately (no URL
   to redirect to).
2. UI shows a form asking for email + API token + site URL.
3. `completeAuth(ctx, { email, apiToken, siteUrl })` round-trips
   `/myself` to validate, returns `{ credentials: { email, apiToken,
   siteUrl }, accountInfo: { id: account_id, displayName } }`.
4. Encrypt + INSERT same as OAuth.
5. `refreshAuth` is a no-op.

**Don't store the same credential in two places.** `siteUrl` is part
of credentials (it's needed to construct API calls) — not part of
`credential_metadata`. The general rule: anything required to make a
request is a credential, even if it isn't itself a secret.

---

## 3. Webhook handler pattern (reference: Slack Events API)

`handleWebhook(ctx, request)` is optional. Slack uses it for real-
time message ingestion via the Events API; Jira doesn't (the Cloud
permissions model doesn't let API-token connectors register webhooks
programmatically — see [jira.js:67-72](../functions/_lib/connectors/jira.js)).

Slack's pattern (read [slack.js](../functions/_lib/connectors/slack.js)
`handleWebhook` for the live version):
1. **Signature verification first.** Compute HMAC-SHA256 over
   `v0:{timestamp}:{body}` with the Slack signing secret; constant-time
   compare against the `X-Slack-Signature` header. Reject with 403 on
   mismatch ([slack.js](../functions/_lib/connectors/slack.js)
   `verifySlackSignature` helper).
2. **Replay protection.** Reject if `|now - timestamp| > 300` seconds.
3. **URL verification challenge.** First-time webhook subscription
   sends `{ type: 'url_verification', challenge }`. Echo `challenge`
   back as `text/plain`.
4. **Look up the connection.** Slack sends `team_id` in the event.
   Use it to find the matching `connections` row scoped to the right
   project. Reject if no row matches.
5. **Dispatch by event type.** `message`, `message_changed`,
   `message_deleted` are the three Block 4 wired. New events extend
   the dispatch.
6. **Idempotency via content_hash.** Re-deliveries hit the same
   `upsertEntityRow` path and get classified `skipped` by the
   content-hash gate (see [§7](#7-content-hash-gate)).

The Slack pattern translates directly to any "push" connector. For
"pull-only" connectors (Jira, future Drive), skip `handleWebhook`
entirely — the registry call site checks for undefined.

---

## 4. fullSync vs incrementalSync + cursor contract

Both methods return the same shape. The difference is scope.

### fullSync

Used on first connect (backfill) and on admin click of "Sync now"
(rate-limited 1/hour per Block 9.1). Walks the source from the
"interesting horizon" forward:
- **Slack**: now − 30 days, paginated forward.
- **Jira**: ORDER BY `updated DESC`, paginated. The DESC ordering
  matters — the active sprint's issues are the most-recently-updated,
  so they land first in the cap.

Both connectors cap pagination to bound runtime (Slack: 5 pages × 200
= 1000 messages; Jira: top-500 issues). See
[slack.js](../functions/_lib/connectors/slack.js) `_doSync` and
[jira.js](../functions/_lib/connectors/jira.js) `_doSync`. When the
cap is hit AND more data remains, the `SyncResult` carries `detail:
{ cap_hit: true, cap_pages, oldest_synced_ts }` so the UI can show
the user.

### incrementalSync

Used by Block 9.4's nightly cron at 08:00 UTC and by Block 10.1's
upcoming refresh-and-ask-again endpoint. Pulls deltas since
`connection.last_sync_cursor`:
- **Slack**: `oldest = connection.last_sync_cursor || (now - 30 days)`.
  Parses the cursor as a Unix timestamp string.
- **Jira**: JQL `updated >= '${cursor}'` ORDER BY `updated ASC`. ASC
  is required for cursor advancement to be correct (each page's max
  is the next page's lower bound).

### Cursor advancement contract

The handler ([functions/api/projects/[id]/connections/[connId]/sync.js](../functions/api/projects/[id]/connections/[connId]/sync.js)
and the cron endpoint
[functions/api/cron/incremental-sync.js](../functions/api/cron/incremental-sync.js))
writes:

```js
UPDATE connections SET last_sync_cursor = ${result.cursor_after},
                       last_sync_at      = NOW()
 WHERE id = ${connection.id}
```

…ONLY on success AND when the sync wasn't inert. "Inert" means the
connector had nothing to sync (e.g., Slack with `selected_channel_id
IS NULL`). The connector signals inert via `result.detail = { inert:
true, reason: '...' }`. Inert syncs don't bump `last_sync_at` so the
UI can distinguish "nothing happened" from "we synced and got 0 rows."

---

## 5. Credential encryption (Block 3 `crypto.js`)

All credentials are stored encrypted at rest in
`connections.ciphertext_credentials`. The encryption is envelope:
- Master key is a Cloudflare Worker Secret (`MASTER_ENCRYPTION_KEY`).
- Per-row data key is wrapped by the master key, stored in
  `connections.wrapped_data_key`.
- AAD (additional authenticated data) is constructed from row fields
  the connector cannot change without re-encrypting — see
  [crypto.js:101](../functions/_lib/crypto.js) `aadFor()`.

The API surface ([crypto.js](../functions/_lib/crypto.js)):
- `encrypt(env, plaintext, aad)` → `{ wrapped_data_key, iv,
  ciphertext, encryption_algorithm }`. Handler calls this on the
  `credentials` object returned by `completeAuth` before INSERT.
- `decrypt(env, row, aad)` → `plaintext`. Connector calls this with
  the connection row + `aadFor(row)`.
- `aadFor(connection)` → AAD bytes. Use this; don't construct AAD
  by hand.

**Tripwire**: if any of the AAD-input fields (e.g., `id`,
`project_id`) drifts vs. encryption time, decrypt fails closed. This
catches the "I copied the row to a different project's connection_id"
class of attack at the crypto layer, not just the SQL layer.

---

## 6. Entity write helpers

[functions/_lib/connectors/_shared/entity_writer.js](../functions/_lib/connectors/_shared/entity_writer.js)
exports four helpers. Pick by use case:

| Function | When to use |
|---|---|
| [`upsertEntityRow(sql, projectId, connectionId, entity)`](../functions/_lib/connectors/_shared/entity_writer.js) ([line 96](../functions/_lib/connectors/_shared/entity_writer.js)) | You need to UPSERT an entity without computing an embedding. Returns `{ id, inserted, changed }`. The three-state classification is load-bearing — see [§7](#7-content-hash-gate). |
| [`embedEntityRow(env, sql, projectId, connectionId, entityId, entity)`](../functions/_lib/connectors/_shared/entity_writer.js) ([line 169](../functions/_lib/connectors/_shared/entity_writer.js)) | The entity already exists; you just need to write its embedding. Currently unused at runtime — pre-10.5 sweep called this per row; post-10.5 sweep uses `embedEntitiesBatch` via the shared sweep helper. Kept exported in case a future caller needs single-row semantics. |
| [`writeEntityWithEmbedding(env, sql, projectId, connectionId, entity)`](../functions/_lib/connectors/_shared/entity_writer.js) ([line 239](../functions/_lib/connectors/_shared/entity_writer.js)) | Sync paths that ingest a few entities at a time and don't benefit from batching. Slack's per-message webhook path uses this ([slack.js](../functions/_lib/connectors/slack.js) `handleWebhook`). |
| [`writeEntitiesWithEmbeddingsBatch(env, sql, projectId, connectionId, entities)`](../functions/_lib/connectors/_shared/entity_writer.js) ([line 281](../functions/_lib/connectors/_shared/entity_writer.js)) | Sync paths that ingest many entities per page. Jira uses this ([jira.js](../functions/_lib/connectors/jira.js) `_doSync`). Collapses N embedding subrequests into one. |
| [`embedEntitiesBatch(env, sql, projectId, entities)`](../functions/_lib/connectors/_shared/entity_writer.js) ([line 407](../functions/_lib/connectors/_shared/entity_writer.js)) | Embed-only path for entities that already exist (the sweep). One OpenAI subrequest per call. Don't call this from sync paths — `writeEntitiesWithEmbeddingsBatch` does the right thing for new writes. |

### Project-isolation tripwire

Every helper checks `entity.metadata.project_id !== projectId` and
skips the embedding write with a structured warning. The trusted
`projectId` arg comes from the connection row (which the API handler
SELECTed against the URL-bound project); the `entity.metadata.project_id`
field is whatever the source system or your connector code put there.
Disagreement = potential cross-project leak from an upstream code
path. The check is defense-in-depth — it can't trigger in normal
operation, but if it does, you have a bug to find.

### Subrequest budget

Cloudflare Workers cap subrequests per invocation: **50 on the free
tier, 1000 on paid** (see comment at
[entity_writer.js:253](../functions/_lib/connectors/_shared/entity_writer.js)).
- DB queries through Hyperdrive don't count as subrequests.
- OpenAI embedding calls + Anthropic API calls do.
- The batched helpers (`writeEntitiesWithEmbeddingsBatch`,
  `embedEntitiesBatch`) collapse N embedding calls into one to stay
  under the cap on multi-hundred-row pages.

Your connector should use the batched variants whenever it processes
more than ~10 entities per invocation.

---

## 7. Content-hash gate

[functions/_lib/connectors/_shared/content_hash.js](../functions/_lib/connectors/_shared/content_hash.js)
computes a SHA-256 hex over the canonical content of an entity. Block
9.5's redesign uses this as the single column for no-op detection in
`upsertEntityRow`.

### Canonical fields (in `content_hash.js`)

[`canonicalContent(entity)`](../functions/_lib/connectors/_shared/content_hash.js)
([line 55](../functions/_lib/connectors/_shared/content_hash.js)) hashes
a sorted-keys JSON of:
- `title`
- `content_text`
- `author_external_id`
- `author_display_name`
- `source_created_at` (ISO normalized)
- `source_updated_at` (ISO normalized)
- `metadata` (whatever object the connector put there)
- `source_url`

### Excluded: `raw`

The raw JSON from the source is intentionally **NOT hashed**. Block
9.5 v1 included it and broke production because Atlassian's REST API
returns cosmetically-drifting `raw` payloads on identical entity
state (see HANDOFF.md "Block 9.5 production incident").

### Adding a content column to entities

If you add a column to `entities` that should be part of the
fresh/stale signal:
1. Add it to `canonicalContent` in
   [content_hash.js](../functions/_lib/connectors/_shared/content_hash.js).
2. Also add it to the `SET` clause in
   [`upsertEntityRow`](../functions/_lib/connectors/_shared/entity_writer.js)
   ([line 114](../functions/_lib/connectors/_shared/entity_writer.js))
   and the `INSERT` column list.
3. The WHERE clause is single-column compare on `content_hash`, so it
   doesn't need updating.

If you forget step 1, the hash misses the field and `upsertEntityRow`
will misclassify real updates as skipped. There's a `TODO` reminder
about this in
[entity_writer.js:68-70](../functions/_lib/connectors/_shared/entity_writer.js).

### Determinism — the canary cell

V5-7 in BLOCK_9_PLAN.md is the canary: if any canonicalized field is
non-deterministic across two consecutive source-API calls on
identical state, the hash drifts and idempotent re-sync writes when
it shouldn't. The known culprits are array fields whose source
doesn't guarantee order (e.g., Jira labels, Slack reactions).
Normalize them in `canonicalContent` before hashing if you hit drift.

---

## 8. Sweep path

Every connector's `_doSync` ends with a try-wrapped call to
[`sweepMissingEmbeddings(env, sql, connection)`](../functions/_lib/connectors/_shared/sweep_missing_embeddings.js).
See live call sites at
[slack.js:615](../functions/_lib/connectors/slack.js) and
[jira.js:645](../functions/_lib/connectors/jira.js).

The sweep:
- SELECTs up to 50 entities for this connection whose `entity_embeddings`
  row at the current model is missing.
- Calls
  [`embedEntitiesBatch`](../functions/_lib/connectors/_shared/entity_writer.js)
  ([line 407](../functions/_lib/connectors/_shared/entity_writer.js))
  to embed them in one OpenAI subrequest.

Catches three classes of gap:
- Entities written before embed-on-write existed.
- Retryable on-write failures from a prior sync (e.g., OpenAI 429
  mid-sync).
- Webhook entities whose inline embed failed.

**You don't need to write a sweep for a new connector.** Just call
the shared helper at the end of `_doSync`, exactly as Slack + Jira
do. The helper is connector-agnostic — it scopes by `connection.id`.

Wrap the call in try/catch so a sweep failure logs but doesn't abort
the sync (the next sync's sweep is the catch-up).

---

## 9. SQL view pattern

Each connector gets a SQL view over `entities` filtered to its
`source`, with source-specific column extraction from `metadata` and
`raw`. References:
- [db/migrations/2026-05-04-slack-messages-view.sql:47](../db/migrations/2026-05-04-slack-messages-view.sql) — `slack_messages`
- [db/migrations/2026-05-10-jira-issues-view.sql:57](../db/migrations/2026-05-10-jira-issues-view.sql) — `jira_issues`

Pattern for a new connector (e.g., Monday):
1. Decide which fields the AI tools and admin UI need to query
   structurally (vs. just text-search via `entities.content_text`).
2. Write `CREATE OR REPLACE VIEW <source>_<type> AS SELECT … FROM
   entities WHERE source = '<source>'`. Add JSON path extracts for
   the structured columns.
3. Future connectors (Monday, Drive) ship with their own
   `monday_items`, `drive_files` views following this pattern.
4. The view is read-only; writes still go through `entities` via
   `upsertEntityRow` and friends.

`CREATE OR REPLACE VIEW` makes the migration safely re-runnable. Apply
in Neon SQL Editor (no production DDL by Claude — per
[WORKFLOW.md](../WORKFLOW.md) hard limits).

---

## 10. AI tool registration

[functions/_lib/ai/tools.js](../functions/_lib/ai/tools.js) holds the
tool registry. Two surfaces to extend per new connector:

### `TOOL_DEFINITIONS` at [line 62](../functions/_lib/ai/tools.js)

Each tool gets a JSON-Schema-shaped entry with `name`, `description`,
and `input_schema`. The description is read by the LLM — make it crisp
about *when* to use the tool and what it returns.

Existing tools as references:
- `search_project_data` ([line 66](../functions/_lib/ai/tools.js)) —
  hybrid keyword + semantic over all sources.
- `query_jira_issues` ([line 91](../functions/_lib/ai/tools.js)) —
  filters by sprint/status/assignee. Returns ≤50 rows.
- `list_jira_sprints` ([line 151](../functions/_lib/ai/tools.js)) —
  discovery tool the LLM calls before structured Jira filters.

### `executeTool` dispatch at [line 231](../functions/_lib/ai/tools.js)

A switch on `toolUse.name` that calls the matching `runX` helper.
Each `run*` function:
- Takes `(env, sql, projectId, input)`.
- Validates `input` against its schema (no trust on LLM args).
- **Always includes `project_id = ${projectId}` in the WHERE
  clause** — this is the project-isolation enforcement layer.
- Returns the row or rows; the caller serializes for the LLM.

### Project-isolation enforcement

`projectId` comes from the URL, NOT from `toolUse.input`. The
`runQueryJiraIssues` helper at
[line 355](../functions/_lib/ai/tools.js) is the cleanest example:
the SQL clauses `FROM jira_issues WHERE project_id = ${projectId}
AND …` are constructed server-side; the LLM can pass whatever
`status` or `sprint_id` value it wants, but it cannot escape the
project boundary.

When you add a new tool, **every WHERE clause that touches user data
must include the `project_id` filter.** No exceptions.

---

## 11. `sync_runs` contract

The orchestrator (the API handler or the cron endpoint) is
responsible for the `sync_runs` row, NOT the connector. The
connector returns `SyncResult { records_inserted, records_updated,
records_skipped, cursor_after?, detail? }`; the handler writes the
row.

Pattern in
[functions/api/projects/[id]/connections/[connId]/sync.js](../functions/api/projects/[id]/connections/[connId]/sync.js):
1. INSERT a `sync_runs` row up-front with `status='running'`,
   `started_at=NOW()`, `sync_mode='full'` (or `'incremental'`).
2. Call `connector.fullSync(ctx, connection)` or
   `incrementalSync(...)`.
3. On success: UPDATE the row to `succeeded` with the three
   `records_*` counters + `finished_at`, bump
   `connections.last_sync_at` and `last_sync_cursor` if non-inert.
4. On failure: UPDATE to `failed` with the error string verbatim in
   `error`. Don't bump cursor or last_sync_at.

The cron endpoint
[functions/api/cron/incremental-sync.js](../functions/api/cron/incremental-sync.js)
mirrors this pattern per-connection with isolated try/catch (Block
9.4 decision U). One connection's failure doesn't block others.

### Three-branch counter logic (Block 9.5 B')

In your `_doSync`, after each entity write:
```js
if (result.inserted)      inserted++;
else if (result.changed)  updated++;
else                      skipped++;
```

Use the three counters honestly — `records_skipped` is the
load-bearing freshness signal for the activity drawer (Block 9.1).
Slack and Jira both do this; copy the pattern.

---

## 12. Test posture

The verification rhythm Block 9 + Block 10 followed:

1. **Plan-mode artifact** (`BLOCK_N_PLAN.md`) — locks decisions, file
   list, verification matrix BEFORE code.
2. **Curl matrix doc** (`curl-matrix-block-N-X.md`) — populated as
   verification cells fire. Cells PASS-runtime, DEFERRED, or PASS-
   by-inspection. Don't claim PASS-runtime without a real probe.
3. **Preview deploy** — push branch to non-main; Cloudflare auto-
   builds at `<branch>.elinno-agent.pages.dev` (branch name ≤28
   chars per the alias cap, see HANDOFF Block 9 carry-forward).
4. **Static smokes** — `node --check` on every file edited;
   `curl /api/db-health` returns 200; `/api/me` returns 200; spot-
   check any route touched by the change.
5. **Hash determinism canary** (Block 9.5 V5-7 for any change to the
   embed-on-write path) — temporary `console.log` of first 5 rows'
   content_hash across two consecutive idempotent syncs. Per-row
   hashes must match; if they don't, find the drifting field.
6. **ff-merge → push** — push to non-main happens in auto mode; push
   to main is per-push approval (the
   [.claude/hooks/deny-push-to-main.sh](../.claude/hooks/deny-push-to-main.sh)
   hook enforces this), Jenny does it from her terminal.

---

## 13. Checklist

Use this list when shipping a new connector. Each item maps to a
section above.

- [ ] **Interface contract** — connector object implements all
  required methods from [§1](#1-connector-interface-contract).
- [ ] **Registered** — added to
  [registry.js:25-31](../functions/_lib/connectors/registry.js) and
  `source` value present in the schema CHECK constraint
  ([db/schema-postgres.sql](../db/schema-postgres.sql)).
- [ ] **Auth flow** — OAuth ([§2 Slack pattern](#2-oauth-callback-pattern-reference-slack--jira))
  or token ([§2 Jira pattern](#2-oauth-callback-pattern-reference-slack--jira)).
  Scopes minimal.
- [ ] **Webhook** — if the source supports it AND v1.1 needs real-
  time, follow [§3](#3-webhook-handler-pattern-reference-slack-events-api).
  Otherwise omit `handleWebhook`.
- [ ] **fullSync + incrementalSync** — both return `SyncResult`.
  Cursor on incremental advances correctly ([§4](#4-fullsync-vs-incrementalsync--cursor-contract)).
- [ ] **Inert signal** — `result.detail = { inert: true, reason }`
  when there's nothing to sync (e.g., source-scope unselected).
- [ ] **Pagination cap** — bounded by page count or row count so
  runtime stays well under Workers' 30s budget.
- [ ] **Credentials encrypted** — handler calls
  [`encrypt()`](../functions/_lib/crypto.js) on `completeAuth`
  output; connector calls `decrypt(env, connection,
  aadFor(connection))` internally.
- [ ] **Entity write helper** — using the right one from
  [§6](#6-entity-write-helpers). Batched for >~10 entities/page.
- [ ] **Content hash** — entity carries the canonical fields from
  [§7](#7-content-hash-gate); no surprise nullable fields.
- [ ] **Sweep** — `_doSync` ends with try-wrapped
  [`sweepMissingEmbeddings(env, sql, connection)`](../functions/_lib/connectors/_shared/sweep_missing_embeddings.js).
- [ ] **SQL view** — `<source>_<type>` view in `db/migrations/`,
  applied to Neon by Jenny ([§9](#9-sql-view-pattern)).
- [ ] **AI tool(s)** — added to
  [tools.js TOOL_DEFINITIONS](../functions/_lib/ai/tools.js)
  ([line 62](../functions/_lib/ai/tools.js)) and `executeTool`
  dispatch ([line 231](../functions/_lib/ai/tools.js)). Every WHERE
  clause carries `project_id = ${projectId}`.
- [ ] **Three-branch counters** in `_doSync`
  ([§11](#11-sync_runs-contract)).
- [ ] **Plan + matrix** — `BLOCK_N_PLAN.md` locked decisions;
  `curl-matrix-block-N-X.md` populated; verification cells run on
  preview before push-to-main approval.
- [ ] **Doc this guide** — if any of the above patterns evolves
  during your connector work, update the corresponding section
  here so the next connector benefits.

---

*Maintenance contract:* code references in this guide are line-
numbered. When a referenced line moves more than ~10 lines, update
the link. The V4.2 verification cell in
[BLOCK_10_PLAN.md](../BLOCK_10_PLAN.md) is the runnable check —
grep this file for paths and confirm each function name still exists
at its referenced line.
