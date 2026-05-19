# Product Requirements Document — v1.2

**Elinno Agent — What's New in v1.2**

| Field | Value |
|---|---|
| Document | PRD v1.2 |
| Owner | Jenny (jenny@elinnovation.net) |
| Status | Draft — ready for review |
| Last updated | 2026-05-18 |
| Baseline | PRD v1.1 (auth, projects, sync, Slack + Jira read tools, agent loop, freshness/rate limits) |
| Related | Build Plan v1.2, HANDOFF.md |

---

## 1. Scope

PRD v1.1 shipped: auth, projects, Slack + Jira read-only connectors, hybrid search, the tool-calling agent loop with citations, freshness timestamps, rate limits, and the cost-cap infrastructure. v1.2 is a delta on that baseline.

v1.2 ships **one** capability addition plus the polish work needed to onboard a non-Jenny user:

1. **`aggregate_jira` — agent capability for counting / grouping / cross-sprint comparison questions over Jira data.** Fills the gap where v1.1's hard-capped detail tools (`query_jira_issues` at 50 rows, `get_jira_sprint_summary` at status_category totals only) can't answer questions like "who has the most tickets in the current sprint?" against a 64-ticket sprint. Detailed design in §3.
2. **Launch-blocking polish** — connection management UI, "data as of" timestamps, nightly cron-driven incremental sync, suggested example questions, `records_skipped` sync accounting. Detail in §4.1.
3. **Nice-to-have polish** — "refresh and ask again," per-project cost cap, daily message limits, tool-call trace viewer, sweep-path batching. Detail in §4.2.

**Not in v1.2** — kept in §6 explicit cuts so v1.3+ inherits a clean scope:

- **Cycle time / time-in-status / throughput-over-time / burndown.** Blocked on Jira status transition history, which is a sync-layer change.
- **Cross-project AI mode.** Originally a v1.2 candidate (PRD v1.1 §11.1); no build-plan block, slipped to a later 1.x release.
- **OR predicates in the DSL, materialized `jira_issues` view, etc.** Smaller items each with their own deferral rationale.

**Parked for v2.0 — not in any 1.x release:**

- **Monday connector.** Originally MVP in v1.1; deferred. v2.0 is the multi-source release.
- **Google Drive connector.** Same.
- **`aggregate_entities`** (cross-source aggregation tool). Has no purpose until v2.0 has Monday + Drive shipped.

The 1.x series is the Slack + Jira era. v2.0 is the multi-source era. v1.3 / v1.4 / etc. carry their own scopes within the 1.x series; this PRD covers v1.2 only.

---

## 2. User Stories (v1.2)

User stories are written from the perspective of the personas this delta serves: the **project member** (asks questions, reads answers), the **project admin** (owns the project, also a member), and **Jenny / future devs** (operates the platform). All stories are in the active-project context — cross-project mode is deferred.

Each story names the question class or capability it serves, has a single acceptance test, and maps to the v1.2 section it justifies.

### 2.1 Member stories — Jira aggregation (justifies §3)

**US-1. Top assignee in current sprint.**
*As a member, I want to ask "who has the most tickets in the current sprint?" and get a ranked list with counts, so I can see workload distribution without opening Jira.*
- **Acceptance:** Agent calls `list_jira_sprints({ state: 'active' })`, then `aggregate_jira` with `group_by: ['assignee_display_name']`, `order_by: count desc`. Response cites the active sprint by name and gives the top N rows with counts. Numbers come from a tool call, not the model.

**US-2. Label frequency across active work.**
*As a member, I want to ask "which labels appear most on active tickets?" and get a frequency-ordered list, so I can spot themes.*
- **Acceptance:** Agent calls `aggregate_jira` with a `where.status_category` filter for in-progress states, groups by individual JSONB array elements of `labels`, and orders by `count desc`. Returns labels with counts.
- **Note:** Requires `jsonb_array_elements_text(labels)` projection in the compiler. See §3.4.

**US-3. Cross-sprint velocity trend.**
*As a member, I want to ask "what's our velocity over the last 3 sprints?" and get sprint-by-sprint story-point totals for done work, so I can see whether velocity is rising or falling.*
- **Acceptance:** Agent chains `list_jira_sprints({ state: 'closed' })` → `aggregate_jira` with `where.sprint_id.in`, `where.status_category: 'done'`, `select: ['sprint_name', 'SUM(story_points)']`, `group_by: ['sprint_name']`. Returns three rows in chronological order. Agent does **not** filter by `sprint_name` (sprint names can be edited; filter would break silently).

**US-4. Bug count sprint over sprint.**
*As a member, I want to ask "how many bugs were closed last sprint vs this one?" and get two comparable numbers, so I can tell whether bug volume is improving.*
- **Acceptance:** Same chain shape as US-3 with `where.issue_type: 'Bug'` and `status_category: 'done'`. Two rows. Agent presents them as a comparison, not a list.

**US-5. Per-assignee workload comparison.**
*As a member, I want to ask "compare Alice's workload to Bob's this sprint" and get their ticket counts and story-point totals side by side, so I can see whether work is balanced.*
- **Acceptance:** Agent calls `aggregate_jira` with `where.assignee_display_name.in: ['Alice', 'Bob']`, `where.sprint_id: <active>`, `select: ['assignee_display_name', 'COUNT(*)', 'SUM(story_points)']`, `group_by: ['assignee_display_name']`. Two rows. If a name doesn't resolve (typo, departed teammate), agent says so rather than silently dropping them.

**US-6. Unresolved high-priority bugs, oldest first.**
*As a member, I want to ask "show me unresolved high-priority bugs, oldest first" and get a list with titles, links, and ages, so I can triage.*
- **Acceptance:** Agent uses `query_jira_issues` (not `aggregate_jira`) — this is an ungrouped detail lookup and the existing tool serves it better. Filters by `priority: 'High'`, `status_category` ∈ `{new, indeterminate}`, `issue_type: 'Bug'`, ordered by `source_created_at asc`. Each row has issue_key, title, age, link.
- **Justifies retaining `query_jira_issues` alongside `aggregate_jira`** (per §3.6).

### 2.2 Member stories — honest "can't answer" (justifies §3.10 not-supported list)

**US-7. Cycle time refusal.**
*As a member, when I ask "what's our average cycle time for stories?" the agent should refuse honestly rather than guess from update timestamps.*
- **Acceptance:** Agent recognizes cycle-time questions per the not-supported list. Response: "Cycle time isn't tracked in v1.2 — I don't have status transition history yet, only the most recent update time, which doesn't tell me when a ticket moved to Done." Agent does **not** attempt to compute cycle time from `source_updated_at`.

**US-8. Cross-project refusal.**
*As a member, when I ask "how many bugs across all my projects?" the agent should answer for the active project and clarify the scope.*
- **Acceptance:** Agent answers for the active project only. Response includes scope note: "This is for [Active Project Name]. Cross-project rollups are deferred." `project_id` enforcement at the SQL layer prevents the data leak regardless of what the LLM says (per §3.7.1).

### 2.3 Member stories — truncation handling (justifies §3.5 truncate-and-flag)

**US-9. Top-N over a large group set.**
*As a member, when I ask "top 10 most active labels" and there are 800 distinct labels, I should get the right top 10 with the total count noted.*
- **Acceptance:** Agent calls `aggregate_jira` with `order_by: count desc, limit: 10`. Server returns 10 rows; `total_groups: 800` is reported alongside. Agent reports top 10 and may mention "out of 800 distinct labels."

**US-10. Breadth question over a large group set.**
*As a member, when I ask "list all assignees who've touched this project" and there are 600 distinct people, I should get an honest "showing 500 of 600" rather than a confidently wrong answer.*
- **Acceptance:** Server returns 500 rows with `truncated: true, total_groups: 600`. Agent reports "showing 500 of 600 assignees" and offers to narrow (by date, by sprint, by issue type) on the next turn.

### 2.4 Admin stories (justifies §4 polish + §3 cost properties)

**US-11. Confidence in numbers shown to teammates.**
*As an admin who invited teammates, I need every number in an agent answer to come from a tool call with a citation, so I can trust what teammates see.*
- **Acceptance:** Per the standing principle "the AI never invents numbers." Every numeric claim in an `aggregate_jira`-powered answer has a corresponding tool call in the trace viewer. Hand-test: ask three counting questions, verify all three answers have tool calls that produced the cited numbers.

**US-12. Cost predictability for `aggregate_jira`.**
*As an admin, I need the new capability to stay within my per-project cost cap (per PRD v1.1 §5.6).*
- **Acceptance:** `aggregate_jira` is one Hyperdrive query per call. No fan-out, no N+1, no retry storms beyond existing rate-limit handling. Tool-result payloads bounded per §3.5.

**US-13. Connection management UI.**
*As an admin, I can see each connection's status, last sync time, and trigger a manual re-sync (1/hour per connection) or disconnect — without dropping to the database.*
- **Acceptance:** Per §4.1. Connection list page shows status, last sync timestamp, and record count per connection. Manual re-sync button respects the rate limit and surfaces an in-product message when hit.

**US-14. Nightly sync without my involvement.**
*As an admin, I need data to stay reasonably fresh overnight without me triggering anything.*
- **Acceptance:** Cloudflare Cron Triggers run `incrementalSync` nightly across all active connections (per §4.1). Failures are logged and surfaced on the connection list (US-13). No-op if a connection's last incremental sync was within the cron window.

### 2.5 Platform / dev stories (justifies §3.7)

**US-15. No cross-tenant leak under adversarial DSL.**
*As Jenny / future devs operating the platform, I need `aggregate_jira` to be safe against any DSL the LLM produces, including attempts to filter by `project_id` or reference other tenants' data.*
- **Acceptance:** `project_id` is never a DSL parameter (§3.7.1). Validation rejects DSL that references columns outside the allowlist. Adversarial test cases (hand-crafted DSL trying to escape the allowlist, plus LLM-generated DSL from a prompt-injection test) all return validation errors, never cross-tenant data.

**US-16. Tool-call trace for debugging.**
*As Jenny / future devs, when a user reports "the agent gave me a weird answer," I need to see the exact DSL the LLM submitted, not just the compiled SQL.*
- **Acceptance:** The DSL JSON is logged with each tool call (§3.7.7). The tool-call trace viewer (§4.2) surfaces it. The compiled SQL is recoverable from the DSL deterministically, so logging the DSL is sufficient.

---

## 3. `aggregate_jira` Capability

### 3.1 Problem

The v1.1 Jira tool surface cannot answer questions that require aggregation, grouping, or comparison across more than 50 rows. `query_jira_issues` is hard-capped at 50 results to bound tool-result payloads; `get_jira_sprint_summary` only exposes totals by status_category plus story points. The data is in Postgres; the capability is what's missing.

### 3.2 In scope

- Counting and grouping ("who has the most tickets," "which labels appear most").
- Filtered listing with ordering ("unresolved high-priority bugs, oldest first" — served by retained `query_jira_issues`).
- Cross-sprint comparison ("velocity trend over last 3 sprints," "bugs closed last sprint vs this one") via `group_by` on sprint plus chained `list_jira_sprints` for IDs.
- Per-assignee / per-priority / per-type breakdowns.
- Aggregate metrics on `story_points` (SUM, AVG, MIN, MAX) across groupings.

### 3.3 Tool signature

A single new tool. Structured DSL. LLM submits a JSON object describing the query. Server compiles to a parameterized SQL `SELECT` against the `jira_issues` view with `project_id = $1` forced in server-side.

```ts
aggregate_jira({
  select:    string[],                    // allowlisted columns + aggregate expressions
  where?:    Record<string, Predicate>,   // allowlisted columns → predicates
  group_by?: string[],                    // allowlisted columns
  order_by?: { field: string, dir: 'asc' | 'desc' }[],
  limit?:    number                       // ≤500 grouped, ≤50 ungrouped, server-clamped
})
```

### 3.4 Allowlists

**Columns** (matches `jira_issues` view):
`issue_key, project_key, status, status_category, issue_type, assignee_display_name, assignee_external_id, reporter_display_name, priority, sprint_id, sprint_name, story_points, source_created_at, source_updated_at, labels`.

`content_text`, `source_url`, `title`, and `entities.raw` are **not** allowlisted for aggregation. Free-text questions stay on `search_project_data`.

**Aggregates** (in `select` expressions):
`COUNT(*)`, `COUNT(column)`, `COUNT(DISTINCT column)`, `SUM(column)`, `AVG(column)`, `MIN(column)`, `MAX(column)`. Numeric aggregates valid only on `story_points`. No window functions, no CTEs, no subqueries — the DSL grammar has no slot for them.

**Predicates** (in `where`):
Per column: `eq` (equality, default when value is scalar), `in` (array membership), `neq`, `gt`, `gte`, `lt`, `lte`, `is_null`, `is_not_null`. `labels` (JSONB array) gets `contains` only. Compound predicates are implicit AND across columns; OR is deferred.

**`labels` array-element grouping:**
`group_by: ['labels[]']` compiles to a `LATERAL jsonb_array_elements_text(labels) AS label_value` projection so `select: ['labels[]', 'COUNT(*)']` returns one row per distinct label across the matched issues. This is the only DSL surface that involves a join; everything else is a flat `SELECT` against the view.

**3.4.1 Allowlisted projections.** The DSL allows exactly one derived form beyond the base column list of §3.4: `labels[]`, valid as a `group_by` target and as a corresponding `select` field when paired with `group_by: ['labels[]']`. It compiles to `LATERAL jsonb_array_elements_text(labels) AS label_value` (per §3.4's array-element grouping paragraph). No other JSONB element expansion, computed projection, or derived form is allowlisted in v1.2 — `labels[]` is enumerated, not pattern-matched. Justifies US-2.

### 3.5 Response shape

```ts
{
  rows: Array<Record<string, unknown>>,   // ≤500 rows grouped, ≤50 ungrouped
  truncated: boolean,                     // true if total_groups > rows.length
  total_groups: number,                   // COUNT(*) OVER () alongside main query
  returned: number                        // rows.length, for LLM convenience
}
```

**Truncation handling.** Server caps at 500 grouped / 50 ungrouped. The LLM is instructed (via tool description) to either (a) answer from the returned rows if ordering makes that correct ("top N" questions), (b) re-query with a tighter `where` if completeness matters, or (c) report honest "top N of M" with the count. Three trade-offs were evaluated:

| Option | Verdict | Reason |
|---|---|---|
| Silent truncation | Rejected | Violates "the AI never invents numbers." Numbers are real, conclusions aren't. |
| Hard reject + retry | Rejected | Forces a retry on every breadth-y query including those where ordering makes a partial result correct. Wastes tokens, teaches the LLM to over-narrow. |
| **Truncate and flag** | **Adopted** | LLM has the info to make the right call per question. One extra `COUNT(*) OVER ()` is cheap. |

### 3.6 Retained tools (unchanged from v1.1)

Three Jira tools at v1.2-end: two specific, one generic. The LLM picks the specific tool when the question fits its narrow shape and falls back to `aggregate_jira` otherwise.

- `query_jira_issues(filter)` — retained for ungrouped detail lookups (US-6 case). 50-row cap unchanged.
- `list_jira_sprints({ state })` — retained, now load-bearing for cross-sprint chains (US-3, US-4).
- `get_jira_sprint_summary({ sprint_id })` — retained for the single-sprint dashboard case. Overlaps `aggregate_jira` capability-wise but is cheaper for the LLM to invoke for its specific shape.

### 3.7 Security model

This is multi-tenant SaaS on a solo build. The cost of a cross-tenant leak is catastrophic. Every dimension of safety is centralized in the compiler.

**3.7.1 Project scoping (load-bearing).** `project_id` is **never** an LLM-supplied parameter. It is taken from the authenticated session's current project context and injected server-side as `WHERE project_id = $1` on every compiled query. The DSL grammar has no `project_id` in the allowlist; an LLM attempt to filter on it is rejected at validation.

**3.7.2 Injection surface.** No raw SQL crosses any wire. The compiler emits parameterized SQL via `postgres.js` with the null-coalesced parameter binding pattern established in Block 6. Column names, aggregate names, operator names, and `order_by` directions are validated against allowlists *before* SQL construction; identifiers are interpolated as bare identifiers (required for SQL-identifier position) and values are always parameterized. `labels contains` compiles to `labels @> $N::jsonb` with the value parameterized. `in` compiles to `= ANY($N)` with the array parameterized.

**3.7.3 Payload caps.**
- Grouped: server clamps `limit` to 500. `total_groups` from `COUNT(*) OVER ()` returned alongside.
- Ungrouped: server clamps to 50, matching `query_jira_issues`.
- Allowlisted columns are scalar or short JSONB; no `content_text`, no `raw`, no oversized `title`. Worst-case grouped payload ~50KB.

**3.7.4 Workers subrequest budget.** One Hyperdrive query per call. Same subrequest cost as `query_jira_issues`. The 50-subrequest cap is not in play.

**3.7.5 Query cost / DoS surface.** High-cardinality `group_by` (e.g., `issue_key`) is mitigated by the server-side `LIMIT` clamp (in compiled SQL, so Postgres stops early), the connection-level statement timeout, and `entities_project_source_recency_idx` covering the lead predicate on every compiled query.

**3.7.6 Rate limiting.** Existing per-user / per-project agent rate limits apply (PRD v1.1 §5.6). No new rate-limit surface.

**3.7.7 Audit trail.** Tool calls are logged with the parsed DSL JSON — the durable record. Compiled SQL is recoverable deterministically. The tool-call trace viewer (§4.2) surfaces this.

### 3.8 Sub-decisions locked

| Sub-decision | Locked choice | Reason rejected alternatives lost |
|---|---|---|
| Many specific tools vs. generic DSL vs. text-to-SQL | **Generic DSL** | Specific tools: combinatorial; covering question list needs 5-6 tools and still misses the 7th. Text-to-SQL: unbounded multi-tenant safety story for a solo build; one missed AST case is a cross-tenant leak. |
| Jira-only vs. source-agnostic | **Jira-only** | No other source exists in 1.x. Source-agnostic abstraction is a v2.0 question (when Monday + Drive land). |
| Trends via `group_by` vs. `compare_sprints` tool | **`group_by`** | A dedicated tool would overlap `aggregate_jira`. Overlap forces fuzzy tool-selection decisions; one tool that always answers wins. Cost: one extra LLM turn per trend question. Acceptable. |
| Cap behavior | **Truncate-and-flag at 500/50** | See §3.5 table. |
| Cycle time | **Deferred** | Requires sync-layer change for transition history. Scope discipline. |

### 3.9 System prompt changes

The system prompt's `{{AVAILABLE_SOURCES}}` slot stays unchanged in shape. The Jira section gains:

- The `aggregate_jira` tool description with allowlist tables and three worked examples (top-assignee-in-current-sprint, velocity-trend-across-last-3-closed-sprints, bug-count-comparison-grouped-by-assignee).
- An explicit "not supported in v1.2" list the LLM cites verbatim when asked an out-of-scope question (§3.10). Without this, the LLM will attempt cycle time from `source_updated_at` and produce wrong-but-plausible numbers.
- A pointer for the chained pattern: "for any question involving sprints by recency or by state, first call `list_jira_sprints`, then pass the resulting `sprint_id` values into `aggregate_jira.where`. Do not filter by `sprint_name` — sprint names can be edited and the filter will break silently."

### 3.10 Not supported in v1.2

The agent must refuse these with an honest "not tracked yet" rather than approximate from data that doesn't support the answer:

- Cycle time, lead time, time-in-status.
- Throughput over time, burndown, burnup.
- Bottleneck detection ("which status holds tickets longest").
- Cross-project aggregation (the agent is always scoped to one project in 1.x).
- Free-text predicates inside `aggregate_jira` (use `search_project_data`).
- OR predicates in the DSL (implicit AND only in v1.2).
- Materialized view for `jira_issues` (regular view stays; materialize only if read latency becomes a measured problem).

---

## 4. v1.2 Polish

These items extend baseline v1.1 capabilities to support a non-Jenny user onboarding. Implementation maps to Build Plan Blocks 9 (launch-blocking) + 10 (nice-to-have).

### 4.1 Launch-blocking (Block 9)

- **Connection management UI** — status, last sync time, manual re-sync (admin, 1/hour per connection per PRD v1.1 §5.6), disconnect (US-13).
- **"Data as of" timestamp** on every AI answer, per source cited (PRD v1.1 §5.6).
- **Suggested example questions** on first project open — Slack + Jira shapes (US-1 / US-6 / US-3 are good seeds).
- **Nightly cron via Cloudflare Cron Triggers** driving `incrementalSync` (US-14). Mitigates the Jira `fullSync` DESC long-tail flagged in HANDOFF Block 6 carry-forward.
- **`records_updated` overcount fix** — detect identical state and report `records_skipped` so admins see a meaningful sync delta (per HANDOFF Block 6 carry-forward).

**Done when:** someone other than Jenny can sign up, connect Slack and Jira, see freshness on every answer, and have nightly sync keep their data current without intervention.

### 4.2 Nice-to-have (Block 10)

- **Member "refresh and ask again" action** on each AI response (PRD v1.1 §5.6, 5/user/hour rate limit).
- **Per-project AI cost cap** with admin notification when hit (per PRD v1.1 §7 / §8).
- **Daily message limits per project** (per PRD v1.1 §8.1).
- **Sweep-path batching** — extend `writeEntitiesWithEmbeddingsBatch` to the embedding-sweep path so it doesn't trip the Workers subrequest cap on large recoveries (per HANDOFF Block 6 carry-forward).
- **Tool-call trace viewer** — surface the per-tool errors that Block 6's `f7fc540` started persisting as `tool_result` payloads (US-16, per HANDOFF Block 6 carry-forward).

**Done when:** cost caps + message limits guard infrastructure; "refresh and ask again" works end-to-end; the trace viewer is the canonical debugging surface for any "weird answer" reports.

---

## 5. Success criteria for v1.2

v1.2 is done when **all** of the following hold:

1. The example question list from §2.1 (US-1 through US-6) returns correct, cited answers in production against Jenny's project, end-to-end.
2. The cycle-time question class (US-7) returns the locked refusal text, not a wrong-but-plausible number from `source_updated_at`.
3. The truncation acceptance cases (US-9 and US-10) behave correctly — top-N answers from partial data when ordering supports it, honest "showing N of M" when completeness matters.
4. A non-Jenny user can sign up, connect Slack and Jira, see freshness on every answer, and rely on nightly sync without intervention (US-13, US-14 closed; §4.1 complete).
5. Adversarial DSL test cases (US-15) all fail closed at validation. No cross-tenant data ever returned.

§4.2 nice-to-haves are valuable but not in this list — they raise quality, not a launch gate.

---

## 6. Explicit Cuts (deferred from v1.2)

Tracked here so future scope-setting inherits these cleanly. The 1.x series will pick these up across v1.3 / v1.4 / etc.; specific targeting is per-release scoping.

**Deferred within the 1.x series (target version set when each release is scoped):**

1. **Transition history.** `jira_issue_transitions` table fed by `expand=changelog` on the Jira sync, `jira_transitions` view, changelog backfill, changelog incremental sync. Prerequisite for items 2–4.
2. **Cycle time / lead time / time-in-status tools.** Blocked on (1).
3. **Throughput over time / burndown / burnup.** Blocked on (1).
4. **Bottleneck detection** ("which status holds tickets longest"). Blocked on (1).
5. **Cross-project AI mode.** Originally PRD v1.1 §11.1 as a planned v1.2 extension; no build-plan block in v1.2. Design sketch in PRD v1.1 §11.1 is the right starting point when this lands.
6. **OR predicates in the DSL.** v1.2 is implicit AND across columns. Add when real questions need it; most "or" questions are really "in" questions.
7. **Materialized view for `jira_issues`.** Only if measured read latency demands it.
8. **Free-text predicates inside `aggregate_jira`.** Use `search_project_data`; only revisit if chaining becomes painful.
9. **Audit log for admin actions.** Add when there are multi-admin projects or compliance pressure.
10. **Per-user permission mirroring** from source systems.
11. **Per-project sub-roles.** Project-scoped admin without billing access.
12. **Paid tiers.** Architecture is ready; pricing is the open question.
13. **Mobile native apps.** Web only.

**Parked for v2.0 (the multi-source release; not in any 1.x version):**

- **Monday connector.** API-token GraphQL, `monday_items` view, four tools including `get_monday_board_schema` for board column heterogeneity.
- **Google Drive connector.** OAuth read-only, `drive_files` view, `list_drive_files` + `read_drive_file`, chunk-and-embed for long documents.
- **Drive: images and OCR.** Text extraction from screenshots, scanned PDFs, image files. Follows the Drive baseline.
- **`aggregate_entities` / cross-source aggregation.** Has no consumer until Monday + Drive ship.
- **Additional connectors** (Notion, Telegram, GitHub, Linear, HubSpot). Plug-in via the connector registry.
- **Write-back actions.** Creating Jira tickets, posting Slack messages. Remains read-only.

---

*End of PRD v1.2.*
