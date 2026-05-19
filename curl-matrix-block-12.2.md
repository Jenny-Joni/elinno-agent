# Block 12.2 — Verification matrix

> **Branch:** `claude/gifted-sanderson-a7e060` (1 commit ahead of main:
> `3bba1a0` feat(block-12.2))
> **Preview deploy:** https://098107d0.elinno-agent.pages.dev/
> **Gallery URL:** https://098107d0.elinno-agent.pages.dev/_dev/components.html
> **Production:** `f13ee81` (Block 12.1 SHIPPED) — unchanged until 12.2 ff-merge
> **Verification driver:** Jenny + Claude (Claude in Chrome MCP) on 2026-05-19

Verdict shape: PASS / PASS-with-caveat / FAIL / PENDING. Mirrors
`curl-matrix-block-12.1.md` discipline.

12.2 is purely additive CSS — no existing selectors modified, no behavior
changes, no schema changes. The only verification surface is "does each
component render per its mockup, and do v1.2 production surfaces still
render correctly with the additions in place."

---

## A — Component renders (eyes-on diff vs. ~/Downloads/mockups_v1_3/)

| Cell | Component | Verdict | Notes |
|---|---|---|---|
| A1 | `.project-card.data` (§7.4 split) | **PASS** | Renders with Rain avatar in brand-tint square, 18px padding, thin border — lighter than v1.2 `.project-card.marketing` heavy pattern as designed |
| A2 | `.app-heading` 20/22/24px (§7.4 split) | **PASS** | Three size variants render: "YOUR CROSS-PROJECT CHATS" (default 22px), "WORKSPACE SETTINGS" (.large 24px), "ACTIVE CONNECTIONS" (.small 20px). Uppercase, bold strong text. Coexists with existing 45px `.section-heading` |
| A3 | `.label-pill` (§7.3 #2) | **PASS** | "PRODUCT", "FINANCE", "WORKSPACE ADMIN" all render as brand-tint pills with 10px uppercase letterspaced label. Matches mockup b/c/d/e/h |
| A4 | `.source-chip` + `.muted` (§7.3 #3) | **PASS** | Active "Jira" (blue logo) + "Slack" (multi-color logo). Muted variant "Monday" (red/yellow/green dots, greyed text). Matches mockup b/c |
| A5 | `.scope-summary` (§7.3 #4) | **PASS** | "2 of 2 · Rain, Joni" with folder icon. Folder icon + count in dark + names in muted, per mockup a/b/d/e |
| A6 | `.spend-bar.healthy / .warning / .exceeded` (§7.3 #5) | **PASS** | All 3 variants render correctly: green 1%, amber 80%, magenta 100%. Slim variant (project settings) also renders. Matches mockup f |
| A7 | `.citation-chip-prefix` (§7.3 #6) | **PASS** | "[RAIN]" and "[JONI]" purple brand-tint pills prepend the citation chip. 9px uppercase letterspaced. Matches mockup e |
| A8 | `.tool-trace-badge` (§7.3 #7) | **PASS** | "How I got this · 3 tool calls" with info-circle icon. Muted text, button-as-text appearance. Matches mockup e |
| A9 | `.paused-banner` (§7.3 #8) | **PASS** | Amber-bordered banner: warning-bg subtle bg + visible amber border (new `--color-warning-border` token works as designed), warning-icon in amber square, title + body text, two action buttons (RAISE CAP in solid amber, VIEW WORKSPACE SETTINGS as quiet outline). Matches mockup g |
| A10 | `.cross-project-chat-card.live` (§7.3 #1) | **PASS** | White bg, PRODUCT label + LIVE status pill, Jira source icon + chip, body text, scope summary "2 of 2 · Rain, Joni", footer "2 hrs ago" / "Open ↗" (purple). Matches mockup b left card |
| A11 | `.cross-project-chat-card.locked-v2` (§7.3 #1) | **PASS** | Soft-grey bg with opacity, FINANCE label + V2.0 status pill, Monday source icon (greyed) + muted chip, body text, footer "Ships in v2.0" / "Locked" (both muted). Matches mockup b right card |
| A12 | `.picker-row` + `.selected` (§7.3 #9) | **PASS** | 3 rows render: Rain (selected, brand-tint-strong bg, red urgency, R avatar, Sprint 12 metadata, progress bar, ticket stats), Joni (selected, purple progress bar, 28/12 stats), Gems Trade (unselected, no sprint info, 12 open). Matches mockup c/h. (Joni row uses inline-style override to force brand-purple progress fill — `.spend-bar` variants only cover healthy/warning/exceeded; consider adding a `.brand` variant when 12.5b wires this for real) |
| A13 | `.status-pill.live / .v2` (helper, not in §7.3 list) | **PASS** | "LIVE" (success green pill) and "V2.0" (warning amber pill) render inside cross-project-chat-card heads |

## B — v1.2 production surfaces unaffected

The 12.2 additions are gated by new class names (`.cross-project-chat-card`,
`.label-pill`, etc.) that v1.2 pages don't use. The only existing selectors
touched were the modifier-class split for `.project-card` (adding `.data`
without modifying the base) and the `--color-warning-border` token addition
(net-new token, no existing rule references it).

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| B1 | v1.2 dashboard renders unchanged | **PASS** | https://098107d0.elinno-agent.pages.dev/dashboard.html — light nav, "WELCOME / YOU'RE SIGNED IN" placeholder, email visible in nav (12.1 fix preserved). No regressions |
| B2 | v1.2 projects list renders unchanged | **PASS-by-inspection** | Projects list uses existing `.project-card` / `.project-card-skeleton` rules; not modified by 12.2 |
| B3 | v1.2 project chat renders unchanged | **PASS-by-inspection** | Chat UI rules in `auth.css` unchanged; 12.2 only appended new sections |
| B4 | v1.2 admin page renders unchanged | **PASS-by-inspection** | Admin user-management table unchanged |

## C — Bundle size + load

| Cell | Scenario | Verdict | Notes |
|---|---|---|---|
| C1 | auth.css line count delta | **PASS** | +451 lines (1874 → 2325). Reasonable for 9 components + 2 splits with mobile rules |
| C2 | components.html size | **PASS** | ~330 lines, ~16KB inline HTML + a small `<style>` block for gallery layout. Not user-facing |
| C3 | New tokens | **PASS** | Only `--color-warning-border` added (mirror of `--color-danger-border` pattern; mockup _app.css omitted) |

---

## Launch gates (BLOCK_12_PLAN §11) status after 12.2

| # | Gate | Status |
|---|---|---|
| 1 | US-1…US-6 + adversarial cells | N/A for 12.2 |
| 5 | Dashboard renders mockup (a) | N/A for 12.2 (lands in 12.3 — the components ARE ready though) |
| 6 | Cross-project chat surface | N/A for 12.2 (lands in 12.5) |
| 7 | Workspace settings page | N/A for 12.2 (lands in 12.6) |
| 8 | Paused banner triggers | N/A for 12.2 — but the banner component IS ready |
| 9 | Per-project settings (i.1 + i.2) | N/A for 12.2 (lands in 12.4) |
| 10 | Seven curl-matrix files committed | IN PROGRESS — this file is #2 of 7 |

All 12.2-applicable gates (additive components ready for 12.3-12.6 use)
**PASS**.

---

## Carry-forward into 12.3

- `.spend-bar` doesn't currently have a `.brand` variant for "in-progress
  but not urgent" sprints (the Joni picker-row example uses inline-style
  brand-purple override). When 12.5b wires the picker for real, consider
  adding `.spend-bar.brand` for visual consistency.
- `public/_dev/components.html` should be removed in v1.3.1 cleanup along
  with logo upload follow-up.
- Member-management CSS still in auth.css (~170 lines) — sweep in 12.4.
- Duplicate index `idx_projects_owner_user_id_alive` (12.1 carry-forward) —
  defer to v1.3.1 cleanup.

*End of curl-matrix-block-12.2.md*
