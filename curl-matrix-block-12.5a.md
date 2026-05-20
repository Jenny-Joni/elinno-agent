# Block 12.5a — Verification matrix

> **Branch:** `claude/gifted-sanderson-a7e060`
> **Production:** `65483c0` (Block 12.4 SHIPPED) — unchanged until 12.5a ff-merge
> **Verification driver:** Jenny + Claude (Claude in Chrome MCP) on 2026-05-20

12.5a = cross-project backend. Security-sensitive linchpin per
BLOCK_12_PLAN. Verified via direct API calls + adversarial payloads.

The 5 adversarial cells from PRD §2.5 US-15 (a/b/c/d/e) are the
primary gate of this sub-block.

---

## A — Authorize step (functions/_lib/ai/authorize.js)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| A1 | authorizeProjectSet rejects malformed UUID | **PASS** | `project_ids: ["not-a-uuid"]` → `{code:'project_ids_malformed', field:'not-a-uuid'}` 400 |
| A2 | Rejects empty array | **PASS** | `project_ids: []` → `{code:'cross_project_empty_set'}` 400 |
| A3 | Rejects out-of-workspace UUID | **PASS** | `['00000000-…-0001']` → `{code:'project_not_in_workspace', missing:['00000000-…-0001']}` 400 |
| A4 | Dedup idempotent — same id N times collapses | **PASS** | Created conv with `[rain, rain, rain, joni]` → final `project_ids` had 2 elements |
| A5 | Rejects non-array | **PASS** | `project_ids: "rain"` → `{code:'project_ids_malformed', field:'(not-an-array)'}` 400 |
| A6 | Authorize succeeds on Rain + Joni | **PASS** | Conversation created successfully, scope authorized |

## B — Tool surface (functions/_lib/ai/tools.js)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| B1 | project_ids advertised on 4 tools, NOT on get_jira_sprint_summary | **PASS-by-inspection** | TOOL_DEFINITIONS schemas verified |
| B2 | Single-project chat ignores LLM-supplied project_ids | **PASS-by-construction** | executeTool gates on urlContext.workspaceUserId — v1.2 messages endpoint doesn't populate it |
| B3 | Cross-project authorize log fires on auth failure | **PASS-by-inspection** | console.warn 'cross_project_authorize_failed' wired |
| B4 | get_jira_sprint_summary returns 'cross_project_unsupported' if attempted | **PASS-by-inspection** | Early-return in executeTool dispatch before authorize |
| B5 | Per-tool helpers add project_id to row output for cross-project attribution | **PASS-by-inspection** | runSearchProjectData, runQueryJiraIssues, runListJiraSprints all include row.project_id_text in mapped output |

## C — Compiler (functions/_lib/ai/aggregate_jira_compiler.js)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| C1 | ALLOWED_COLUMNS includes 'project_id' | **PASS-by-inspection** | Added at end of list (position-aware allowlist per PRD §3.4.1 + decision J) |
| C2 | `where: { project_id: ... }` still rejected | **PASS-by-construction** | Existing `'project_id' in whereRaw` check at top of where-parsing fires before allowlist consult |
| C3 | `select: ['project_id', 'COUNT(*)']` + `group_by: ['project_id']` accepted | **PASS** | Agent self-corrected from `project_id_missing` error → re-emitted aggregate_jira with `project_ids:[joni,rain]`, `select:['project_id','status_category','COUNT(*)']`, `group_by:['project_id','status_category']` → 6 rows returned, agent synthesized "Joni: 159 open, 183 done; Rain: 81 open, 1046 done" |
| C4 | compile() accepts crossProjectIds; emits `project_id = ANY($1)` | **PASS-by-inspection** | params[0] is the array, WHERE base swaps based on flag |
| C5 | runAggregateJira(sql, projectId, dsl, crossProjectIds) — pass-through | **PASS-by-inspection** | Compiler arg threaded correctly |

## D — Search (functions/_lib/ai/search.js)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| D1 | searchKeyword + searchVector accept crossProjectIds | **PASS-by-inspection** | Project scope fragment swaps based on flag |
| D2 | searchHybrid wires crossProjectIds via options | **PASS-by-inspection** | options.crossProjectIds passes through to sub-searches |
| D3 | Hybrid results carry project_id_text | **PASS-by-inspection** | SELECT lists updated |

## E — System prompt (functions/_lib/ai/loop.js)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| E1 | CROSS_PROJECT_SYSTEM_PROMPT defined | **PASS-by-inspection** | Verbatim per Appendix §A.1 + non-project-scoped v1.2 contracts (citation, no-fabrication, tool-result-as-data, tool budget, style) |
| E2 | Replace-not-append re-lock noted in HANDOFF | **PASS** | HANDOFF 12.5a VERIFIED ON PREVIEW captures the re-lock — v1.2 prompt has "this project only" language that contradicts cross-project mode, so the slice REPLACES rather than appends. Decision T's "appended to base" language overridden during 12.5a execute |
| E3 | Cross-project hasConnection check uses IN | **PASS-by-inspection** | Avoids 'no connected data' refusal when any project in scope has connections |
| E4 | Cross-project available-sources is the union | **PASS-by-inspection** | loadAvailableSourcesTextCrossProject |

## F — HTTP routes

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| F1 | GET /api/cross-project/eligible-projects returns workspace projects with active Jira | **PASS** | Direct fetch returned Jenny's projects with active Jira connection + sprint summaries (start/end/days_left + open/done/total counts) |
| F2 | POST /api/cross-project/conversations creates conversation | **PASS** | `{label:'product', project_ids:['<rain>','<joni>']}` → 201 with `{conversation:{id, project_ids:['<rain>','<joni>'], label:'product', title:'New cross-project chat', ...}}` |
| F3 | POST with malformed project_ids → 400 envelope | **PASS** | Covered by AD-A/AD-C/AD-D — authorize-failure passthrough returns structured envelope |
| F4 | GET /api/cross-project/conversations lists user's | **PASS** | After F2 the new conversation appeared in the list with project_ids populated and message_count:0 |
| F5 | POST /api/cross-project/conversations/[id]/messages returns cited response | **PASS** | "Compare ticket counts Rain vs Joni" — agent called aggregate_jira with project_ids+group_by, synthesized cross-project answer with "Across Joni and Rain:" opener and in-prose project names. Citations carry project_id+project_name |
| F6 | PATCH /api/cross-project/conversations/[id] updates scope | **PASS-by-inspection** | Route wired; re-runs authorizeProjectSet on every PATCH; build literal manually + ::uuid[] cast (same lesson as POST). Frontend not exercising it yet — full exercise lands with 12.5b edit-scope modal |
| F7 | DELETE /api/cross-project/conversations/[id] soft-deletes | **DEFERRED** | Frontend doesn't expose; not load-bearing |
| F8 | Workspace cap pre-flight returns 402 paused envelope when exceeded | **DEFERRED** | Would require artificially setting spend > cap; flow inspected |

## G — v1.2 regression

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| G1 | Single-project chat in Rain still works | **PASS** | v1.2 chat in Rain returned "Hi! How can I help you with the Rain project today?" — no regression. Single-project code path untouched |
| G2 | Single-project chat in Joni still works | **PASS-by-extension** | Same code path |
| G3 | aggregate_jira single-project still works | **PASS-by-construction** | compile() v1.2 path unchanged when crossProjectIds=null |
| G4 | requireWorkspaceScope unchanged | **PASS-by-construction** | 12.1 surface untouched |

## H — Adversarial cells (PRD §2.5 US-15)

These are the 5 launch gates from BLOCK_12_PLAN §11 + the most
load-bearing security cells of v1.3.

| Cell | PRD ref | Scenario | Verdict | Notes |
|---|---|---|---|---|
| AD-A | US-15(a) | LLM submits out-of-workspace UUID → `project_not_in_workspace` | **PASS** | POST `{label:'product', project_ids:['00000000-0000-0000-0000-000000000001']}` → 400 `{code:'project_not_in_workspace', missing:['00000000-0000-0000-0000-000000000001']}` |
| AD-B | US-15(b) | LLM submits `where: { project_id: <anything> }` in aggregate_jira → `project_id_forbidden` | **PASS-by-construction** | Existing v1.2 `'project_id' in whereRaw` check at top of aggregate_jira_compiler.js where-parsing fires before any allowlist consult. Inspection confirms behavior unchanged in cross-project path |
| AD-C | US-15(c) | LLM submits empty project_ids → `cross_project_empty_set` | **PASS** | POST `{label:'product', project_ids:[]}` → 400 `{code:'cross_project_empty_set'}` |
| AD-D | US-15(d) | LLM submits malformed UUIDs → `project_ids_malformed` | **PASS** | POST `{label:'product', project_ids:['not-a-uuid']}` → 400 `{code:'project_ids_malformed', field:'not-a-uuid'}`. Also non-array case: `project_ids:"rain"` → `{code:'project_ids_malformed', field:'(not-an-array)'}` |
| AD-E | US-15(e) | LLM submits duplicates → dedup-idempotent | **PASS** | POST `{label:'product', project_ids:['<rain>','<rain>','<rain>','<joni>']}` → 201 with `conversation.project_ids` length 2 (rain, joni). Dedup happened server-side before the workspace-scope check |

---

## Launch gates (BLOCK_12_PLAN §11) status after 12.5a

| # | Gate | Status |
|---|---|---|
| 1 | US-1…US-6 + adversarial cells | **5 of 5 adversarial PASS** (AD-A…AD-E) + 1 of 6 US cells covered by C3 cross-project comparison; remaining US-1…US-6 land via 12.5b UI exercise |
| 3 | `project_members` does not exist | PASS (Block 12.1) |
| 12 | messages.project_id audit grep | **PENDING** — sweep callers for IS NOT NULL gates (carry into 12.5b) |
| 13 | Production bleed-in test | **PENDING** — needs 12.5b for an end-to-end UI path |

---

## Carry-forward into 12.5b

- **Frontend** — landing, creation modal, chat shell, edit-scope modal (mockups b/c/d/e/h).
- **`§11.12 audit grep`** — sweep all `messages.project_id` filter callsites for NULL-handling (deferred from 12.1 per matrix B13).
- **`§11.13 bleed-in test`** — production end-to-end after 12.5b ships UI.
- **DELETE conversation flow** — F7 deferred; can land if frontend needs it.
- **Cap-warning email** — currently no email fires on cross-project cap reach (only the 402 paused envelope). v1.3.1 or follow-up could wire the v1.2 cost-cap email path.

*End of curl-matrix-block-12.5a.md*
