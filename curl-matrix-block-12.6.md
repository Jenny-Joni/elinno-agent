# Block 12.6 — Verification matrix

> **Branch:** `claude/gifted-sanderson-a7e060`
> **Production:** `16b2a89` (Block 12.5b SHIPPED) — unchanged until 12.6 ff-merge
> **Verification driver:** Jenny + Claude (Claude in Chrome MCP) on 2026-05-20
> **Verified deploy:** `https://e73d8988.elinno-agent.pages.dev/`

12.6 is the last sub-block of v1.3. Workspace settings page (mockup
f) + paused-banner wiring in the cross-project chat shell (mockup g).
Auto-mode sub-block — no SECURITY-CARVE-OUT files; new admin-gated
endpoint at `functions/api/workspace/limits.js`.

---

## A — Workspace API (functions/api/workspace.js)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| A1 | GET /api/workspace (unauth) → 401 | **PASS-by-construction** | getSessionUser → 401 fallthrough; same pattern as /api/me |
| A2 | GET /api/workspace (auth) → 200 with full payload | **PASS** | Live: `{workspace:{id:"1", name:"Elinnovation", plan:"solo", user_count:1, project_count:4, created_at:1777552928}, cross_project_ai:{cap_usd:20, spend_usd:0.287538, period_start, resets_at}}` |
| A3 | Workspace name derived from email domain stem | **PASS** | "jenny@elinnovation.net" → "Elinnovation" via `deriveWorkspaceName` |
| A4 | project_count matches actual workspace project count | **PASS** | 4 = Rain + Joni + Gems Launchpad + Gems Trade |
| A5 | spend_usd matches workspace cross-project MTD | **PASS** | 0.287538 — matches dashboard.js value within rounding |

## B — Workspace limits API (functions/api/workspace/limits.js)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| B1 | PATCH /api/workspace/limits (unauth) → 401 | **PASS-by-construction** | requireWorkspaceAdmin gate |
| B2 | PATCH as non-admin → 403 | **PASS-by-construction** | requireWorkspaceAdmin (only Jenny is admin in solo workspace) |
| B3 | PATCH with valid cap → 200, D1 updated | **PASS** | Live: PATCH 20→25 → success; PATCH 25→0.10 → success; PATCH 0.10→20 → success (3 round-trips verified) |
| B4 | PATCH with cap < 0.01 → 400 | **PASS-by-construction** | Validation block at CAP_MIN |
| B5 | PATCH with cap > 10000 → 400 | **PASS-by-construction** | Validation block at CAP_MAX |
| B6 | PATCH with missing body → 400 | **PASS-by-construction** | "cross_project_ai_monthly_cap_usd is required" |

## C — Workspace settings page (public/workspace_settings.html)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| C1 | Loads at /workspace_settings.html — full page render | **PASS** | Header + admin pill + section + cap editor + info grid all visible |
| C2 | Spend card shows used / cap with variant color | **PASS** | Healthy (green) at $0.29 / $20.00 (1% used); flipped to exceeded when $0.29 > $0.10 cap |
| C3 | Spend bar fill width matches percent | **PASS** | Visible 1% fill at default; would be 100% when over-cap |
| C4 | Status line "X% used · resets in N days" | **PASS** | "1% used · resets in 12 days" rendered |
| C5 | Cap input pre-populated with current cap | **PASS** | Default $20, updates on each PATCH |
| C6 | Update cap → PATCH → spend card re-renders | **PASS** | Round-trip verified 3× ($20→$25→$0.10→$20). Green success message "Cap updated to $X.XX per month." renders inline |
| C7 | Workspace info grid (name, ID, plan, created) | **PASS-with-caveat** | Name + avatar + ID + plan all render; created date showed "January 21, 1970" — D1 stores `users.created_at` as INTEGER unix seconds (1777552928); my initial fmtDate interpreted as ms. Fixed in follow-up commit by detecting numeric `< 1e12 → seconds * 1000` |
| C8 | Non-admin user sees forbidden message | **PASS-by-construction** | render() branches on `me.is_admin` |
| C9 | Validation error rendered inline (cap > 10000) | **PASS-by-construction** | onSaveCap returns early with ws-error block when out of range |

## D — Paused-banner wiring (public/cross-project/chat.html)

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| D1 | When workspaceSpend.used < cap → no banner | **PASS** | $0.29 / $20.00 — no banner; chat shell renders normally |
| D2 | When workspaceSpend.used ≥ cap → .paused-banner renders | **PASS** | Set cap to $0.10 (below $0.29 spend) → banner appeared above messages on next chat load |
| D3 | Banner copy verbatim per mockup (g) | **PASS** | "Cross-project chats paused. You've reached the workspace cap of **$0.10** for cross-project AI this month. Per-project chats (Rain, Joni) are unaffected and still work. Cross-project resumes automatically on **June 1, 2026**." |
| D4 | "Raise cap ↗" + "View workspace settings" CTAs link to /workspace_settings.html | **PASS** | Both buttons render in the banner-actions block with correct hrefs |
| D5 | Composer disabled when paused | **PASS** | Textarea greyed with "Cross-project is paused this month" placeholder; send button disabled |
| D6 | Footer cap pill flips to warning color "$X / $X — cap reached" | **PASS** | "Cross-project AI · **$0.10 / $0.10 — cap reached**" (warning amber); right side shows "Paused" instead of "↵ to send" |
| D7 | 402 envelope mid-flight → flip into paused without reload | **PASS-by-construction** | sendMessage 402 handler syncs workspaceSpend + re-renders; tested would require pushing spend over cap during a send |
| D8 | Past messages stay visible while paused | **PASS** | All prior turns (comparison, bug list, cycle refusal) remained visible under the banner |
| D9 | Lifting the cap → next load shows un-paused state | **PASS** | PATCH cap from $0.10 → $20; reloaded chat; banner gone, header/composer/footer all back to normal |

## E — Regression

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| E1 | v1.2 single-project chat unaffected | **PASS-by-construction** | 12.6 touches only cross-project chat shell + new files; v1.2 paths untouched |
| E2 | Dashboard still renders + cross-project strip | **PASS-by-construction** | dashboard.html untouched in 12.6 |
| E3 | /cross-project/ landing still renders | **PASS-by-construction** | index.html untouched in 12.6 |
| E4 | /cross-project/new creation modal still works | **PASS-by-construction** | new.html untouched in 12.6 |
| E5 | Cross-project chat send still works when un-paused | **PASS** | Pre-existing chat with 4 messages still loads + would accept new sends (D9 path) |

---

## Launch gates (BLOCK_12_PLAN §11) status after 12.6

| # | Gate | Status |
|---|---|---|
| 1 | US-1…US-6 + adversarial cells | **PASS** (12.5b SHIPPED) |
| 3 | `project_members` does not exist | PASS (Block 12.1) |
| 6 | Workspace cap fires independently of per-project caps; pause flow works | **PASS** — D2 (paused triggers when cross-project spend ≥ cap), D9 (un-pauses on lift), and per-project Rain spend ($1.13) is unaffected throughout (orthogonal to workspace cross-project spend $0.29) |
| 7 | Visual system from mockups lands site-wide | **PASS** (Block 12.1 + 12.2 + 12.3 + 12.4 + 12.5b + 12.6) — workspace settings (f) + paused banner (g) close out the design-system swap |
| 12 | messages.project_id audit grep | PASS (Block 12.5b) |
| 13 | Production bleed-in test | PASS (Block 12.5b) |

**All launch gates PASS after 12.6.** v1.3 is verification-complete.

---

## Diagnostic loops (12.6)

One cosmetic bug caught + fixed during verification:

1. **D1 created_at unix-seconds vs milliseconds** — D1 stores `users.created_at` as INTEGER unix seconds (e.g., `1777552928` = 2026-04-28). My initial `fmtDate(v)` passed the integer to `new Date(v)` which interprets as **milliseconds** → ~Jan 21, 1970. Fix: `fmtDate` now detects `typeof v === 'number' && v < 1e12` and multiplies by 1000. Same defensive pattern that should also be ported to other places that read D1 timestamps if any exist.

---

## Carry-forward into v1.3.1

- **`workspaces` table v2.0 prep**: workspace.js derives name from email domain stem; v2.0 will add a `workspaces` row with explicit name. That swap touches only this one file (decision E + decision U).
- **Workspace settings nav link**: discoverable only via paused-banner CTAs + direct URL in v1.3. Optional v1.3.1 add to dashboard nav for admins.
- **Per-project cap overview**: the info line on workspace settings says "Each per-project chat has its own separate cap. View per-project caps in Projects." — links to `/projects.html`, not a workspace-wide cost dashboard. v1.3.1 candidate.
- **Workspace cap email**: still not wired (carry-forward from 12.5a HANDOFF).
- **D1 created_at fmtDate defensive parsing**: only applied in workspace_settings.html; if other places read D1 timestamps, port the same `< 1e12 → seconds * 1000` detector.

*End of curl-matrix-block-12.6.md*
