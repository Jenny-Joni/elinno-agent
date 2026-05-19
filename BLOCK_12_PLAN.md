# Block 12 Plan — v1.3 cross-project AI mode

> **Status:** Approved 2026-05-19. Block 11 (`12bb040`) is production;
> Block 12 opens v1.3. Cadence: seven ff-merged sub-blocks
> (12.1 → 12.6 with 12.5 split into 12.5a backend + 12.5b frontend),
> each verified in production before the next.

---

## 1. Context

PRD v1.1 shipped the auth + per-project AI assistant. PRD v1.2 (Block
11) shipped `aggregate_jira` and the polish needed to onboard a non-Jenny
user. PRD v1.3 (Block 12) ships **one** capability addition plus the
polish work to make it usable:

- **Cross-project AI mode** — a second chat surface, scoped to a
  user-selected set of projects in the workspace, that lets the agent
  answer comparison / rollup / cross-project retrieval questions
  ("compare velocity between Rain and Joni," "which of my projects
  has the most overdue tickets," "themes across our Slack channels
  this week"). Jira-only in v1.3; Slack search extends cross-project
  via `search_project_data`. Monday is parked for v2.0. Originally
  sketched in PRD v1.1 §11.1, deferred from v1.2 per PRD v1.2 §6
  item 5.
- **Membership-model collapse.** v1.3 drops `project_members` and the
  `project_admin` role concept entirely. All workspace users see all
  projects; workspace-admin (the existing D1 `users.is_admin` flag)
  gates project-edit operations. One-shot DDL migration; no data
  preservation needed (Jenny is the only user; one workspace; no
  cross-team gating in play).
- **Design-system swap.** The mockups (`~/Downloads/_app.css` +
  10 HTML files) are the v1.3 source-of-truth visual system. The
  largest single visual delta is inverting `.app-nav` from
  dark-glass to light-mode, propagating site-wide. Nine new
  components, two existing components re-skinned, member-management
  styles removed.

Everything is additive in code (non-breaking sibling
`project_ids: string[]` parameter on four tools; new routes; new
components) and irreversibly subtractive in schema
(`DROP TABLE project_members`). Schema decisions stay in Claude
chat (this conversation); Cursor implements against the agreed plan.

---

## 2. What Block 12 delivers

By Block 12 SHIPPED, the following hold in production:

1. The six headline questions from PRD §2.1 (US-1 through US-6) return
   correct, cited answers against a workspace with ≥ 2 projects, end
   to end. Citation chips render with `[Project Name]` prefixes; agent
   prose includes project names inline.
2. PRD §2.2 refusals (cross-project cycle time, project-outside-
   workspace) return the locked refusal shapes; the request fails
   closed, not with a partial answer.
3. The five PRD §2.5 / §3.6 adversarial cases all fail closed at
   authorize-or-validate: `project_not_in_workspace`,
   `project_id_forbidden`, `cross_project_empty_set`,
   `project_ids_malformed`, dedup-idempotent. No cross-tenant data
   ever returned.
4. PRD §5 success criterion 5 (single-project regression): every
   v1.2 §2.1 acceptance case still passes byte-equivalent on the
   existing surface. Cross-project mode adds; it does not modify.
5. `project_members` table is dropped post-migration.
   `grep -rn 'project_admin\|project_members' functions/ public/`
   returns zero hits. `requireWorkspaceScope` middleware handles the
   per-project route authorization that was previously
   `requireProjectRole`.
6. Workspace cap fires independently of per-project caps. Hitting it
   pauses cross-project mode and surfaces the §4.1 paused banner
   (mockup g); per-project chats still work.
7. The visual system from the mockups lands across dashboard,
   project settings (General + Connections tabs), cross-project
   surfaces (landing + creation + chat + edit-scope), and workspace
   settings. The light-mode `.app-nav` propagates site-wide.

**Deferred to a follow-up** (PRD §4.2 nice-to-have):

- **Logo upload (US-17).** Initial-letter placeholders ship in v1.3.
  Logo upload lands as a follow-up sub-block (provisionally 12.7 or
  v1.3.1). R2 binding, `projects.logo_r2_key` column, multipart
  upload endpoint, signed-URL retrieval — none of these are in the
  Block 12 critical path. Mockups already render placeholders, so
  visual continuity is fine.
- **"Last used project set" pre-selection** on the creation modal.
  Picker opens empty in v1.3.
- **Tool-call trace viewer extension** to show conversation
  `project_ids` + per-call authorize result. v1.2's trace viewer is
  unchanged; cross-project conversations will render their
  `project_ids` field but the per-call authorize log is best-effort
  (logged via existing telemetry path, viewer wiring deferred).

---

## 3. Pre-Block-12 prerequisites

Two items Jenny must do before sub-block 12.1 starts (these are
outside Claude's permissions):

1. **Confirm Cloudflare Pages compatibility flags.** `nodejs_compat`
   is already set per `PROJECT.md`. Nothing new to add for Block 12.
2. **No R2 bucket needed yet.** Logo upload is deferred (per
   §2). R2 creation moves to the follow-up sub-block, not 12.x.

Nothing else — Block 12 uses the same D1 + Hyperdrive + Anthropic
bindings as v1.2.

---

## 4. Execute mode: mixed AUTO + DEFAULT

Per WORKFLOW.md §"Security carve-outs run in default mode," the
following sub-block steps must run in default mode (Claude prompts
before each commit):

- **12.1 schema migration** (DROP TABLE, multiple ALTER TABLEs).
  DDL is drafted in this chat; Jenny executes it herself against Neon
  via the Neon console or `psql` from her local machine.
  Claude never runs production DDL (CLAUDE.md hard rule).
- **12.5 authorize step** (`authorizeProjectSet`). Project-scoping
  enforcement; written + tested in default mode, never auto.
- **12.5 system-prompt slice.** Edits to `loop.js` system prompt
  for cross-project mode; verified by Jenny before commit.
- **12.5 tool surface extension.** Changes to `tools.js` executor
  entry that govern the single-vs-cross dispatch; default mode.
- **12.5 compiler change.** `aggregate_jira_compiler.js`
  `WHERE project_id = ANY(...)` and position-aware allowlist;
  default mode.

Everything else (CSS additions, new HTML pages, picker UI, dashboard
rebuild, workspace settings page, paused-banner styling) runs in
auto mode under the approved sub-block change-list. WORKFLOW iteration
cap (10 tool calls without a successful commit or new passing check)
and one-fix rule still apply.

---

## 5. Locked design decisions

These mirror BLOCK_11_PLAN's A–P pattern. Each is the answer to a
choice considered during planning; alternatives noted only when
they meaningfully shaped the choice.

| ID | Decision | Locked choice | Reason |
|---|---|---|---|
| A | v1.3 scope | One capability (cross-project AI mode) + one simplification (membership collapse) + one design swap (light-mode app system). Jira-only. | PRD §1. Slack search extends via `search_project_data`; Monday parked for v2.0. |
| B | Tool surface extension | 4 of 5 tools learn optional `project_ids: string[]`: `search_project_data`, `query_jira_issues`, `list_jira_sprints`, `aggregate_jira`. `get_jira_sprint_summary` does **not**. | PRD §3.4 + §3.5. `sprint_id` collisions across projects make cross-project sprint-summary a footgun. |
| C | Comparison framing | Single SQL query with `group_by: ['project_id', ...]`, not per-project fan-out. | PRD §3.4 + §3.7. Fan-out hits iteration ceiling and breaks "one Hyperdrive query per call." |
| D | Project-set selection UX | Ad-hoc per-chat picker. Named persistent sets deferred to v1.4+. | PRD §3.7 + §6 item 2. No evidence of fatigue yet. |
| E | Workspace identifier | Use `projects.owner_user_id` as the workspace handle in v1.3. No `workspace_id` column added. | Jenny's confirmation (this session). PRD §6 cut #12: "one-user-workspace model … cap moves to a workspace row when teams or organizations land." Solo model = `user.id` is the workspace key. |
| F | Cross-project message storage | `messages.project_id` becomes NULLABLE; cross-project messages have `project_id = NULL` and rely on `conversation.project_ids` for scope. | Jenny's confirmation (this session). Single messages ledger; simpler trace viewer, simpler citation persistence; FK constraint stays valid when value is present. **Verification gate** — relaxing NOT NULL means every existing `WHERE m.project_id = $1` query must be re-audited; launch gate items §11.12 (grep audit) + §11.13 (production bleed-in test) cover this. |
| G | Cost cap | Workspace-level cap on D1 `users` row, default `$20`. New columns: `cross_project_ai_monthly_cap_usd`, `cross_project_ai_cap_warned_at`, `cross_project_ai_spend_period_start`. Cross-project chats charge against this cap exclusively; per-project caps unaffected. | PRD §3.7 + §3.3 table + §4.1. Pro-rata misattributes; strictest-wins overstates; hybrid double-counts. |
| H | Citation disambiguation | Always-on `[Project Name]` chip prefix on every citation in cross-project mode; in-prose project-name rule enforced via system prompt. **Server-rendered prefix**: `messages.citations` JSONB includes per-citation `project_id` + `project_name` in cross-project mode. Single-project chips unchanged. | PRD §3.7 + §3.8. Hover-only fails accessibility; grouped headers add a component without fixing prose ambiguity. |
| I | Membership-model collapse | DROP `project_members` table + `project_members_user_active_idx`. Remove `project_admin` role concept everywhere. Workspace admin (D1 `users.is_admin`) gates project edits. `requireProjectRole` middleware replaced by `requireWorkspaceScope`. | PRD §3.6 + §4.1. Per-project membership added a layer with no current use case; workspace boundary stays as the security floor. |
| J | `project_id` allowlist in DSL | Position-aware. Allowed in `select` and `group_by`; forbidden in `where` (existing `project_id_forbidden` error continues to fire). | PRD §3.4.1. Same shape as `labels`/`labels[]` in v1.2. |
| K | Authorize step at executor entry | `authorizeProjectSet(sql, userId, projectIds)` runs before the compiler on every cross-project tool invocation. UUID-validate → dedupe → workspace-scope lookup → structured envelope on failure. Returned `projectIds` is what's passed to the compiler. LLM-submitted set never trusted past this gate. | PRD §3.6.1. Load-bearing security property; mirrors v1.2's project_id server-injection. |
| L | Single-project mode preserved | When `project_ids` is omitted, executor takes the existing v1.2 single-project path verbatim. No authorize step runs (HTTP route layer already enforced workspace scope). v1.2 byte-equivalent regression check is a launch gate. | PRD §3.6.3 + §5 criterion 5. |
| M | Iteration cap | Unchanged at 6. Cross-project comparison resolves in 2–3 calls via single SQL grouping. | PRD §3.7 (US-14). |
| N | Logo upload | **Deferred to follow-up sub-block** (provisionally 12.7 / v1.3.1). Initial-letter placeholders ship in 12.x. | Jenny's confirmation (this session). PRD §4.2 lists it as nice-to-have, not launch-blocking. Removes R2 + multipart-validation work from the critical path. |
| O | Sub-block cadence | **Seven** ff-merged sub-blocks: 12.1, 12.2, 12.3, 12.4, **12.5a (backend cross-project capability)**, **12.5b (frontend cross-project surface)**, 12.6. Each verified in production before the next. Matches PRD §7.7 sequence; 12.5 is split because its original bundle had ~2-3× the rollback surface and ~half the total verification cells. Splitting lets the security-sensitive backend (authorize step + tool surface + compiler + system-prompt slice) ship and be verified via direct executor calls *before* any UI exists, then the frontend rides on a proven backend. | Jenny's confirmation (this session) + her plan-review feedback. Front-loads visible wins; each sub-block is its own approve-push-to-main per WORKFLOW. |
| P | CSS approach | Merge tokens + new components from mockup `_app.css` into existing `public/auth.css`. Token-rename mapping: `--brand` → `--color-brand`, `--bg` → `--color-bg-light`, `--bg-soft` → `--color-bg-soft`, `--border` → `--color-border`, `--text` → `--color-text-dark`, `--text-2` → `--color-text-body`, `--text-3` → `--color-text-muted`, `--success` / `--warning` / `--danger` + `-bg` / `-border` variants added. No new CSS file; `auth.css` remains the app's design system. `public/styles.css` (landing) unchanged. | PRD §7.6 + §7.7. Existing token names stay; new tokens are additive. |
| Q | Mode immutability | A conversation is single-project or cross-project at creation. No mid-stream switch. `conversations.project_id` and `conversations.project_ids` are mutually exclusive (NOT NULL XOR), enforced at app layer (not DB CHECK, matching the existing soft-delete pattern). | PRD §3.9. |
| R | Subrequest budget | Two Hyperdrive queries per cross-project tool call (one authorize, one tool). Workers 50-subrequest cap not in play. | PRD §3.6.6. |
| S | Verification | Curl-matrix per sub-block, written before merge. Files: `curl-matrix-block-12.1.md`, `12.2.md`, `12.3.md`, `12.4.md`, `12.5a.md`, `12.5b.md`, `12.6.md` alongside `curl-matrix-block-11.md` in repo root. Same verdict shape (PASS / PASS-with-caveat / FAIL / PENDING). | WORKFLOW + Block 11 precedent. |
| T | System prompt slice | Cross-project system prompt slice text is locked verbatim in **Appendix §A.1** of this plan, including template-variable substitution points ({{PROJECT_LIST}}, {{PROJECT_NAMES_PROSE}}, {{MISSING}}). Loaded as an additional system message when `conversation.project_ids` is non-null; appended to the base v1.2 system prompt rather than replacing it. Subject to micro-edits during 12.5a execute, but the structure (mode declaration → tool guidance → not-supported additions → citation contract) is fixed. | Jenny's plan-review feedback. Same precedent as Block 11 locking refusal envelopes verbatim — prose that controls agent behavior is too load-bearing to draft from PRD memory at execute time. |
| U | Workspace handle helper | A single `functions/_lib/workspace.js` helper exposing `getWorkspaceUserId(request, env)` is the *only* sanctioned way to derive the workspace identifier from a session. Every callsite (authorize step, `requireWorkspaceScope`, cap-charging, route handlers) imports from there instead of duplicating `getSessionUserId` + `.id`. When v2.0 introduces real workspaces, this is the **one file** that changes; everything else continues to work. | Jenny's plan-review feedback. Single point of grep for the "workspace = user.id" assumption. |
| V | Empty-set UX gate | The cross-project creation modal's "Create chat" button is disabled until ≥ 1 project is selected; the edit-scope modal's "Save scope" button is disabled if the resulting selection would be empty. This is the UI-layer guard; `cross_project_empty_set` (decision K) remains the server-side second line of defense. | Jenny's plan-review feedback. Server-side adversarial cell AD-C still verifies the security floor, but UI prevents the case from arising in the first place. |

---

## 6. Sub-block ordering

Mirrors PRD §7.7 recommended sequence. Each sub-block is one
ff-merged commit (or short commit chain) to main, with its own
verification matrix and per-push approval per WORKFLOW.

### 12.1 — Foundation (schema + middleware + nav swap + tokens)

The smallest commit with the biggest blast radius. Lands the
non-negotiable substrate everything else builds on.

**Schema migrations** (drafted here, executed by Jenny):

```sql
-- Postgres (Neon, via psql or Neon console)

-- (a) Collapse membership
DROP INDEX IF EXISTS project_members_user_active_idx;
DROP TABLE IF EXISTS project_members;

-- (b) Cross-project conversation columns + relax single-project
ALTER TABLE conversations
  ADD COLUMN project_ids UUID[] NULL;
ALTER TABLE conversations
  ADD COLUMN label TEXT NULL;            -- 'product' for v1.3 cross-project chats; NULL for single-project
ALTER TABLE conversations
  ALTER COLUMN project_id DROP NOT NULL;

-- (c) Cross-project messages
ALTER TABLE messages
  ALTER COLUMN project_id DROP NOT NULL;

-- (d) Authorize-step hot-path index (idempotent)
CREATE INDEX IF NOT EXISTS idx_projects_owner_user_id_alive
  ON projects(owner_user_id)
  WHERE deleted_at IS NULL;
```

```sql
-- D1 (auth edge DB, via wrangler d1 execute — Jenny runs)

ALTER TABLE users
  ADD COLUMN cross_project_ai_monthly_cap_usd REAL NOT NULL DEFAULT 20;
ALTER TABLE users
  ADD COLUMN cross_project_ai_cap_warned_at TEXT NULL;
ALTER TABLE users
  ADD COLUMN cross_project_ai_spend_period_start TEXT
    NOT NULL DEFAULT (date('now', 'start of month'));
```

> **First-attempt note.** The D1 `DEFAULT (date('now', 'start of month'))` expression is the preferred shape (SQLite's `strftime`/`date` modifiers are usually accepted in DEFAULT clauses). If Cloudflare's D1 build rejects it during `wrangler d1 execute`, fall back per §12's first open item: split into three statements — `ADD COLUMN cross_project_ai_spend_period_start TEXT NULL;` → `UPDATE users SET cross_project_ai_spend_period_start = date('now', 'start of month') WHERE cross_project_ai_spend_period_start IS NULL;` → `... ALTER COLUMN ... SET NOT NULL;` (or, if D1's SQLite doesn't support `SET NOT NULL`, leave the column NULLABLE and enforce non-null at the app layer). Either path produces the same end state; the fallback is just one extra step.

`db/schema-postgres.sql` and `db/schema-d1.sql` are updated in the
same commit to reflect the new shape (canonical schema files stay
truthful).

**Backend changes:**

- `functions/_lib/workspace.js` (new) — sole entry point for the workspace identifier in v1.3. Exports `getWorkspaceUserId(request, env)` which resolves the session and returns the workspace handle (the session user's id, in the solo-workspace model per decision E). Every callsite for "workspace = user.id" goes through this file; **no inline `getSessionUserId().id` substitutions anywhere else**. This is the single grep point for the v2.0 multi-user-workspace migration (decision U).
- `functions/_lib/auth.js` — replace `requireProjectRole(request, env, projectId, requiredRole)` with `requireWorkspaceScope(request, env, projectId)`. `requireWorkspaceScope` reads the workspace handle via `getWorkspaceUserId` and asserts `projects.owner_user_id = $handle` (workspace scope check). Keep existing `requireWorkspaceAdmin(request, env)` (already in v1.2). Remove the `project_admin` role hierarchy code. Update every existing route that called `requireProjectRole` (grep for callsites; expected files: `functions/api/projects/[id]/**/*.js` chat/conversation endpoints, connection endpoints, project settings endpoints).
- Code grep audit: `grep -rn 'project_admin\|project_members\|requireProjectRole' functions/ public/` returns zero hits at end of 12.1.

**Frontend changes:**

- `public/auth.css` — token additions (per decision P), light-mode `.app-nav` rule (white bg, `border-bottom: 1px solid var(--color-border)`, no `backdrop-filter`, text colors flip to `var(--color-text-dark)` / `var(--color-text-body)`, `.btn-nav` becomes solid brand-purple). No HTML changes — all authed pages share the same inline `<nav class="app-nav">` markup, so styling propagates site-wide.
- Member-management styles removed from auth.css if any are keyed to `project_members` rendering (per PRD §7.5).

**Verification (12.1):**

- D1 + Postgres schemas match `db/schema-*.sql` after migration.
- `curl https://elinnoagent.com/api/projects/<id>` returns 200 to Jenny (workspace-scope check passes).
- Visiting any authed page (dashboard, project, admin) renders the light nav without regression.
- v1.2 single-project chat in Rain or Joni returns correct cited answer.
- `curl-matrix-block-12.1.md` covers: workspace-scope auth pass/fail, membership-table-dropped audit, nav visual sanity, single-project regression.

### 12.2 — Additive components

Purely CSS additions to `public/auth.css`. No HTML, no behavior
changes. The nine components from PRD §7.3:

1. `.cross-project-chat-card` — labeled chat card from mockup (b). Variants: `.live`, `.locked-v2`.
2. `.label-pill` — small uppercase brand-tint pill for the "Product" / "Finance" function label.
3. `.source-chip` — inline source logo + name (Jira, Slack, Monday) for chat headers, card source rows, creation modal step 1.
4. `.scope-summary` — the `2 of 2 · Rain, Joni` pattern with a folder icon.
5. `.spend-bar` — workspace cap visualizer from mockup (f). Variants: `.healthy` / `.warning` / `.exceeded`.
6. `.citation-chip-prefix` — small purple pill inside citation chips, prepending `[Project Name]`. Only renders when a citation has a `project_id` set (server-driven; absent in single-project chats).
7. `.tool-trace-badge` — "How I got this · N tool calls" affordance from mockup (e).
8. `.paused-banner` — 2px amber-bordered banner from mockup (g), with Raise-cap CTA.
9. `.picker-row` — Variant 1 project picker row from mockups (c) and (h). Stacked sprint metadata, progress bar, right-aligned ticket stats. Reused across creation and edit-scope modals.

Two existing components split per PRD §7.4:

- `.project-card` → `.project-card.marketing` (existing heavy pattern) and `.project-card.data` (new lighter pattern). Selector base unchanged; modifier classes carry the weight.
- `.section-heading` (45px marketing scale) coexists with new `.app-heading` (20–24px screen-level for authed pages).

**Verification (12.2):**

- Static visual smoke test: a temporary scratch page renders each of the 9 components against the mockup screenshot. Compared by Jenny eyes-on.
- v1.2 surfaces unchanged (no existing CSS rules modified beyond the `.app-nav` swap from 12.1 and the `.project-card` / `.section-heading` modifier-class addition).
- `curl-matrix-block-12.2.md`: visual diffs vs. mockup for each of the 9 components.

### 12.3 — Dashboard rebuild

Replace `public/dashboard.html` (placeholder today) with mockup
(a) wired to live data.

**Routes / data needed:**

- `GET /api/dashboard` (new) — returns workspace summary: greeting name, list of user's cross-project chats (id, label, source, project_ids, last_message_at), workspace cross-project spend MTD + cap, list of projects (id, name, owner_user_id, current sprint summary per project — name, days_left, open/done/total ticket counts, progress %, start/end dates).
- Sprint summary inside `/api/dashboard` reuses the existing `getActiveSprintForProject` helper (or equivalent — to be located during execute; grep `current sprint` / `active sprint` in `functions/_lib/jira`).

**Frontend wiring:**

- New script in `public/dashboard.html` calls `/api/dashboard`, renders sections in order: header → hero (cross-project CTA, mockup-a row 1) → cross-project chats strip (mockup-a row 2; opens existing chat or `/cross-project/` landing for new) → Product (Jira) projects strip (mockup-a row 3, lighter `.project-card.data` style).
- Empty-state: when no cross-project chats exist yet, the strip shows just the "New cross-project chat" dashed-border card.
- Workspace cap pill (`$0.06 / $20 this month`) read from `/api/dashboard` response.

**Verification (12.3):**

- Dashboard renders correctly with Rain + Joni in Jenny's workspace.
- Clicking the hero CTA goes to `/cross-project/` (stub OK — 12.5 implements).
- Clicking a project card opens that project's existing chat (v1.2 surface).
- Clicking a cross-project chat card opens it (stub OK — 12.5 implements).
- `curl-matrix-block-12.3.md`: 5+ cells covering greeting, hero, cross-project strip, project strip, empty-state fallback.

### 12.4 — Project settings rework

Rework the settings section of `public/project.html` (or split out to
`public/project_settings.html` if the existing page is monolithic —
to be confirmed during execute by reading `public/project.html`'s
structure) into the two-tab layout from mockups (i.1) and (i.2).

**Tabs:**

- **General** (mockup i.1): Logo section — initial-letter avatar (mockup i.1's "Placeholder" state) + a **disabled** "Upload logo" button with tooltip "Coming in v1.3.1" (per decision N, upload UI is deferred to a follow-up sub-block; this differs from the mockup's active-button rendering — the mockup is forward-looking and the production button is the disabled variant). Identity (name editor, key read-only, description), Project info (project ID, created-by, last-activity, all read-only), **Limits** section (per-project AI spend bar, monthly AI cap editor, daily message limit editor — wires existing v1.2 `ai_monthly_cap_usd` + `daily_message_limit` mechanisms to admin-facing controls; first time these are exposed), Danger zone (delete project).
- **Connections** (mockup i.2): Active connections list (Slack + Jira with status, sync info, sync-now button, disconnect button — all v1.2 endpoints, just re-skinned), Available connectors grid (Monday + Drive locked v2.0 cards).

**Routes:**

- `PATCH /api/projects/[id]` — extend to accept `name`, `description`. Existing project rename endpoint reused; workspace-admin gated.
- `PATCH /api/projects/[id]/limits` (new) — accepts `{ ai_monthly_cap_usd, daily_message_limit }`. Workspace-admin gated.
- Members tab removed entirely (per PRD §7.2 / §7.5).
- Project-delete confirmation — uses existing soft-delete endpoint; styling re-skinned.

**Verification (12.4):**

- Rain settings open at `/projects/rain/settings` (or wherever the route lives) and render mockup i.1 General.
- Switching to Connections tab renders mockup i.2.
- Editing Project name + saving persists to Postgres and re-renders.
- Editing AI cap + saving persists.
- Editing daily message limit + saving persists.
- Disconnect Slack from Connections tab works (v1.2 endpoint; just verifying re-skin didn't break it).
- `curl-matrix-block-12.4.md`: ~10 cells covering tab switch, name save, key read-only, description save, limits editor (cap + message-limit), connection list rendering, disconnect, soft-delete flow.

### 12.5a — Cross-project backend (the security-sensitive linchpin)

**No UI in this sub-block.** Lands the entire cross-project capability
at the API + agent-loop layer, verified via direct executor calls and
curl. Splitting from 12.5b means the security model can be confirmed
working *before* any user-facing surface exists.

**Schema:** none — all schema landed in 12.1.

**Backend:**

- `functions/_lib/ai/authorize.js` (new) — `authorizeProjectSet(sql, userId, projectIds)` per PRD §3.6.1 verbatim. UUID-validate → dedupe → workspace-scope lookup against `projects WHERE owner_user_id = $1 AND id = ANY($2) AND deleted_at IS NULL` (uses `getWorkspaceUserId` from decision U for the `userId` resolution at the call site). Returns `{ ok: true, projectIds: deduped }` on success or `{ ok: false, code: '...', missing?: [...] }` on failure. **Three new failure codes** from authorize itself: `project_ids_malformed`, `cross_project_empty_set`, `project_not_in_workspace` (with `missing` field). The fourth adversarial case — `project_id_forbidden` — continues to fire from the existing v1.2 `aggregate_jira` compiler when the LLM puts `project_id` in `where`; authorize doesn't see it. The fifth (`dedup-idempotent`) is a *behavioral property* of authorize, not a separate error code: duplicate inputs collapse to the unique set and succeed. Five §11 adversarial cells, three codes plus one inherited code plus one behavioral verification. Security model net: zero loss vs. v1.2.
- `functions/_lib/ai/tools.js` — extend the 4 tool definitions (decision B) to add optional `project_ids: string[]` to their JSON schemas. At `executeTool()` entry, dispatch single-project vs cross-project path on parameter presence. Cross-project path calls `authorizeProjectSet` before the compiler / helper; on failure, returns the envelope to the agent loop (same shape as v1.2's validation envelope). Persisted tool-call payload now records both the LLM-submitted `project_ids` and the post-authorize `projectIds`.
- `functions/_lib/ai/aggregate_jira_compiler.js`:
  - `compile()` accepts a `projectIds: string[] | null` argument. When non-null, `WHERE project_id = $1` becomes `WHERE project_id = ANY($1::uuid[])` (postgres-js array param). When null, single-project path unchanged.
  - `ALLOWED_COLUMNS` grows a position-aware entry for `project_id`: allowed in `select` and `group_by`; existing `project_id_forbidden` error continues to fire for `where`. Mirror the `labels` / `labels[]` shape — one allowlist entry; one position-check helper.
- `functions/_lib/ai/search.js` — `searchHybrid()` accepts an optional `projectIds: string[]`; passes through to both keyword and vector queries. Single-project path unchanged (project_id stays a scalar).
- `functions/_lib/ai/loop.js` — add a cross-project system-prompt slice loaded when `conversation.project_ids` is non-null. **The exact slice text is locked in Appendix §A.1** (decision T). Slice references the resolved project names (loaded from `projects` once per turn and substituted via the {{...}} template variables in §A.1). Single-project prompt unchanged; the slice is appended to the v1.2 base system prompt, not replacing it.
- `functions/api/cross-project/conversations.js` (new) — POST creates a cross-project conversation: requires `label` (always `"product"` in v1.3 — Finance/Monday is v2.0-locked), `project_ids: string[]`. Calls `authorizeProjectSet` upfront; on failure returns the envelope as a 4xx response. Inserts row with `project_id: null`, `project_ids: <authorized>`, `label: 'product'` (the `label` column landed in 12.1 per the updated schema migration). GET lists the workspace user's cross-project conversations.
- `functions/api/cross-project/conversations/[id].js` (new) — PATCH for edit-scope (updates `project_ids` after re-running `authorizeProjectSet`). DELETE for soft-delete (rare; included for parity with per-project conversations).
- `functions/api/cross-project/conversations/[id]/messages.js` (new) — POST sends a message. Loads conversation, validates the workspace user owns it, calls `runAgent()` with the cross-project system prompt slice. Charges against D1 `users.cross_project_ai_monthly_cap_usd`. Cap-exceeded returns a structured `{ paused: true, ... }` envelope (used by 12.6's banner wiring); agent doesn't run.
- `functions/api/cross-project/eligible-projects.js` (new) — GET returns the workspace user's projects that have an active Jira connection (`connections.source = 'jira' AND status = 'active'`). Used by 12.5b's picker.
- Cap-charging helper extension in `functions/_lib/ai/cost.js` (or wherever the v1.2 per-project mechanism lives — to be located in execute) — adds `getWorkspaceCrossProjectAiSpend(env, userId)` + `chargeWorkspaceCrossProjectAi(env, userId, costUsd)` siblings. Hitting cap sets D1 `users.cross_project_ai_cap_warned_at` to `datetime('now')`. Email integration: confirmed during 12.5a execute by reading the v1.2 cap-warning email path; if the existing template accepts a workspace-variant slot, reuse; otherwise email wiring lands as a follow-up fixup (not a launch blocker).

**Verification (12.5a — backend only, curl + executor):**

| Cell | What | Source |
|---|---|---|
| AD-A | LLM-equivalent payload submits out-of-workspace `project_ids` → `project_not_in_workspace` envelope | PRD §2.5 US-15(a) |
| AD-B | LLM-equivalent payload submits `project_id` in `where` → existing `project_id_forbidden` | PRD §2.5 US-15(b) |
| AD-C | LLM-equivalent payload submits empty `project_ids: []` → `cross_project_empty_set` | PRD §2.5 US-15(c) |
| AD-D | LLM-equivalent payload submits malformed UUIDs → `project_ids_malformed` | PRD §2.5 US-15(d) |
| AD-E | LLM-equivalent payload submits duplicates → dedup-idempotent | PRD §2.5 US-15(e) |
| AGG-CROSS | `POST /api/cross-project/conversations/[id]/messages` with "compare velocity Rain ↔ Joni last 3 sprints" returns 6 rows via `group_by: ['project_id', 'sprint_name']`, agent synthesizes correct comparison | PRD §2.1 US-1 (agent path) |
| SEARCH-CROSS | `search_project_data` with `project_ids: [Rain, Joni]` returns hybrid results from both projects | PRD §2.1 US-5 (agent path) |
| AUTHZ-DEDUPE | Duplicate `project_ids` collapses to unique set before SQL | PRD §3.6.1 |
| SUBREQ | Cross-project tool call uses exactly two Hyperdrive round trips (authorize + tool) — verified via `wrangler tail` | PRD §3.6.6 |
| REG-BACKEND | v1.2 single-project chat in Rain via `POST /api/projects/[id]/conversations/[cid]/messages` still passes byte-equivalent | PRD §5 criterion 5 |
| PROMPT-SLICE | Cross-project system prompt slice loads only when `conversation.project_ids` is non-null; inspected via tool-call trace logging | PRD §3.8 + decision T |
| CAP-CROSS | Sending a message charges D1 `users.cross_project_ai_monthly_cap_usd` only; per-project caps unchanged | PRD §3.7 (US-12) + decision G |
| MODE-IMMUT | Conversation row's `project_id` and `project_ids` are mutually exclusive on every read path | PRD §3.9 + decision Q |

The five adversarial cells run with crafted curl payloads to
`/api/cross-project/conversations/[id]/messages` (and, where the
agent loop won't emit the malformed shape naturally, direct calls
into the executor entry). Same approach Block 11 used for D1/D4
adversarial cells.

### 12.5b — Cross-project frontend surface

**UI only.** Rides on the proven 12.5a backend.

**Frontend:**

- `public/cross-project/index.html` (new) — landing page (mockup b). Lists the workspace user's cross-project chats (one card per chat, `.cross-project-chat-card.live`) plus a v2.0-locked Finance/Monday card (`.cross-project-chat-card.locked-v2`) and a "New cross-project chat" dashed CTA. Reads from `GET /api/cross-project/conversations`.
- `public/cross-project/new.html` or modal (new) — creation modal (mockup c). Step 1 label selection (Product/Jira is the only live option; Finance/Monday locked). Step 2 project picker: lists eligible projects from `GET /api/cross-project/eligible-projects`. Picker rows use `.picker-row` with sprint metadata, progress bar, ticket stats. Multi-select with "Select all visible" + "Clear" buttons. **"Create chat" submit button disabled until ≥ 1 project is selected** (per decision V; the UI gate. Server-side `cross_project_empty_set` from 12.5a is the second line of defense.) Submit calls `POST /api/cross-project/conversations`, redirects to the new chat.
- `public/cross-project/chat.html` (new) — chat shell (mockups d empty + e populated). Header: `.label-pill` (Product), `.source-chip` (Jira), `.scope-summary` ("2 of 2 · Rain, Joni"), Edit-scope button. Body: messages (user bubbles right, agent answers rendered with `.citation-chip-prefix` chips when citation has `project_id`). `.tool-trace-badge` below agent answers (existing v1.2 trace viewer extended to render conversation `project_ids` — best-effort; full per-call authorize-result rendering deferred per §2 carry-forward). Composer with cap pill in footer.
- Edit-scope modal (mockup h) — reuses the picker; label and source locked (read-only chips); updates `conversation.project_ids` via `PATCH /api/cross-project/conversations/[id]`. **"Save scope" disabled if the resulting selection is empty** (decision V). The server re-runs `authorizeProjectSet` on save.
- Citation rendering: server attaches `project_id` + `project_name` to each citation in `messages.citations` JSONB for cross-project rows; the chat renderer reads those and renders `.citation-chip-prefix` only when present (single-project citations from v1.2 stay unchanged).

**Verification (12.5b — end-to-end UI):**

| Cell | What | Source |
|---|---|---|
| US-1 | UI: Compare velocity Rain ↔ Joni over last 3 sprints, end-to-end via chat | PRD §2.1 US-1 |
| US-2 | UI: Which project has the most overdue tickets, ranked list | PRD §2.1 US-2 |
| US-3 | UI: Bug throughput compare Rain ↔ Joni this sprint | PRD §2.1 US-3 |
| US-4 | UI: Cross-project busiest assignee | PRD §2.1 US-4 |
| US-5 | UI: Cross-project Slack themes via `search_project_data` | PRD §2.1 US-5 |
| US-6 | UI: Cross-project detail list (unresolved high-prio bugs across projects, oldest first) | PRD §2.1 US-6 |
| US-7 | UI: Cross-project cycle-time question returns locked refusal text | PRD §2.2 US-7 |
| US-8 | UI: Asking about a project outside workspace returns honest "I can't include …" refusal | PRD §2.2 US-8 |
| LANDING | Landing page (mockup b) renders chat cards + dashed CTA + v2.0-locked Finance card | PRD §4.1 + mockup b |
| PICKER-DISABLE | Creation modal: "Create chat" disabled with 0 projects selected; enables on ≥1 | decision V |
| PICKER-SELECT-ALL | "Select all visible" + "Clear" toggle all rows | mockup c |
| CITATION-PREFIX | Cross-project chat citations render `[Rain]` / `[Joni]` chip prefix; single-project chat citations do not | PRD §3.8 + mockup e |
| HEADER-SCOPE | Chat header shows `2 of 2 · Rain, Joni` on every screen | PRD §2.3 US-10 + mockup d/e |
| EDIT-SCOPE-EMPTY | Edit-scope modal: "Save scope" disabled if resulting selection would be empty | decision V |
| EDIT-SCOPE-SAVE | Edit-scope save updates conversation `project_ids`; re-runs authorize server-side | PRD §3.6.1 |
| REG-1 | UI: v1.2 single-project chat in Rain still passes byte-equivalent | PRD §5 criterion 5 |
| REG-2 | UI: v1.2 single-project chat in Joni still passes byte-equivalent | PRD §5 criterion 5 |

### 12.6 — Workspace settings + paused banner

The smallest functional sub-block. Two pieces:

**Workspace settings page** (mockup f) — `public/workspace_settings.html` (new). Route: `/workspace/settings` (or `/settings/workspace`).

- Cross-project AI cap section: spend bar (`.spend-bar` with `.healthy` / `.warning` / `.exceeded` variant based on percentage), MTD spend display, cap editor input, "Update cap" button.
- Workspace info section: read-only metadata (name, ID, plan, created date).
- Wire to `GET /api/workspace` (new) for read; `PATCH /api/workspace/limits` (new) for cap edit. Workspace-admin gated.

**Paused banner wiring** (mockup g) — when cross-project cap is hit:

- The `{ paused: true, cap_reached_at: ..., resets_at: ... }` envelope already returned by `/api/cross-project/.../messages` (landed in 12.5a) is consumed by the chat shell. Existing message thread preserved.
- Chat shell renders `.paused-banner` at top with copy from mockup g: "Cross-project chats paused. You've reached the workspace cap of $20.00 for cross-project AI this month. Per-project chats (Rain, Joni) are unaffected and still work. Cross-project resumes automatically on <June 1>." Composer disabled.
- Footer cap pill flips to `$20.00 / $20 — cap reached` in `var(--color-warning)`.
- Banner CTAs: "Raise cap ↗" (workspace settings) + "View workspace settings."

**Verification (12.6):**

- Workspace settings page renders, cap edit persists.
- Manually setting `cross_project_ai_cap_warned_at` to a non-null value (via Jenny in Neon console) flips the paused banner on next chat load. Lift to verify resume.
- Single-project Rain chat still works while cross-project is paused.
- `curl-matrix-block-12.6.md`: 5+ cells covering workspace cap read, cap update, paused-banner trigger, single-project unaffected, banner copy verbatim from mockup.

---

## 7. Commit ordering (rule of thumb)

Within each sub-block, the order is:

1. Schema migration (if any) — Jenny runs, then commit updates to `db/schema-*.sql`.
2. Backend changes — middleware, helpers, routes, executor, compiler.
3. Frontend changes — CSS first (when applicable), then HTML/JS.
4. Curl-matrix + verification.
5. HANDOFF.md addendum (mid-state or sub-block closeout) — doc-only commit can land separately or bundled with the closing functional commit (Block 11 precedent had both patterns).

ff-merge to main happens once per sub-block, with per-push approval.

---

## 8. Critical files (by area)

**Schema:**
- `db/schema-postgres.sql`, `db/schema-d1.sql`

**Backend — auth + middleware:**
- `functions/_lib/workspace.js` (new) — `getWorkspaceUserId(request, env)`; sole sanctioned entry point for the workspace handle (decision U)
- `functions/_lib/auth.js` — `requireWorkspaceScope`, `requireWorkspaceAdmin`; `project_admin` hierarchy removed

**Backend — AI / tools / compiler:**
- `functions/_lib/ai/loop.js` — system prompt slice (cross-project mode)
- `functions/_lib/ai/tools.js` — `project_ids` extension on 4 tools, executor dispatch
- `functions/_lib/ai/aggregate_jira_compiler.js` — `= ANY` rewrite, position-aware `project_id` allowlist
- `functions/_lib/ai/search.js` — `searchHybrid` accepts `project_ids`
- `functions/_lib/ai/authorize.js` (new) — `authorizeProjectSet`

**Backend — routes:**
- `functions/api/projects/[id]/**/*.js` — replace `requireProjectRole` with `requireWorkspaceScope`
- `functions/api/projects/[id]/limits.js` (new) — per-project cap + message-limit editor endpoint
- `functions/api/dashboard.js` (new) — dashboard summary
- `functions/api/cross-project/conversations.js` (new)
- `functions/api/cross-project/conversations/[id].js` (new) — PATCH for edit-scope
- `functions/api/cross-project/conversations/[id]/messages.js` (new)
- `functions/api/cross-project/eligible-projects.js` (new) — projects with active Jira connection
- `functions/api/workspace.js` (new) — workspace read
- `functions/api/workspace/limits.js` (new) — workspace cap editor

**Frontend:**
- `public/auth.css` — token additions, light `.app-nav`, 9 new components, `.project-card` + `.section-heading` split
- `public/dashboard.html` — rebuild
- `public/project.html` — settings rework (or split to `public/project_settings.html` — decision deferred to execute after reading the file)
- `public/cross-project/index.html` (new) — landing
- `public/cross-project/new.html` (new) or creation modal
- `public/cross-project/chat.html` (new) — chat shell
- `public/cross-project/edit-scope.html` (new) or modal
- `public/workspace_settings.html` (new) — workspace cap + info

**Docs:**
- `BLOCK_12_PLAN.md` (this file, post-approval) — locked plan
- `HANDOFF.md` — per-sub-block closeout addenda (Block 11 cadence)
- `curl-matrix-block-12.1.md`, `12.2.md`, `12.3.md`, `12.4.md`, `12.5a.md`, `12.5b.md`, `12.6.md` — verification artifacts (one per sub-block)

---

## 9. Block 13+ carry-forward (already deferred)

Tracking these so the v1.4 / v1.5 scoping inherits cleanly:

- **Per-project "include in cross-project queries" flag** (sensitive-project exclusion). PRD §6 item 1.
- **Named persistent project sets** ("My Q2 Projects"). PRD §6 item 2.
- **Cross-project share URLs.** PRD §6 item 3.
- **`get_jira_sprint_summary` cross-project variant** with `(project_id, sprint_id)` composite. PRD §6 item 4.
- **Transition history** (`jira_issue_transitions` via `expand=changelog`) — prerequisite for cycle time, lead time, throughput-over-time, burndown, bottleneck detection. PRD §6 items 5–8.
- **OR predicates in `aggregate_jira` DSL.** PRD §6 item 9.
- **Materialized `jira_issues` view.** PRD §6 item 10.
- **Free-text predicates inside `aggregate_jira`.** PRD §6 item 11.
- **Workspaces as a first-class entity** (`workspaces` table). PRD §6 item 12.
- **Audit log for admin actions.** PRD §6 item 13.
- **Logo upload (US-17).** Deferred to follow-up sub-block (per decision N).
- **"Last used project set" pre-selection** on creation modal. PRD §4.2.
- **Tool-call trace viewer extension** to render conversation `project_ids` + per-call authorize result. PRD §4.2.
- **Per-project Cost & limits dedicated tab.** PRD §6 item 18. v1.3 inlines limits into General tab.
- **`aggregate_jira` allowlist drift CI assertion.** v1.2 closeout carry-forward.
- **Email integration polish if cross-project cap email isn't covered by the existing generic mechanism.** Confirmed during 12.5 execute.

---

## 10. Out-of-scope for Block 12

To prevent scope drift:

- Monday, Google Drive, Notion, Telegram, GitHub, Linear, HubSpot connectors. v2.0.
- Write-back actions of any kind. Read-only stays.
- Cycle time / lead time / time-in-status / throughput-over-time / burndown / bottleneck. Blocked on transition history (PRD §6 items 5–8).
- `aggregate_entities` cross-source aggregation. v2.0.
- OR predicates in the DSL. v1.3 stays implicit AND.
- `get_jira_sprint_summary` cross-project variant. Decision B.
- Mid-conversation mode switch. Decision Q.
- Logo upload. Decision N.
- Named persistent project sets. Decision D + PRD §6 item 2.
- Cross-project share URLs. PRD §6 item 3.
- Workspaces as a first-class table. PRD §6 item 12.
- Audit log for admin actions. PRD §6 item 13.
- Per-project sub-roles or per-user permission mirroring. PRD §6 items 14–15.
- Paid tiers. PRD §6 item 16.
- Mobile native apps. PRD §6 item 17.

---

## 11. Verification end-to-end (the launch gate)

Block 12 SHIPPED when **all** of the following hold, verified in
production against Jenny's workspace (Rain + Joni):

1. The seven cell groups in §6's 12.5 verification table pass:
   `US-1` through `US-6` PASS; `US-7` + `US-8` refuse correctly; the
   five adversarial cells fail closed; `REG-1` + `REG-2` confirm v1.2
   byte-equivalent.
2. `grep -rn 'project_admin\|project_members\|requireProjectRole' functions/ public/` returns zero hits.
3. Membership audit: `SELECT count(*) FROM project_members` in Neon errors with `relation "project_members" does not exist`.
4. D1 `users` table has the three new columns (`cross_project_ai_monthly_cap_usd`, `cross_project_ai_cap_warned_at`, `cross_project_ai_spend_period_start`) and the default cap is $20.
5. Dashboard renders mockup (a) layout faithfully against live data.
6. Cross-project chat surface (landing → creation → empty → populated → edit scope) all reachable; visual matches mockups (b) (c) (d) (e) (h).
7. Workspace settings page (mockup f) editable; cap update persists; spend bar reflects MTD.
8. Paused banner (mockup g) triggers when cap is hit (verified by manually advancing `cross_project_ai_spend_period_start` or setting `cross_project_ai_cap_warned_at` to simulate); per-project chats unaffected.
9. Per-project settings (mockups i.1 + i.2) replaces the old project settings; limits editor saves; members tab is gone.
10. Seven `curl-matrix-block-12.N.md` files committed alongside the plan (12.1, 12.2, 12.3, 12.4, 12.5a, 12.5b, 12.6).
11. (Reserved for future-block consumption.)
12. **`messages.project_id` audit gate (decision F).** `grep -rn "project_id" functions/ workers/` — every query / aggregation / filter that touches `messages.project_id` has been visited. Either (i) it explicitly handles the cross-project NULL case (`IS NOT NULL` / `IS NULL` / `COALESCE` as appropriate), or (ii) the default SQL three-valued-logic exclusion is documented as intentional in the curl-matrix entry. Findings recorded in `curl-matrix-block-12.1.md` (audit table). The grep + verdict for every callsite is the artifact, not the absence of findings.
13. **Production bleed-in test (decision F).** In production, send one user message in Rain's single-project chat (creating a row with `project_id = <rain_uuid>`). Send one user message in a cross-project chat scoped to Rain + Joni (creating a row with `project_id = NULL`). Then:
    - Load Rain's per-project conversation history via the existing v1.2 endpoint → confirm only the single-project message appears; the cross-project message does **not** bleed in.
    - Load the cross-project conversation history via the new 12.5a endpoint → confirm only the cross-project message appears.
    - Aggregate Rain's per-project spend (`SUM(cost_usd) FROM messages WHERE project_id = $rain`) → confirm the cross-project message's cost is **not** included.
    - Aggregate workspace cross-project spend: `SELECT SUM(cost_usd) FROM messages WHERE project_id IS NULL AND conversation_id IN (SELECT id FROM conversations WHERE project_ids IS NOT NULL AND user_id = $userId AND deleted_at IS NULL)` → confirm the cross-project message's cost **is** included. (The `conversations.user_id` column is the workspace handle per decision E; `conversations` doesn't have its own `owner_user_id` column — it's `user_id`.)
    Recorded in `curl-matrix-block-12.5a.md` or `12.5b.md` (whichever runs the production end-to-end first).

§4.2 nice-to-haves (logo upload, last-used-set pre-selection, trace
viewer extension) are explicitly deferred (decision N + §9) and
**not** in this list.

---

## 12. Open items I'll need from Jenny during execute

Not blocking the plan; flagging so we surface them before the
relevant sub-block starts:

- **12.1 schema migration — D1 default-expression check.** Jenny runs the DDL drafted above in §6.12.1 against Neon (Postgres) and D1 (via `wrangler d1 execute --remote elinno-agent-db ...`). Confirm whether the D1 default-expression `(date('now', 'start of month'))` is supported in Cloudflare D1's SQLite (it generally is — SQLite supports `strftime` and modifier expressions in DEFAULT clauses), or if we need a code-side default + a one-shot UPDATE. Fallback: drop the DEFAULT, set `NOT NULL` only after a code-side backfill UPDATE.
- **12.4 — project settings location.** Confirm whether project settings live inline in `public/project.html` or want their own page `public/project_settings.html`. Decision deferred until 12.4's first read of the file in execute. Either is fine; mockups don't constrain the choice.
- **12.5a — cap-warning email integration.** Existing v1.2 cap-warning email path: does its template accept a workspace-level variant (passing `cap_kind: 'workspace_cross_project'`), or do we need a parallel template / route? Checked in execute by reading the v1.2 Resend integration. If template reuse isn't clean, workspace cap email lands as a follow-up fixup — not a 12.5a launch blocker.

---

## Appendix A.1 — Cross-project system prompt slice (locked verbatim per decision T)

This slice is appended to the v1.2 base system prompt whenever
`conversation.project_ids` is non-null. The base prompt (tool
definitions, citation contract, not-supported list for single-project)
continues to run; the slice adds mode-specific guidance.

Template variables are substituted at agent-loop entry, per turn:
- `{{PROJECT_LIST}}` — bulleted list of `- <Project Name> (`<project_id_uuid>`)` lines, one per authorized project.
- `{{PROJECT_NAMES_PROSE}}` — natural-language joining, e.g. "Rain and Joni" (two), "Rain, Joni, and Project C" (three+), "Rain" (one — degenerate cross-project case, still permitted).
- `{{MISSING}}` — populated only when the agent receives a `project_not_in_workspace` error envelope; resolves to the missing project identifier(s) the agent should surface to the user.

The text is **subject to micro-edits during 12.5a execute** (typo
fixes, prose tightening) but the four-section structure — mode
declaration → tool guidance → not-supported additions → citation
contract — is fixed.

---

```text
## Cross-project mode

You are in **cross-project mode**. The user has selected the
following projects, and every question in this conversation is
scoped to this set:

{{PROJECT_LIST}}

Every answer you produce in this conversation MUST:

1. **Open with the scope.** Begin with a brief scope line in prose:
   "Across {{PROJECT_NAMES_PROSE}}: …". This is not optional — the
   user is comparing across projects and needs the scope line as the
   anchor for the answer.

2. **Name the project inline on every source reference.** When you
   reference a sprint, ticket, channel, document, or any source
   object, include the owning project's name inline. Examples:
   - "Rain's Sprint 12 closed 28 story points."
   - "Joni has 14 high-priority bugs unresolved; Rain has 3."
   - "RAIN-117 (Rain's bug)" — not "RAIN-117."
   - "Sprint 11 in Joni had a velocity dip" — not "Sprint 11 had a velocity dip."
   This is the in-prose disambiguation rule. The citation chip
   prefix (described in §Citations below) is rendered separately
   by the server.

### Tools in cross-project mode

- **For comparison and ranking questions**, use `aggregate_jira`
  with `group_by: ['project_id', ...]` to get per-project rows in a
  single query. Examples:
  - "Compare velocity Rain vs Joni" → `aggregate_jira({ project_ids:
    [A,B], where: { sprint_id: { in: [...] }, status_category: 'done' },
    select: ['project_id', 'sprint_name', 'SUM(story_points)'],
    group_by: ['project_id', 'sprint_name'] })`.
  - "Which project has the most overdue tickets" → `aggregate_jira({
    project_ids: [<all selected>], where: { status_category: { neq:
    'done' }, source_created_at: { lt: <14d ago> } }, select:
    ['project_id', 'COUNT(*)'], group_by: ['project_id'], order_by:
    [{ field: 'count', dir: 'desc' }] })`.
  Do **not** call `aggregate_jira` once per project — a single SQL
  query with `group_by` covers the comparison correctly and cheaply.

- **For chained sprint patterns** (e.g. "compare last 3 sprints"),
  first call `list_jira_sprints({ project_ids, state: 'closed' })`
  to resolve sprint IDs across the project set, then
  `aggregate_jira({ project_ids, where: { sprint_id: { in: [...] }
  }, ... })` to aggregate over them. Do **not** filter by
  `sprint_name` — sprint names are not globally unique across
  projects.

- **For Slack themes or free-text retrieval across projects**, use
  `search_project_data({ project_ids, query, sources: ['slack'] })`.
  Hybrid keyword + semantic search runs across the project set in
  one call.

- **For cross-project detail listing** (e.g. "all my high-priority
  bugs across projects, oldest first"), use `query_jira_issues({
  project_ids, ... })`. The tool returns up to 50 issues ordered by
  `source_updated_at DESC` (existing behavior); when the user wants
  a different sort, re-present from the returned payload.

- **`get_jira_sprint_summary` does NOT accept `project_ids`.**
  Calling it cross-project is a mistake — `sprint_id` is not
  globally unique, so a cross-project sprint-summary call could
  silently aggregate unrelated sprints. For cross-project sprint
  questions, use `aggregate_jira` with appropriate `group_by`,
  for example `group_by: ['project_id', 'status_category']`.

### Not supported in cross-project mode

In addition to the not-supported items from single-project mode
(which still apply unchanged):

- **Cycle time, lead time, time-in-status, throughput-over-time,
  burndown, burnup, bottleneck detection.** Status transition
  history is not tracked yet — only the most recent update time is
  available, and that doesn't tell us when a ticket moved to Done.
  Cross-project mode does **not** unlock these capabilities. If the
  user asks for any of them, refuse honestly: "Cycle time isn't
  tracked yet — I don't have status transition history, only the
  most recent update time, which doesn't tell me when a ticket
  moved to Done. This is unchanged in cross-project mode."

- **Projects outside the user's workspace.** The authorize step
  fails closed before any SQL runs. If you receive a tool result
  with `code: 'project_not_in_workspace'` and `missing: [...]`,
  surface to the user: "I can't include {{MISSING}} — it's not in
  your workspace." Do **not** continue with a partial-scope answer.
  The request fails closed; you should ask the user to remove the
  out-of-workspace project from their scope.

- **Cross-source aggregation across Slack and Jira in one tool.**
  Each cross-project tool stays source-specific. If the user wants
  a question that mixes Slack and Jira data, run separate tool
  calls and synthesize.

- **Cross-project write-back.** Read-only stays. No tool in this
  conversation creates or modifies source data.

- **Switching the project set mid-conversation.** The conversation
  is bound to its project set at creation. If the user wants a
  different scope, they should open a new cross-project chat or
  use the Edit-scope action.

### Citations

Citation chips in cross-project mode are rendered with a
`[Project Name]` prefix automatically by the server (e.g.
`[Rain] Sprint 11 burndown · 3 weeks ago`). You do **not** need to
prepend the project name into the inline-citation token in your
prose — the chip surface handles disambiguation visually.

What you DO still need is to name the project in the surrounding
prose, per rule #2 of "Every answer MUST" above. "Rain's Sprint 11
burndown shows the dip" is correct; "Sprint 11 burndown shows the
dip" is wrong even if the citation chip is rendered with [Rain].
The chip is for the citation surface; the prose mention is for the
reader's flow.

### Reminder: this conversation is cross-project

The conversation row has `project_ids` set, which is why this slice
is loaded. If a tool result surprises you (an authorize failure, a
malformed payload, a result that crosses projects unexpectedly),
the slice is the place to consult — and the authoritative source of
truth for any prose contract.
```

---

*End of BLOCK_12_PLAN.md draft.*
