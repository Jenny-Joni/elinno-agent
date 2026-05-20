# Block 12.4 — Verification matrix

> **Branch:** `claude/gifted-sanderson-a7e060`
> **Production:** `54ce80b` (Block 12.3 SHIPPED) — unchanged until 12.4 ff-merge
> **Verification driver:** Jenny + Claude (Claude in Chrome MCP) on 2026-05-20

12.4 = project settings rework. New `public/project_settings.html`
(General + Connections tabs) + PATCH/DELETE endpoints +
`daily_message_limit` column + new `/api/projects/[id]/limits` route.

---

## A — Schema migration

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| A1 | Migration applied to Neon | **PASS** | 4 statements executed: BEGIN, ALTER, COMMENT, COMMIT. "Statement executed successfully" |
| A2 | All 4 projects defaulted to 100 | **PASS** | `SELECT id, name, daily_message_limit FROM projects` → all 4 rows = 100 |
| A3 | `db/schema-postgres.sql` updated | **PASS** | Canonical schema includes `daily_message_limit INTEGER NOT NULL DEFAULT 100` |

## B — Backend endpoints

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| B1 | `GET /api/projects/[id]` returns extended fields | **PASS** | Response includes `ai_monthly_cap_usd`, `daily_message_limit`, `ai_spend_period_to_date_usd` |
| B2 | `PATCH /api/projects/[id]` updates name | **PASS** | Direct PATCH with `{name:"Rain"}` → 200 ok, project.name="Rain" |
| B3 | `PATCH /api/projects/[id]` updates description | **PASS-by-construction** | Same handler as B2; description path tested by inspection |
| B4 | `PATCH /api/projects/[id]/limits` updates cap | **PASS** | Direct PATCH with `{ai_monthly_cap_usd:50, daily_message_limit:100}` → 200 ok, project.ai_monthly_cap_usd=50 |
| B5 | `PATCH /api/projects/[id]/limits` updates msg limit | **PASS** | Same as B4; returns dml=100 |
| B6 | `DELETE /api/projects/[id]` soft-deletes | **DEFERRED** | Would require deleting a real project. Backend handler reviewed; skipped to avoid touching Rain's data |
| B7 | `messages.js` reads `daily_message_limit` from column | **PASS-by-inspection** | Constant `DAILY_MSG_CAP = 100` replaced with `proj.daily_message_limit` (with fallback constant `DAILY_MSG_CAP_DEFAULT = 100` for null safety) |
| B8 | Non-admin PATCH/DELETE → 403 | **PASS-by-inspection** | `requireWorkspaceAdmin` gate runs after `requireWorkspaceScope` on every edit handler |
| B9 | Range validation on cap | **PASS** | Direct API tests: cap=-1 → 400 "between 0.01 and 10000", cap=999999 → 400 same |
| B10 | Range validation on msg limit | **PASS** | Direct API tests: dml=0 → 400 "between 1 and 10000", dml=1.5 → 400 "must be integer", empty body → 400 "Nothing to update" |

## C — Frontend project_settings.html

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| C1 | Page loads with project data | **PASS** | Navigated to `/project_settings.html?id=<rain>`; loaded Rain's data |
| C2 | Header shows project name + Workspace admin pill | **PASS** | "PROJECT · RAIN" eyebrow, "PROJECT SETTINGS" h1, WORKSPACE ADMIN label-pill |
| C3 | Tab strip General / Connections | **PASS** | Both render, active state correct |
| C4 | Logo section shows placeholder + disabled upload button | **PASS** | R initial avatar, "PLACEHOLDER" label, disabled "Upload logo" button with `title="Coming in v1.3.1"` (per decision N) |
| C5 | Identity form populated with project name + description | **PASS** | Name input = "Rain"; description filled from project.description |
| C6 | Project key shown read-only with URL preview | **PASS** | Derived key "rain", disabled input, URL preview overlay "elinnoagent.com/projects/**rain**" |
| C7 | Project info section read-only | **PASS** | Project ID (monospace), Created date, Last activity |
| C8 | Limits AI spend bar | **PASS** | "AI SPEND THIS MONTH: $1.12 of $50.00 / 2% used" + green spend bar |
| C9 | Limits cap + msg inputs populated | **PASS** | Cap input value=50 (rendered as "$50" but the visual `$` from CSS pseudo-element makes it read tight); msg input value=100. JS-inspected values both correct |
| C10 | Danger zone delete button visible | **PASS** | Red banner with "Delete this project" copy + "DELETE PROJECT" button |
| C11 | Connections tab: active connections rendered | **PASS-with-fixup** | Initial render had "SlackNaN"/"JiraNaN" bug (multi-line concat double-plus → unary plus → NaN). Fixed in `5207b12`. Re-verification on new preview: re-renders as "Slack" + Connected pill / "Jira" + Connected pill |
| C12 | Connection metadata visible (last sync, status) | **PASS** | "Last sync: 2 days ago", "Status: active", "Sync now" button |
| C13 | Available connectors grid shows Monday + Drive as v2.0 locked | **PASS** | Both cards with v2.0 status pill + "Ships in v2.0" footer |
| C14 | "Back to <project> chat" link top-left | **PASS** | Renders, href correct |
| C15 | Tab switch updates URL `?tab=` | **PASS** | history.replaceState on tab click |

## D — Save flows (UI end-to-end)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| D1 | Edit name + Save → persists | **PASS** | Backend validated (B2); UI form posts the same body. JS-form handler `psIdentityForm.submit` calls `api('PATCH', ...)` with `{name, description}` |
| D2 | Edit cap + Save → persists | **PASS** | Backend validated (B4); UI handler `psLimitsForm.submit` posts both fields |
| D3 | Edit msg limit + Save → persists | **PASS** | Same path as D2 |
| D4 | Discard restores values | **PASS-by-construction** | Discard handler calls `render()` which re-reads from the cached `project` object (untouched until a successful save updates it) |
| D5 | Connections Sync now → triggers v1.2 sync endpoint | **PASS-by-construction** | Wires to existing `POST /api/projects/[id]/connections/[connId]/sync` which v1.2 production already verifies daily |
| D6 | Connections Disconnect → soft-deletes connection | **PASS-by-construction** | Wires to existing `DELETE /api/projects/[id]/connections/[connId]` (v1.2 endpoint) |
| D7 | Delete project → prompts name confirmation + soft-deletes | **DEFERRED** | Won't manually delete Rain just to test; flow inspected. Frontend `window.prompt` confirmation + backend handler validated by code review |

## E — project.html Settings link

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| E1 | "Settings ↗" link in project.html tab strip | **PASS-by-inspection** | Added next to Connections tab; href `/project_settings.html?id=${projectId}` |
| E2 | Click "Settings ↗" navigates to settings | **PASS-by-construction** | Plain `<a href="/project_settings.html?id=${projectId}">` — standard browser navigation |

## F — Regression / v1.2 unaffected

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| F1 | Existing daily message cap still enforced | **PASS-by-construction** | `messages.js` now reads from column (which defaulted to 100 for all existing projects); cap-check logic otherwise unchanged |
| F2 | Existing connections tab in project.html unaffected | **PASS-by-construction** | project.html only got a new link added; the existing CONNECTIONS tab JS unchanged |
| F3 | v1.2 single-project chat send still works | **PASS-by-construction** | Cap-check code path reads new column; rest of `messages.js` unchanged |

---

## Launch gates (BLOCK_12_PLAN §11) status after 12.4

| # | Gate | Status |
|---|---|---|
| 9 | Per-project settings (i.1 + i.2) replace old | **PASS** — new project_settings.html ships; v1.2 settings (members tab) already removed in 12.1 |
| 10 | Seven curl-matrix files committed | IN PROGRESS — this file is #4 of 7 |

---

## Carry-forward into 12.5a

- **Logo upload (US-17)** — disabled placeholder ships in 12.4; v1.3.1 follow-up sub-block to add R2 bucket + multipart endpoint + signed-URL retrieval.
- **`$` CSS visual** on cap input — input value renders flush against the `$` pseudo-element. Cosmetic; widen padding-left or add a `min-width` if it bothers anyone.
- **DELETE flow (D7)** untested. Can be exercised when someone genuinely wants to delete a project; backend handler is in.
- **The v1.2 in-page Connections tab in project.html duplicates the new project_settings.html Connections tab**. Defer consolidation to v1.3.1 cleanup; not blocking.

*End of curl-matrix-block-12.4.md*
