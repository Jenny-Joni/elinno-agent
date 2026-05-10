# Block 6 — Jira Connector · Build Plan

| Field | Value |
| ----- | ----- |
| Document | Block 6 Build Plan v1.1 |
| Block | Block 6 of 9 (per [BUILD_PLAN.md](BUILD_PLAN.md)) |
| Companion to | BUILD_PLAN.md, PRD.md, HANDOFF.md, WORKFLOW.md |
| For | Solo build with Claude Code |
| Generated | 2026-05-10 (post-Block-5 closeout, design session) |
| Mode | DEFAULT for credential write path + tool executor + system prompt module; AUTO elsewhere (per WORKFLOW.md security carve-outs) |

## Context

Block 5 closed 2026-05-10 with full runtime verification on production at https://elinnoagent.com. The agent loop, hybrid search (keyword + vector + RRF), embed-on-write hook, and citation-bearing chat UI are live. The Block 4–era `message_changed` webhook bug was fixed in production at `3cdcea3`.

**Block 6 builds the second connector (Jira), which:**
1. Validates the connector framework against a non-OAuth, non-webhook auth model (API token), proving the framework generalizes beyond Slack's exact shape.
2. Adds three structured-query tools to the agent loop, exercising the "exact data" path of PRD §1.3 ("the AI never invents numbers").
3. Updates the system prompt to enumerate connectors per project — required so the model knows which structured tools it can use vs. which projects only have Slack content for hybrid search.

Per [BUILD_PLAN.md:128](BUILD_PLAN.md), done-when:
> "How many tickets are in this sprint?" returns the right number with a link to the sprint.

## What Block 6 delivers

Mapping BUILD_PLAN §Block 6 onto the existing framework:

1. **Atlassian API-token auth** (per decision A) — site URL + account email + API token form; encrypted via existing `aadFor`/`encrypt`/`decrypt`. No OAuth dance. Per-user credential, per Atlassian site instance.
2. **Single Jira project picker** post-connect (mirrors Slack's channel picker; decision D + L).
3. **Backfill + incremental sync** — `fullSync` pulls issues + sprints for the selected project; `incrementalSync` uses JQL `updated >= last_sync_cursor` (decision E). No webhook in v1.1 (decision E3).
4. **`jira_issues` SQL view** over `entities` for fast lookups (decision J). No `jira_sprints` view (Block 4 discipline: one view per primary tool surface).
5. **Three new agent tools**: `query_jira_issues`, `list_jira_sprints`, `get_jira_sprint_summary` (decision I, with sub-letters I1/I2/I3 locking each input schema).
6. **System-prompt template slot** `{{AVAILABLE_SOURCES}}` (decision K) — additive substitution to the locked Block 5 prompt; scoped re-lock for the slot only, not the prose.
7. **`writeEntityWithEmbedding` shared helper** (decision M, commit 0) — extracted from `slack.js`'s inline embed-on-write pattern. Pre-Block-6 carry-forward from Block 5 closeout, lands as commit 0 in DEFAULT mode.
8. **Connect Jira UI** in the Connections tab + project-picker modal post-connect.

## Block 5 drift findings (folded into Block 6 design)

Three items found vs. closeout assumptions by reading the post-Block-5 code:

1. **`embedEntityRow(env, sql, projectId, connectionId, entityId, entity)`** is at [slack.js:486-536](functions/_lib/connectors/slack.js:486), called from three sites: `_doSync` (~line 687), `processMessageEvent` (~line 900), and `sweepMissingEmbeddings` (~line 781). The sweep path needs `embedEntityRow` standalone (no upsert needed; entity already exists). Decision M's helper exports BOTH `writeEntityWithEmbedding` (combined upsert+embed) AND keeps `embedEntityRow` standalone for sweep reuse. Single-helper-only refactor would break sweep.

2. **`SYSTEM_PROMPT` constant** at [loop.js:36-84](functions/_lib/ai/loop.js:36) currently names only `search_project_data` ("Slack messages today; future connectors will expand"). The lock posture per Block 5 closeout is "changes require re-lock conversation." Decision K honors this by adding a NEW template slot (`{{AVAILABLE_SOURCES}}`) without altering existing prose — additive substitution via existing `renderSystemPrompt` mechanism at loop.js:148.

3. **`tools.js` executor** at [tools.js:108-166](functions/_lib/ai/tools.js:108) implements D4b substitution-enforced project isolation: `input.project_id` is discarded; URL-bound `projectId` is used unconditionally. Decision I2/I3 preserves this exact pattern for all three Jira tools — no Jira tool reads `input.project_id` for SQL filtering.

## Pre-Block-6 prerequisites

**Per-env secret existence audit (corrected post-S1a-500 finding, 2026-05-10).** Pre-flight enumerate every `env.*` reference touched by Block 6's code paths AND every `env.*` reference touched by upstream code paths Block 6 verification exercises. Full secret list (verified by `grep -rE "env\.[A-Z_]+" functions/`):

- `env.RESEND_API_KEY`
- `env.MASTER_ENCRYPTION_KEY`
- `env.ANTHROPIC_API_KEY`
- `env.OPENAI_API_KEY`
- `env.SLACK_CLIENT_SECRET`
- `env.SLACK_SIGNING_SECRET`
- `env.ALLOW_CRYPTO_SMOKE` (gate flag; per-env value intentional)

Block 6 introduces ZERO new env vars or secrets (Atlassian API tokens are per-connection, encrypted at rest under existing `MASTER_ENCRYPTION_KEY`, not Worker-level secrets).

**Audit shape per secret:**
- **Existence check** — both Production AND Preview Pages env: confirm the secret name is present at Cloudflare dashboard → Workers & Pages → `elinno-agent` → Settings → Variables and Secrets (Production tab AND Preview tab). Cloudflare hides values post-set; existence is the only check available from the dashboard.
- **Value match between envs** — deliberately NOT required for envelope-encryption keys. `MASTER_ENCRYPTION_KEY` was set up in Block 3 with **deliberately different values** in Production vs. Preview (per [curl-matrix-block-3.md:11](curl-matrix-block-3.md:11)), to ensure a compromised Preview deploy cannot decrypt prod-encrypted data. The same isolation discipline applies to any future per-env-isolated secrets.
- **Cross-env data exercise rule (the one Block 6 commit 0 surfaced)** — any preview-side verification that decrypts existing connection data must use connections **created on Preview**, not connections created on Production. Production-encrypted data is by-design un-decryptable on Preview.

**Why this matters for Block 6 verification phasing:**
- **Slack regression test (commit 0 S1a/b/c)**: prod's existing Slack connection cannot be decrypted on Preview → S1a/b/c run as PASS-by-inspection pre-merge, PASS-runtime post-merge against prod (Block 5 addendum pattern).
- **Jira tests (commits 2–9)**: a Jira connection created on Preview encrypts under Preview's master key → fully Preview-runtime-verifiable. Block 6's Jira-specific verification phases (B/C/D/E) work on Preview because every Jira connection in the verification matrix is Preview-created.

**No separate pre-Block-6 PR.** Decision M's helper extraction lands as Block 6 commit 0, not as a separate PR — keeps the refactor scoped to the block that motivates it (Block 7's Monday connector would otherwise be the next forcing function).

## Execute mode: mixed AUTO + DEFAULT (security carve-out where it matters)

Per [WORKFLOW.md](WORKFLOW.md) §"Security carve-outs": Block 6 is **smaller** in carve-out scope than Block 4 because there is no OAuth callback (no token exchange), no webhook handler (no signature verification), no schema migration that changes invariants (only an additive view). The DEFAULT-mode surface is:

- **Credential write path** (jira.js auth save endpoint) — touches encryption boundary. DEFAULT.
- **Tool executor wiring** (`tools.js` additions for the three Jira tools) — project-isolation enforcement. DEFAULT.
- **System-prompt module** (`loop.js` `{{AVAILABLE_SOURCES}}` slot) — locked-neighborhood. DEFAULT.
- **Helper extraction** (commit 0 — `_shared/entity_writer.js` + Slack refactor) — touches the embedding write path that Block 5 carved out. DEFAULT.

Everything else (UI, project-picker endpoint, view migration file, sync logic mirror) runs in AUTO. **Carve-out files carry the `// SECURITY-CARVE-OUT: do not edit in auto mode` banner per the Block 4 convention.**

---

## Locked design decisions

Block 4 used A–P; Block 6 lands at A–P with sub-letters (E1/E2/E3, I1/I2/I3/I4). Each carve-out decision (A, C, I1/I2/I3/I4, K, M, P) includes a **specific failure mode the lock prevents** — same discipline as Block 4.

### A. Auth model — Atlassian API token only for v1.1; OAuth 3LO deferred to v1.2

The Connect Jira flow takes three inputs from the admin: Atlassian site URL (e.g. `mycompany.atlassian.net`), account email, and an API token the admin generated at https://id.atlassian.com/manage-profile/security/api-tokens. The token is treated exactly like a Slack bot token — encrypted at rest via `aadFor`/`encrypt` ([crypto.js:101-239](functions/_lib/crypto.js:101)).

Authentication on outbound Jira API calls uses HTTP Basic: `Authorization: Basic ${base64(email + ':' + apiToken)}`.

**v1.2 prerequisite for OAuth 3LO:** register an Atlassian Connect / OAuth 2.0 app in Atlassian Developer Console; implement the 3LO callback flow with refresh tokens; handle Atlassian Marketplace review for distribution.

**Rationale:** ships v1.1 without Marketplace registration friction; Atlassian API tokens are long-lived and don't require refresh-token plumbing. Single-tenant install is Jenny + early customers; per-user token mint is acceptable friction.
**Tradeoff:** each new tenant must mint their own API token; no auto-refresh; if a user's token is revoked at Atlassian, sync fails until re-auth.
**Specific failure mode the lock prevents:** OAuth-callback-class vulnerabilities (CSRF on completion, state replay, code interception, open-redirect via `redirect_to`) — **all eliminated by not having an OAuth callback**. The credential-write path is a single `POST /api/connectors/jira/auth/save` endpoint authenticated by the admin's existing session; no untrusted-redirect surface, no third-party-controlled callback.

### B. Atlassian API surface — five REST endpoints only

v1.1 calls exactly five Atlassian REST endpoints:

1. `GET /rest/api/3/myself` — connection test (decision C's `testConnection`).
2. `GET /rest/api/3/project/search?expand=description` — list accessible projects for the picker (decision G).
3. `GET /rest/api/3/search?jql=...&fields=summary,status,assignee,reporter,priority,issuetype,labels,customfield_10020` — issue search for backfill + incremental (decision E). `customfield_10020` is the standard sprint field; story points is `customfield_10016`.
4. `GET /rest/agile/1.0/board?projectKeyOrId=...` — list boards for the project (decision E).
5. `GET /rest/agile/1.0/board/{boardId}/sprint?state=active,closed,future` — list sprints per board (decision E).

No Jira admin events, no user listing, no comment ingestion, no attachments, no custom-field discovery beyond the two pinned IDs.

**Rationale:** matches PRD §3 ("issues, sprints, statuses"); small surface keeps Atlassian-side scope review (if v1.2 adds OAuth) lightweight.
**Tradeoff:** non-standard custom field IDs require per-instance customization — out of scope for v1.1. Both `customfield_10020` (sprint) AND `customfield_10016` (story points) are the standard Atlassian Cloud defaults but are NOT guaranteed across instances; instances with custom workflows or imported data can have different IDs. **Pin both IDs at commit 5 coding time against Jenny's test instance**; instance-specific custom field discovery is Block 9.

### C. Credential storage — reuse Block 3 envelope encryption; `credential_metadata` holds non-secret config

No schema migration. The `connections` table already has `wrapped_data_key`, `iv`, `ciphertext_credentials`, `encryption_algorithm`, `credential_metadata`. For Jira:

- `ciphertext_credentials` stores the JSON `{email, api_token, site_url}` encrypted under AAD = `aadFor(connection)`.
- `credential_metadata` stores `{site_url, account_email, atlassian_account_id, selected_project_key, selected_project_name}` (all non-secret).
- `external_account_id` stores the Atlassian site cloud ID (UUID returned by `/myself`'s `accountId` is per-user, not per-instance — use the cloud ID from `/_edge/tenant_info` instead, or fall back to lowercased site host).

**Specific failure mode the lock prevents:** site URL drift between encrypted blob and metadata. If site URL lived only in `credential_metadata`, an admin could PATCH it to point at a different Atlassian instance and the encrypted token would be sent to the new host. Storing it BOTH in the encrypted blob AND `credential_metadata` (read-only after creation) lets `testConnection` cross-check on every sync; mismatch → status='error', no outbound call.

### D. Single Jira project per connection for v1.1; multi-project picker → Block 9 / v1.2

After Connect succeeds, the post-connect modal lists projects from B's `/project/search`. Admin picks ONE; `credential_metadata.selected_project_key` is set via existing PATCH endpoint (Block 4 decision L). Until a project is picked, the connection row pill shows "needs setup" (UI-derived from `credential_metadata.selected_project_key IS NULL`).

`fullSync` reads `selected_project_key`; if absent, returns inert sync per Block 4 decision L (records_inserted=0, records_skipped=0, `sync_runs.detail = { reason: 'no project selected' }`, `last_sync_at` NOT advanced).

**Rationale:** mirrors Slack's channel-picker pattern; bounded backfill cost; predictable for the v1.1 done-when test.
**Tradeoff:** in-place project switch requires disconnect + reconnect in v1.1. Multi-project picker is Block 9 / v1.2 polish.

### E. Sync model — `fullSync` + JQL `incrementalSync`; no webhook for v1.1

`fullSync(ctx, connection)`:
1. Read `selected_project_key` from `credential_metadata`.
2. Call B's `/project/search` once to get the project's display name (cache-via-`connection.credential_metadata`-update if needed; otherwise re-fetch each fullSync).
3. Call `/agile/1.0/board?projectKeyOrId=${selected_project_key}` to enumerate boards (typically 1–3 per project).
4. For each board, `/agile/1.0/board/{id}/sprint?state=active,closed,future` to enumerate sprints. UPSERT sprints as `entities` rows with `source_type='jira_sprint'`.
5. Call `/rest/api/3/search?jql=project=${selected_project_key} ORDER BY updated ASC&fields=summary,status,assignee,reporter,priority,issuetype,labels,customfield_10020,customfield_10016&maxResults=100`. Paginate via `startAt`. UPSERT issues as `entities` rows with `source_type='jira_issue'`.
6. Per-row: call decision M's `writeEntityWithEmbedding` (combined upsert+embed). Sweep recovery via `sweepMissingEmbeddings` (existing pattern from Slack).
7. Persist max(`updated`) of synced issues to `connection.last_sync_cursor` (ISO 8601 string).

`incrementalSync(ctx, connection)`:
1. Read `last_sync_cursor` (ISO 8601) or fall back to `now() - 30d` (mirror Slack's full-sync-window default).
2. Call `/rest/api/3/search?jql=project=${selected_project_key} AND updated >= "${cursor}" ORDER BY updated ASC&fields=...&maxResults=100`. Paginate.
3. Sprints: re-fetch entirely via E step 4 (sprints are O(10) per project; not worth incremental).
4. UPSERT + embed; advance cursor.

**Rationale:** matches Block 4's E2/E3 pagination + cursor pattern; zero new infrastructure beyond the JQL incremental query.
**Tradeoff:** changes between sync runs are invisible until next sync (vs. webhook-driven real-time). Manual "Sync now" button + Block 9 nightly cron mitigate.

### E1. Pagination cap — `MAX_PAGES = 5` ≈ 500 issues per sync run

Mirror Slack's E3. Cap at 5 pages × 100 results = 500 issues per `_doSync` invocation. Cap-hit produces `sync_runs.detail = { cap_hit: true, cap_pages: 5, cap_records: 500, oldest_unsynced_updated_ts: '...' }`. Subsequent sync runs catch up via the cursor.

**Rationale:** bounded per-request cost; Atlassian rate limits reward small page sizes; large backfills happen over multiple sync runs.
**Tradeoff + v1.1 known limitation:** **v1.1 has no nightly cron.** A 10,000-issue project requires the admin to click "Sync now" ~20 times to fully backfill. Between Block 6 ship and Block 9 cron, this is the operational reality — name it explicitly to the first non-Jenny customer at onboarding. Block 9 mitigation: Cloudflare Cron Triggers running incrementalSync per active connection nightly. Until then, the only automation is whatever the admin builds externally (cron-triggered curl against the existing `/sync` endpoint).

### E2. Rate-limit handling — Atlassian's 429 + `Retry-After`; sleep + retry once, then abort

Atlassian returns HTTP 429 with `Retry-After: <seconds>` header when rate-limited. Behavior:
1. On 429, parse `Retry-After`. Sleep that many seconds (cap at 60s).
2. Retry the same request once.
3. If second attempt also 429, abort the sync run with `sync_runs.status = 'failed'`, `sync_runs.detail = { reason: 'rate_limited', retry_after_seconds: N, records_so_far: M }`. Do NOT advance cursor.

**Rationale:** mirror Slack's E2 retry-once-then-abort discipline; freshness signal stays honest (`last_sync_at` not advanced if cursor not advanced).
**Tradeoff:** under sustained rate-limiting, syncs fail visibly until the limit clears. That's the right answer — silent partial sync would be worse.

### E3. No webhook handler in v1.1; deferred to Block 9

Atlassian webhooks require admin-level configuration in the Jira instance settings (per-instance, not per-user). API-token-auth users cannot register webhooks programmatically. v1.1 ships without webhooks; admin uses the manual "Sync now" button (existing Block 4 endpoint). Block 9 adds a nightly cron via Cloudflare Cron Triggers + admin-configured webhook registration UI.

**Rationale:** webhook plumbing requires per-instance admin coordination; the v1.1 done-when ("how many tickets in this sprint?") works fine with manual sync. No new security carve-out for signature verification.
**Tradeoff:** Jira data can be up to one sync interval stale. Block 9 cron mitigates without adding Block 6 scope.

### F. Single connection per Jira instance per project

Same v1.1 lock as Slack's F: `connections` table allows multi-row per `(project_id, source='jira', external_account_id=site_cloud_id)` at the schema level (for v1.2 multi-instance), but Block 6 enforces single-row at the application layer. Connection POST handler returns 409 if a Jira connection already exists for the project + site combination.

**Rationale:** v1.1 doesn't ship multi-instance disambiguation in the agent tool surface; allowing duplicate rows would let the model arbitrarily pick one.
**Tradeoff:** an admin who wants to connect two Jira instances to the same project must wait for v1.2.

### G. Project listing endpoint — bespoke `/api/projects/:id/connections/:connId/jira/projects`

Mirror Slack's `/slack/channels` endpoint at [channels.js](functions/api/projects/[id]/connections/[connId]/slack/channels.js). Admin-gated (`requireProjectRole(admin)`); connection must be status='active', source='jira', not soft-deleted. Returns `{ok: true, projects: [{key, name, lead_account_id?}, ...]}` from B's `/project/search`.

### H. Entity mapping — two `source_type` values: `jira_issue` and `jira_sprint`

**`jira_issue`** entity row:
- `source_id` = `${site_cloud_id}:issue:${issue_key}` (e.g. `abc123-...:issue:PROJ-456`)
- `title` = issue summary
- `content_text` = `${summary}\n\n${description_plain_text}` (description rendered from ADF to plain text via a small inline helper; ADF complexity beyond paragraph + heading deferred to Block 9)
- `author_external_id` = reporter's Atlassian accountId
- `author_display_name` = reporter's displayName
- `source_created_at` = `fields.created`
- `source_updated_at` = `fields.updated`
- `source_url` = `https://${site_url}/browse/${issue_key}`
- `metadata` JSON:
  ```json
  {
    "issue_key": "PROJ-456",
    "jira_project_key": "PROJ",
    "status": "In Progress",
    "status_category": "indeterminate",
    "issue_type": "Bug",
    "assignee_display_name": "Jane Doe",
    "assignee_external_id": "5b10a...",
    "reporter_display_name": "Jenny",
    "reporter_external_id": "5b10b...",
    "priority": "High",
    "sprint_id": 42,
    "sprint_name": "Sprint 23",
    "story_points": 5,
    "labels": ["backend", "p1"]
  }
  ```
- `raw` = the full Atlassian issue JSON (for v1.2 forward-compatibility)

**`jira_sprint`** entity row:
- `source_id` = `${site_cloud_id}:sprint:${sprint_id}`
- `title` = sprint name
- `content_text` = `${name}${goal ? `\n\n${goal}` : ''}` (embedding-friendly; sprints rarely surface in vector search but the slot exists)
- `source_created_at` = `startDate` (or `null` if future)
- `source_updated_at` = `completeDate || endDate || startDate || now()`
- `source_url` = `https://${site_url}/jira/software/projects/${project_key}/boards/${board_id}?sprint=${sprint_id}` (Jenny: verify URL shape against a real sprint at coding time; pin the format in commit 5)
- `metadata` JSON:
  ```json
  {
    "sprint_id": 42,
    "board_id": 7,
    "sprint_name": "Sprint 23",
    "state": "active",
    "start_date": "2026-05-01T00:00:00.000Z",
    "end_date": "2026-05-15T00:00:00.000Z",
    "complete_date": null,
    "goal": "Ship Block 6"
  }
  ```

`status_category` is included because it survives Jira workflow customization where `status` does not — it's the column you actually want for "show me open issues" (`status_category IN ('new','indeterminate')` vs. `'done'`).

### I. Three new agent tools — `query_jira_issues`, `list_jira_sprints`, `get_jira_sprint_summary`

All three follow Block 5's executor pattern at [tools.js:108-166](functions/_lib/ai/tools.js:108): URL-bound `projectId` is the truth; `input.project_id` (if present) is discarded with D4c telemetry on mismatch; SQL helper enforces project scoping at the WHERE clause.

All three return citation-shaped result rows so the chat UI's chip rendering (Block 5 commits 13–14) works automatically: `{entity_id, source: 'jira', source_type, title, source_url, author?}`.

### I1. `query_jira_issues` — structured filter only; no JQL passthrough

Input schema:
```json
{
  "type": "object",
  "properties": {
    "status_category": { "type": "string", "enum": ["new", "indeterminate", "done"] },
    "status": { "type": "string" },
    "assignee_display_name": { "type": "string" },
    "sprint_id": { "type": "integer" },
    "issue_type": { "type": "string" },
    "priority": { "type": "string" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 20 },
    "project_id": { "type": "string", "description": "Reserved for v1.2 cross-project; ignored in v1.1" }
  }
}
```

Executor: SQL on `jira_issues` view with project_id WHERE clause from URL-bound `projectId`. Returns `{result_count, issues: [{entity_id, source: 'jira', source_type: 'jira_issue', issue_key, title, status, status_category, assignee_display_name, sprint_name, story_points, source_url}]}`.

**No JQL passthrough.** Primary reason: **Jira tools query the local index, not Jira live.** The agent operates against entities synced into `jira_issues` view; live JQL passthrough would bypass the index and require a separate execution path (call out to Atlassian, handle their rate limits live in the agent loop, lose the project-scope SQL gate). The index-only architecture is locked at the framework level — Block 5 tools query Postgres, Block 6 tools query Postgres, Block 7+ same. Secondary reason: free-form JQL inverts Block 5's "tool inputs are LLM-supplied and untrusted; the model never writes the WHERE clause" posture (D4b at tools.js:30-40). If a customer needs JQL, that's v1.2 (which would require live-Atlassian execution + a separate trust posture).

**Specific failure mode the lock prevents:** two failure modes covered:
1. **Architecture drift via tool-side live calls.** Adding a free-JQL tool that calls Atlassian live opens the precedent that future tools can call source APIs in-loop. The agent loop's iteration cap (6 per turn), token accounting, and citation rendering all assume index-shaped tool results. Live-call tools would need a parallel set of guarantees per source.
2. **SQL-injection-class drift.** JQL → SQL translation requires a parser; an incomplete or buggy parser becomes a privilege-escalation vector (model crafts JQL that translates to a SQL clause bypassing project_id scope). Structured-only schema forces the project_id substitution at the executor entry point and keeps the SQL static.

### I2. `list_jira_sprints` — optional state filter; reads entities directly (no view)

Input schema:
```json
{
  "type": "object",
  "properties": {
    "state": { "type": "string", "enum": ["active", "closed", "future"] },
    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 20 },
    "project_id": { "type": "string", "description": "Reserved for v1.2 cross-project; ignored in v1.1" }
  }
}
```

Executor: SQL on `entities` table directly (no `jira_sprints` view per Block 4 single-view discipline) — `WHERE source = 'jira' AND source_type = 'jira_sprint' AND project_id = ${projectId}`, optional `AND metadata->>'state' = ${state}`. Returns `{result_count, sprints: [{entity_id, source: 'jira', source_type: 'jira_sprint', sprint_id, sprint_name, state, start_date, end_date, source_url}]}`.

**Specific failure mode the lock prevents:** same project-isolation guarantee as I1; `project_id` in input is reserved-and-ignored.

### I3. `get_jira_sprint_summary` — `sprint_id` required; aggregates by status_category + story points

Input schema:
```json
{
  "type": "object",
  "properties": {
    "sprint_id": { "type": "integer" },
    "project_id": { "type": "string", "description": "Reserved for v1.2 cross-project; ignored in v1.1" }
  },
  "required": ["sprint_id"]
}
```

Executor: SQL aggregation on `jira_issues` view filtered by `sprint_id::text = ${sprintId}::text`. Joins `entities` for the sprint row (source_type='jira_sprint') to fetch sprint metadata. Returns:

```json
{
  "sprint_id": 42,
  "sprint_name": "Sprint 23",
  "state": "active",
  "start_date": "...",
  "end_date": "...",
  "issue_count": 17,
  "by_status_category": { "new": 4, "indeterminate": 9, "done": 4 },
  "total_story_points": 38,
  "completed_story_points": 13,
  "source_url": "https://..."
}
```

If `sprint_id` is unknown (no matching sprint entity for the project), return `{error: 'sprint_not_found', sprint_id}` — the executor convention from tools.js:111-119.

**Specific failure mode the lock prevents:** cross-project sprint lookup. Without the WHERE-project_id clause, a sprint_id from another tenant's Jira instance could match if numeric IDs collide (Jira sprint IDs are globally numeric). The executor scopes the JOIN by URL-bound `projectId`, making collisions invisible across tenants.

### I4. No general-purpose `aggregate_jira` tool in v1.1 — sprint summary is the only aggregation surface

**Missing-by-design.** Block 6 ships exactly three Jira tools (I1/I2/I3). It does NOT ship a general-purpose aggregation tool like `aggregate_jira({group_by, metric, filter})` for queries such as "story points completed this quarter by assignee" or "count of bugs by priority across all sprints." The only aggregation surface in v1.1 is `get_jira_sprint_summary` (I3), scoped to a single sprint.

When the user asks an aggregation-style question outside that surface (e.g. "how many bugs are open?"), the agent's only path is to call `query_jira_issues` with a filter and count the result rows. This is bounded by I1's `limit` ceiling of 50 — questions exceeding 50 results return a clamped count and the model must answer "at least 50" rather than the true number.

**Rationale:** general-purpose aggregation requires a query language (JQL or a structured group-by/metric DSL); Block 6 explicitly chose structured-only filters (I1) for safety + index-only architecture. Adding a separate aggregation tool with its own DSL is the same surface-area + parser risk as JQL. Sprint-scoped aggregation (I3) is bounded — one sprint, one set of fields, one schema — which is reviewable.
**Tradeoff:** "how many tickets across all sprints" returns clamped counts in v1.1. Users get correct sprint-level numbers (the BUILD_PLAN done-when) but not arbitrary cross-sprint aggregations.
**Specific failure mode the lock prevents:** silent under-reporting. If `query_jira_issues` returned 50 rows when the true count is 200 and the model reported "50 bugs" without flagging the clamp, the user would believe a wrong number. Mitigation: I1's response includes `result_count` AND a `clamped: true` flag when `result_count == limit`; system-prompt guidance (decision K candidate sentence — see follow-ups) tells the model to surface the clamp explicitly. Verification: S13 asserts the `clamped` flag is present and accurate.

**v1.2 candidate:** if customer demand surfaces, design a structured `aggregate_jira({group_by: 'assignee'|'status'|'sprint', metric: 'count'|'sum_story_points'|'avg_cycle_time', filter: {...same shape as I1...}})` with the same project_id substitution + hard limits.

### J. `jira_issues` SQL view — single view, no `jira_sprints` view

Migration `db/migrations/2026-MM-DD-jira-issues-view.sql`:

```sql
CREATE OR REPLACE VIEW jira_issues AS
SELECT
  e.id, e.project_id, e.connection_id, e.source_id,
  e.title, e.content_text, e.source_url,
  e.author_external_id, e.author_display_name,
  e.source_created_at, e.source_updated_at,
  (e.metadata->>'issue_key')              AS issue_key,
  (e.metadata->>'jira_project_key')       AS project_key,
  (e.metadata->>'status')                 AS status,
  (e.metadata->>'status_category')        AS status_category,
  (e.metadata->>'issue_type')             AS issue_type,
  (e.metadata->>'assignee_display_name')  AS assignee_display_name,
  (e.metadata->>'assignee_external_id')   AS assignee_external_id,
  (e.metadata->>'reporter_display_name')  AS reporter_display_name,
  (e.metadata->>'priority')               AS priority,
  ((e.metadata->>'sprint_id')::integer)   AS sprint_id,
  (e.metadata->>'sprint_name')            AS sprint_name,
  ((e.metadata->>'story_points')::numeric) AS story_points,
  (e.metadata->'labels')                  AS labels
FROM entities e
WHERE e.source = 'jira' AND e.source_type = 'jira_issue';
```

`labels` stays JSONB; `story_points` casts to numeric for SUM aggregation; `sprint_id` casts to integer for I3's join.

**No `jira_sprints` view.** Block 4 created exactly one view (`slack_messages`); Block 6 mirrors that discipline. `list_jira_sprints` (I2) reads entities directly; `get_jira_sprint_summary` (I3) joins entities directly. Adding a sprints view becomes Block 9 polish if a third tool needs it.

### K. System-prompt update — `{{AVAILABLE_SOURCES}}` template slot; design-chat sign-off required for the new sentence

**This is doing more than slot insertion.** The template slot is mechanically additive, but the new SENTENCE that wraps the slot is new prompt content with semantic implications: it tells the model what tools to use, what tools to NOT call, and how to phrase "we don't have that connected" responses. Block 5's D11 review pinned the locked prompt prose; the K addition needs an equivalent design-chat review pass on the exact wording before commit 8 ships.

**Candidate sentence (subject to Jenny's D11-style sign-off in design chat before commit 8):**

> "This project has the following data sources connected: {{AVAILABLE_SOURCES}}. Only call Jira tools (`query_jira_issues`, `list_jira_sprints`, `get_jira_sprint_summary`) if Jira is in that list. If a user asks about a source not in the list, tell them the source isn't connected to this project — don't claim you searched for it."

**Insertion point:** after the existing `{{PROJECT_NAME}}` substitution line; before the existing tool-usage guidance. Surrounding locked prose stays byte-identical.

**Substitution rendering at `renderSystemPrompt` (loop.js:148):**
- Query: `SELECT DISTINCT source FROM connections WHERE project_id = $1 AND status = 'active' AND deleted_at IS NULL ORDER BY source`.
- Format: human-readable display names ("Slack", "Jira") joined per English convention.
  - One source: bare name (`"Slack"`).
  - Two sources: `"Slack and Jira"`.
  - Three or more: Oxford comma (`"Slack, Jira, and Monday"`).

**Empty-substitution case is unreachable.** Per [loop.js:111-115](functions/_lib/ai/loop.js:111), the agent loop short-circuits BEFORE prompt rendering if no connectors are connected (Block 5 commit 10 — zero-data-source short-circuit). The `{{AVAILABLE_SOURCES}}` substitution will never run with an empty list under current loop.js code. Decision K therefore ships with no empty-state branch in the substitution function — calling it with an empty list is a bug (assert + throw). If Block 9 reorders the short-circuit, K must be revisited at the same time.

**Failure semantics — query failure:**
- The substitution query is a single bounded SELECT against the `connections` table; failure modes are DB unavailable, timeout, or the connection cursor itself failing.
- On query failure, the substitution function logs `system_prompt:available_sources_query_failed` (with project_id, no exception body) and substitutes the literal string `"(temporarily unavailable; tool call decisions may be conservative)"`. The agent loop continues; the model receives a degraded but non-empty prompt.
- This is a FALLBACK not a retry. The substitution function does NOT retry the query on failure (avoids amplifying DB-unavailable into multi-second loop start latency).
- If the failure persists across many turns, the model's tool-call decisions degrade to "I'm not sure if Jira is available" caution — visible degraded behavior rather than silent crash.

**Caching scope — per `runAgent` invocation only.**
- The substitution query runs ONCE per `runAgent` call, at prompt-render time, before the first model invocation.
- No isolate-level cache, no per-project cache, no Workers KV cache. Reasoning: connections list is small (<10 rows per project in v1.1), the query is fast (~5ms over Hyperdrive), and a stale cache could surface "Jira connected" after disconnect (or vice versa) within the same chat session — confusing.
- Block 5's loop already issues several DB queries per `runAgent` call (turn history fetch, message inserts); adding one more is in the noise.
- If profiling later shows this query as a hot path, Block 9 polish can add a per-isolate cache with TTL ≤30s.

**Specific failure mode the lock prevents:** the model claiming "I checked Jira" or "you don't have Jira connected" without any signal in the prompt. Without K, the model can't reliably distinguish "no Jira data" from "Jira not connected" — it either hallucinates an answer ("I couldn't find any Jira issues") or refuses to call the tool at all. K closes the gap. The candidate-sentence + D11-style sign-off discipline prevents the secondary failure mode of K landing with subtly-wrong wording that passes review-by-skim but produces wrong tool-selection behavior in production.

**Re-lock scope.** This decision is a re-lock for the new sentence + new slot, not for the surrounding Block 5 prose (which stays byte-identical). WORKFLOW addendum input: codify "adding a sentence to the locked prompt requires the same design-chat sign-off as editing existing prose, even if the surrounding text is untouched."

### L. UI — Connect Jira form + post-connect project picker modal

**Connections tab** in [project.html](public/project.html):
1. **Connect button** for Jira → opens an inline form (NOT a redirect; Jira has no consent flow). Form fields: site URL, account email, API token. Submit → `POST /api/connectors/jira/auth/save`.
2. **Save endpoint** (decision N — bespoke, not POST `/connections`) — admin-gated; calls `jira.completeAuth(ctx, formInput)`; on success INSERTs `connections` row at status='active'; redirects (via JS `window.location`) to `/project.html?project_id=...&tab=connections&just_connected=jira`.
3. **`?just_connected=jira`** triggers project-picker modal via L's analog to Slack's just_connected handler.
4. **Project picker modal** consumes G's endpoint; admin picks one project key. PATCH writes `credential_metadata.selected_project_key` + `selected_project_name`.
5. **"Sync now" button** triggers existing `POST /api/projects/:id/connections/:connId/sync` (Block 4).
6. **Connection row pill** lifecycle: "needs setup" (no project picked) → "syncing" (sync in flight) → "active" (last sync succeeded) → "error" (last sync failed; hover for `sync_runs.error`).

**Why no OAuth-flow redirect.** Decision A — API token model has no third-party consent; the entire credential write happens server-side from a form POST, not a callback.

### M. `writeEntityWithEmbedding` shared helper — Block 6 commit 0 (DEFAULT mode)

Extract two functions from [slack.js](functions/_lib/connectors/slack.js) to a new module `functions/_lib/connectors/_shared/entity_writer.js`:

```js
// Combined upsert + embed. Use from connector sync paths.
export async function writeEntityWithEmbedding(env, sql, projectId, connectionId, entity) {
  const upsertResult = await upsertEntityRow(sql, projectId, connectionId, entity);
  await embedEntityRow(env, sql, projectId, connectionId, upsertResult.id, entity);
  return upsertResult;
}

// Embed-only. Use from sweep paths (entity already exists).
export async function embedEntityRow(env, sql, projectId, connectionId, entityId, entity) {
  /* moved verbatim from slack.js:486-536 */
}

// Entity upsert — generalized to accept any source/source_type via the entity object.
export async function upsertEntityRow(sql, projectId, connectionId, entity) {
  /* moved verbatim from slack.js:429-457 */
}
```

Slack's three call sites change to:
- `_doSync` (~line 687): call `writeEntityWithEmbedding(env, sql, projectId, connectionId, entity)` instead of the sequential pair.
- `processMessageEvent` (~line 900): same.
- `sweepMissingEmbeddings` (~line 781): keeps calling `embedEntityRow` directly (entity already exists; no upsert).

`upsertEntityRow` and `embedEntityRow` are deleted from `slack.js` and re-imported from the shared module. Slack-specific entity construction (`mapMessageToEntity` at slack.js:385-419) stays in `slack.js`.

**Behavior preservation:** error paths are identical because `embedEntityRow` already swallows retryable + non-retryable errors internally (slack.js:508-521). The combined helper inherits that swallow-and-log contract. Sync continues on embedding failure; sweep recovery picks up missing rows on next sync.

**Verification gate (post-commit-0):** before any Block 6 work begins, run a Slack sync against the existing connection in Jenny's test workspace (Phase B's S1 below). If Slack still produces entities + embeddings, commit 0 is good; if not, halt and roll back commit 0 before proceeding.

**Specific failure mode the lock prevents:** every future connector (Block 7 Monday, Block 8 Drive) re-implementing the embed-on-write pattern. Drift across connectors silently breaks the "every entity has an embedding" invariant that hybrid search depends on. The shared helper is a one-line call site; missing it is a code-review red flag.

### N. Bespoke save endpoint — `POST /api/connectors/jira/auth/save` (NOT POST `/connections`)

The Block 4-era `POST /api/projects/:id/connections` handler is OAuth-shaped: it returns `{authUrl}` and expects the connector's `startAuth` to produce a redirect URL. Jira has no `authUrl` to return — credentials come in via form POST, not callback.

Decision: introduce a new endpoint `POST /api/connectors/jira/auth/save`:
- Method: POST
- Path: `/api/connectors/jira/auth/save`
- Body: `{ project_id, site_url, account_email, api_token }`
- Auth: admin role on `project_id` via `requireProjectRole(admin)`
- Behavior:
  1. Validate inputs (site_url is hostname-only e.g. `mycompany.atlassian.net`; email is RFC 5322; api_token non-empty).
  2. Construct an in-memory `connection`-shaped object with `id = crypto.randomUUID()`, `project_id`, `source = 'jira'`.
  3. Call `jira.completeAuth(ctx, {site_url, email, api_token})` — connector validates by calling `/myself` and returns `{credentials, accountInfo}`.
  4. Encrypt `credentials` via `aadFor` + `encrypt`.
  5. INSERT `connections` row at status='active', encryption columns populated, `external_account_id = site_cloud_id`, `credential_metadata = {site_url, account_email, atlassian_account_id}`.
  6. Respond `{ok: true, connection_id}`.
- Errors: `/myself` fails → 400 `{error: 'invalid_credentials'}`; rate-limited → 429; otherwise 500-collapse.
- **Carve-out file:** carries `// SECURITY-CARVE-OUT` banner; DEFAULT mode.

The handler does NOT modify the existing `POST /connections` shape; that handler still 501-stubs for unknown source types (Block 3 framework). Future API-token connectors (e.g. Block 7 Monday) follow the same `/api/connectors/${source}/auth/save` pattern.

**Specific failure mode the lock prevents:** trying to retrofit `POST /connections` to handle both OAuth (returns redirect) and API-token (consumes form) flows. A single endpoint with two modes invites the "wrong mode dispatched on missing field" class of bug — silent fallthrough where an OAuth save endpoint accepts API-token creds and writes them to the wrong cipher slot.

### O. `incrementalSync` cursor format — ISO 8601 `updated` timestamp string

`connection.last_sync_cursor` stores the ISO 8601 string of the max `fields.updated` value seen in the last sync (e.g. `"2026-05-10T14:32:11.123+0000"`). JQL `updated >= "${cursor}"` consumes it directly (Atlassian JQL accepts ISO 8601).

Boundary safety: cursor is set to max(updated), not max(updated)+1ms. JQL's `>=` plus the entity UPSERT idempotency (UNIQUE on connection_id + source_type + source_id) makes one duplicate fetch per sync run harmless. The alternative (max+1ms) risks losing issues whose `updated` matches the cursor exactly.

**Rationale:** Atlassian's JQL doesn't expose milliseconds reliably; idempotent UPSERT covers the boundary. Slack uses an analogous approach (Slack `ts` cursor, OR-equal not strict-greater).
**Tradeoff:** one redundant API call per sync run on the boundary issue. Negligible.

---

### P. Sonnet-only model usage; Haiku-routing explicitly deferred

Block 5 ships using Anthropic Sonnet for the agent loop's `runAgent` invocations (`createMessage` at loop.js:153). PROJECT.md §3 names the planned LLM strategy as "Sonnet for synthesis, Haiku for routing." Block 6 keeps Sonnet-only — does NOT introduce a Haiku-based pre-classifier ("should this question hit Slack search or Jira tools?") even though a tool-pre-router would arguably benefit from a cheap classifier.

**Rationale:** the Block 5 + Block 6 model has the agent itself decide tool selection inline via Sonnet's tool-use; adding a Haiku pre-classifier doubles the LLM call surface (Haiku call → tool selection → Sonnet call), introduces a second model whose lock posture isn't established, and benefits cost only at scale (Sonnet handles 6-iteration tool loops fine for v1.1 volumes). Net cost win is non-obvious until per-project cost cap (Block 9) actually surfaces hot-path projects.
**Tradeoff:** every Block 6 question pays Sonnet input cost for the system prompt + tool definitions on every turn, including questions Haiku could route trivially (e.g. "what's in this sprint" → obvious `get_jira_sprint_summary` call, doesn't need Sonnet's reasoning).
**Specific failure mode the lock prevents:** drift toward a multi-model loop without a corresponding cost-accounting + tool-selection-validation mechanism. Adding Haiku later is additive; rolling it back if the routing classifier hallucinates tool selections is harder.

**Block 9 candidate:** add a Haiku-based tool router that runs BEFORE the Sonnet loop, picks the tool subset to expose to Sonnet for that turn, and falls back to "expose all tools" on Haiku error. Requires: per-router-call cost telemetry, failure-mode coverage in verification matrix, locked Haiku prompt with its own D11-style review, A/B test of routed vs. unrouted answer quality. None of these are Block 6 work.

---

## Block 5 closeout carry-forward — explicit disposition

The Block 5 closeout left a long carry-forward queue. Each item below is named with its Block 6 disposition: **fold-in** (lands as Block 6 work), **fold-doc** (lands as a Block 6 plan/closeout note), **punt-Block-9** (named-and-deferred), or **punt-WORKFLOW** (codified into WORKFLOW addendum, not block-scoped).

### Folded into Block 6 work

- **`writeEntityWithEmbedding` shared-helper refactor.** → fold-in as commit 0 (decision M).
- **Production-env Pages secret confirmation discipline.** → fold-doc into pre-Block-6 prerequisites (Phase A enumerates `env.*` refs; result: zero new env vars for Block 6).
- **Cross-file naming consistency check (D11 system prompt's tool-name reference).** → fold-doc; commit 7 reviewer must grep `tools.js` exports vs. system prompt mentions of tool names. Add to commit 7 reviewer checklist.
- **DevTools-console-fetch pattern for admin-API runtime probes.** → fold-doc; Phase B's S3 + Phase C's runs all use this pattern (avoid pasting Atlassian API token into chat). Codify as a one-line note in the curl-matrix.

### Folded into Block 6 documentation only

- **Note B Risk #7 wording (per Block 5 plan v2.2 lines 286–288).** → fold-doc; not Block 6 work, but Block 6's plan should reuse the framing if any new tool exposes pre-flight token counting (none do; v1.1 keeps post-hoc `usage.input_tokens`). Mention in carry-forward, no Block 6 deliverable.
- **Anomalies and lessons drafts (HANDOFF:1660–1668).** → fold-doc; already in HANDOFF, no Block 6 emission.

### Punt to Block 9 (explicitly named, not Block 6 work)

- **S11 / S23 fixture-deferral re-run** at ≥100 indexed Slack messages → Block 9.
- **S2.5 + S16c synthetic injection harness** for project_id-mismatch tests → Block 9.
- **Multi-connection-per-team 500 → 200-ack-with-warn-log** (Block 5 post-merge finding) → Block 9 / v1.2.
- **Orphan entities on soft-deleted connections** (sweep doesn't cover disconnected connections) → Block 9.
- **`entity_embeddings.updated_at` column** → Block 9 observability polish.
- **Sync `records_updated` accuracy** (currently overcounts when only metadata refreshes) → Block 9 polish; **note**: Block 6's S9 idempotency test allows for sprint_count + boundary_issue_count overcount until this Block 9 fix lands.
- **`Plaintext` named secret row in Pages env cleanup** → Block 9 cleanup.
- **Cross-sync `users.info` cache** (Slack-specific; in-memory-per-sync only) → Block 9.
- **Tool-call trace viewer (admin observability)** → Block 9.
- **Inline `[1]` citation markers** → Block 9 polish.
- **Streaming Sonnet responses** → Block 9 polish.
- **Per-project day cap on AI cost** → Block 9 (cost-side telemetry already exists from Block 5).
- **"Refresh and ask again" action / "Data as of" timestamp surfacing** → Block 9 UI polish.
- **Materialized views for hot search paths** → Block 9.
- **UI "Change channel" affordance** (Slack-specific; analog for Jira: in-place project switch) → Block 9 polish.

### Punt to v1.2

- **Cross-project mode** (`project_ids: string[]` on tool inputs) → v1.2.
- **Slack `groups:*` private channel scopes** → v1.2.
- **One Slack workspace in two Elinno projects** → v1.2.
- **Atlassian OAuth 3LO** (decision A defers) → v1.2.

### Punt to Block 8 (chunked embeddings)

- **Chunked embeddings for long docs** (`chunk_index > 0`) → Block 8 (Drive long-doc requirement is the forcing function).

### Punt to WORKFLOW addendum (rework, not block-scoped)

- **Bridging gap recurrence** (Design-chat ↔ Claude Code artifact-travel discipline + verbatim quote-back protocol) → WORKFLOW.
- **OpenAI key transcript exposure precedent** (`read -s` for input + chat-reply discipline returns only `http=` + non-secret response shape) → WORKFLOW alongside the launchctl pattern.
- **Cursor markdown formatter still firing** → WORKFLOW operational note (not a code fix).
- **WORKFLOW: production secret confirmation should grep all `env.*` references.** → WORKFLOW addendum.
- **Block-4-era webhook matrix gap (lessons).** → WORKFLOW addendum: "decisions that add code paths need runtime cells, not just inspection."
- **WORKFLOW: additive template-slot insertion is a re-lock for the slot only, not the prose** (per K's lock pattern) → WORKFLOW addendum.
- **WORKFLOW: adding a sentence to the locked prompt requires the same design-chat sign-off as editing existing prose** (per K's broader lesson) → WORKFLOW addendum.
- **Phase 0 Check 5 STILL SKIPPED** (carried since Block 5; WORKFLOW addendum rework not yet done) → WORKFLOW.

### Cloudflare Queues for embedding retry

- **Defer until volume justifies.** → not Block 6, not Block 9, not v1.2 — gated on observed embedding-failure backlog. No-op for Block 6.

---

## Schema migrations summary

One migration in this block. Follows Block 4's pattern: file lands in repo for review; Jenny applies via Neon SQL Editor before the dependent code commit ships.

| File | Lands in | Applied before | Purpose |
| ---- | -------- | -------------- | ------- |
| `db/migrations/2026-MM-DD-jira-issues-view.sql` | commit 4 | Phase C (before commit 7's executor reads the view) | J's `jira_issues` view |

No `connections` schema changes (decision C reuses existing columns). No new env vars (per pre-Block-6 prerequisite).

---

## Commit ordering (10 commits + 2 reserved fixup slots + closeout)

Branch: `block-6-jira-connector`. Single branch, no sub-branches.

| #  | Subject | Notes (mode) |
| -- | ------- | ------------ |
| 0  | `refactor(block-6): extract writeEntityWithEmbedding to _shared/entity_writer.js` | DEFAULT. Pre-Block-6 helper extraction (decision M). Touches slack.js:429-457, 486-536, 681-694, 894-907; sweep keeps `embedEntityRow`. **Smoke-test Slack sync before proceeding to commit 1.** |
| 1  | `docs(block-6): lock Block 6 design decisions A–O` | AUTO. This file (`BLOCK_6_PLAN.md`). |
| 2  | `feat(block-6): add Jira connector — getMetadata/completeAuth/refreshAuth/testConnection` | DEFAULT (carve-out — credential write path). New `functions/_lib/connectors/jira.js` minus sync. Registry entry. `completeAuth` calls `/myself`. |
| 3  | `feat(block-6): bespoke POST /api/connectors/jira/auth/save endpoint` | DEFAULT (carve-out — credential write path). Decision N. Validates inputs, encrypts via `aadFor`, INSERTs at status='active'. |
| 3a | `fix(block-6): <one-line subject>` | **Reserved fixup slot** (mirror Block 4's 3a/7a discipline). Likely import-depth or migration-apply ordering. If unused, slot is dropped. |
| 4  | `feat(block-6): jira_issues view migration + Jira project listing endpoint` | AUTO for code; DEFAULT for migration application. **Migration file landed but NOT applied** — Jenny applies via Neon SQL Editor before commit 7 ships. G's bespoke `/jira/projects` endpoint reads B's `/project/search`. |
| 5  | `feat(block-6): Jira fullSync + entity mapping for jira_issue + jira_sprint` | DEFAULT. Decision E + H. Uses commit 0's `writeEntityWithEmbedding`. Sprint URL shape pinned to a real sprint at coding time. |
| 6  | `feat(block-6): Jira incrementalSync via JQL updated >= cursor` | DEFAULT. Decision E + O. E1 pagination cap + E2 rate-limit retry. |
| 7  | `feat(block-6): TOOL_DEFINITIONS add 3 Jira tools + executor handlers` | DEFAULT (carve-out — `tools.js` is locked-neighborhood). Decisions I1/I2/I3. URL-bound projectId substitution. |
| 7a | `fix(block-6): <one-line subject>` | **Reserved fixup slot.** If unused, slot is dropped. |
| 8  | `feat(block-6): SYSTEM_PROMPT {{AVAILABLE_SOURCES}} template slot + render-time query` | DEFAULT (carve-out — locked prompt module). Decision K. Scoped re-lock for slot only, not prose. |
| 9  | `feat(block-6): Connect Jira UI in project.html + project-picker modal` | AUTO. Decision L. Form POST → save endpoint → just_connected=jira → modal. |
| 10 | `docs(block-6): closeout — verification matrix + HANDOFF addendum` | AUTO. `curl-matrix-block-6.md` + HANDOFF Block 6 closeout. |

**Ordering rationale:**
- **Commit 0 first.** Helper extraction must precede any Jira code that uses it; verify Slack still works before Jira work begins.
- **Commit 7 (executor) before commit 8 (prompt).** New tools must register before the prompt advertises them. Reverse-order risk (8 before 7) is worse: prompt promises a tool the executor returns `unknown_tool` for.
- **Commit 4 (migration) before commit 7 (executor).** If executor lands first and Jenny hasn't applied the view, every Jira tool call errors at SQL layer. Match Block 4's apply-before-Phase-C discipline.
- **Commit 2 (auth) before commit 3 (save endpoint).** Save endpoint depends on `jira.completeAuth`.
- **Pre-allocated fixup slots 3a + 7a.** Block 4's import-depth bugs slipped past review at exactly these positions; Jira's `connectors/jira/` nesting (if it grows) has the same risk profile.

---

## Verification matrix

Continuous numbering across phases; ~22 scenarios. Full per-scenario detail in commit 10's `curl-matrix-block-6.md`.

### Phase A — Jenny's hands (between commits 1 and 4)
- Mint an Atlassian API token at https://id.atlassian.com/manage-profile/security/api-tokens; capture site URL + account email.
- Re-confirm `MASTER_ENCRYPTION_KEY` set in Production AND Preview environments (existing; sanity check per pre-Block-6 prerequisite).
- Apply J's view migration to Neon production via SQL Editor (before commit 7's executor needs it).
- Provide test Jira project with at least one active sprint and ≥5 issues spread across status_categories `new`/`indeterminate`/`done`.

### Phase B — Connector-layer smoke (preview deploy)
- **S1a.** Post-commit-0 regression — `_doSync` path: trigger Slack manual sync via `POST /api/projects/:id/connections/:connId/sync`. Confirm `sync_runs.records_inserted >= 0` AND new entity row(s) carry a matching `entity_embeddings` row (this is the path that calls `writeEntityWithEmbedding` from the shared module).
- **S1b.** Post-commit-0 regression — `processMessageEvent` (webhook) path: post a new message in the test Slack channel; within 5s, confirm a new `entities` row appears AND a matching `entity_embeddings` row (this is the path that calls `writeEntityWithEmbedding` from the webhook handler).
- **S1c.** Post-commit-0 regression — `sweepMissingEmbeddings` path: simulate missing-embedding state by `DELETE FROM entity_embeddings WHERE entity_id = $someSlackEntityId` against a Neon branch, then trigger sync. Confirm sweep re-creates the embedding row (this is the path that calls `embedEntityRow` standalone — the function that stays as a separate export from the shared module per decision M).
- **Halt-on-fail gate (revised 2026-05-10)**: per the cross-env data exercise rule (pre-Block-6 prerequisites), prod-encrypted Slack credentials cannot be decrypted on Preview. S1a/b/c therefore run as **PASS-by-inspection pre-merge** — code on disk verified (grep + read) for behavior preservation: import-paths + 2 mapping fields + 2 callsite collapses + 1 sweep call (byte-identical args) — and **PASS-runtime post-merge** against prod (Block 5 addendum pattern). Halt-on-fail still applies post-merge: a Slack regression that surfaces in production rolls back commit 0 + halts the rest of Block 6 pending diagnosis.
- **S2.** After commit 2: `getConnector('jira').getMetadata()` returns expected shape; `isKnownSource('jira')` returns true.
- **S3.** After commit 3: `POST /api/connectors/jira/auth/save` with valid credentials → 200 with `connection_id`; row exists at status='active', encryption columns populated, `external_account_id` = site cloud ID.
- **S4.** Same endpoint with invalid token → 400 `{error: 'invalid_credentials'}`; no row inserted.
- **S5.** Same endpoint without admin role → 403; no row inserted.

### Phase C — End-to-end against Jenny's test Jira project (preview deploy)
- **S6.** Connect → project picker modal opens via `?just_connected=jira` → picker lists test project → admin picks → PATCH writes `selected_project_key`.
- **S7.** Trigger sync → backfill writes ≥5 issues + ≥1 sprint to entities; embeddings written for issues.
- **S8.** Issue updated in Jira → next manual sync UPSERTs the row (`updated_at` advances).
- **S9.** Re-run sync immediately → idempotent (`records_inserted=0`, `records_updated=0` for unchanged issues; if Jira clock skew shows tiny `updated` drift, allow `records_updated <= sprint_count + boundary_issue_count`).
- **S10.** Sync without `selected_project_key` → inert sync (records_inserted=0, `sync_runs.detail.reason='no project selected'`, `last_sync_at` NOT advanced).

### Phase D — Tool surface (preview, against Phase C data)
- **S11.** `query_jira_issues({status_category: 'indeterminate'})` → returns rows; result_count ≥ 1; all rows have `source: 'jira'`, `source_type: 'jira_issue'`, `source_url` linking to Jira browse URL.
- **S12.** `query_jira_issues({sprint_id: <test_sprint_id>})` → returns rows scoped to that sprint.
- **S13.** `query_jira_issues({limit: 100})` → server clamps to 50 (per I1 ceiling); response includes `result_count <= 50`.
- **S14.** `list_jira_sprints({state: 'active'})` → returns the test sprint.
- **S15.** `get_jira_sprint_summary({sprint_id: <test_sprint_id>})` → returns `{issue_count, by_status_category, total_story_points, completed_story_points}` with values matching direct SQL count against `jira_issues` view.
- **S16.** `get_jira_sprint_summary({sprint_id: 999999999})` → returns `{error: 'sprint_not_found', sprint_id: 999999999}` (non-error tool result; agent loop continues).
- **S17.** End-to-end agent answer (BUILD_PLAN done-when): user asks "How many tickets are in this sprint?" via chat → agent calls `list_jira_sprints({state: 'active'})` → calls `get_jira_sprint_summary({sprint_id})` → final response cites the count + sprint name + sprint URL chip in UI.

### Phase E — Silent-failure-mode + auth/scoping (security-critical)
- **S18.** Project-isolation tripwire: a tool call from project A's chat receives `input.project_id` set to project B's id → executor logs D4c mismatch warning, substitutes A's id, returns A's data only.
- **S19.** Mirror Block 4 auth/scoping S17 against Jira connections (POST `/auth/save`, GET `/connections`, DELETE `/connections/:id`, POST `/sync`, GET `/sync_runs` — all reject non-admin or wrong-project sessions).
- **S20.** Plaintext-leak guard: `SELECT ciphertext_credentials FROM connections WHERE id = $jiraConn` → bytes are NOT the UTF-8 encoding of the API token.
- **S21.** Response whitelist: no `wrapped_data_key` / `ciphertext_credentials` / `encryption_algorithm` / `credential_metadata.api_token` (decision C: api_token MUST NOT be in credential_metadata) / `initiated_by_user_id` in any GET-connections response for Jira rows.
- **S22a.** System-prompt substitution — single source: project with only Slack connected → rendered prompt contains the substitution as `"Slack"` (bare name, no comma).
- **S22b.** System-prompt substitution — two sources: project with Slack + Jira connected → rendered prompt contains the substitution as `"Slack and Jira"` (English "and" join, no comma).
- **S22c.** System-prompt substitution — three sources (synthetic test only; v1.1 ships only Slack + Jira but the rendering function must handle 3+ for forward compatibility): seed a third connector row via Neon branch (`INSERT INTO connections … source='monday' status='active'`); rendered prompt contains the substitution as `"Slack, Jira, and Monday"` (Oxford comma per K's lock). Drop the seed row when done.
- **S22d.** System-prompt failure path: simulate query failure by pointing a Neon branch's connection cursor at a closed connection; rendered prompt contains the substitution as `"(temporarily unavailable; tool call decisions may be conservative)"` per K's failure semantics. Agent loop continues to model invocation; one-line warning logged.
- **S22-unreachable.** No empty-substitution test — empty case is unreachable per K's decision (loop.js:111-115 short-circuits before render). Document the unreachability in the curl-matrix entry; if a regression introduces a render call with an empty list, the substitution function's assertion + throw will surface it.

Jenny eyeballs the preview after Phase E before approving the push to main per WORKFLOW Phase 3.

---

## Critical files

**To create:**
- `BLOCK_6_PLAN.md` — commit 1
- `functions/_lib/connectors/_shared/entity_writer.js` — commit 0 (security carve-out)
- `functions/_lib/connectors/jira.js` — commit 2+ (security carve-out)
- `functions/api/connectors/jira/auth/save.js` — commit 3 (security carve-out)
- `functions/api/projects/[id]/connections/[connId]/jira/projects.js` — commit 4
- `db/migrations/2026-MM-DD-jira-issues-view.sql` — commit 4
- `curl-matrix-block-6.md` — commit 10

**To modify:**
- [functions/_lib/connectors/slack.js](functions/_lib/connectors/slack.js) — commit 0: remove `upsertEntityRow` + `embedEntityRow` (re-imported from shared module); update three call sites
- [functions/_lib/connectors/registry.js](functions/_lib/connectors/registry.js) — commit 2: add `jira` import + map entry
- [functions/_lib/ai/tools.js](functions/_lib/ai/tools.js) — commit 7: add 3 Jira tool definitions + executor handlers (security carve-out)
- [functions/_lib/ai/loop.js](functions/_lib/ai/loop.js) — commit 8: `{{AVAILABLE_SOURCES}}` template slot + substitution query (security carve-out)
- [public/project.html](public/project.html) — commit 9: Connect Jira form + project picker modal
- [HANDOFF.md](HANDOFF.md) — commit 10: Block 6 closeout addendum

**To consume but not modify:**
- [functions/_lib/crypto.js](functions/_lib/crypto.js) — `encrypt`, `decrypt`, `aadFor`
- [functions/_lib/connectors/types.js](functions/_lib/connectors/types.js) — `Connector` typedef
- [functions/_lib/auth.js](functions/_lib/auth.js) — `requireProjectRole`, `getSessionUser`
- [functions/_lib/ai/embeddings.js](functions/_lib/ai/embeddings.js) — `embedText` (called from `embedEntityRow` in shared module)
- [functions/_lib/ai/search.js](functions/_lib/ai/search.js) — kind-agnostic; Jira issues become searchable via existing `search_project_data` once embedded
- Block 4 `POST /sync`, `GET /connections`, `DELETE /connections/:id` handlers — Jira reuses unchanged
- Block 4 `PATCH /connections/[connId]` handler — reused for `selected_project_key` write (allowlist already includes `credential_metadata` keys; verify `selected_project_key` + `selected_project_name` are added to the allowlist if narrower than expected)

---

## Verification — end-to-end test plan

After all 10 commits land on the preview branch:

1. **Slack regression** (S1) — sync existing Slack connection, confirm new entity + embedding written.
2. **Jira connect flow** (S3 → S6) — DevTools-console-fetch `POST /api/connectors/jira/auth/save` with site URL + email + token (per Block 5 closeout DevTools-console-fetch pattern; avoid pasting token into chat). Verify project picker modal renders. Pick test project.
3. **Jira sync** (S7 → S10) — click "Sync now"; verify ≥5 issues + ≥1 sprint in entities; embeddings present for issues; idempotent re-run.
4. **Tool surface** (S11 → S16) — ask the agent each tool's question via chat; verify result_count, status_category breakdowns, sprint summary numbers match a direct SQL count.
5. **End-to-end** (S17) — ask "How many tickets are in this sprint?" → verify the answer cites the right number + sprint URL chip.
6. **Security** (S18 → S22) — run S18 cross-project probe; check S20 plaintext-leak guard; verify S22 prompt substitution.

Jenny eyeballs the preview, then approves the push to main per WORKFLOW Phase 3 and the per-push-to-main approval rule. ff-merge to local main → `git push origin main` → Cloudflare Pages deploys → re-run S6 + S7 + S17 against production to confirm.

---

## Block 7 prerequisites — what Block 6 sets up for Monday

- **API-token connector pattern.** Block 7 (Monday GraphQL with API token) follows decisions A + N: bespoke `/api/connectors/monday/auth/save` endpoint, encrypted token in `connections`, no OAuth callback. Block 6's pattern is the template.
- **`writeEntityWithEmbedding`** is shared infrastructure (decision M); Block 7 uses it without re-extraction.
- **`{{AVAILABLE_SOURCES}}` substitution** generalizes to Monday automatically (just add another source enum value to the connections table CHECK constraint enumeration).
- **Single-instance-per-project lock** (decision F) generalizes to Monday's per-account API tokens.

---

## Out-of-scope for Block 6

- OAuth 3LO for Atlassian — v1.2 (decision A defers).
- Webhook handler — Block 9 / v1.2 (decision E3 defers).
- Multi-project picker per Jira instance — Block 9 / v1.2 (decision D defers).
- Multi-instance per Elinno project — v1.2 (decision F defers).
- Custom field discovery beyond pinned `customfield_10020` (sprint) + `customfield_10016` (story points) — Block 9.
- Comment ingestion — Block 9.
- Attachment metadata — Block 9.
- ADF (Atlassian Document Format) → rich-text rendering — Block 9 (v1.1 ships plain-text extraction only).
- JQL passthrough on `query_jira_issues` — v1.2 (decision I1 defers).
- Velocity / burndown / cumulative-flow analytics — Block 9.
- Jira admin events (project created, status workflow change) — out of v1.x scope.
- Cron-triggered nightly sync — Block 9.
- `jira_sprints` view — Block 9 (decision J defers).
- AI tool to UPDATE Jira (status transitions, assignment, etc.) — out of v1.x scope (read-only per PRD).

---

## Open follow-ups — Block-6-specific (queued, not Block 6 work)

> Cross-block carry-forwards already dispositioned in "Block 5 closeout carry-forward — explicit disposition" above are NOT repeated here. This section is Block-6-specific deferrals only.

- **Sprint URL shape verification.** Decision H notes the URL pattern needs verification against a real Jira instance at commit 5 coding time. Pin in commit 5 commit message.
- **`status_category` enum drift.** Atlassian uses `new` / `indeterminate` / `done` as the three category keys; verify against `/rest/api/3/statuscategory` at commit 5 coding time; pin if any custom workflow uses additional categories.
- **`customfield_10016` (story points) instance drift.** Decision B pins this against Jenny's test instance at commit 5 coding time. Other Atlassian Cloud instances can have different IDs (custom workflow imports, instance-age artifacts). Same risk class as `status_category` enum drift; same Block 9 mitigation (custom field discovery endpoint).
- **`customfield_10020` (sprint) instance drift.** Same risk class; same commit-5 pinning; same Block 9 mitigation.
- **Sprint completion vs. close.** Atlassian sometimes fires `complete_date` separately from `state='closed'`. Verify behavior against a closed sprint at commit 5 coding time; metadata schema may need a `completed_at` distinct from `end_date`.
- **K candidate sentence sign-off.** Decision K's exact wording requires a D11-style design-chat review pass before commit 8 ships. Treat as a Block 6 hard gate, not just a follow-up.
- **`detail` JSONB on Jira `sync_runs`** — Jira-specific instance of the broader Block 9 admin observability follow-up.
- **I1 `clamped` flag in result payload.** Decision I4 requires `query_jira_issues` to include `clamped: true` when `result_count == limit`. Verify in commit 7 unit + S13 cell. If the model fails to surface the clamp, system-prompt guidance (decision K candidate sentence variant) tells it to.
- **Block 9 polish hooks tied to v1.1 completeness (Jira-specific):** webhook handler (E3), multi-project picker (D), `jira_sprints` view (J), nightly cron, ADF rich-text, custom field discovery endpoint, comment ingestion, attachment metadata, in-place project switch, ADF heading + paragraph + list rendering beyond plain-text extraction.

---

## Things deferred (don't build in Block 6)

- **Cloudflare Cron Triggers for nightly sync** — Block 9.
- **Cloudflare Queues for embedding retry** — when volume justifies (per Block 5 closeout).
- **OAuth 3LO + Atlassian Marketplace registration** — v1.2 (decision A).
- **Webhook signature verification helper** — Block 9 if multiple connectors need it (Block 4 D defers extraction until Block 6+).
- **Haiku-routing pre-classifier** — Block 9 (decision P). Sonnet-only stays in Block 6.
- **General-purpose `aggregate_jira` tool** — v1.2 candidate per decision I4. Block 6 ships sprint-scoped aggregation only.
- **JQL passthrough on `query_jira_issues`** — v1.2 (decision I1).
- **Materialized `jira_issues` view** — Block 9 polish if hot path emerges.
- **`writeEntityWithEmbedding` chunking** — Block 8 polish (Drive's long docs need `chunk_index > 0`).
- **Custom field discovery endpoint** — Block 9 (mitigation for B's `customfield_*` instance drift).
- **Block 7+ work**: Monday connector, Drive connector, polish.

---

*End of Block 6 Build Plan v1.1. Generated 2026-05-10 in the design session for the Jira connector block, post-Block-5 closeout. Mirrors the structure of BLOCK_4_PLAN.md for consistency. Updates to locked decisions require a re-lock from Jenny per WORKFLOW.md.*

*v1.1 rework rounds (vs. v1.0):*
- *Added I4 (no general-purpose `aggregate_jira` tool — missing-by-design lock with clamp-flag mitigation).*
- *Reworked K (failure semantics, caching scope, exact candidate sentence pinned for D11-style sign-off, dropped unreachable empty-substitution case per loop.js:111-115 short-circuit).*
- *Expanded S1 → S1a/S1b/S1c (covers all three slack.js call sites touched by commit 0).*
- *Reordered I1 rationale (architecture-drift first, SQL-injection second).*
- *Reframed E1 as v1.1 known limitation (no nightly cron until Block 9; admin manual sync only).*
- *Added P (Sonnet-only model usage; Haiku-routing explicitly deferred to Block 9 with named criteria).*
- *Added "Block 5 closeout carry-forward — explicit disposition" section (every queue item dispositioned: fold-in / fold-doc / punt-Block-9 / punt-v1.2 / punt-Block-8 / punt-WORKFLOW).*
- *Fixed B intro count (three → five endpoints).*
- *Added `customfield_10016` + `customfield_10020` instance-drift verification follow-ups (parallel to status_category enum drift).*
- *Expanded S22 → S22a/S22b/S22c/S22d (Oxford-comma rendering coverage + failure-path coverage); documented S22-unreachable for the empty case.*
- *Deduped Open follow-ups vs. carry-forward disposition section.*
- *Added Haiku-routing + I1 JQL passthrough + I4 aggregate_jira to Things deferred for symmetry.*
