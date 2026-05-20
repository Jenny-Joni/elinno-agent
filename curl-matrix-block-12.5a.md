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
| A1 | authorizeProjectSet rejects malformed UUID | **PENDING** | Test: POST `{project_ids: ["not-a-uuid"]}` → expect `{ok:false, code:'project_ids_malformed', field:'not-a-uuid'}` |
| A2 | Rejects empty array | **PENDING** | `{project_ids: []}` → `{ok:false, code:'cross_project_empty_set'}` |
| A3 | Rejects out-of-workspace UUID | **PENDING** | `{project_ids: ['00000000-0000-0000-0000-000000000001']}` → `{ok:false, code:'project_not_in_workspace', missing: [...]}` |
| A4 | Dedup idempotent — same id N times collapses to 1 | **PENDING** | `{project_ids: ['<rain>', '<rain>', '<rain>']}` → `{ok:true, projectIds: ['<rain>']}` (single element) |
| A5 | Rejects non-array | **PENDING** | `{project_ids: "rain"}` → `{ok:false, code:'project_ids_malformed', field:'(not-an-array)'}` |
| A6 | Authorize succeeds on Rain + Joni | **PENDING** | `{project_ids: ['<rain>', '<joni>']}` → `{ok:true, projectIds: [...]}` |

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
| C3 | `select: ['project_id', 'COUNT(*)']` + `group_by: ['project_id']` accepted | **PENDING — agent test** | Will fire via cross-project comparison query |
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
| E2 | Replace-not-append re-lock noted in HANDOFF | **PENDING** | HANDOFF VERIFIED ON PREVIEW will capture |
| E3 | Cross-project hasConnection check uses IN | **PASS-by-inspection** | Avoids 'no connected data' refusal when any project in scope has connections |
| E4 | Cross-project available-sources is the union | **PASS-by-inspection** | loadAvailableSourcesTextCrossProject |

## F — HTTP routes

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| F1 | GET /api/cross-project/eligible-projects returns workspace projects with active Jira | **PENDING** | Direct fetch — expect 4 projects (Jenny's workspace) with sprint summaries |
| F2 | POST /api/cross-project/conversations creates conversation | **PENDING** | `{label:'product', project_ids:['<rain>', '<joni>']}` → 201 with `{conversation: {id, project_ids, label, ...}}` |
| F3 | POST with malformed project_ids → 400 envelope | **PENDING** | Authorize-failure passthrough |
| F4 | GET /api/cross-project/conversations lists user's | **PENDING** | After F2 succeeds, list should include the new conversation |
| F5 | POST /api/cross-project/conversations/[id]/messages returns cited response | **PENDING** | "Compare velocity Rain vs Joni" — agent should call aggregate_jira with group_by:['project_id'] |
| F6 | PATCH /api/cross-project/conversations/[id] updates scope | **PENDING** | Re-runs authorize |
| F7 | DELETE /api/cross-project/conversations/[id] soft-deletes | **DEFERRED** | Frontend doesn't expose; not load-bearing |
| F8 | Workspace cap pre-flight returns 402 paused envelope when exceeded | **DEFERRED** | Would require artificially setting spend > cap; flow inspected |

## G — v1.2 regression

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| G1 | Single-project chat in Rain still works | **PENDING — eyes-on** | Send a message, expect cited response. Critical regression check |
| G2 | Single-project chat in Joni still works | **PASS-by-extension** | Same code path |
| G3 | aggregate_jira single-project still works | **PASS-by-construction** | compile() v1.2 path unchanged when crossProjectIds=null |
| G4 | requireWorkspaceScope unchanged | **PASS-by-construction** | 12.1 surface untouched |

## H — Adversarial cells (PRD §2.5 US-15)

These are the 5 launch gates from BLOCK_12_PLAN §11 + the most
load-bearing security cells of v1.3.

| Cell | PRD ref | Scenario | Verdict | Notes |
|---|---|---|---|---|
| AD-A | US-15(a) | LLM submits out-of-workspace UUID → `project_not_in_workspace` | **PENDING** | Test via direct API call to POST /api/cross-project/conversations |
| AD-B | US-15(b) | LLM submits `where: { project_id: <anything> }` in aggregate_jira → `project_id_forbidden` | **PENDING** | Test by crafting a conversation + sending a message that should trigger aggregate_jira; or directly test compile() with the bad DSL |
| AD-C | US-15(c) | LLM submits empty project_ids → `cross_project_empty_set` | **PENDING** | Test on POST /api/cross-project/conversations |
| AD-D | US-15(d) | LLM submits malformed UUIDs → `project_ids_malformed` | **PENDING** | Test on POST /api/cross-project/conversations |
| AD-E | US-15(e) | LLM submits duplicates → dedup-idempotent | **PENDING** | Test on POST: pass same UUID 3x, expect dedup to 1 |

---

## Launch gates (BLOCK_12_PLAN §11) status after 12.5a

| # | Gate | Status |
|---|---|---|
| 1 | US-1…US-6 + adversarial cells | **5 of 5 adversarial PENDING** — preview verification |
| 3 | `project_members` does not exist | PASS (Block 12.1) |
| 12 | messages.project_id audit grep | **PENDING** — sweep callers for IS NOT NULL gates |
| 13 | Production bleed-in test | **PENDING** — needs 12.5b for an end-to-end UI path |

---

## Carry-forward into 12.5b

- **Frontend** — landing, creation modal, chat shell, edit-scope modal (mockups b/c/d/e/h).
- **`§11.12 audit grep`** — sweep all `messages.project_id` filter callsites for NULL-handling (deferred from 12.1 per matrix B13).
- **`§11.13 bleed-in test`** — production end-to-end after 12.5b ships UI.
- **DELETE conversation flow** — F7 deferred; can land if frontend needs it.
- **Cap-warning email** — currently no email fires on cross-project cap reach (only the 402 paused envelope). v1.3.1 or follow-up could wire the v1.2 cost-cap email path.

*End of curl-matrix-block-12.5a.md*
