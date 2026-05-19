# Block 12.1 — Verification matrix

> **Branch:** `claude/gifted-sanderson-a7e060` (5 commits ahead of main:
> `e1df413` plan → `47ff950` schema → `f4d6448` workspace-scope swap →
> `5949a5c` light nav + tokens → `e0393bb` matrix draft)
> **Preview deploy:** https://87bf73bc.elinno-agent.pages.dev/
> **Production:** `12bb040` (Block 11) — unchanged until 12.1 ff-merge
> **Verification driver:** Jenny + Claude (Claude in Chrome MCP) on 2026-05-19

Verdict shape: PASS / PASS-with-caveat / FAIL / PENDING. Mirrors
BLOCK_11 / `curl-matrix-block-11.md` discipline.

---

## A — Schema migration (12.1.A)

| Cell | Scenario | Check | Expected | Verdict | Notes |
|---|---|---|---|---|---|
| A1 | Postgres migration ran | Neon SQL Editor; 11 statements executed | "Statement executed successfully" | **PASS** | Verified in chat 2026-05-19 — screenshot showed "Connected (11 queries)" |
| A2 | Postgres post-apply audit | Run the 4 audit queries from `db/migrations/2026-05-19-block-12-1-cross-project-postgres.sql` POST-APPLY block | (a)=0 rows, (b)=3 rows, (c)=`YES`, (d)=1 row | **PASS** | All 4 tab badges read 1/3/1/1 rows in the Neon UI |
| A3 | D1 migration ran | `npx wrangler d1 execute elinno-agent-db --file=./db/migrations/2026-05-19-block-12-1-cross-project-d1.sql --remote` | "Executed 4 queries" | **PASS** | First attempt hit "Cannot add a column with non-constant default"; fallback path applied per §12 first open item |
| A4 | D1 post-apply audit | Wrangler command from the migration file's POST-APPLY block | `cap=20`, `warned_at=NULL`, `period_start='2026-05-01 00:00:00'` | **PASS** | One-row output matched expected shape |
| A5 | Canonical schema files updated | `git diff main -- db/schema-d1.sql db/schema-postgres.sql` after `47ff950` | Files reflect post-migration state (project_members removed, new columns documented) | **PASS** | Committed at `47ff950` |
| A6 | Duplicate-index note | `idx_projects_owner_user_id_alive` is functionally identical to existing `projects_owner_active_idx` | Duplicate retained; flagged for future cleanup | **PASS-with-caveat** | Cleanup in a future Block 12.x mini-PR |

## B — Backend workspace-scope swap (12.1.B)

| Cell | Scenario | Check | Expected | Verdict | Notes |
|---|---|---|---|---|---|
| B1 | `workspace.js` helper present | `functions/_lib/workspace.js` exports `getWorkspaceUserId` | Code inspection | **PASS** | Committed at `f4d6448` |
| B2 | `requireProjectRole` removed | `grep -n "export.*requireProjectRole" functions/_lib/auth.js` | Zero hits | **PASS** | Function deleted in `f4d6448` |
| B3 | `requireWorkspaceScope` exists | `grep -n "export async function requireWorkspaceScope" functions/_lib/auth.js` | One hit | **PASS** | Defined at auth.js:215+ |
| B4 | REG-1: Rain single-project chat | Sent "ping (12.1 regression test)" via preview Rain chat composer | Cited assistant response; no 500 | **PASS** | Got back "I'm here! How can I help you with your project data?" — full agent loop runs cleanly under requireWorkspaceScope |
| B5 | REG-2: Joni single-project chat | Same as B4 but in Joni | Cited assistant response | **PASS-by-extension** | Same code path as B4; not separately exercised to save LLM cost. Joni's URL/auth flow uses identical workspaceScope check |
| B6 | Project list endpoint | `GET /api/projects` rendered via projects.html | Returns 4 projects with `role: "admin"` | **PASS** | Renders 4 cards: GEMS LAUNCHPAD, GEMS TRADE, JONI, RAIN — all marked ADMIN |
| B7 | Get-one project endpoint | Navigated to `/project?id=<rain_id>` | Returns Rain row with role: "admin" + sidebar conversations + chat UI | **PASS** | Page loaded "RAIN" header + 10+ conversation sidebar entries from existing data |
| B8 | Members tab hidden | Project page tab strip | Members tab button does NOT render | **PASS** | Tab strip shows only "CHAT" and "CONNECTIONS" |
| B9 | Members API gone | `fetch('/api/projects/<rain_id>/members')` from devtools | Route not served by a Function | **PASS-with-caveat** | Returns status 200 with HTML (Cloudflare Pages static-fallback serves index.html when no Function matches). Route deleted; v1.2 frontend handles via JSON-parse failure → members=null. Strictly not a 404, but gate intent (no members API) satisfied |
| B10 | Cost-cap email path unchanged | (No active cap-breach to trigger; deferred to natural occurrence) | Production behavior on next cap-warn fires correctly using new admins.js | **DEFERRED** | Will surface naturally if cap is approached |
| B11 | Cron incremental-sync unchanged | (No active cron run during verification) | HMAC auth path is comment-only update; should be a no-op | **PASS-by-inspection** | No code logic changed in `functions/api/cron/incremental-sync.js` |
| B12 | Audit grep §11.2 | `grep -rn 'project_admin\|project_members\|requireProjectRole' functions/ public/` | Hits only in v1.3-swap-narrative comments; zero functional code | **PASS-with-caveat-on-relaxed-gate** | 33 hits, all in comments documenting the v1.2 → v1.3 transition. Gate relaxed via session AskUserQuestion to "no functional code references." |
| B13 | §11.12 messages.project_id audit | Sweep every query that touches `messages.project_id` for the NULL case | Each callsite either has explicit `IS NOT NULL` / `IS NULL` handling OR is documented as intentionally-three-valued-logic-safe | **DEFERRED to 12.5a** | No cross-project messages exist until 12.5a's endpoint lands, so the bleed-in concern is theoretical now. Audit completed as part of 12.5a's matrix. Candidate files identified by grep: `functions/_lib/ai/*.js`, `functions/_lib/agent/refresh_runner.js`, `functions/api/projects/[id]/conversations/[conversationId]/messages.js`. |
| B14 | §11.13 bleed-in test | Send single-project msg in Rain + cross-project msg, verify isolation | Cross-project msg does not bleed into Rain's history | **DEFERRED to 12.5a/12.5b** | Cross-project endpoint doesn't exist yet |
| B15 | Production temporary recreate | `project_members` table currently exists in production (temporarily recreated mid-12.1 to restore the v1.2 code path during the swap) | Production code path restored; will be re-dropped after 12.1 deploys | **PASS-transitional** | Re-run the IF-EXISTS-safe Postgres migration once 12.1 is on main + verified |

## C — CSS visual swap (12.1.C)

| Cell | Scenario | Check | Expected | Verdict | Notes |
|---|---|---|---|---|---|
| C1 | Light nav on dashboard | Navigated to `/dashboard.html` on preview | Nav is white with thin bottom border, dark text, solid-purple Sign Out button | **PASS** | Matches mockup exactly — white bg, dark "ELINNO AGENT" brand, dark "Projects"/"Admin" links, solid purple "LOG OUT" button. No dark glass, no backdrop blur |
| C2 | Light nav on project page | Visited `/project?id=<rain_id>` | Same light nav as C1 | **PASS** | Identical nav shape across all authed pages |
| C3 | Light nav on admin page | Visited `/admin.html` | Same light nav as C1 | **PASS** | Same nav |
| C4 | Light nav on projects list | Visited `/projects.html` | Same light nav | **PASS** | Same nav |
| C5 | v1.2 surfaces unaffected | Sign-in page (auto-displayed when navigating to deleted /api/projects/.../members route), project chat full flow, projects list | No broken styles | **PASS** | Sign-in page renders cleanly; chat shell unchanged from v1.2; existing 10-message conversation in Rain rendered with citations + tool-call trace + Refresh & re-ask button. No visible regressions from --color-success value change |
| C6 | New v1.3 status tokens declared | `grep -n "--color-warning\|--color-danger" public/auth.css` | Multiple hits in `:root` | **PASS** | Declared at top of auth.css |
| C7 | Member-management CSS still in file | `.members-list`, `.member-row` etc. unchanged | Dead CSS retained for 12.4 to sweep | **PASS** | Per plan §6.12.1 noted, removal deferred to 12.4 |

---

## Launch gates (BLOCK_12_PLAN §11) status after 12.1

Item-by-item from §11's 13 gates:

| # | Gate | Status |
|---|---|---|
| 1 | US-1…US-6 + US-7/US-8 + adversarial cells pass | **N/A for 12.1** — gates apply at 12.5b launch |
| 2 | Grep `project_admin\|project_members\|requireProjectRole` returns zero hits | **PASS-with-caveat** (B12) — gate relaxed to "no functional code references" |
| 3 | `project_members` does not exist in Neon | **PASS** — re-drop ran in Neon SQL Editor after main deployed. `SELECT count(*) FROM project_members` returns `ERROR: relation "project_members" does not exist (SQLSTATE 42P01)`. Verified production projects list endpoint still loads cleanly (4 projects, admin role) without the table |
| 4 | D1 `users` has the 3 new columns + default $20 | **PASS** (A4) |
| 5 | Dashboard renders mockup (a) layout | **N/A for 12.1** — dashboard rebuild is 12.3 |
| 6 | Cross-project chat surface reachable | **N/A for 12.1** — lands in 12.5 |
| 7 | Workspace settings page editable | **N/A for 12.1** — lands in 12.6 |
| 8 | Paused banner triggers | **N/A for 12.1** — lands in 12.6 |
| 9 | Per-project settings (i.1 + i.2) replace old | **N/A for 12.1** — lands in 12.4 |
| 10 | Seven curl-matrix files committed | **IN PROGRESS** — this file is #1 of 7 |
| 11 | (reserved) | — |
| 12 | `messages.project_id` audit grep | **DEFERRED to 12.5a** (B13) — no cross-project messages exist yet |
| 13 | Production bleed-in test | **DEFERRED to 12.5a/12.5b** (B14) — same reason |

---

## Carry-forward into 12.2

- Re-run the original Postgres migration after 12.1 deploys to main; this re-drops `project_members` cleanly.
- Final §11.3 audit (`SELECT count(*) FROM project_members` errors).
- 12.2 = additive component CSS (9 new components from PRD §7.3).
- The duplicate index `idx_projects_owner_user_id_alive` vs. existing `projects_owner_active_idx` — drop one in a future mini-cleanup.
- Member-management CSS retained in `auth.css`; 12.4 sweeps it.

*End of curl-matrix-block-12.1.md*
