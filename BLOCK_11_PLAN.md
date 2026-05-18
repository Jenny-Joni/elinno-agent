# Block 11 — `aggregate_jira` Capability · Build Plan

| Field | Value |
|---|---|
| Block | 11 |
| Series | v1.2 (first block of v1.2) |
| Baseline | Block 10 closed; v1.1 SHIPPED (HANDOFF.md) |
| PRD | PRD v1.2 §3 (in `~/Downloads/PRD_v1.2.md`; to be moved to repo at execute time) |
| Verification | Companion `curl-matrix-block-11.md` (shipped commit 6) |
| Owner | Jenny |

## Context

PRD v1.2 §3 adds **one** agent capability: `aggregate_jira`, a single new tool that lets the agent answer counting / grouping / cross-sprint comparison questions over Jira data. PRD §3.1 spells out the gap: `query_jira_issues` is capped at 50 rows, `get_jira_sprint_summary` only aggregates by status_category — neither serves "who has the most tickets in current sprint" against a 64-ticket sprint, nor "velocity trend over last 3 sprints," nor "compare Alice's workload to Bob's."

Block 6 deferred this exact capability — see BLOCK_6_PLAN.md decision I4 ("Missing-by-design"). v1.2 inherits the deferral and ships it here.

## What Block 11 delivers

A single new tool `aggregate_jira` exposed to the agent loop, backed by a server-side DSL compiler that:

1. Validates a structured DSL (PRD §3.3) against allowlists (PRD §3.4) before any SQL is constructed.
2. Compiles to one parameterized `SELECT` against the existing `jira_issues` view, with `project_id = $1` forced server-side from session context (never an LLM parameter).
3. Caps results server-side at 500 grouped / 50 ungrouped and returns `total_groups` via `COUNT(*) OVER ()` in the same query (one Hyperdrive subrequest total).
4. Is wired into the agent's tool catalogue alongside — not replacing — `query_jira_issues`, `list_jira_sprints`, `get_jira_sprint_summary`.

The system prompt's `{{AVAILABLE_SOURCES}}` slot gains: the tool description with three worked examples, the v1.2 not-supported list (cycle time, lead time, etc.), and the chained pattern pointer (`list_jira_sprints` → `aggregate_jira.where.sprint_id.in`, never filter by `sprint_name`).

**Done-when:** The six US-1 through US-6 questions from PRD §2.1 each return a correct, cited answer in production against Jenny's RAIN project, and US-7's cycle-time question returns the locked refusal text rather than a wrong-but-plausible number from `source_updated_at`.

## Block 10 drift findings

None affecting Block 11 directly. Block 10's trace viewer (V6.1 trace render — commit `c1048d8`) is a debugging accelerator for §3.7.7 audit-trail verification; Block 11's verification will exercise it for US-16.

## Pre-Block-11 prerequisites

Confirm before commit 3:

1. **`jira_issues` view satisfies PRD §3.4 column allowlist.** Verified at plan-write time against `db/migrations/2026-05-10-jira-issues-view.sql`:
   - PRD §3.4 lists 15 allowlist columns. The view projects every one — `issue_key`, `project_key`, `status`, `status_category`, `issue_type`, `assignee_display_name`, `assignee_external_id`, `reporter_display_name`, `priority`, `sprint_id` (cast to integer), `sprint_name`, `story_points` (cast to numeric), `source_created_at`, `source_updated_at`, `labels` (as JSONB array).
   - **No migration required.** The view from Block 6 is sufficient.
2. **Test data on `rain-labs.atlassian.net`** retains the shape verified in Block 6: ≥12 sprints (mix of active / closed / future), sprint_id 704 active with >50 tickets (US-1 case), multiple distinct assignees per sprint (US-5), label diversity (US-2), ≥3 closed sprints for velocity trends (US-3, US-4).
3. **Block 9 nightly cron** is running so chained `list_jira_sprints` → `aggregate_jira` patterns hit fresh data. (Verified pre-execute against `wrangler.toml` Cron Triggers section.)
4. **Block 10 tool-call trace viewer** is reachable for US-16. (Verified pre-execute via existing admin UI route.)
5. **No new secrets required.** `aggregate_jira` uses the existing Hyperdrive binding and master encryption key; introduces no new env vars.

## Execute mode: mixed AUTO + DEFAULT

Per WORKFLOW.md security carve-outs:

- **AUTO**: doc files (this plan, BUILD_PLAN update, curl-matrix companion, HANDOFF closeout).
- **DEFAULT** (carve-out): the DSL compiler module (security boundary), tool registration in `tools.js` (changes the agent's executable tool surface), and the system prompt update (changes what the model is instructed to do). All three sit on the multi-tenant safety story per PRD §3.7.

Each commit names its mode in §10 commit ordering.

## Locked design decisions

### A. Tool surface — generic DSL, not many specific tools, not text-to-SQL

`aggregate_jira` exposes a single structured DSL: `{ select, where, group_by, order_by, limit }` (PRD §3.3). The LLM populates the DSL; the server compiles to SQL.

**Rationale:** Many-specific-tools would need 5–6 tools to cover §2.1's question list and still miss the 7th — combinatorial blowup with no exit. Text-to-SQL has an unbounded multi-tenant safety story on a solo build; one missed AST case is a cross-tenant leak.

**Tradeoff:** The DSL is a new surface the LLM must learn. Mitigated by three worked examples in the tool description (§3.9 lock).

**Specific failure mode the lock prevents:** Cross-tenant SQL injection. The DSL has no syntactic slot for raw SQL, no subqueries, no CTEs, no window functions. The compiler is the only path from DSL → SQL.

### B. Tool scope — Jira-only in v1.2; cross-source aggregation parked for v2.0

`aggregate_jira` queries only the `jira_issues` view. No `aggregate_slack`, no `aggregate_entities`, no source parameter.

**Rationale:** Slack is the only other 1.x source and its question shapes don't overlap (Slack questions are conversational / retrieval, not counting / grouping). Cross-source aggregation (`aggregate_entities`) has no consumer until Monday + Drive land in v2.0 (PRD v1.2 §6 parked list).

**Specific failure mode the lock prevents:** Premature abstraction. A "source-agnostic aggregate tool" would lock in column-set assumptions before Monday's GraphQL schema and Drive's file-metadata shape are known.

### C. Cross-sprint trends via `group_by`, not a dedicated `compare_sprints` tool

Trend questions (US-3 velocity, US-4 bug count comparison) chain `list_jira_sprints({ state: 'closed' })` → `aggregate_jira` with `where.sprint_id.in: [...]` and `group_by: ['sprint_name']`.

**Rationale:** A dedicated `compare_sprints` tool would overlap `aggregate_jira` and force the LLM to pick between them on every trend-shaped question. Overlap is the worst case for tool selection.

**Tradeoff:** One extra LLM turn per trend question (the `list_jira_sprints` call to get IDs). Acceptable — sprint listing is cheap.

**Specific failure mode the lock prevents:** Filtering by `sprint_name` directly. Sprint names are user-editable in Jira; a `sprint_name = 'Sprint 12'` filter silently breaks if someone renames. The chained `sprint_id.in` pattern uses stable IDs. The system prompt (§K) makes this rule explicit.

### D. Truncate-and-flag at 500 grouped / 50 ungrouped

The compiler clamps `limit` to 500 (grouped) or 50 (ungrouped) before SQL execution. Response shape per PRD §3.5: `{ rows, truncated, total_groups, returned }`. `total_groups` from `COUNT(*) OVER ()` in the same query.

**Rationale:** Silent truncation violates "the AI never invents numbers." Hard-reject + retry burns tokens on every breadth-y query where the top-N ordering would have made a partial result correct. Truncate-and-flag lets the LLM make the right call per question (US-9 top-N → answer from partial; US-10 breadth → report "showing N of M").

**Tradeoff:** One extra column (`COUNT(*) OVER ()`) on every query. Cheap.

**Specific failure mode the lock prevents:** "Top 10 labels" returning a confident wrong answer because the LLM didn't know the row set was truncated.

### E. Cycle time / lead time / time-in-status — deferred to v1.3+

These question shapes require transition history (`expand=changelog` in Jira sync, a `jira_issue_transitions` table, a `jira_transitions` view). Block 11 ships none of that.

**The agent must refuse, not approximate.** See decision K (tool description includes the not-supported list). Without that lock the LLM will compute cycle time from `source_updated_at - source_created_at` and report a wrong-but-plausible number (US-7 case).

**Specific failure mode the lock prevents:** Wrong-but-plausible answers in a production tool that's supposed to be authoritative.

### F. Project scoping — server-injected, never a DSL parameter

`project_id` is taken from the authenticated session's current project context at the executor entry point and injected as `WHERE project_id = $1` on every compiled query. The DSL grammar **does not list `project_id` in the column allowlist**; an LLM attempt to include it in `where` is rejected at validation.

**Specific failure mode the lock prevents:** Cross-tenant data leak. This is the load-bearing security property. US-15 in the verification matrix tests this with adversarial DSL.

### G. Injection surface — allowlist + parameterized SQL, no raw SQL anywhere

The compiler emits SQL via postgres.js parameter binding. Column names, aggregate function names, predicate operator names, and `order_by` directions are validated against allowlists (PRD §3.4) **before** any string construction; only after validation are identifiers interpolated as bare SQL identifiers. Values are always parameterized. `labels contains X` → `labels @> $N::jsonb` with `X` parameterized. `column in [a,b,c]` → `column = ANY($N)` with the array parameterized.

The null-coalesced parameter binding pattern from Block 6 (`(${val}::type IS NULL OR col = ${val})`) is reused for optional `where` predicates.

**Validation errors return a structured envelope the LLM can self-correct from**, not just a 400: `{ ok: false, error: 'validation', code: '<symbolic-reason>', field: '<offending-DSL-key>', allowed: <relevant-allowlist-slice-or-null> }`. Codes are an enumerated set (e.g. `column_not_allowlisted`, `aggregate_not_allowlisted`, `operator_not_allowlisted`, `project_id_forbidden`, `projection_not_allowlisted`). Note: `limit_clamped` is **not** an error — clamping is silent server-side. The LLM can read the envelope, revise its DSL, and retry on the next turn within the same agent loop.

**Specific failure mode the lock prevents:** SQL injection. Any column name not in the allowlist rejects at validation. Any operator not in the allowlist rejects at validation. Identifiers never come from user input.

### H. Payload caps — 500 grouped / 50 ungrouped, server-clamped

Server clamps `limit` before SQL execution. PRD §3.7.3 reasoning: allowlisted columns are scalar or short JSONB; no `content_text`, no `raw`, no oversized `title`. Worst-case grouped payload ~50 KB — fits Claude's tool-result budget without trimming.

**Specific failure mode the lock prevents:** Tool-result blowup. An LLM submitting `limit: 100000` does not blow context.

### I. Subrequest budget — one Hyperdrive query per `aggregate_jira` call

`total_groups` is computed via `COUNT(*) OVER ()` in the same `SELECT`, not via a second round trip. Total cost: 1 Hyperdrive subrequest per tool call.

**Specific failure mode the lock prevents:** Workers 50-subrequest cap. Block 6's `1d84cf7` fixup showed the cap is real; `aggregate_jira` stays cheap.

### J. Audit trail — DSL JSON logged as the durable record

The DSL JSON the LLM submitted is logged with each tool call (via the existing `tool_result` JSONB persistence in `loop.js`). The compiled SQL is recoverable deterministically from the DSL, so logging the DSL is sufficient.

**Specific failure mode the lock prevents:** Unauditable LLM behavior. When a user reports a weird answer, the DSL JSON in the trace viewer (US-16) is the canonical artifact to diagnose against.

### K. Tool description includes the v1.2 not-supported list verbatim

The `aggregate_jira` tool description in the system prompt MUST include the §3.10 not-supported list (cycle time, lead time, time-in-status, throughput-over-time, burndown, burnup, bottleneck detection, cross-project aggregation, free-text predicates, OR predicates) with the agent instructed to cite the relevant item verbatim when refusing.

**Specific failure mode the lock prevents:** US-7 case — the LLM computing cycle time from `source_updated_at` and producing a wrong-but-plausible number. Without the explicit list, the LLM will try.

### L. Retained tools unchanged from v1.1

`query_jira_issues`, `list_jira_sprints`, `get_jira_sprint_summary` ship at v1.2-end with no signature or behavior change. Block 11 adds; it does not modify.

**Rationale:** `query_jira_issues` is the right tool for ungrouped detail lookups (US-6 case — "unresolved high-priority bugs, oldest first" is a list, not an aggregate). `list_jira_sprints` is load-bearing for the chained pattern (decision C). `get_jira_sprint_summary` is cheaper for its specific shape than the equivalent `aggregate_jira` call and the LLM already knows it.

**Specific failure mode the lock prevents:** Regression on v1.1's verified Jira behavior. Block 6's curl-matrix-block-6.md remains the regression contract.

### M. `labels` array-element grouping via LATERAL `jsonb_array_elements_text`

`group_by: ['labels[]']` is the only DSL surface that involves a join. The compiler emits `LATERAL jsonb_array_elements_text(labels) AS label_value` and projects `label_value` as the grouped column. Every other DSL shape is a flat `SELECT` against the view.

**Dependency:** This decision compiles a projection (`labels[]`) that is not in PRD §3.4's literal column allowlist. Shipping the compiler with that authority requires PRD addendum §3.4.1 to land in the PRD before commit 3. The compiler **must not** treat any other JSONB-element expansion as allowlisted — `labels[]` is enumerated, not pattern-matched. If §3.4.1 does not land, US-2 is cut and `labels[]` is rejected by the compiler with `error: 'validation', code: 'projection_not_allowlisted'`.

**Specific failure mode the lock prevents:** US-2 — "which labels appear most" silently returning JSONB arrays instead of per-label counts. Also: the compiler shipping with authority the PRD does not grant.

### N. Allowlist tables — single source of truth in PRD §3.4

Block 11 does not duplicate the column / aggregate / predicate allowlists into this plan or into source code comments. The compiler imports the lists from a single module (`functions/_lib/ai/aggregate_jira_compiler.js` exports them) and references PRD §3.4 in a header comment.

**Specific failure mode the lock prevents:** Allowlist drift between PRD, plan, code, and tests.

### O. Compiler module location — `functions/_lib/ai/aggregate_jira_compiler.js`

Mirrors the existing `functions/_lib/ai/` namespace (`tools.js`, `loop.js`, prompt module). Not under `functions/_lib/connectors/` because aggregate_jira is an AI-tool capability, not a connector. Not under a new `functions/_lib/agent/` directory — the existing `ai/` directory is the right home.

**Specific failure mode the lock prevents:** Directory sprawl. Block 11 introduces one new module file, not a new namespace.

### P. Verification — companion `curl-matrix-block-11.md`, shipped commit 6

All verification scenarios (Phase A–E, matching Block 6's shape) land in `curl-matrix-block-11.md`. The plan references the matrix; the plan does not contain it.

**Specific failure mode the lock prevents:** Plan-doc bloat. Test artifacts live next to the plan, not inside it.

## Commit ordering

Numbered in execute order. Modes per the AUTO + DEFAULT split from earlier.

**Pre-commit-3 dependency (Jenny-owned, outside this plan's commit list):** PRD addendum §3.4.1 must land in `~/Downloads/PRD_v1.2.md` before commit 3 (the compiler) lands. Proposed text:

> **3.4.1 Allowlisted projections.** The DSL allows exactly one derived form beyond the base column list of §3.4: `labels[]`, valid as a `group_by` target and as a corresponding `select` field when paired with `group_by: ['labels[]']`. It compiles to `LATERAL jsonb_array_elements_text(labels) AS label_value` (per §3.4's array-element grouping paragraph). No other JSONB element expansion, computed projection, or derived form is allowlisted in v1.2 — `labels[]` is enumerated, not pattern-matched. Justifies US-2.

Without §3.4.1, decision M and US-2 are both cut and `labels[]` is rejected by the compiler.

| # | Subject | Mode | Notes |
|---|---|---|---|
| 1 | `docs(block-11): lock Block 11 design decisions A–P` | AUTO | This plan doc as a single artifact. |
| 2 | `docs(block-11): refresh BUILD_PLAN.md — mark 9 + 10 shipped, add Block 11` | AUTO | Two-part docs change: (a) move Blocks 9 + 10 entries to the "Already Done" section (with HANDOFF closeout cross-refs), (b) append Block 11 to "Build in This Order." BUILD_PLAN's `Last updated` field bumped to today. |
| 3 | `feat(block-11): aggregate_jira DSL compiler module` | DEFAULT | `functions/_lib/ai/aggregate_jira_compiler.js`. Allowlist exports (referencing PRD §3.4 + §3.4.1 as source of truth), DSL validator, SQL compiler, parameter binding, `LATERAL jsonb_array_elements_text` for `labels[]`, `COUNT(*) OVER ()` for `total_groups`. Server-side `project_id` injection at the executor boundary. Structured validation-error envelope per decision G. |
| 4 | `feat(block-11): register aggregate_jira tool + executor handler` | DEFAULT | `functions/_lib/ai/tools.js`. Add tool definition (DSL schema); add executor case that loads `project_id` from session, calls the compiler, runs the query, returns the §3.5 response shape. Existing three Jira tools untouched. |
| 5 | `feat(block-11): aggregate_jira system prompt update` | DEFAULT | Tool description with three worked examples (top-assignee-current-sprint, velocity-trend-3-closed-sprints, bug-count-comparison-by-assignee); the §3.10 not-supported list verbatim; the chained `list_jira_sprints` → `aggregate_jira` pointer with the no-`sprint_name`-filter rule. |
| 6 | `docs(block-11): curl-matrix-block-11.md verification record` | AUTO | All Phase A–E scenarios from §11. |
| 7 | `docs(block-11): HANDOFF Block 11 closeout` | AUTO | Adds the v1.2-kickoff section; carries forward any new findings. |

Reserved fixup slots: 2 (matching Block 6's discipline).

## Verification matrix — scenario index

Detail in `curl-matrix-block-11.md` (commit 6). Phase shape mirrors Block 6.

**Phase A — pre-execution gates.**
- A1 jira_issues view column shape matches PRD §3.4 (read-only SQL).
- A2 Test instance shape (sprint count, active sprint ticket count, assignee/label diversity).
- A3 No new secrets / env vars required.

**Phase B — compiler unit behavior** (against staging or local; not user-facing).
- B1 Column not in allowlist → validation error.
- B2 Aggregate function not in allowlist → validation error.
- B3 Operator not in allowlist → validation error.
- B4 `project_id` in `where` → validation error.
- B5 `limit` over 500 (grouped) / 50 (ungrouped) → clamped, no error.
- B6 Empty `where` + empty `group_by` → ungrouped path, 50-row cap.
- B7 `labels[]` in `group_by` → compiles to `LATERAL jsonb_array_elements_text`.
- B8 `total_groups` returned via `COUNT(*) OVER ()` in same query (verify EXPLAIN or wire-trace).

**Phase C — end-to-end agent questions** (production, RAIN project).
- C1 US-1 "who has the most tickets in current sprint?" → ranked list with counts, cites active sprint.
- C2 US-2 "which labels appear most?" → frequency-ordered list (uses M).
- C3 US-3 "velocity over last 3 sprints?" → chained call, three rows chronological.
- C4 US-4 "bugs closed last sprint vs this one?" → comparison framing.
- C5 US-5 "compare Alice's workload to Bob's" → side-by-side; missing-name handling.
- C6 US-6 "unresolved high-priority bugs, oldest first" → routes to `query_jira_issues`, not `aggregate_jira` (verifies L).

**Phase D — refusal + truncation behavior.**
- D1 US-7 "average cycle time for stories?" → refusal text matches §3.10; no source_updated_at math.
- D2 US-8 "bugs across all my projects?" → answers for active project + scope note.
- D3 US-9 top-10 over high-cardinality group → correct top 10 + `total_groups`.
- D4 US-10 breadth over high-cardinality group → "showing N of M" framing.

**Phase E — security + audit.**
- E1 US-15 adversarial DSL: attempt to add `project_id` to `where` → validation error, no cross-tenant data.
- E2 Adversarial DSL: attempt raw-SQL-shaped column name (e.g. `'1; DROP TABLE'`) → validation error.
- E3 Adversarial DSL: attempt subquery / CTE / window-function shape → validation error (grammar has no slot).
- E4 LLM-generated adversarial DSL via prompt-injection test → all attempts fail closed.
- E5 US-16 trace viewer shows DSL JSON for one `aggregate_jira` call end-to-end.
- E6 Subrequest count: one Hyperdrive call per `aggregate_jira` invocation (verify via wrangler tail).

## Critical files

New:
- `functions/_lib/ai/aggregate_jira_compiler.js`
- `curl-matrix-block-11.md`

Modified:
- `functions/_lib/ai/tools.js` — `TOOL_DEFINITIONS` array + executor dispatch (no changes to existing Jira executors)
- The file containing the `{{AVAILABLE_SOURCES}}` slot — exact path identified at commit 5 (likely `functions/_lib/ai/prompts.js` or equivalent; resolved via grep at execute time)
- `BUILD_PLAN.md` — refresh "Already Done" section for Blocks 9 + 10, append Block 11
- `HANDOFF.md` — Block 11 closeout section

Read-only references:
- `db/migrations/2026-05-10-jira-issues-view.sql` — the view the compiler queries
- `functions/_lib/connectors/jira.js` — entity mapping the view depends on (no changes)

## Block 12+ prerequisites

Block 11 establishes the DSL pattern and the safety story for one source. Successor blocks for the deferred items in PRD v1.2 §6 (transition history, cycle time, OR predicates) reuse the same compiler shape — they extend the allowlist, not the architecture.

## Out-of-scope for Block 11

Tracked here to keep scope discipline:

- **No schema migration.** The `jira_issues` view satisfies §3.4 already.
- **No new Jira-sync logic.** Block 11 reads from `entities`; it does not change what gets synced.
- **No transition history.** Cycle time / lead time / time-in-status remain refused with the locked text. v1.3+ work.
- **No OR predicates in the DSL.** Implicit AND only. v1.3+.
- **No materialized view.** Regular view stays; revisit only if measured read latency demands it.
- **No free-text predicates inside `aggregate_jira`.** `search_project_data` remains the free-text tool.
- **No cross-project aggregation.** Active-project-scoped only. PRD v1.2 §6 deferred-within-1.x item 5.
- **No cross-source aggregation.** `aggregate_entities` is parked for v2.0.
- **No changes to existing Jira tools.** `query_jira_issues`, `list_jira_sprints`, `get_jira_sprint_summary` unchanged (decision L).
- **No connector framework changes.** Block 3's registry untouched.
- **No connection-management UI changes.** Block 9 polish, already shipped.
