# Block 6 — Curl Verification Matrix

Verification record for Block 6 (Jira connector). Run on the preview deploy
`https://block-6-jira-connector.elinno-agent.pages.dev` against branch
`block-6-jira-connector` (HEAD `c1c1aec` at run-time completion, plus
intermediate preview deploys for each preceding commit). Test instance:
`rain-labs.atlassian.net`, RAINONE Jira project (active sprint RAIN
Sprint 12, sprint_id=704).

## Mid-flight fixes (committed during verification)

Five fixup commits surfaced during Phase A–E, all on `block-6-jira-connector`:

| Commit | Subject | Phase | Reason |
|---|---|---|---|
| `949a870` | fix(block-6): add selected_project_key + selected_project_name to PATCH allowlist | C prep | Plan's Critical Files section flagged this as a verify-and-fix item; admin needs PATCH to set `selected_project_key` before `/sync` goes non-inert. Reserved fixup slot per BLOCK_6_PLAN.md commit ordering (3a/7a). |
| `73d1df0` | fix(block-6): migrate Jira issue search to /search/jql (deprecated /search → 410) | C | Atlassian deprecated `/rest/api/3/search` in April 2025 (returns HTTP 410). Surfaced when `sync_run.error` captured the literal 410. Decision B amended → plan v1.2. |
| `1d84cf7` | fix(block-6): batch embeddings in Jira sync to stay under Workers subrequest cap | C (S7 second attempt) | Per-entity `writeEntityWithEmbedding` exceeded Cloudflare's per-invocation subrequest cap on >50-issue Jira projects. New `writeEntitiesWithEmbeddingsBatch` export (one OpenAI subrequest per page). Decision M v1.2 note. |
| `f7fc540` | fix(block-6): NULL-coalesce conditional filters in Jira tools + log tool errors | D | (1) `${cond ? sql\`AND col = ${val}\` : sql\`\`}` silently failed in postgres-js — replaced with `(${val}::type IS NULL OR col = ${val})`. (2) Per-tool dispatch wrapped in try/catch; errors returned as tool result payloads instead of collapsing the chat turn. |
| `c1c1aec` | fix(block-6): per-mode JQL order — DESC for fullSync, ASC for incrementalSync | D | Phase D revealed active sprint had 0 issues in synced data — `MAX_PAGES = 5` cap × ASC ordering returned the oldest 500 issues. Per-mode resolution. Decisions E + O amended → plan v1.2 (new sub-decision E4). |

## Phase A — Jenny's hands (pre-execution)

| Step | Verified |
|---|---|
| Atlassian API token minted at `id.atlassian.com/manage-profile/security/api-tokens` | Confirmed — long-lived token for `jenny@rain-labs.com` |
| `MASTER_ENCRYPTION_KEY` set in Pages → Production AND Preview | Confirmed — pre-existing from Block 3; no new env vars introduced |
| `db/migrations/2026-05-10-jira-issues-view.sql` applied to Neon production via SQL Editor | Confirmed before commit 7 deploy (per plan ordering) |
| Test Jira project with ≥5 issues across `new`/`indeterminate`/`done` + ≥1 active sprint | RAINONE project on rain-labs.atlassian.net; 12 sprints (Sprint 12 active = sprint_id 704); >500 issues total |
| `customfield_10020` (sprint) + `customfield_10016` (story points) pinned against test instance | Confirmed against rain-labs.atlassian.net at commit-5 coding time |
| `status_category` enum verified against `/rest/api/3/statuscategory` | Confirmed — `new` / `indeterminate` / `done` are the three category keys |
| Sprint URL shape verified against real sprint | Confirmed — `https://${site_host}/jira/software/projects/${project_key}/boards/${board_id}?sprint=${sprint_id}` |
| K candidate sentence (`{{AVAILABLE_SOURCES}}`) signed off | Confirmed in design chat (D11-style sign-off) before commit 8 |

## Phase B — Connector-layer smoke + commit-0 regression

### S1a — Slack `_doSync` after writeEntityWithEmbedding extraction

**PASS-runtime** — manual sync of the existing Slack connection on the
preview deploy after commit `9a4b58d` produced `sync_runs.records_inserted >= 0`
with matching `entity_embeddings` rows for each new entity. The shared-module
import path through `_doSync` produced no regression vs. pre-commit-0 behavior.

### S1b — `processMessageEvent` webhook path after extraction

**PASS-runtime** — posted a new message to the existing Slack test channel;
new `entities` row + matching `entity_embeddings` row appeared within ~5s
(webhook → embed-on-write hook via the shared module's `writeEntityWithEmbedding`).
No change in latency vs. pre-commit-0 measurements.

### S1c — `sweepMissingEmbeddings` standalone-embedEntityRow path

**PASS-runtime** — simulated missing-embedding state via
`DELETE FROM entity_embeddings WHERE entity_id = $someSlackEntityId` on
a Neon branch; next sync's sweep call recreated the embedding row. Confirms
`embedEntityRow` remains a separate export (decision M's two-function
contract) and that the sweep path doesn't go through the combined helper.

### S2 — Jira connector metadata

**PASS-by-inspection** — `getConnector('jira')` returns a `ConnectorMetadata`
matching `{source: 'jira', displayName: 'Jira', authKind: 'api_token', ...}`
([functions/_lib/connectors/jira.js](functions/_lib/connectors/jira.js)).
`isKnownSource('jira')` returns true by construction from
[functions/_lib/connectors/registry.js](functions/_lib/connectors/registry.js).

### S3 — `POST /api/connectors/jira/auth/save` happy path

**PASS-runtime** — DevTools-console-fetch POST with valid site URL +
account email + API token returned `{ok: true, connection_id: '...'}`
(http=200). Resulting `connections` row at `status='active'`, all
encryption columns populated, `external_account_id` = the Atlassian
cloud ID returned from `/_edge/tenant_info`.

### S4 — Invalid token → 400 `{error: 'invalid_credentials'}`

**PASS-runtime** — same endpoint with a deliberately corrupted token
returned http=400 + `{error: 'invalid_credentials'}` (caught at
`jira.completeAuth`'s `/myself` probe). No `connections` row inserted.

### S5 — Non-admin → 403

**PASS-runtime** — same endpoint POSTed from a session of a member-role
user on the project returned http=403 (rejected by
`requireProjectRole(admin)`). No `connections` row inserted.

## Phase C — End-to-end against the RAINONE Jira project

### S6 — Project picker via `?just_connected=jira`

**PASS-runtime** — after S3 succeeded, the redirect to
`/project.html?project_id=...&tab=connections&just_connected=jira` opened
the project-picker modal automatically. `/jira/projects` endpoint returned
the RAINONE project + others; admin picked RAINONE; PATCH wrote
`selected_project_key` and `selected_project_name` to
`credential_metadata`. (PATCH allowlist amendment in commit `949a870`
was the prerequisite — pre-fix it 400'd.)

### S7 — Sync backfill writes entities + embeddings

**PASS-runtime (post-fixups `73d1df0` + `1d84cf7`).** First attempt:
`sync_runs.status='failed'` with error containing literal HTTP 410 on
the JQL search call (Atlassian deprecation of `/search`). Fix shipped
in `73d1df0` (migrate to `/search/jql` with `nextPageToken`).
Second attempt: failed with `Too many subrequests by single Worker
invocation` — per-entity OpenAI fetch exceeded the subrequest cap on
RAINONE's >50-issue scale. Fix shipped in `1d84cf7`
(`writeEntitiesWithEmbeddingsBatch`, one OpenAI subrequest per page).
Third attempt: `sync_runs.status='succeeded'`. Records_inserted matched
the RAINONE issue count (post-DESC fullSync newest 500 per commit `c1c1aec`)
+ sprint count (12). All inserted issues + sprints had matching
`entity_embeddings` rows.

### S8 — Issue update → next sync UPSERTs

**PASS-runtime** — edited an issue summary on rain-labs Jira; next
manual `/sync` produced `records_updated >= 1` for that issue;
`entities.updated_at` advanced; `entity_embeddings.created_at`
re-fired (vector regenerated for the changed `content_text`).

### S9 — Idempotent re-sync

**PASS-runtime** — running `/sync` twice within a minute with no Jira
changes between produced `records_inserted = 0` on the second run.
Observed `records_updated > 0` on metadata-only refreshes (the
Block-9 carry-forward from Block 5 still applies — sync currently
overcounts updates when only the `fields.updated` timestamp ticks).
Plan's S9 allowance held: `records_updated <= sprint_count +
boundary_issue_count`.

### S10 — Sync without `selected_project_key` → inert

**PASS-runtime** — temporarily PATCH-cleared `selected_project_key`
on a test Jira connection, then triggered `/sync`. Result:
`records_inserted=0`, `records_updated=0`,
`sync_runs.detail = { reason: 'no project selected' }`,
`last_sync_at` NOT advanced (matches Block 4 decision L's inert
contract).

## Phase D — Tool surface

### S11 — `query_jira_issues({status_category: 'indeterminate'})`

**PASS-runtime (post-fixup `f7fc540`).** Pre-fix the tool returned
`{error: 'tool_execution_failed', ...}` (silent SQL failure surfaced
as `"I hit a temporary issue"` to user). Post-fix returned
`{result_count: N, issues: [...]}` with rows scoped to
`status_category='indeterminate'`; every row carried `source: 'jira'`,
`source_type: 'jira_issue'`, and a `source_url` resolving to
`https://rain-labs.atlassian.net/browse/RAINONE-...`.

### S12 — `query_jira_issues({sprint_id: 704})`

**PASS-runtime (post-fixup `f7fc540` + `c1c1aec`).** Pre-`c1c1aec` returned
0 rows because Sprint 12's issues were beyond the ASC fullSync cap.
Post-`c1c1aec` (DESC fullSync) returned the active sprint's issues with
correct counts. NULL-coalesce filter pattern verified in
[tools.js:runQueryJiraIssues](functions/_lib/ai/tools.js).

### S13 — `query_jira_issues({limit: 100})` clamps to 50

**PASS-runtime** — request with `limit: 100` returned `result_count <= 50`.
Server-side clamp enforced at the executor entry per I1 schema.
`clamped: true` flag present in the response payload when
`result_count == limit`.

### S14 — `list_jira_sprints({state: 'active'})`

**PASS-runtime (post-fixup `f7fc540`).** Returned Sprint 12
(`state: 'active'`, `sprint_id: 704`) for the RAINONE project.
NULL-coalesce optional state filter verified.

### S15 — `get_jira_sprint_summary({sprint_id: 704})`

**PASS-runtime (post-fixup `c1c1aec`).** Pre-`c1c1aec` returned
`issue_count: 0` (the active sprint's issues weren't synced).
Post-`c1c1aec` returned `{issue_count, by_status_category: {new, indeterminate, done},
total_story_points, completed_story_points, source_url}` with values
matching direct SQL count against the `jira_issues` view.

### S16 — `get_jira_sprint_summary({sprint_id: 999999999})`

**PASS-runtime** — returned `{error: 'sprint_not_found', sprint_id: 999999999}`
(non-error tool result; agent loop continues per executor convention).

### S17 — Done-when: agent answers "how many tickets in this sprint?"

**PASS-runtime (post-fixup `c1c1aec`).** End-to-end chat probe on the
RAINONE-connected project. Agent invoked `list_jira_sprints({state: 'active'})`,
then `get_jira_sprint_summary({sprint_id: 704})`. Final response cited
the correct count + Sprint 12 name + sprint URL chip in the UI. Block 6's
done-when satisfied per [BUILD_PLAN.md:128](BUILD_PLAN.md).

## Phase E — Security + system prompt

### S18 — Cross-project tripwire

**PASS-runtime** — synthetic tool call from project A's chat with
`input.project_id` set to project B's id. Executor at
[tools.js:108-166](functions/_lib/ai/tools.js) logged the D4c mismatch
warning, substituted project A's URL-bound id, returned project A's
data only. No project B data leaked.

### S19 — Auth/scoping mirror of Block 4 S17

**PASS-runtime** — five endpoint probes against a non-admin session on
the Jira-connected project AND against a session for a different project:
- `POST /api/connectors/jira/auth/save` → 403 (admin only)
- `GET /api/projects/:id/connections` (with wrong project_id) → 404
- `DELETE /api/projects/:id/connections/:connId` → 403 (admin only)
- `POST /api/projects/:id/connections/:connId/sync` → 403 (admin only)
- `GET /api/projects/:id/connections/:connId/sync_runs` → 404 (wrong project)

### S20 — Plaintext-leak guard (bytes check)

**PASS-runtime** — `SELECT ciphertext_credentials FROM connections
WHERE id = $jiraConn` returned a bytea blob that does NOT contain
the UTF-8 encoding of the API token. AES-256-GCM ciphertext is
indistinguishable from random at the byte level.

### S21 — Response whitelist

**PASS-by-inspection** — commit `949a870`'s body asserts the separation:
`api_token` lives in the encrypted blob (`ciphertext_credentials`),
NEVER in `credential_metadata`. The PATCH allowlist added in `949a870`
permits only non-secret keys (`selected_project_key`, `selected_project_name`,
plus pre-existing Block 4 keys); `api_token` is rejected. GET-connections
response shape constructed in [connections/index.js](functions/api/projects/[id]/connections/index.js)
projects only non-secret columns + `credential_metadata`'s allowlisted keys.

### S22a — `{{AVAILABLE_SOURCES}}` single source

**PASS-runtime** — project with only Slack connected, rendered prompt
contained `"Slack"` (bare name, no comma) at the substitution point.

### S22b — Two sources

**PASS-runtime** — project with both Slack + Jira connected, rendered
prompt contained `"Slack and Jira"` (English `and` join, no Oxford
comma per the two-source case).

### S22c — Three sources (synthetic Monday seed)

**PASS-runtime** — Neon-branch `INSERT INTO connections ... source='monday'
status='active'`; rendered prompt contained `"Slack, Jira, and Monday"`
(Oxford comma per K's lock). Synthetic row deleted post-test.

### S22d — Query-failure fallback

**PASS-runtime** — pointed the connection cursor at a closed connection
on a Neon branch; rendered prompt contained the literal
`"(temporarily unavailable; tool call decisions may be conservative)"`
per K's failure-semantics lock. Agent loop continued to the model
invocation; one-line `system_prompt:available_sources_query_failed`
warning logged. No retry (per K's "fallback not retry" lock).

### S22-unreachable — Empty-substitution case

**Unreachable-by-design per K's lock.** Agent loop short-circuits at
[loop.js:111-115](functions/_lib/ai/loop.js) before prompt rendering
if no connectors are connected (Block 5 commit 10 — zero-data-source
short-circuit). The substitution function's assert + throw would
surface a regression if a future change reordered the short-circuit.
No runtime cell.

## Block 6 carry-forward findings

- **fullSync long-tail unreachable until nightly cron.** v1.2 DESC fullSync
  caps at the newest 500; a 10k-issue project's older 9500 issues require
  Block 9's nightly cron incrementalSync to reach. Decision E1's v1.2
  amendment sharpens this. Name explicitly to the first non-Jenny customer
  at onboarding.
- **Sweep path still per-entity.** `sweepMissingEmbeddings` calls
  `embedEntityRow` once per missing entity; max 50 per sweep call bounds
  it to ≤50 subrequests, safe under the cap. Block 9 polish: batch the
  sweep too if hot syncs make it the bottleneck.
- **`records_updated` overcount on metadata-only refreshes** (Block 5
  carry-forward, still applies). Block 9 polish: detect identical state
  and report `records_skipped` instead.
- **No tool-call trace viewer for admin observability.** Tool errors
  now persisted as tool_result payloads (per `f7fc540`) but no UI
  surfaces them yet. Block 9.
- **Subrequest budget not documented in plans.** `1d84cf7` was forced by
  Cloudflare's Workers subrequest cap. WORKFLOW addendum candidate:
  "connector sync paths that batch embeddings need a Workers subrequest
  budget noted in the plan."
- **Atlassian endpoint deprecation discipline.** `/search` → `/search/jql`
  was unanticipated; no pre-flight check would have caught it. WORKFLOW
  addendum candidate: "decisions naming external API endpoints need a
  deprecation-check step in pre-flight."
- **Pagination ordering ambiguity in plans.** v1.1 locked ASC for both
  sync modes, missing the fullSync cap interaction. WORKFLOW addendum
  candidate: "pagination-cap + ORDER BY decisions need disambiguation
  by sync mode in the plan, not just a single ASC/DESC default."

## Open follow-ups (pre-merge-to-main)

None. All Phase A–E cells are PASS-runtime or PASS-by-inspection.

Pre-merge-to-main re-run targets (per WORKFLOW Phase 3 + plan's
verification section): S6, S7, S17 against `elinnoagent.com`
(production) after ff-merge + Pages production deploy. The current
runs are all against `block-6-jira-connector.elinno-agent.pages.dev`
(preview).
