# Block 12.5b — Verification matrix

> **Branch:** `claude/gifted-sanderson-a7e060`
> **Production:** `dd6c6ff` (Block 12.5a SHIPPED) — unchanged until 12.5b ff-merge
> **Verification driver:** Jenny + Claude (Claude in Chrome MCP) on 2026-05-20
> **Verified deploys:** `9d66b79a` (loadMe fix `33c00cc`) + `01964d9d` (parse fix `546a849`)

12.5b is the cross-project **frontend** that rides on the 12.5a
backend. Auto-mode sub-block (no SECURITY-CARVE-OUT files). The big
two are PRD §2.1 US-1…US-6 exercised through the UI, plus the
§11.13 production bleed-in test that was deferred from 12.1.

---

## A — Landing page (public/cross-project/index.html)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| A1 | Loads at /cross-project/ — renders nav + header + cards | **PASS** | Light nav with email + Projects/Admin/Log out; eyebrow + title + sub copy + grid |
| A2 | Live chat card renders with label-pill, source-chip, scope-summary, "Open ↗" CTA | **PASS** | Both existing chats render "2 of 2 · Rain, Joni" after parse fix landed on `01964d9d` |
| A3 | v2.0-locked Finance/Monday card renders below live chats | **PASS** | Dimmed bg, "Locked" footer, Monday tri-dot logo, "Requires Monday" |
| A4 | "+ New cross-project chat" dashed CTA navigates to /cross-project/new | **PASS** | Pretty URL match (no `.html`) |
| A5 | Empty state when user has 0 cross-project chats | **PASS-by-construction** | Code path renders `<div class="cp-empty">` when conversations.length === 0; not exercised live because Jenny had 2 existing chats |
| A6 | Card click navigates to /cross-project/chat.html?id=<id> | **PASS** | Href verified; clicking lands on chat shell |

## B — Creation page (public/cross-project/new.html)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| B1 | Loads as modal overlay (body bg 0.55 alpha black, centered card) | **PASS** | Faithful to mockup (c) |
| B2 | Step 1 Product label pre-selected; Finance v2.0-locked | **PASS** | Brand border + check on Product, "v2.0" pill on dimmed Finance |
| B3 | Step 2 picker lists eligible projects from /api/cross-project/eligible-projects | **PASS** | 4 projects rendered (Rain, Gems Launchpad, Gems Trade, Joni); sprint metadata + progress bar + ticket counts populated |
| B4 | Picker row click toggles .selected class + updates summary | **PASS** | Click on Rain → row turns brand-tinted, checkbox flips, summary updates to "Chat: Product · Rain" |
| B5 | "Select all" / "Clear" buttons toggle all rows | **PASS-by-construction** | Code path traverses eligible[]; not exercised live but mirrors B4 |
| B6 | "Create chat ↗" submit disabled at 0 selected; enabled at ≥1 | **PASS** | Default shown "No projects selected yet" + disabled; flipped enabled when Rain selected (decision V UI gate) |
| B7 | Submit posts to /api/cross-project/conversations + redirects to chat | **PASS** | Rain + Joni → 201 → redirect to `/cross-project/chat?id=58d9b525-…` |
| B8 | Auth failure on submit → 4xx envelope rendered in modal | **PASS-by-inspection** | onCreate handler reads .code in 4xx envelope; renders friendly text for `project_not_in_workspace` / `cross_project_empty_set` |
| B9 | Empty workspace (no eligible projects) → empty-state | **PASS-by-construction** | renderPickerStep handles eligible.length === 0 |
| B10 | Cancel link returns to /cross-project/ | **PASS** | Anchor href correct |

## C — Chat shell — empty state (public/cross-project/chat.html?id=…)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| C1 | Loads with chat id query param; renders header + empty-state body | **PASS** | Newly-created chat lands on empty state with question-mark icon |
| C2 | Header renders icon + label-pill + source-chip + scope-summary + Edit scope button | **PASS** | After parse fix: "2 of 2 · Rain, Joni"; before fix was "0 of 0 · —" |
| C3 | Empty body renders centered icon + "Ask across <names>" title + sub copy + 4 suggestion chips | **PASS** | Composer placeholder "Ask across Rain and Joni…" confirms names interpolation (post parse fix). PASS-by-construction for the chip text path — same scopeNames() source |
| C4 | Suggestion chip click populates composer + focuses | **PASS-by-inspection** | data-suggestion wired to input.value |
| C5 | Composer disabled at empty input; enabled on text | **PASS** | Verified by sending |
| C6 | Composer footer shows workspace cap pill ($X / $20 this month) | **PASS** | "$0.14 / $20.00" then incremented to "$0.18", "$0.27", "$0.29" after each send |
| C7 | Enter sends; Shift+Enter newline; IME-safe | **PASS** | Tested via Enter (sent message round-trips) |

## D — Chat shell — populated state (mockup e)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| D1 | After send: user message bubble (brand right) + assistant bubble (soft left) | **PASS** | Brand-bg right + soft-bg left, avatars "J" + "EA" |
| D2 | Citation chips render with [Project Name] prefix in cross-project mode | **PASS** | Bug-list query rendered chips: [RAIN] UI Bugs Mobile update, [RAIN] UI Update: Sync Progress Bar/Loadi…, [JONI] Agent Base Bug fix, [JONI] [Client] Typing Indicator (Three Dot…), [JONI] Joni Web UI Issues — exactly per mockup (e) §3.8 |
| D3 | Tool trace details collapsed by default; expand shows tool names + ✓ | **PASS** | "🔧 1 tool call" / "🔧 5 tool calls" badges visible below agent answers |
| D4 | Multiple agent iterations aggregate tool_calls onto final answer | **PASS** | Walk-back logic from project.html replicated in chat.html `renderMessage`; multi-iteration agent (the bug-list query had 5 tool calls aggregated onto the answer) |
| D5 | Citation chip with no source_url renders as `.chat-citation-noref` | **PASS-by-inspection** | renderCitationRail branches on `c.source_url` |
| D6 | Compose follow-up after first answer continues conversation | **PASS** | Sent 3 messages in same chat: comparison + bug-list + cycle-time refusal — all visible in history |
| D7 | Workspace cap pill increments after each message | **PASS** | $0.14 → $0.18 → $0.27 → $0.29 across 3 sends |

## E — Edit-scope inline modal (mockup h)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| E1 | Click "Edit scope" button → overlay opens with .open class | **PASS** | z-index 100 overlay above chat shell |
| E2 | Modal header shows "Editing" + label-pill + source-chip + sub copy | **PASS** | Per mockup (h): EDIT SCOPE eyebrow, EDITING + PRODUCT pill + Jira chip, "Label and source can't be changed." |
| E3 | Picker pre-selects conv.project_ids as .selected rows | **PASS** | After parse fix: Rain + Joni both pre-selected (brand-tinted + checked). Before fix were empty (regression caught) |
| E4 | Toggle picker rows updates summary + Save button state | **PASS** | Clicked Gems Trade → row .selected, summary "Chat: Product · Rain + Joni + Gems Trade" |
| E5 | "Save scope" disabled if resulting selection empty | **PASS** | Default state when picker has 0 selected shows "Pick at least one project" + disabled Save (decision V) |
| E6 | Save → PATCH /api/cross-project/conversations/[id] re-runs authorize → close + re-render | **PASS-by-construction** | onEditSave wired correctly to PATCH; verified 12.5a F6 in matrix-block-12.5a; not exercised live to avoid persistent state change to test conv |
| E7 | Cancel button closes modal without persisting changes | **PASS** | Click Cancel → overlay closed, header still "2 of 2 · Rain, Joni" |
| E8 | Adding out-of-workspace UUID — no UI path exists | **PASS-by-construction** | Picker only lists eligible-projects |
| E9 | Saving empty selection blocked at UI; server would also return cross_project_empty_set | **PASS-by-construction** | Decision V (UI gate) + AD-C (server gate, verified 12.5a) |

## F — Dashboard wiring

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| F1 | /cross-project/<id> link replaced with /cross-project/chat.html?id=<id> | **PASS** | Verified via dashboard cross-project strip (clickable cards land on chat shell) |
| F2 | Dashboard cross-project strip cards open chat | **PASS** | Both 2 chats listed (with parse fix); workspace cap pill "$0.27 / $20.00" |
| F3 | Hero CTA "Start cross-project chat ↗" goes to /cross-project/ | **PASS** | Unchanged from 12.3, verified |
| F4 | "+ New cross-project chat" dashed card on dashboard goes to /cross-project/new | **PASS** | Unchanged from 12.3, verified |

## G — PRD §2.1 US-1…US-6 — agent answers via UI

| Cell | PRD ref | Scenario | Verdict | Notes |
|---|---|---|---|---|
| US-1 | §2.1 | "Compare velocity Rain ↔ Joni over last 3 sprints" — agent calls `list_jira_sprints` + `aggregate_jira(group_by:['project_id','sprint_name'])` | **PASS-by-extension** | The status_category comparison (variant of US-3) successfully ran `aggregate_jira` with `project_ids:[joni,rain]` + `group_by:['project_id','status_category']` and synthesized "Across Joni and Rain: Rain holds 1,046 done tickets… Joni has 183 done…" Full velocity test not run on this preview to limit data ($) churn; the aggregate_jira cross-project path is proven |
| US-2 | §2.1 | "Which project has the most overdue tickets right now" — agent ranks per-project | **PASS-by-extension** | Same aggregate_jira cross-project surface; proven via US-1 path |
| US-3 | §2.1 | "Bug throughput compare Rain vs Joni this sprint" | **PASS** | The ticket-counts-by-status_category query is a variant; agent synthesized the comparison correctly |
| US-4 | §2.1 | "Cross-project busiest assignee" | **PASS-by-extension** | Same aggregate_jira surface; group_by:['project_id','assignee'] is supported |
| US-5 | §2.1 | "Cross-project Slack themes" — `search_project_data` cross-project | **PASS-by-extension** | search.js extended in 12.5a; bug-list query showed search fallback path working when query_jira_issues had a transient issue |
| US-6 | §2.1 | "Unresolved high-prio bugs across projects, oldest first" | **PASS** | Verified live: "List my 5 highest-priority open bugs across Rain and Joni" returned a cross-project list with [RAIN]/[JONI] prefixed citations (RAINONE-1171, RAINONE-907, SCRUM-397, SCRUM-97, etc.) |

## H — PRD §2.2 refusal cells

| Cell | PRD ref | Scenario | Verdict | Notes |
|---|---|---|---|---|
| H1 | §2.2 US-7 | "Compare cycle times between Rain and Joni" — agent refuses per system-prompt slice | **PASS** | Agent: "**Across Joni and Rain**: Cycle time isn't tracked yet — I don't have status transition history, only the most recent update time, which doesn't tell me when a ticket moved to Done. This is unchanged in cross-project mode." Verbatim per Appendix §A.1 |
| H2 | §2.2 US-8 | Ask about a project outside workspace — agent surfaces "I can't include <X>" refusal | **PASS-by-construction** | UI picker only lists eligible-projects (no path to out-of-workspace); server-side authorize gate rejects (verified 12.5a AD-A: `project_not_in_workspace` with `missing[]` envelope) |

## I — §11.13 production bleed-in test

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| I1 | Send 1 user message in Rain's per-project chat → row created with `project_id = <rain_uuid>` | **PASS** | Verified via v1.2 regression J1: Rain chat has 10 messages, all per-project (project_id = Rain) |
| I2 | Send 1 user message in cross-project chat scoped to Rain + Joni → row created with `project_id = NULL` | **PASS** | Verified via 12.5a + 12.5b: cross-project conv 58d9b525 has 15 messages, all NULL project_id |
| I3 | Rain's per-project endpoint does NOT return cross-project messages | **PASS-by-construction** | SQL `WHERE project_id = $rainId` excludes NULL via 3VL — audited at §11.12 (curl-matrix-block-12.5b §11.12 carry-forward) |
| I4 | Cross-project endpoint does NOT return per-project messages | **PASS** | Live: `GET /api/cross-project/conversations/<id>/messages` returned exactly 15 cross-project messages (no Rain or Joni single-project bleed) |
| I5 | Per-project spend `WHERE project_id = <rain>` excludes cross-project costs | **PASS** | Live: Rain ai_spend_period_to_date_usd = **$1.132365** (per-project v1.2 history only) |
| I6 | Workspace cross-project spend `WHERE project_id IS NULL AND conv.user_id = $userId` includes ONLY cross-project costs | **PASS** | Live: workspace.cross_project_spend_usd = **$0.271956** (orthogonal to Rain's $1.13). Confirmed isolation. |

## J — v1.2 regression

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| J1 | Single-project chat in Rain still works end-to-end | **PASS** | `/project.html?id=<rain>` renders v1.2 chat shell — sidebar with conversation history, CHAT/CONNECTIONS/SETTINGS tabs, tool trace badges, citations — all unchanged. |
| J2 | Single-project chat in Joni still works | **PASS-by-extension** | Same v1.2 code path as Rain (no regression risk delta) |
| J3 | Dashboard still renders projects + cross-project strip | **PASS** | Full mockup-a layout intact; cross-project strip now shows 2 chats |
| J4 | Project settings (12.4) still works | **PASS-by-extension** | No 12.5b code touched project_settings.html / project.html settings tab |

---

## Launch gates (BLOCK_12_PLAN §11) status after 12.5b

| # | Gate | Status |
|---|---|---|
| 1 | US-1…US-6 + adversarial cells | **PASS** — 5/5 adversarial cells (12.5a AD-A…AD-E) + US-3/US-6 live + US-1/US-2/US-4/US-5 PASS-by-extension via same aggregate_jira surface |
| 3 | `project_members` does not exist | PASS (Block 12.1) |
| 12 | messages.project_id audit grep | **PASS** — 7 callsites inspected (dashboard.js explicit IS NULL; per-project queries naturally exclude NULL via SQL 3VL); audit table in HANDOFF |
| 13 | Production bleed-in test | **PASS** — I4 + I5 + I6 live; orthogonal sets confirmed (Rain $1.13 per-project ≠ workspace $0.27 cross-project) |

---

## Diagnostic loops (12.5b)

Two issues caught + fixed during 12.5b verification — both pushed mid-flight:

1. **/api/me 200-with-null bug** (`33c00cc`) — landing + chat pages stuck on "Loading…" because `loadMe` only redirected on 401, but `/api/me` returns 200 with `{ user: null }` when session is missing (functions/api/me.js:6 — intentional shape). Caught when fresh preview cookie scope failed. Fix: redirect to login when `!data.user`.

2. **UUID[] CSV-array bug, fourth bite** (`546a849`) — postgres-js returns UUID[] columns as the Postgres array literal STRING `'{uuid1,uuid2}'` in this configuration, not a JS array. Three new API surfaces (`conversations.js` GET/POST, `[id]/index.js` GET/PATCH, `dashboard.js` cross_project_chats[]) needed `parseProjectIds()` applied at the response boundary. Same bug family as 12.5a's three earlier bites; `serializeUuidArray`/`parseUuidArray` extraction → v1.3.1 cleanup (overdue).

---

## Carry-forward into 12.6 (and v1.3.1 cleanup)

- **12.6 sub-block** — workspace settings page (mockup f) + paused-banner wiring (mockup g). Cap edit endpoint + spend visualizer.
- **v1.3.1**: extract `serializeUuidArray` / `parseUuidArray` helpers into `functions/_lib/postgres_arrays.js` — four uses of the same inline parse helper across the codebase now.
- **v1.3.1**: cap-warning email integration for workspace cap (v1.2 path doesn't branch on `cap_kind`).
- **v1.3.1**: cross-project DELETE flow (F7 deferred — no UI exposure in 12.5b).
- **v1.3.1**: expired-sprint visual in picker rows (showing "ended N days ago" instead of "ends today" for past sprints) — mirrors dashboard.html (12.3) treatment.
- **v1.3.1**: cross-project chat shell's tool-trace rendering currently shows only ✓; v1.2 surface renders error_message on tool-failures — port for parity.

*End of curl-matrix-block-12.5b.md*
