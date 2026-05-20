# Product Requirements Document — v1.3

**Elinno Agent — What's New in v1.3**

| Field | Value |
|---|---|
| Document | PRD v1.3 |
| Owner | Jenny (jenny@elinnovation.net) |
| Status | Draft — ready for review |
| Last updated | 2026-05-19 |
| Baseline | PRD v1.2 (auth, projects, Slack + Jira read tools, hybrid search, agent loop with citations, freshness timestamps, rate limits, cost-cap infrastructure, `aggregate_jira`) |
| Related | Build Plan v1.3 (to be drafted), HANDOFF.md, BLOCK_11_PLAN.md |

---

## 1. Scope

PRD v1.1 shipped auth, projects, Slack + Jira read-only connectors, hybrid search, the tool-calling agent loop with citations, freshness timestamps, rate limits, and the cost-cap infrastructure. PRD v1.2 shipped `aggregate_jira` (counting / grouping / cross-sprint comparison over Jira) plus the polish needed to onboard a non-Jenny user (connection management UI, "data as of" timestamps, nightly cron, suggested example questions, `records_skipped` accounting, refresh-and-ask-again, per-project cost cap, daily message limits, sweep-path batching, tool-call trace viewer). v1.3 is a delta on that baseline.

v1.3 ships **one** capability addition plus the polish work to make it usable:

1. **Cross-project AI mode** — a second chat surface, scoped to a user-selected set of projects, that lets the agent answer comparison and rollup questions across projects ("compare velocity between Project A and Project B over the last 3 sprints," "which of my projects has the most overdue tickets," "what themes are coming up in Slack across Projects A, B, C this week"). Originally sketched in PRD v1.1 §11.1; deferred from v1.2 per PRD v1.2 §6 deferred-list item 5. Detailed design in §3.
2. **Cross-project mode polish** — workspace-level AI cost cap, cross-project chat surface entry point, project-set picker, citation disambiguation (project-name chip prefix + prose rule). Detail in §4.

**Not in v1.3** — kept in §6 explicit cuts so v1.4+ inherits a clean scope:

- **Per-project "include in cross-project queries" flag.** From PRD v1.1 §11.1 sketch. Deferred — no concrete sensitive-project use case yet; authorization without exclusion is already the security floor.
- **Named persistent project sets** ("My Q2 Projects," shareable, addressable). Workflow ergonomics on top of the capability; ship the ad-hoc picker first, watch usage, design persistence against evidence.
- **Cycle time / time-in-status / throughput-over-time / burndown / bottleneck.** Still blocked on Jira transition history (sync-layer change). Same lock as PRD v1.2.
- **Cross-source aggregation (`aggregate_entities`).** Has no consumer until v2.0 ships Monday + Drive.
- **OR predicates in the DSL, materialized `jira_issues` view, free-text predicates in `aggregate_jira`.** Same locks as PRD v1.2.

**Parked for v2.0 — not in any 1.x release:**

- **Monday connector.** Originally MVP in v1.1; deferred. v2.0 is the multi-source release.
- **Google Drive connector.** Same.
- **Drive: images and OCR.** Follows Drive baseline.
- **Write-back actions.** Read-only stays.
- **Additional connectors** (Notion, Telegram, GitHub, Linear, HubSpot). Plug-in via connector registry.

The 1.x series is the Slack + Jira era. v2.0 is the multi-source era. v1.4 / v1.5 / etc. carry their own scopes within the 1.x series; this PRD covers v1.3 only.

---

## 2. User Stories (v1.3)

User stories are written from the perspective of the personas this delta serves: the **user** in a cross-project chat (asks comparison / rollup questions), the **workspace admin** (operates cross-project mode, owns the cost cap, edits project settings), and **Jenny / future devs** (operates the platform, validates the security boundary). All stories assume cross-project mode unless otherwise noted; single-project behavior is unchanged from v1.2 except where called out.

Each story names the question class or capability it serves, has a single acceptance test, and maps to the v1.3 section it justifies.

### 2.1 Member stories — cross-project comparison (justifies §3)

**US-1. Velocity comparison across two projects.**
*As a user with multiple projects in my workspace, I want to ask "compare velocity between Rain and Joni over the last 3 sprints" and get sprint-by-sprint story-point totals side by side, so I can see how the projects' delivery rates differ.*
- **Acceptance:** Agent calls `list_jira_sprints({ project_ids: [A,B], state: 'closed' })`, then `aggregate_jira` with `project_ids: [A,B]`, `where: { sprint_id: { in: [...] }, status_category: 'done' }`, `select: ['project_id', 'sprint_name', 'SUM(story_points)']`, `group_by: ['project_id', 'sprint_name']`. Returns 6 rows (3 sprints × 2 projects). Agent synthesizes side-by-side comparison in prose with project names inline. Citation chips prefixed `[RAIN]` / `[Joni]`.

**US-2. Rollup ranking across all projects in scope.**
*As a workspace admin, I want to ask "which of my projects has the most overdue tickets?" and get a ranked list with counts per project, so I can spot delivery risk.*
- **Acceptance:** Agent calls `aggregate_jira` with `project_ids: [<all selected>]`, `where: { status_category: { neq: 'done' }, source_created_at: { lt: <14d ago> } }`, `select: ['project_id', 'COUNT(*)']`, `group_by: ['project_id']`, `order_by: [{ field: 'count', dir: 'desc' }]`. Returns one row per project in scope, count desc. Agent reports ranking with project names inline; citation chips per project.

**US-3. Bug throughput comparison.**
*As a member, I want to ask "compare bug-close rate between RAIN and Joni this sprint" and get two numbers I can directly compare, so I can tell which project is shipping bug fixes faster.*
- **Acceptance:** Agent first identifies the active sprint per project via `list_jira_sprints({ project_ids: [A,B], state: 'active' })`, then `aggregate_jira` with `project_ids: [A,B]`, `where: { sprint_id: { in: [...] }, issue_type: 'Bug', status_category: 'done' }`, `select: ['project_id', 'COUNT(*)']`, `group_by: ['project_id']`. Two rows. Agent presents as comparison, not a list.

**US-4. Per-assignee workload across projects.**
*As a user with multiple projects in my workspace, I want to ask "across all my projects, who's the busiest assignee right now?" and get a ranked list of people with their ticket counts, so I can see who's most loaded across our portfolio.*
- **Acceptance:** Agent calls `aggregate_jira` with `project_ids: [<all selected>]`, `where: { status_category: { in: ['new', 'indeterminate'] } }`, `select: ['assignee_display_name', 'COUNT(*)']`, `group_by: ['assignee_display_name']`, `order_by: [{ field: 'count', dir: 'desc' }]`. Returns top-N ranked. If a person works in multiple projects, their tickets are summed across projects (the question is intentionally cross-project). Agent notes "across N projects" in scope-line of response.

**US-5. Cross-project Slack themes.**
*As a workspace admin, I want to ask "what themes are coming up in Slack across RAIN, Joni, and Project C this week?" and get topic summaries grouped by source project, so I can stay aware of cross-project conversation patterns.*
- **Acceptance:** Agent calls `search_project_data` with `project_ids: [A,B,C]`, `query: 'this week'`, `sources: ['slack']`. Returns up to 10 entities (hybrid keyword + semantic). Agent synthesizes themes per project. Citations grouped under per-project chip prefixes. This story justifies extending `search_project_data` cross-project (not only `aggregate_jira`).

**US-6. Cross-project detail listing.**
*As a member, I want to ask "across my projects, list all unresolved high-priority bugs oldest first" and get a ranked list with project, issue key, title, age, link, so I can triage globally.*
- **Acceptance:** Agent calls `query_jira_issues` with `project_ids: [<all selected>]`, `priority: 'High'`, `status_category: 'new'`, `issue_type: 'Bug'`. Returns up to 50 issues ordered by `source_updated_at DESC` (existing behavior); agent re-presents oldest-first by `source_created_at` from the payload, with project name prefix on each row. Citation chips prefixed by project.

### 2.2 Member stories — honest "can't answer" (justifies §3.7 + cross-project not-supported additions)

**US-7. Cross-project cycle time refusal.**
*As a member, when I ask "average cycle time across my projects" the agent should refuse honestly, not approximate.*
- **Acceptance:** Same refusal text shape as PRD v1.2 US-7. Cycle time is not supported regardless of mode; transition history is still missing. Response: "Cycle time isn't tracked yet — I don't have status transition history, only the most recent update time, which doesn't tell me when a ticket moved to Done. This is unchanged in cross-project mode."

**US-8. Workspace-scope refusal.**
*As a user, when I (or a misbehaving client) reference a project outside my workspace, the agent should refuse honestly, not silently drop the project from scope.*
- **Acceptance:** Authorize step (per §3.6.1) returns `error: 'authorization', code: 'project_not_in_workspace', missing: [<Z>]`. Agent surfaces: "I can't include Project Z — it's not in your workspace." Agent does **not** continue with a partial answer; the request fails closed.

### 2.3 User stories — picker + scope visibility (justifies §4)

**US-9. Picker selection.**
*As a user, I can open the cross-project chat surface, pick a set of projects via a multi-select picker, and start asking questions — without configuring anything else.*
- **Acceptance:** Picker shows every project in the user's workspace with the relevant connector (Jira in v1.3), sorted by recent use. Multi-select with search/filter, "select all visible," "clear." Minimum 1, maximum N (no hard cap in v1.3; soft ceiling enforced by message-limit + cap). Picker selection lives on the new conversation row's `project_ids` column.

**US-10. Scope visibility in chat.**
*As a user in a cross-project chat, I can see at all times which projects are in scope, so I never lose track of whose data the agent is reasoning over.*
- **Acceptance:** Header shows "Cross-project: Rain, Joni, Project C (3 projects)" on every screen of the chat. Each answer also opens with a brief scope line ("Across Rain, Joni, and Project C: …") in agent prose.

**US-11. Single-project chat unchanged.**
*As a user in a per-project chat, my experience is unchanged from v1.2 — no new picker, no project-name prefix on citation chips, no scope line.*
- **Acceptance:** Single-project chats render identically to v1.2. `project_ids` on the conversation row is null (existing `project_id` is the single value); the executor uses the single-project SQL path (`WHERE project_id = $1`). No regressions on v1.2's verified surface.

### 2.4 Admin stories (justifies §3 cost properties + §4 polish)

**US-12. Workspace cost cap independent of per-project caps.**
*As a workspace admin who's running cross-project chats, my cross-project AI spend should be bounded by a workspace cap that's separate from my per-project caps — so a runaway cross-project query doesn't drain my per-project budgets.*
- **Acceptance:** New column `cross_project_ai_monthly_cap_usd` on D1 `users` row, default `$20`. Cross-project chats charge against this cap exclusively. Per-project caps are not touched by cross-project chats. Hitting the workspace cap pauses cross-project mode (per-project chats still work) and surfaces a "cross-project AI paused" banner with a `cross_project_ai_cap_warned_at` flag analogous to v1.2's per-project mechanism.

**US-13. Cross-project spend visibility.**
*As a workspace admin, I can see my month-to-date cross-project AI spend on my account / settings page, so I can decide whether to raise the cap.*
- **Acceptance:** Settings page shows MTD `cross_project_ai_spend_usd`, the cap, and a remaining-budget bar. Same UX shape as per-project cap display on the project settings page.

**US-14. Cross-project iteration ceiling.**
*As an admin, I need cross-project chats to not blow up token cost by running unbounded tool iterations.*
- **Acceptance:** Iteration cap stays at 6 in v1.3 (unchanged from PRD v1.2). Cross-project comparison questions resolve in 2–3 tool calls (one `list_jira_sprints` if needed, one `aggregate_jira`, one synthesis turn). No fan-out per project — single SQL query with `project_id = ANY(...)` covers the comparison (per §3.4 below).

**US-17. Project branding — logo upload.**
*As a workspace admin, I can upload a logo image (PNG or JPG) for any project in my workspace, so the dashboard and cross-project scope chips show the project's real identity instead of a placeholder initial.*
- **Acceptance:** Project settings has a "Branding" section with a logo upload control. Accepts PNG and JPG only, 1 MB maximum, server-side validated. Logo stored in Cloudflare R2 under `projects/{project_id}/logo.{ext}`; signed-URL pattern with 1-hour TTL for retrieval. `projects.logo_r2_key` column on Postgres stores the key. Role gate: workspace admin only (workspace admin is the only project-edit role in v1.3 — project_admin role is dropped in this release; see §3.6 security model). Logo replaces the initial-letter placeholder on every surface where projects are rendered: dashboard project cards, cross-project chat scope chips, citation chip prefixes, picker rows. If no logo uploaded, initial-letter avatar continues. Deleted logos cascade-delete on project soft-delete.

### 2.5 Platform / dev stories (justifies §3.6 security model)

**US-15. No cross-tenant leak under adversarial cross-project DSL.**
*As Jenny / future devs operating the platform, I need cross-project tools to be safe against any DSL the LLM produces, including attempts to include a project that doesn't belong to the user's workspace, to inject `project_id` into a `where` clause, or to escape the allowlist.*
- **Acceptance:** All five adversarial test cases fail closed at authorize-or-validate:
  - (a) LLM submits `project_ids` containing a project outside the user's workspace → authorize step returns `project_not_in_workspace`, no SQL runs.
  - (b) LLM submits `project_id` in `where` → existing v1.2 `project_id_forbidden` validation error fires (allowlist unchanged for `where`).
  - (c) LLM submits empty `project_ids: []` in cross-project mode → executor returns `cross_project_empty_set` error, no SQL runs.
  - (d) LLM submits `project_ids` with malformed UUIDs → authorize step UUID-validates before the workspace lookup; returns `project_ids_malformed`.
  - (e) LLM submits `project_ids` with duplicates → de-duplicated at authorize step (idempotent); no error.
  None of these return data; all surface a structured envelope the LLM can self-correct from on the next turn.

**US-16. Cross-project tool-call trace.**
*As Jenny / future devs, when a user reports a weird cross-project answer, I need to see (a) the project set the request was scoped to, (b) the DSL the LLM submitted, (c) the authorize result, in one place.*
- **Acceptance:** The v1.2 tool-call trace viewer surfaces all three. Conversation row's `project_ids` is rendered above the trace; each tool call's persisted payload now includes both the LLM-submitted `project_ids` and the post-authorize set (logged for telemetry parity with v1.2's `project_id` mismatch logging in D4c).

---

## 3. Cross-project AI mode capability

### 3.1 Problem

v1.2's agent is hard-bound to one project per chat. The headline question shapes admins actually want — "compare velocity between A and B," "which of my projects is most behind," "what themes are coming up across our Slack channels this week" — cannot be answered without a cross-project surface. PRD v1.1 §11.1 sketched the design; PRD v1.2 §6 deferred it. v1.3 ships it.

### 3.2 In scope

- Multi-project comparison questions (velocity, throughput, bug-close rate per project) via `aggregate_jira` with `group_by: ['project_id']`.
- Rollup ranking ("which project has the most overdue tickets") via the same path.
- Cross-project Slack/Jira retrieval ("themes across projects this week") via `search_project_data` with `project_ids`.
- Cross-project detail listing ("all my high-priority bugs across projects, oldest first") via `query_jira_issues` with `project_ids`.
- Chained sprint pattern across projects: `list_jira_sprints({ project_ids, state })` → `aggregate_jira({ project_ids, where: { sprint_id: { in: [...] } } })`.

### 3.3 Modes

Two modes co-exist; the agent surface is the same shape (chat in / chat out), but the conversation row and tool dispatch differ.

| Property | Single-project mode (v1.2, unchanged) | Cross-project mode (v1.3) |
|---|---|---|
| Conversation row | `project_id: uuid`, `project_ids: null` | `project_id: null`, `project_ids: uuid[]` |
| Picker | None — chat opens scoped to its project | Multi-select picker on entry; selection lives on the conversation row |
| Tool dispatch | `WHERE project_id = $1` (URL/session-bound) | `WHERE project_id = ANY($1::uuid[])` (session-validated set) |
| Citation chips | Title + freshness (v1.2 shape) | `[Project Name]` prefix + title + freshness |
| Prose | No project-name rule | Every reference to a source object includes the project name inline |
| Cost cap | Per-project `ai_monthly_cap_usd` (v1.2 default $50) | Workspace `cross_project_ai_monthly_cap_usd` on D1 `users` row (default $20) |
| Iteration cap | 6 (PRD v1.1 §5.7) | 6 (unchanged) |
| Entry point | Existing project page chat | New "Cross-project chat" entry on the dashboard |

The two modes are mutually exclusive per conversation; a single chat doesn't switch mode mid-session.

### 3.4 Tool surface — `project_ids` as non-breaking sibling parameter

Four of v1.2's five Jira/Slack tools learn an optional `project_ids: string[]` parameter alongside the existing single-project mode. The fifth (`get_jira_sprint_summary`) does **not** — see §3.5 retained tools.

| Tool | New parameter | SQL change |
|---|---|---|
| `search_project_data` | `project_ids: string[]` (optional) | hybrid-search helper accepts `project_ids` and passes to keyword + vector queries; `WHERE project_id = ANY($N::uuid[])` |
| `query_jira_issues` | `project_ids: string[]` (optional) | `WHERE project_id = ANY($N::uuid[])`; ordering by `source_updated_at DESC` unchanged |
| `list_jira_sprints` | `project_ids: string[]` (optional) | `WHERE project_id = ANY($N::uuid[])`; ordering unchanged |
| `aggregate_jira` | `project_ids: string[]` (optional) | compiler's `WHERE project_id = $1` becomes `WHERE project_id = ANY($1::uuid[])`; `project_id` becomes legal in `select`/`group_by`, illegal in `where` (per §3.6.2) |

The parameter is **optional** on the JSON schema. When omitted, single-project behavior is unchanged. When supplied, the executor dispatches the cross-project SQL path. The two paths share one compiler / one tool implementation; the dispatch is on parameter presence at the executor entry.

This is the same "non-breaking sibling-field addition" pattern that `tools.js` D4a designed for (line 12, system prompt note: "v1.2's project_ids: string[] becomes a non-breaking sibling-field addition rather than a union-type change"). v1.3 cashes the option.

### 3.4.1 `project_id` allowlisted in `select` and `group_by` only

Per BLOCK_11_PLAN decision F, `project_id` is **not** in the `aggregate_jira` column allowlist for `where`. v1.3 extends `ALLOWED_COLUMNS` to include `project_id` **for `select` and `group_by` positions only**. The compiler validates by position, not by name alone:

- `select: ['project_id', 'COUNT(*)']` + `group_by: ['project_id']` → valid (used for US-2 ranking, US-1 velocity comparison).
- `where: { project_id: <anything> }` → existing `project_id_forbidden` error fires (unchanged from v1.2).

This is the same shape as the `labels` / `labels[]` distinction in v1.2 (PRD §3.4.1) — a column allowed in some DSL positions, forbidden in others. The compiler grows one new position-aware allowlist entry; no new grammar surface.

### 3.5 Retained tools (unchanged from v1.2)

- `get_jira_sprint_summary({ sprint_id })` — single-project only in v1.3. Does **not** accept `project_ids`. Cross-project sprint questions go through `aggregate_jira` with `group_by: ['project_id', 'status_category']` or equivalent shape.

  *Rationale:* `sprint_id` is not globally unique across Jira projects — two projects can independently have `sprint_id = 12` for unrelated sprints. Extending `get_jira_sprint_summary` cross-project would silently aggregate unrelated sprints. `aggregate_jira` handles the cross-project sprint question correctly via grouping. Decision locked.

### 3.6 Security model

The load-bearing security property of v1.1/v1.2 was: project_id is server-injected from session context, never an LLM parameter, never trusted from input. v1.3 extends this property to a *set*: project_ids are LLM-supplied, but every ID is validated against the authenticated user's workspace scope before SQL runs.

**Membership model collapse — context.** v1.3 drops the per-project membership concept entirely. The `project_members` table is dropped in the v1.3 schema migration. The `project_admin` role concept is removed. The authorization predicate simplifies from "user is an active member of this project" to "the project belongs to the user's workspace." All workspace users see all projects. Workspace-level admin (single role on the workspace row) gates project edit operations such as logo upload (US-17), connection management, and rename. See §4.2 for the schema migration detail.

**3.6.1 Authorize step at the executor entry (load-bearing).**

A new helper `authorizeProjectSet(sql, workspaceId, projectIds)` runs at the executor entry point, **before** the compiler is called, on every cross-project tool invocation:

```js
async function authorizeProjectSet(sql, workspaceId, projectIds) {
  // De-duplicate and UUID-validate before the DB round trip.
  const deduped = [...new Set(projectIds)];
  for (const id of deduped) {
    if (!isValidUuid(id)) {
      return { ok: false, code: 'project_ids_malformed', field: id };
    }
  }
  if (deduped.length === 0) {
    return { ok: false, code: 'cross_project_empty_set' };
  }

  const rows = await sql`
    SELECT id::text AS project_id
      FROM projects
     WHERE workspace_id = ${workspaceId}
       AND id = ANY(${deduped}::uuid[])
       AND deleted_at IS NULL
  `;
  const authorizedSet = new Set(rows.map((r) => r.project_id));
  const missing = deduped.filter((id) => !authorizedSet.has(id));
  if (missing.length > 0) {
    return { ok: false, code: 'project_not_in_workspace', missing };
  }
  return { ok: true, projectIds: deduped };
}
```

The returned `projectIds` (de-duplicated, validated, workspace-scoped) is what's passed to the compiler / SQL helper. The LLM-submitted set is **never** trusted past this gate. Failure at this gate returns a structured envelope to the agent loop (same shape as v1.2's validation envelope) so the LLM can self-correct on the next turn.

This step uses the existing `projects` table indexed on `workspace_id` (or adds the index if missing) — one indexed lookup, no fan-out, one Hyperdrive round trip. Simpler than v1.2's membership-based authorize: one JOIN fewer, no role column.

**3.6.2 `project_id` in `where` still forbidden (unchanged from v1.2).**

The compiler's existing `project_id_forbidden` error code keeps applying to `where`. An LLM that submits `where: { project_id: <anything> }` gets the same v1.2 error regardless of mode. Cross-project scope is set via `project_ids` at the tool level, never via `where`.

**3.6.3 Single-project mode preserved exactly.**

When `project_ids` is omitted, the executor takes the single-project path:
- Existing D4b substitution at `tools.js` executor entry continues to discard `input.project_id` and use the URL-bound `projectId`.
- Existing v1.2 compiler path runs unchanged (`WHERE project_id = $1`).
- No authorize step runs (it's not needed — single-project authorization is already enforced by the workspace-scope check at the HTTP route layer, before the agent loop ever starts).

This is what protects v1.2's verified single-project behavior from regression. The `requireProjectRole` middleware from v1.1/v1.2 is replaced by `requireWorkspaceScope` (project belongs to session user's workspace); the single-project agent-loop entry is otherwise unchanged.

**3.6.4 Injection surface (unchanged).**

The compiler still emits parameterized SQL via postgres.js. The only new identifier interpolation is `project_id` in `select`/`group_by` positions — already in the per-position allowlist (§3.4.1). No raw SQL crosses any wire. The `= ANY($N::uuid[])` shape is the postgres-js array-parameter pattern, same shape `IN` uses today.

**3.6.5 Payload caps (unchanged from v1.2).**

500 grouped / 50 ungrouped, server-clamped. Cross-project queries return the same row counts (one extra grouping axis doesn't change the cap). Worst-case grouped payload ~50 KB still holds.

**3.6.6 Subrequest budget — two Hyperdrive queries per cross-project call.**

The cross-project executor runs **two** Hyperdrive round trips:
- One authorize-step query (`projects` workspace-scope lookup).
- One tool query (the aggregate / search / list / detail).

Both are single indexed lookups. The Workers 50-subrequest cap (BLOCK_11_PLAN decision I) is not in play.

**3.6.7 Audit trail (extended from v1.2).**

The persisted tool-call payload now includes both the LLM-submitted `project_ids` and the post-authorize set. v1.2's `tool_input_project_id_mismatch` D4c logging gets a sibling event `cross_project_authorize_failed` for the case where the LLM submitted out-of-workspace projects. Both surface in the v1.2 trace viewer.

### 3.7 Sub-decisions locked

| Sub-decision | Locked choice | Reason rejected alternatives lost |
|---|---|---|
| Project-set selection UX | **Ad-hoc per-chat picker** | Named sets premature without evidence; default-to-all is unsafe without sensitive-project flag; both is build-everything |
| Comparison framing | **LLM-synthesis via `group_by ['project_id']`, one query** | Per-project fan-out hits iteration ceiling and breaks "one Hyperdrive query per call"; `compare:` DSL surface is specific-purpose on a generic DSL |
| Cost cap | **Workspace-level cap on D1 `users` row, default $20** | Pro-rata misattributes; strictest-wins overstates by N×; hybrid double-counts |
| Citation disambiguation | **Always-on `[Project Name]` chip prefix + in-prose project-name rule** | Grouped headers add a new component without fixing prose ambiguity; hover-only fails on mobile and accessibility |
| Sensitive-project exclusion flag | **Deferred to v1.4** | No concrete use case yet; authorization without exclusion is the security floor |
| Tools extended | **Four (skip `get_jira_sprint_summary`)** | `sprint_id` collisions across projects make cross-project sprint-summary a footgun; `aggregate_jira` handles the question correctly |
| `project_id` in `select`/`group_by` | **Allowed by position; still forbidden in `where`** | A column allowed in some positions and forbidden in others is the same shape as `labels`/`labels[]` |
| Iteration cap | **6 unchanged** | Cross-project comparison resolves in 2–3 calls via single SQL grouping; per-project fan-out (which would have needed 8) is rejected |
| Authorization predicate | **Workspace-scope (all workspace users see all projects); `project_members` table dropped** | Per-project membership added a layer of access control with no use case (Jenny is the only user; one workspace; one project ≠ one team). Membership-implicit is simpler and the security floor stays (workspace boundary is still enforced) |
| Project-edit role | **Workspace admin** (replaces `project_admin`) | Single role concept matches "workspace = team" mental model; no per-project role gates needed when all users see all projects |

### 3.8 System prompt changes

Cross-project mode gets a distinct system prompt slice (loaded only when the conversation row has non-null `project_ids`). The slice adds:

- **Mode declaration:** "You are in cross-project mode. The user has selected the following projects: [<list with names and IDs>]. Every answer must explicitly state the scope ('Across RAIN, Joni, and Project C: …'). Every reference to a sprint, ticket, channel, or source object must include the project name inline (e.g., 'RAIN's Sprint 12 had 47 bugs,' not 'Sprint 12 had 47 bugs')."

- **Tool guidance:**
  - For comparison and ranking questions, use `aggregate_jira` with `group_by: ['project_id', ...]` to get per-project rows in one query. Do not call `aggregate_jira` once per project.
  - For chained sprint patterns, call `list_jira_sprints({ project_ids, state })` then `aggregate_jira({ project_ids, where: { sprint_id: { in: [...] } } })`. Do not filter by `sprint_name`.
  - For Slack themes or free-text retrieval across projects, use `search_project_data({ project_ids, ... })`.
  - For cross-project detail listing, use `query_jira_issues({ project_ids, ... })`.
  - `get_jira_sprint_summary` does **not** accept `project_ids`. For cross-project sprint questions, use `aggregate_jira` with `group_by: ['project_id', 'status_category']`.

- **Not-supported additions** (on top of v1.2's not-supported list):
  - Cross-project answers that include a project outside the user's workspace. Surface "I can't include Project X — it's not in your workspace."
  - Cross-project mode does **not** unlock cycle time, lead time, time-in-status, throughput-over-time, burndown, burnup, or bottleneck detection. Same refusal text as PRD v1.2 §3.10. Mode does not change capability there.

- **Citation contract:** Citation chips in cross-project mode include the project name prefix automatically (server-rendered). Do not duplicate the prefix in the inline-citation token — render prose with project names inline, but trust the chip's prefix to disambiguate the chip surface.

### 3.9 Not supported in v1.3

In addition to v1.2 §3.10's full not-supported list (cycle time, lead time, time-in-status, throughput-over-time, burndown, bottleneck detection, free-text predicates in `aggregate_jira`, OR predicates), v1.3 also doesn't support:

- **Cross-project queries on projects outside the user's workspace.** Authorize step fails closed.
- **Cross-source aggregation across Slack and Jira in one tool.** Each cross-project tool stays source-specific. `aggregate_entities` parked for v2.0.
- **Cross-project write-back.** Read-only stays.
- **Switching mode mid-conversation.** A chat is single-project or cross-project at creation; no mid-stream mode change.
- **Per-project membership.** Membership concept dropped in v1.3 (see §3.6). All workspace users see all projects in the workspace. v1.4+ may reintroduce a sensitive-project flag as the exclusion primitive.

---

## 4. v1.3 Polish

These items extend baseline v1.2 capabilities to make cross-project mode usable. Implementation maps to a single Block 12 (cross-project mode) — block plan to be drafted against this PRD before code starts.

### 4.1 Launch-blocking (Block 12)

- **Project-set picker UI** — multi-select with search/filter, "select all visible," "clear." Lists every project in the user's workspace that has the relevant connector (Jira in v1.3). Selection saved to `conversation.project_ids` on chat creation. Justifies US-9.
- **Cross-project chat surface entry point** — new entry on the dashboard ("Cross-project chat"), separate from per-project chat. Opens the picker first; chat starts once selection is confirmed.
- **Scope-visible header** — every screen of a cross-project chat shows "Cross-project: [<project names>] (N projects)" in the header. Justifies US-10.
- **Citation chip project-name prefix** — every citation chip in cross-project mode renders `[Project Name] Title · timestamp`. Single-project chips unchanged. Justifies US-15 disambiguation.
- **Workspace cost cap** — new columns on D1 `users`: `cross_project_ai_monthly_cap_usd` (default `$20`), `cross_project_ai_cap_warned_at`, `cross_project_ai_spend_period_start`. Cap check at the executor entry for cross-project chats; AI-paused banner labeled "cross-project" when hit. Per-project caps unchanged. Justifies US-12.
- **Settings page: cross-project spend visibility** — MTD spend, cap, remaining-budget bar on the user's settings page. Justifies US-13.
- **Membership-model collapse (schema migration).** `project_members` table dropped from Postgres in v1.3 (one-shot DDL migration; data is not preserved — workspace-scope replaces it). `project_members_user_active_idx` dropped with it. `project_admin` role concept removed everywhere (code grep for `project_admin` should return zero hits post-migration). New workspace-admin column on the `users`-equivalent table (D1) gates project-edit operations. `requireProjectRole` middleware replaced by `requireWorkspaceScope` (cheaper: one indexed lookup against `projects.workspace_id` vs. the old two-step `project_members` join). Pre-migration backup is recommended but not required (no production data depends on `project_members` rows for Jenny's solo workspace). Authorize step in §3.6.1 reads from `projects.workspace_id` exclusively. Justifies the simplification in §3.6.

**Done when:** A workspace admin can open the cross-project chat surface, pick a set of projects from their workspace, ask the six headline questions from §2.1, get correct cited answers with project-name prefixes on every citation chip, and stay within the workspace cap.

### 4.2 Nice-to-have

- **"Last used project set" pre-selection** — picker pre-checks the project set from the user's most recent cross-project chat. Reduces re-picking friction without committing to named sets.
- **Tool-call trace viewer extension** — show conversation `project_ids` + per-call authorize result in the trace. Justifies US-16.
- **Schema migration: `conversation.project_ids: uuid[]`** — nullable column on `conversations` (alongside the existing `project_id`). Mutually exclusive constraint enforced at app layer, not via DB CHECK (cleaner for the deferred-FK semantics and matches the existing soft-delete pattern).
- **Project branding — logo upload** (US-17). New `projects.logo_r2_key TEXT NULL` column on Postgres. New `BRAND_LOGOS_BUCKET` Cloudflare R2 binding in `wrangler.toml`. New API endpoints: `POST /api/projects/[id]/logo` (multipart, server validates MIME + magic-bytes + 1 MB limit, writes to R2 at `projects/{project_id}/logo.{ext}`); `DELETE /api/projects/[id]/logo` (clears column + R2 object). Logo retrieval via signed URLs with 1-hour TTL, generated on demand and cached client-side. Role gate at HTTP layer: `requireWorkspaceRole('workspace_admin')` (replaces v1.1's `requireProjectRole('project_admin')`). R2 lifecycle rule: delete objects on project soft-delete cascade. Replaces initial-letter avatar everywhere a project renders (dashboard cards, cross-project scope chips, citation chip prefixes, picker rows). Fallback to initial-letter when `logo_r2_key IS NULL`.
- **Per-project limits editor (inline in General tab).** v1.2 shipped the per-project AI cap mechanism (`ai_monthly_cap_usd`, `ai_cap_warned_at`) and the daily message limit, but no admin-facing editor surface. v1.3 inlines a small "Limits" section near the bottom of the project settings General tab: read-only spend bar showing month-to-date `ai_spend_usd` against the cap, editor for `ai_monthly_cap_usd`, editor for `daily_message_limit`. No dedicated "Cost & limits" tab — keeps v1.3 settings to three tabs (General · Connections · Branding-merged-into-General). Role gate: workspace admin only. A dedicated cost-management tab is deferred to a later release when per-project cost controls get richer (per-model selection, weekly/monthly granularity, alerts).

These raise quality but don't gate launch.

---

## 5. Success criteria for v1.3

v1.3 is done when **all** of the following hold:

1. The six headline questions from §2.1 (US-1 through US-6) return correct, cited answers in production against a workspace with at least two projects, end-to-end. Citation chips render with `[Project Name]` prefixes; prose includes project names inline.
2. US-7's cross-project cycle-time question returns the locked refusal text — mode does not unlock the capability.
3. US-8's "project outside workspace" question fails closed with the structured envelope; agent surfaces an honest refusal, doesn't continue with partial scope.
4. US-15's five adversarial cases all fail closed at the authorize-or-validate gate: `project_not_in_workspace`, `project_id_forbidden`, `cross_project_empty_set`, `project_ids_malformed`, deduplication-idempotent. No cross-tenant data ever returned.
5. US-11's single-project regression check: every v1.2 acceptance case (PRD v1.2 §2.1 US-1 through US-6) still passes byte-equivalent on the existing surface. Cross-project mode adds; it does not modify.
6. US-12's workspace cap fires independently of per-project caps. Hitting it pauses cross-project mode; per-project chats still work.
7. The `project_members` table is dropped post-migration. A `grep -rn 'project_admin\|project_members' src/` returns zero hits. `requireWorkspaceScope` middleware handles the per-project route authorization that was previously `requireProjectRole`.

§4.2 nice-to-haves are valuable but not in this list — they raise quality, not a launch gate.

---

## 6. Explicit Cuts (deferred from v1.3)

Tracked here so future scope-setting inherits these cleanly.

**Deferred within the 1.x series (target version set when each release is scoped):**

1. **Per-project "include in cross-project queries" flag.** From PRD v1.1 §11.1. Adds an exclusion layer on top of authorization. No concrete sensitive-project use case yet; ship when one exists. Design sketch in PRD v1.1 §11.1 is the right starting point.
2. **Named persistent project sets** ("My Q2 Projects," "Active launches"). Workflow ergonomics on top of v1.3's ad-hoc picker. Ship when the picker shows real fatigue patterns. Schema sketch: `project_sets(id, workspace_id, owner_user_id, name) + project_set_members(set_id, project_id)`; workspace-scope re-validation on every use.
3. **Cross-project share URLs.** A cross-project chat or saved-set URL that can be shared with another member. Depends on (2) for set persistence and on a sharing-permission model that doesn't exist in v1.3.
4. **`get_jira_sprint_summary` cross-project variant.** Requires a fix for the `sprint_id` collision problem — either a `(project_id, sprint_id)` composite parameter or a wrapper that resolves names → IDs per project. Pick up when a real use case demands it.
5. **Transition history** (`jira_issue_transitions` table via `expand=changelog`). Still blocked. Prerequisite for items 6–8.
6. **Cycle time / lead time / time-in-status tools.** Blocked on (5).
7. **Throughput over time / burndown / burnup.** Blocked on (5).
8. **Bottleneck detection** ("which status holds tickets longest"). Blocked on (5).
9. **OR predicates in the DSL.** v1.3 stays implicit AND.
10. **Materialized view for `jira_issues`.** Only if measured read latency demands it.
11. **Free-text predicates inside `aggregate_jira`.** Use `search_project_data`.
12. **Workspace as a first-class entity** (`workspaces` table). v1.3's workspace cap lives on D1 `users` row — the one-user-workspace model. When teams or organizations land, the cap moves to a workspace row and `users.cross_project_ai_monthly_cap_usd` gets migrated.
13. **Audit log for admin actions.** Add when multi-admin projects or compliance pressure exist.
14. **Per-user permission mirroring** from source systems.
15. **Per-project sub-roles.** Project-scoped admin without billing access.
16. **Paid tiers.** Architecture is ready; pricing is the open question.
17. **Mobile native apps.** Web only.
18. **Dedicated "Cost & limits" project-settings tab.** v1.3 inlines the per-project cap + message-limit editors into the General tab (small Limits section, two fields). A dedicated tab is deferred to a later release when per-project cost controls get richer — per-model selection, weekly/monthly granularity, per-user limits within a project, alerts when approaching the cap.

**Parked for v2.0 (the multi-source release; not in any 1.x version):**

- **Monday connector.** API-token GraphQL, `monday_items` view, four tools including `get_monday_board_schema` for board column heterogeneity.
- **Google Drive connector.** OAuth read-only, `drive_files` view, `list_drive_files` + `read_drive_file`, chunk-and-embed for long documents.
- **Drive: images and OCR.** Text extraction from screenshots, scanned PDFs, image files.
- **`aggregate_entities` / cross-source aggregation.** Has no consumer until Monday + Drive ship.
- **Additional connectors** (Notion, Telegram, GitHub, Linear, HubSpot). Plug-in via connector registry.
- **Write-back actions.** Creating Jira tickets, posting Slack messages. Remains read-only.

---

## 7. Design system audit (carry-over for implementation)

The visual system was locked across the v1.3 mockups. This section is the reference for Cursor: what carries forward from v1.2's `auth.css` unchanged, what needs to change, and what needs to be added. The DESIGN.md style guide (Elinnovation marketing system) remains the canonical source for color, type, and radius tokens; the changes below are app-specific adaptations.

### 7.1 Three load-bearing divergences from v1.2

**(a) The top bar inverts.** `auth.css` ships a dark-glass `.app-nav` (`rgba(18, 18, 21, 0.85)` background with `blur(3.5px)`, white text) — a marketing-shell carry-over that pairs with a dark hero. In the authed app there is no dark hero underneath, so the nav reads as an arbitrary dark stripe over a light-grey body. v1.3 inverts it: white nav, dark text, thin bottom border. The brand E mark stays (26px purple square, white E). Content carries the eye; the nav recedes.

**(b) The app type scale shrinks.** `auth.css` `.section-heading` is 45px (60px in DESIGN.md). Marketing scale, not app scale. v1.3 introduces app-scoped type — screen-level headings at 20-24px, subheadings at 16-18px, body 13-14px, eyebrow 10-11px. The marketing scale stays for the public landing only.

**(c) Two card variants, used deliberately.** `.project-card` from `auth.css` is the marketing "specialcard" pattern — 32px padding, purple-wash hover with icon-color invert. Heavy when 5+ cards stack on a dashboard. v1.3 keeps this style for *marketing moments* (empty states, "+ New" CTAs, the cross-project landing) but adds a lighter variant for *data-dense surfaces* (dashboard project cards, connection rows, conversation list): 18-22px padding, thinner borders, subtle background hover only.

### 7.2 Per-screen mapping from current pages to v1.3 mockups

| Page (today) | File | v1.3 disposition |
|---|---|---|
| Landing / sign-in | `public/index.html` | No change. Marketing shell stays. |
| Login redirect stub | `public/login.html` | No change. |
| Dashboard | `public/dashboard.html` | **Replace entirely with mockup (a).** Existing placeholder doesn't carry forward. |
| Projects list | `public/projects.html` | **Re-skin cards to lighter v1.3 style.** Page stays as a secondary list view; the dashboard is the new primary surface. |
| New project | `public/projects/new.html` | **Update gate** from `requireProjectRole('project_admin')` to `requireWorkspaceRole('workspace_admin')`. Form layout unchanged. |
| Project detail | `public/project.html` | **Settings section** re-skinned to mockups (i.1 General) and (i.2 Connections). Members tab removed (membership collapsed). **Chat surface** gets the project-name citation pattern from mockups (d) and (e). |
| Admin / users | `public/admin.html` | Mostly stays. `project_admin` role removed from toggles. Workspace AI cap moves to mockup (f) on a sibling page. |
| Forgot password | `public/forgot-password.html` | No change. |
| Reset password | `public/reset-password.html` | No change. |

### 7.3 New components to add to `auth.css`

These don't exist in v1.2 and are needed for v1.3 mockup fidelity. All build on existing color/radius tokens; no foundational rework.

1. **`.cross-project-chat-card`** — the labeled chat card from (b). Variants: `.live` (Product), `.locked-v2` (Finance).
2. **`.label-pill`** — small uppercase brand-tint pill for the "Product" / "Finance" function label.
3. **`.source-chip`** — inline source logo + name (Jira, Monday) used in chat headers, card source rows, and step-1 of the creation modal.
4. **`.scope-summary`** — the `2 of 2 · Rain, Joni` pattern with a folder icon. Used on chat cards, chat headers, edit-scope modal footer.
5. **`.spend-bar`** — the workspace cap visualizer from (f). Variants: `.healthy` (success-green fill), `.warning` (amber when approaching), `.exceeded` (danger-pink at cap).
6. **`.citation-chip-prefix`** — small purple pill inside citation chips, prepending the project name like `[Rain]`. Only appears in cross-project chats; single-project chips don't get the prefix (preserves v1.2 surface).
7. **`.tool-trace-badge`** — the "How I got this · N tool calls" affordance below agent answers from (e). Click expands inline.
8. **`.paused-banner`** — the 2px amber-bordered banner from (g) that surfaces when the workspace cap is hit. Includes a Raise-cap CTA.
9. **`.picker-row`** — the Variant 1 project picker row from (c) and (h): stacked sprint metadata, progress bar, right-aligned ticket stats. Reused across creation and edit-scope modals.

### 7.4 Component changes to existing `auth.css`

- **`.app-nav`** — light variant (background `#fff`, border-bottom `1px solid var(--color-border)`, no backdrop-filter). Text colors flip from white to `--color-text-dark` and `--color-text-body`. `.btn-nav` becomes solid brand-purple instead of outlined-on-glass.
- **`.section-heading`** — keep the existing selector for marketing-style sections, add a new `.app-heading` class at 20-24px for screen-level headings on authed pages. Mockups use the smaller scale throughout.
- **`.project-card`** — split into `.project-card.marketing` (existing pattern, used for "+ New" CTAs and empty-state cards) and `.project-card.data` (new lighter pattern, used on the dashboard and projects list). Same selector base; modifier classes carry the weight.

### 7.5 Components to remove from `auth.css`

- **Member-management styles** on the project detail page (anything keyed to `project_members`). Membership is collapsed in v1.3 per §4.1.
- **Project-level admin gating styles** — the `project_admin` role no longer exists. Workspace-admin gating reuses the existing `.btn-danger` and admin-page patterns.

### 7.6 What stays untouched from v1.2

For implementation clarity — these need no changes:

- **Color palette** — every token in DESIGN.md still applies. Brand purple `#6234fc`, brand-tint, purple wash, near-black, light surfaces.
- **Border radius scale** — 8/10/15/20/50px. Mockups use exactly these.
- **Eyebrow + purple-line pattern** (`.section-eyebrow`, `.section-line`) for section intros. Mockups use the same pattern at a smaller scale.
- **Form fields** (`.field input`, `.field textarea`). Mockup forms reuse them.
- **Buttons** (`.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`). No changes.
- **Skeleton loading state** (`.skeleton-shape`, `.project-card-skeleton`). Reused for any new loading state in v1.3.
- **State cards** (`.state-card`) for empty / error / unauthorized.
- **Auth pages** — sign-in, forgot-password, reset-password. Dark-hero/light-card pattern is right for these.
- **Font fallback chain** — `'cregular', 'Space Grotesk', system-ui` handles Clash → Space gracefully. Mockups designed in Space, render in Clash when production loads it. No change needed.

### 7.7 Recommended implementation sequence

For Cursor working through Block 12:

1. **Light-mode `.app-nav` swap.** Smallest change, largest visual impact. One CSS file edit; no HTML changes (all authed pages share the same inline `<nav class="app-nav">` markup, so the new styles propagate site-wide on a single commit).
2. **Add the 9 new components** (§7.3). Purely additive; no existing selectors modified.
3. **Implement (a) Dashboard.** Net-new page replacing the placeholder at `/dashboard`.
4. **Rework project detail settings** to (i.1) General and (i.2) Connections tabs. Largest single-page edit.
5. **Implement (b-e) cross-project chat surfaces.** New routes under `/cross-project/`.
6. **Workspace settings (f) and paused banner (g).** Final pieces before launch.

This sequence front-loads the visual wins (steps 1-3 are visible after each commit) and back-loads the deeper rework (4-6 touch more files but build on the design foundation established in 1-3).

---

*End of PRD v1.3.*
