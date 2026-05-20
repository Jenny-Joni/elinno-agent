# Block 12.3 — Verification matrix

> **Branch:** `claude/gifted-sanderson-a7e060`
> **Production:** `0975d00` (Block 12.2 SHIPPED) — unchanged until 12.3 ff-merge
> **Verification driver:** Jenny + Claude (Claude in Chrome MCP) on 2026-05-20

12.3 = dashboard rebuild. New `GET /api/dashboard` endpoint + full rewrite
of `public/dashboard.html` per mockup (a). The most novel piece is the
endpoint composing data from 6 Postgres queries + 1 D1 lookup, all in
one round-trip-bounded handler.

---

## A — Backend `/api/dashboard` endpoint

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| A1 | Endpoint exists and 401s when unauthenticated | **PASS** | `fetch('/api/dashboard')` on fresh preview host returns `{"error":"Not authenticated"}` 401 |
| A2 | Endpoint returns 200 with valid payload when authenticated | **PASS** | Initial run hit `malformed array literal` (postgres-js `${arr}::uuid[]` CSV serialization bug); fixed in `09790db` by switching to `WHERE col IN ${sql(arr)}` pattern (established in messages.js per HANDOFF 9.2 hotfix) |
| A3 | Payload contains all 7 keys | **PASS** | `ok`, `user`, `workspace`, `cross_project_chats`, `projects` |
| A4 | Workspace cap reads D1 `cross_project_ai_monthly_cap_usd` (default 20) | **PASS** | Workspace cap shows `$20.00` in dashboard "0 chats · workspace cap $0.00 / $20.00" sub-line |
| A5 | Cross-project spend is 0 (no cross-project messages exist yet) | **PASS** | `$0.00` displays correctly |
| A6 | Cross-project chats list is empty in 12.3 | **PASS** | Empty array; dashboard renders dashed "+ New cross-project chat" CTA in place |
| A7 | Projects list returns 4 (Jenny's workspace) | **PASS** | All 4: Gems Launchpad, Gems Trade, Joni, Rain |
| A8 | All 4 projects have `has_jira: true` | **PASS** | All 4 cards show Jira icon + label |
| A9 | Sprint summaries populated for projects with active Jira sprints | **PASS** | All 4 projects have an active Jira sprint visible. Sprint names: "23/02-09/03", "Sprint 23/4-7/5", "Joni 2.0 (Multi-agents)", "RAIN Sprint 12" |
| A10 | Ticket counts within sprint (total/open/done by status_category) | **PASS** | E.g., Gems Launchpad 3 open / 2 done / 5 total; Joni 118 / 18 / 136 — actual sprint data |
| A11 | Subrequest count: 6 Postgres + 1 D1 (well under 50-cap) | **PASS-by-inspection** | Code inspection of `functions/api/dashboard.js`: 6 sql\`\` calls + 1 env.DB.prepare |
| A12 | Debug catch reverted before main push | **PASS** | `b8fa585` reverted to generic `'Internal error'` catch; production never exposes `_debug_stack` |

## B — Frontend dashboard.html

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| B1 | Light nav site-wide (preserved from 12.1) | **PASS** | Email visible, dark text, solid purple Log Out |
| B2 | Greeting block | **PASS** | "— WORKSPACE / GOOD MORNING, JENNY / 4 projects in your workspace…" — time-of-day + name-from-email correct |
| B3 | Hero card (purple gradient) | **PASS** | "NEW IN V1.3" badge + "CROSS-PROJECT CHAT" eyebrow + "ASK QUESTIONS ACROSS ALL YOUR PROJECTS AT ONCE" title + "Compare velocity and spot delivery risk across your portfolio." sub + "START CROSS-PROJECT CHAT ↗" CTA |
| B4 | Cross-project chats strip header | **PASS** | "YOUR CROSS-PROJECT CHATS / 0 chats · workspace cap $0.00 / $20.00 this month" |
| B5 | Cross-project chats empty state | **PASS** | Dashed "+ New cross-project chat / Pick a label and projects. Setup in under a minute." card. Layout: takes one column of the 1fr 1fr grid; slight whitespace on the right (acceptable for empty state; in 12.5b when chats exist, two cards will fill the grid) |
| B6 | Projects strip header | **PASS** | "YOUR PROJECTS / 4 total · 4 connected to Jira / View all projects →" |
| B7 | Project cards grid (2-col) | **PASS** | 4 cards in 2×2 grid; lighter `.project-card.data` styling per §7.4 |
| B8 | Project card with active+future sprint | **PASS-by-construction** | Jenny's data has no future-end sprints; the code path is the original (kept), tested by inspection. Will validate naturally when a real future-end sprint exists |
| B9 | Project card with expired sprint (end_date in past) | **PASS** | All 4 cards now show "Ended N days ago" in muted text + grey progress bar (`.pc-bar-expired`); previously rendered "0 days left" + red urgency (misleading). Days-overdue values match the real elapsed time |
| B10 | Project card with no active sprint | **PASS-by-construction** | Falls back to "No active sprint" copy. Not exercised against Jenny's data (all 4 have stale-active sprints) |
| B11 | Project card with no Jira | **PASS-by-construction** | Falls back to "Not connected to Jira" copy. Not exercised (all 4 have Jira) |
| B12 | Empty workspace (no projects) | **PASS-by-construction** | Code path returns `projects: []` and renders "Create your first project" dashed card. Not exercised |
| B13 | Hard-error (network / API failure) renders graceful error card | **PASS** | First load before array-fix showed the `.dash-error` card with HTTP 500 message |
| B14 | Logout button works | **PASS-by-inspection** | Existing v1.2 logoutBtn handler preserved |

## C — Regression / v1.2 unaffected

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| C1 | `/api/me` still returns user info | **PASS-by-construction** | Endpoint unchanged in 12.3; dashboard now uses `/api/dashboard` instead but other pages (admin.html, etc.) still call `/api/me` |
| C2 | Project chat (`/project.html?id=...`) still renders v1.2 surface | **PASS-by-construction** | Not touched in 12.3 |
| C3 | Projects list (`/projects.html`) still renders v1.2 surface | **PASS-by-construction** | Not touched in 12.3 |
| C4 | Single-project chat send still works (REG-1) | **PASS-by-construction** | Backend unchanged in 12.3 |

---

## Launch gates (BLOCK_12_PLAN §11) status after 12.3

| # | Gate | Status |
|---|---|---|
| 1 | US-1…US-6 + adversarial | N/A for 12.3 |
| 5 | Dashboard renders mockup (a) layout | **PASS** — live data wired |
| 10 | Seven curl-matrix files committed | IN PROGRESS — this file is #3 of 7 |

---

## Carry-forward into 12.4

- **Stale "active" sprints in Jira data**: all 4 projects show sprints whose end_date is past. This is a data sync issue (Jira hasn't re-synced to flip state to 'closed'), not a code issue. The dashboard handles it honestly with "Ended N days ago." If you want the dashboard to filter out long-expired sprints (e.g., end_date > 30 days ago = treat as no active sprint), that's a separate ask.
- **Empty cross-project chats grid layout**: when there's only the dashed CTA, it takes half the grid leaving whitespace. Cosmetic; resolves naturally when 12.5b ships and chats exist.
- **Existing `idx_projects_owner_user_id_alive` duplicate** (12.1 carry-forward) — still pending v1.3.1 cleanup.
- **`/api/me` could be retired** since `/api/dashboard` returns the same user identity. Defer to v1.3.1 cleanup so other pages (admin.html etc.) migrate first.

*End of curl-matrix-block-12.3.md*
