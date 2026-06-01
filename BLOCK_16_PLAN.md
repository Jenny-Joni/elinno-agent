# Block 16 — Sprint View (read-only tab)

## Context

Add a **read-only "Sprint View" tab** to the project page (`public/project.html`)
showing the active Jira sprint as a dashboard: header + date progress, summary
cards, status-category + board-status charts, assignee workload, and a
grouped/filterable issue list. The data already lands in Neon via the Jira
connector; this tab reads it **directly via the existing sprint executors,
bypassing the LLM agent loop** — no new agent calls, no new model spend.

Architecture is already locked in design chat (see "Locked decisions"). This
plan is for **sequencing + verification**, not re-litigating design. The visual
source of truth is the mockup set in `~/Downloads/files/`
(`sprint-view-mockup-v2.html` is the main one; `byassignee/bytype/bynone.html`
= grouping modes, `overdue.html`, `empty.html`, plus `*-mobile.html`).

**Phase 0 confirmed:** on `main` at `ac4e539` (== `origin/main`), tree clean
except modified `HANDOFF.md` + the two earlier untracked `_dev` mockups. Branch
off `main` at this SHA.

## Locked decisions (from brief — do not change without design-chat sign-off)
- **A.** New endpoint `GET /api/projects/:id/sprint` — read-only, project-scoped
  cookie auth. Reuse `get_jira_sprint_summary` + `aggregate_jira` executors
  directly; bypass the agent loop. **Verified:** the executors are plain
  callables `(sql, projectId, input)` with no agent context — but they are *not
  exported* today (only `runAggregateJira` is). Reuse = add named exports.
- **A2. RESOLVED THIS SESSION → DROPPED (option b).** A2 proposed adding the
  thin `jira_sprints` SQL view now. During execute, the trace showed **nothing
  in this block reads `jira_sprints`**: `runListJiraSprints` /
  `runGetJiraSprintSummary` read `entities` directly (per Block 6 **decision J**,
  "one view per primary tool surface" — the `tools.js` L628 comment), and the
  endpoint reads `jira_issues` + those executors. A2 conflicts with the prior,
  deliberate decision J, and was locked in design chat without J in view, so it
  does not override J inside an execute-time fork. **The `jira_sprints` view
  migration is pulled OUT of Block 16 (no step-1 DDL, no prod schema apply).**
  Introducing `jira_sprints` later requires first overturning decision J with a
  stated reason — backlog item, see PROJECT.md. The endpoint loses nothing:
  sprint resolution already works via the executors (`entities`) + the direct
  `jira_issues` read.
- **B.** Summary cards + "% done" use `status_category` (new/indeterminate/done).
  Board-status chart shows raw `status` columns **colored by category**.
- **C.** One active sprint; `?sprint_id=` override. No active sprint → empty
  state (do **not** fall back to a closed sprint). Gate the tab on a live Jira
  connection (`getConnectionState()`). **Default to Sprint View whenever Jira is
  connected** (even with no active sprint → empty state), else Chat — decided on
  connection state alone, no pre-fetch.
- **E.** Freshness "as of" = `MAX(sync_runs.started_at)` for the Jira
  connection, **not** `connections.last_sync_at`. (Note: the Block 9.2 citation
  chip uses `last_sync_at`; this divergence is intentional — confirm against the
  recorded hotfix in HANDOFF during execute.)
- **G.** Progress is a **date-based bar only** (day X of N, % elapsed). No
  burndown, no multi-sprint velocity — data-blocked, out.

### Confirmed this session
- **Issue list:** direct uncapped read of `jira_issues` view (project_id +
  sprint_id scoped, `LIMIT 500` = the sync ceiling). `query_jira_issues` caps at
  50 and would silently truncate a 79-issue sprint, so the list bypasses it;
  COUNTS still come from `get_jira_sprint_summary` + `aggregate_jira`.
- **Point subtitles:** keep the "N pts" subtitle under each board-status column
  (mockup is source of truth); `SUM(story_points)` rides along the same
  aggregate. ("story-point *cards*" stay out of scope.)

### Out of scope this block
Cap-incompleteness banner, story-point summary cards, loading/error skeletons.
Flag during execute if any turns out launch-blocking.

## Pre-Phase-2 confirmations (verify real names/shapes — do not assume)
The executors are confirmed not-exported. Apply the same check to every symbol
the skeleton leans on, **before** writing code:
- `requireWorkspaceScope` — confirm it exists by that name and returns
  `{user} | {error}` as assumed (could be `getWorkspaceScope` / a different
  shape). Adjust the skeleton to the real signature.
- `runGetJiraSprintSummary` / `runListJiraSprints` / `runQueryJiraIssues` —
  confirm the export-add is **purely additive** (no scoping-logic edit).
- **Counts↔list precondition:** confirm `runAggregateJira` reads the **same
  persisted entity set** the `jira_issues` view exposes (both bounded by the
  ≤500 sync ceiling). If they can diverge, **stop and flag** — the whole
  counts-vs-list design assumes one shared ceiling.

### Pre-Phase-2 confirmation results (read-only, completed before any code)
All green:
- `requireWorkspaceScope(request, env, projectId)` exists in
  `functions/_lib/auth.js` (L250); returns `{error}` (401/400/404/500) or
  `{user}`. Matches assumption.
- `runQueryJiraIssues` (tools.js L531), `runListJiraSprints` (L623),
  `runGetJiraSprintSummary` (L688) all present; only `TOOL_DEFINITIONS` +
  `executeTool` exported today → export-add is purely additive.
- `runAggregateJira` (aggregate_jira_compiler.js L468) uses
  `const VIEW = 'jira_issues'` (L77) — same persisted set as the list; `sprint_id`
  is in `ALLOWED_COLUMNS` (L28). Counts↔list precondition holds.

## Files to change
1. **`functions/_lib/ai/tools.js`** — add `export` to `runGetJiraSprintSummary`,
   `runListJiraSprints`, `runQueryJiraIssues`. Carve-out header (file hosts the
   D4b project-scoping gate). Default mode.
2. **`functions/api/projects/[id]/sprint.js`** *(new)* — the endpoint. Carve-out
   header (project-scoping + freshness). Default mode.
3. **`public/auth.css`** — port `sv-*` component styles, `.seg` segmented
   control, sticky `.project-bar`, and the mobile rules from the mockup.
4. **`public/project.html`** — `VALID_TABS` (+`sprint:1`, ~L507), `renderTabBody`
   branch (~L1160), new `renderSprint()`, segmented-control tab strip + sticky
   bar markup + scroll-shadow JS, default-tab logic (~L785, gated on
   `getConnectionState()`), viewport meta zoom-lock.

> **`db/migrations/<date>-jira-sprints-view.sql` — REMOVED.** Originally file #1
> (the `jira_sprints` view). Dropped per the A2 disposition above (decision J
> wins). No DDL, no prod schema apply this block.

## Endpoint: `GET /api/projects/:id/sprint?sprint_id=`
Template: `functions/api/projects/[id]/index.js`. Steps:
1. `requireWorkspaceScope(request, env, params.id)` → `{user}` or `{error}`
   (auth + project existence). Open `postgres(env.HYPERDRIVE.connectionString,
   {max:5, fetch_types:false})`; `sql.end()` in `finally`.
2. **Pick sprint ONCE:** if `?sprint_id` → use it; else
   `runListJiraSprints(sql, projectId, {state:'active'})` → newest active. None
   → `{ ok:true, active:false }` (UI → empty state). No closed fallback.
   **Resolve the sprint_id exactly once here and thread that same value** into
   the summary executor, every aggregate DSL, and the list query — never let any
   downstream call re-resolve "active sprint" independently (prevents
   counts/list drift). `?sprint_id` is **attacker-controlled input on a
   carve-out path**: every consumer must scope by `project_id` **in addition to**
   `sprint_id`, so a valid-but-foreign sprint_id cannot leak another project's
   data (the view/executors already carry `WHERE project_id=$`; confirm and keep).
3. **Header/category/points:** `runGetJiraSprintSummary(sql, projectId,
   {sprint_id})` → `issue_count`, `by_status_category`, total/completed points,
   sprint metadata.
4. **Aggregates** via `runAggregateJira(sql, projectId, dsl)`:
   - issue types: `select:['issue_type','COUNT(*)'], group_by:['issue_type'],
     where:{sprint_id:{eq:X}}` → Total / Tasks / Bugs / Stories (other types
     fold into Total only — flag).
   - board status: `select:['status','status_category','COUNT(*)',
     'SUM(story_points)'], group_by:['status','status_category'],
     where:{sprint_id:{eq:X}}` → columns + per-status pts.
   - workload: `select:['assignee_display_name','status_category','COUNT(*)'],
     group_by:['assignee_display_name','status_category'],
     where:{sprint_id:{eq:X}}` → stacked bars; null assignee = Unassigned.
5. **Issue list (uncapped) — single-source the isolation:** the query is a
   SECOND place project-isolation is enforced, inside a carve-out file (exactly
   where an isolation bug hides). **Preferred:** factor the executor's existing
   `jira_issues` query + its project scoping into a shared helper parameterized
   by `limit`; the endpoint calls it with `500`, the agent path keeps `50` —
   isolation logic stays single-sourced. **If a direct hand-written read is kept
   instead,** it MUST scope by `project_id` AND `sprint_id` together, and item-4
   isolation tests must exercise THIS query specifically (not just the
   `requireWorkspaceScope` gate above it): `SELECT issue_key, issue_type, status,
   status_category, assignee_display_name, title, story_points, labels,
   source_url FROM jira_issues WHERE project_id=$ AND sprint_id=$ ORDER BY
   status_category, status, issue_key LIMIT 500`.
6. **Freshness:** `SELECT MAX(sr.started_at) FROM sync_runs sr JOIN connections
   c ON c.id=sr.connection_id WHERE sr.project_id=$ AND c.source='jira'`.
7. **Date math server-side** (decision G): from `start_date`/`end_date`/`now` →
   `total_days, elapsed_days, pct_elapsed, days_left`, `overdue` (now > end &&
   state active) + `days_overdue`.
8. Respond `{ ok:true, active:true, sprint:{…, progress}, stats, categories,
   board_status[], workload[], issues[], as_of }`.

## UI: `renderSprint(body)` + chrome
- Fetch `/api/projects/:id/sprint` (pass through `?sprint_id`). `active:false`
  → render the `empty.html` markup. Else build the dashboard from
  `sprint-view-mockup-v2.html`, populated from the response.
- **Grouping (Status default / Assignee / Type / None) + Status/Assignee/Type
  filters operate client-side** on the returned `issues[]` — no refetch. Port
  the mockup's vanilla dropdown JS (chip open/close, checkbox toggles). Status &
  Type group cards get a category-colored left edge; Assignee groups neutral.
- **Overdue** (`overdue.html`): days tile, progress bar, extra pill all red;
  label "N days overdue". Map `by_status_category.unknown` (if >0) — surface,
  don't silently drop (flag if it appears in real data).
- Footer: "Synced from Jira · as of " + `fmtRelativeShort(as_of)` (reuse the
  existing client formatter).
- **Tab wiring:** add `sprint:1` to `VALID_TABS`; `renderTabBody` →
  `else if (activeTab==='sprint') renderSprint(body)`; reuse `onTabClick →
  applyState → renderTabBody`. Replace the hidden `.project-tab` strip with the
  mockup's `.seg` segmented control (Sprint View + Chat, `data-tab`) inside a
  sticky `.project-bar`; **Chat segment routes to the existing chat tab — do not
  render chat here.** Segmented control shows only when Jira is connected.
- **Default tab:** in boot (~L785), after `connections` fetched, if no explicit
  `?tab` and `getConnectionState()` ∈ {jira, both} → `activeTab='sprint'`.
- **Sticky bar:** port `nav.scrolled` / `project-bar.scrolled` scroll-shadow JS.

## Mobile (app shell, not per-tab)
- Viewport: `maximum-scale=1, user-scalable=no` (no pinch/double-tap zoom).
- No horizontal scroll: `overflow-x: clip` (not hidden — hidden breaks sticky),
  `max-width:100vw`, `overscroll-behavior:none`.
- Responsive specifics are in the mockup `@media (max-width:640px)`: 2×2 cards,
  stacked 2-line issue cards, wrapping filter chips, rightmost dropdown
  right-aligned.

## Sequencing / commit discipline
Branch `block-16-sprintview-readonly-tab` off `main` @ `ac4e539`. ff-merge only;
per-diff review; **no push to main without explicit per-push approval**. Each
session ends runnable.

**Re-sequenced after A2 was dropped — there is no longer a "[Jenny applies DDL]"
gate; verification is unblocked immediately.**
1. `/sprint` endpoint + `tools.js` exports — **default mode, carve-out header**
   (project-isolation + freshness).
2. UI render (`renderSprint` + `sv-*` CSS) — auto mode.
3. Tab wiring + segmented control + sticky bar + default-tab + viewport — auto
   mode.

## Verification
- **No DDL gate** (A2 dropped) — verification is unblocked immediately after the
  step-1 endpoint commit.
- **Endpoint (curl, with cookie):** assert response shape; issues all carry the
  requested `sprint_id`; `as_of` == `MAX(sync_runs.started_at)` for the Jira
  connection.
- **Counts↔list consistency:** on a multi-sprint test project with
  `issue_count ≤ 500`, assert `SUM(board_status[].count) == issues[].length`
  (the guarantee the uncapped list exists to provide).
- **Isolation (two cases, both required):**
  - a project you don't own → 404/403 (the `requireWorkspaceScope` gate).
  - `?sprint_id=<a sprint that belongs to a DIFFERENT project>` against a project
    you DO own → returns that project's own empty/`active:false` result (or
    404/403), **NEVER** the foreign sprint's issues. This must exercise the
    step-5 list query / shared helper specifically, not just the scope gate.
- **Local app** (project's dev command / `wrangler pages dev`): load a
  Jira-connected project → Sprint View is the default tab → header, date
  progress, 4 cards, category bar, board-status chart (+pts), workload, issue
  list all populate from real data. Toggle grouping (Status/Assignee/Type/None)
  and each filter. Test `?sprint_id=` override. Test empty state (project/sprint
  with no active sprint). Test overdue rendering (force/find an overdue sprint).
- **Mobile:** narrow viewport → 2×2 cards, stacked issue cards, sticky switcher
  pins on scroll, no horizontal scroll, no pinch-zoom.

## Risks / notes
- Freshness intentionally diverges from the citation chip (decision E) — confirm
  against the HANDOFF hotfix during execute.
- `status_category = 'unknown'` bucket: surface, don't drop.
- Assignee grouped by `display_name` (rare same-name collision acceptable v1);
  Unassigned = null.
- Non-Task/Bug/Story issue types (Epic/Sub-task) counted in Total only.
- `tools.js` export change is additive (no scoping-logic change) but lives in a
  carve-out file → default-mode commit + carve-out header.
