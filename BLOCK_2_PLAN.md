# Block 2 — Project Shell · Build Plan

| Field | Value |
|---|---|
| Document | Block 2 Build Plan v1.0 |
| Block | Block 2 of 9 (per BUILD_PLAN.md) |
| Companion to | BUILD_PLAN.md, PRD.md, HANDOFF.md |
| For | Solo build with Cursor + Claude |
| Generated | 2026-05-02 (Block 2 design session) |

---

## How to use this document

Drop this file into a fresh Cursor session at the start of each Block 2 working session. It contains:

- The full sub-task breakdown for Block 2
- Every design decision already made (so Cursor doesn't re-litigate them)
- Schema prerequisites that must run before any code is written
- A session-by-session work order, so each Cursor session has a clear scope

Workflow per session:

1. Open Cursor with this file + `HANDOFF.md` + `PRD.md` as context.
2. Tell Cursor which session you're working on (e.g. "We're on Block 2 Session 1").
3. Have Cursor implement one sub-task at a time. Read every diff before accepting.
4. End the session with the trunk green and an updated `HANDOFF.md`.

---

## What Block 2 delivers

Per BUILD_PLAN, the done-when criterion for Block 2 is:

> You can create a project, invite yourself as a member, open the project page, and send chat messages that persist.

Translated into concrete deliverables:

- **Workspace-admin-only project creation** — only users with `is_admin = TRUE` in D1 can create projects. Anyone can be a member of any project.
- **Projects list and detail pages** rendered in the existing site style (matches `dashboard.html` / `admin.html`).
- **Invite-by-email flow, existing-users-only** — typing an email looks up D1; if the user doesn't exist, return a clear error.
- **Multi-thread chat persistence** — each project has multiple conversations; messages persist to Postgres; assistant replies are an echo placeholder until Block 5.
- **Three-tab project shell** — Chat / Members / Connections. The Connections tab is a forward-compatible empty state ("No tools connected yet. Slack, Jira, Monday, and Google Drive are coming.") — the actual connector framework is Block 3+ work.

---

## Design principles still in force (from HANDOFF §"Key design principles")

For Block 2, the live constraints are **#3 and #6**. The others bite later (Blocks 5+).

- **#3 Project scoping is enforced server-side, not in the prompt.** Every Postgres query in Block 2 filters by `project_id`. `project_id` always comes from the URL or session — never trusted from the request body for authorization.
- **#6 Secrets never in plaintext.** Block 2 doesn't store any new secrets, but the existing rule applies: connection strings stay in Cloudflare bindings + password manager only.

The other principles (#1 AI never invents numbers, #2 every answer needs a citation, #4 tool signature extensibility, #5 cost discipline) become live in Block 5.

---

## Locked design decisions (don't re-litigate in Cursor)

These were settled in the Block 2 design conversation. Each has a short rationale so future sessions don't second-guess.

### A. URL routing — flat, not split
- Project routes: `/projects.html`, `/projects/new.html`, `/project.html?id=PROJECT_ID&c=CONVERSATION_ID&tab=chat`
- One project URL, role-aware rendering inside it. Per PRD §5.1, role gating is server-side; the URL itself is not a permission boundary.

### B. Dynamic routing handled via query strings
- Cloudflare Pages serves `public/` as static files. There's no built-in `[id]` for HTML pages.
- Pattern: single `project.html` reads `?id=...&c=...&tab=...` from `location.search`. Keep this until/unless we add a `_redirects` rule for pretty URLs.

### C. Project creation — workspace-admin only
- Only users with `is_admin = TRUE` in D1's `users` table can create projects.
- The creator becomes the project's admin via a `project_members` row with `role = 'admin'`, inserted in the same transaction as the project insert.
- Non-admin users hitting `/projects/new.html` directly get a 403 with redirect to `/projects.html`.

### D. Invite flow — existing users only
- Typing an email looks up D1. If found → insert `project_members` row. If not → 404-equivalent error: `"No Elinno account with this email. Ask your admin to create the account first."`
- Per BUILD_PLAN, Block 2's purpose is "create a project, invite yourself as a member" — this is path A's exact use case.
- Hybrid path with pending invites is deferred. If we need it post-launch, it's an additive change.

### E. Role enforcement — `requireProjectRole` helper
- Per-handler call: `const { user, role } = await requireProjectRole(env, sessionToken, projectId, 'admin')` (or `'member'` for read-level operations).
- Returns user info or throws 403. Survives URL-shape changes better than middleware.
- Session validation already happens upstream (existing auth middleware verified the D1 user); `requireProjectRole` only checks Postgres `project_members` for the project-scoped role.

### F. Conversation model — multi-thread
- Each project has many `conversations`. User can create new ones via the "+" button in the sidebar; switch between them via sidebar click.
- URL pattern: `?id=PROJECT&c=CONVERSATION`. If `c` is missing, default to the most recent conversation.

### G. Conversation auto-creation on first project open
- When a user opens a project that has zero conversations, auto-create one named `"New conversation"`. Lower friction than an empty state.

### H. Conversation auto-titles
- When the **first** user message lands in a conversation, set the conversation's `title` to the first ~50 chars of that message (truncate at word boundary, append "…" if truncated).
- LLM-generated titles can replace this in Block 5+ if desired.

### I. Echo placeholder format
- Assistant message body: `You said: "USER_MESSAGE" — Real AI coming in Block 5.`
- Persisted as a `messages` row with `role = 'assistant'` so the schema usage is identical to Block 5.
- Visually rendered with a dashed border + subtle banner above the composer to make the placeholder state obvious.

### J. Conversation routes — conversation-scoped URLs
- `POST /api/projects/:projectId/conversations` (create conversation)
- `GET /api/projects/:projectId/conversations` (list conversations for project)
- `GET /api/projects/:projectId/conversations/:conversationId/messages` (fetch messages)
- `POST /api/projects/:projectId/conversations/:conversationId/messages` (send message — server creates user row, generates echo, creates assistant row, returns both)
- The `requireProjectRole` helper validates the project; a separate one-line check confirms the conversation belongs to the project.

### K. Three-tab project shell
- Chat | Members | Connections
- Connections tab in Block 2 is purely a forward-compatible empty state. No backend work; the actual framework is Block 3.

### L. Validation rules
- **Project name:** required, 1–100 chars, trimmed, not empty after trim. Unicode allowed. No uniqueness constraint.
- **Project description:** optional, 0–1000 chars.
- **Invite email:** standard email validation, normalized to lowercase before D1 lookup.
- **Role on invite:** all invites default to `'member'`. Promoting/demoting between admin and member is **deferred to Block 9**.

### M. Deferred to Block 9 (don't build in Block 2)
- Soft-delete UX (archive button, restore flow, hard-delete with confirm)
- Conversation rename / delete
- Promote member to admin / demote admin to member
- Invite-notification email via Resend (consider as bonus end-of-Block-2 task if time permits)
- Pagination on message history (placeholder mode won't get long)

### Session 2 additions (decisions N–U)

These were locked at the start of Session 2, after Session 1 shipped the projects + members APIs. N, P, and Q are sticky and apply to Session 3+ (same fetch/render and form-submit patterns reused on `project.html`). O, R, S, T, U are Session-2 specific.

### N. Error-string strategy — UI translates terse, renders validation verbatim
- Auth helpers' strings (`"Not authenticated"`, `"Forbidden"`, `"Internal error"`) are deliberately terse for security. UI translates them to user-facing copy or routes to the right state. Never inline-rendered.
- Create-handler validation strings (`"Project name is required"`, `"Project name must be 100 characters or fewer"`, etc.) are already user-facing-quality. Render verbatim in the form's error panel.
- Mapping: 401 → redirect to `/login.html?next=...`. 403 on POST → flip page to unauthorized state (decision O). 500 → "Something went wrong. Please try again." 400 with validation message → render `body.error` verbatim. 400 `"Invalid JSON"` is not user-reachable; treat as 500 if it ever happens.
- This pattern carries to Session 3 (conversations, messages).

### O. `/projects/new.html` — three page states
- **Loading**: initial render before `/api/me` resolves.
- **Form**: `is_admin === true`. The mockup as drawn.
- **Unauthorized**: `is_admin === false`. Form card replaced with: *"Only workspace admins can create projects. Ask your admin to create one and invite you."* Plus a back link to `/projects.html`.
- API is the boundary; the client check is convenience. A spoofed client check that POSTs anyway gets 403 from `requireWorkspaceAdmin` and the page flips to unauthorized.

### P. `/projects.html` — four page states + error overlay
- **Loading**: skeleton grid (4 ghost cards).
- **Empty (admin)**: heading/sub stay, grid replaced with centered card *"No projects yet. Create your first one to get started."* + "+ New project" CTA.
- **Empty (non-admin)**: same shell, copy *"You haven't been added to any projects yet. Ask your admin to invite you."* No CTA.
- **Populated**: the mockup as drawn.
- **Error overlay**: fetch failed (network / 500). Replaces grid with *"Couldn't load your projects. [Retry]"*. Retry re-runs the fetch.
- **No timeout fallback.** Explicit try/catch around `fetch()` with explicit error rendering. A real hang stays visible as stuck loading — that's the correct signal.
- This four-state pattern carries to Session 3 (project.html — chat tab, members tab).
- **`.state-card` primitive (Session 2 closeout):** the canonical primitive for empty/error/unauthorized states across Block 2 — used in `projects.html` for empty-admin / empty-non-admin / error overlay; in `projects/new.html` for unauthorized; reused for Session 3+ chat / members / connections empty states.

### Q. Form validation — client-light, server-truth, panel-only errors
- Client: submit button disabled while name field is empty after trim. No length checks client-side (server catches; rare to hit).
- Server: every POST renders the response. Success → redirect (decision T). Failure → render `body.error` (translated per N) in `.form-msg.error` above the first field. Form values stay populated. Submit re-enables.
- No per-field error markers in v1.1 — error panel is enough at this scale.
- Submit button text while in-flight: "Creating…", disabled. Resets on response.
- Pattern reused for invite form in Session 4 and message composer in Session 3.

### R. Mobile floor — single 700px breakpoint
- Matches the existing site precedent (auth.css has one `@media (max-width: 700px)` block, no other breakpoints).
- At ≤700px: `.projects-grid` collapses from `repeat(2, 1fr)` to single column; `.section-head-row` stacks vertically (heading on top, "+ New project" full-width below).
- `.section-heading` already shrinks 45px → 30px in production CSS (no change needed).
- Form is already single-column in the mockup (no change).
- Anything beyond this is ahead of the rest of the site.

### S. Browser-back behavior — clear form on back, no preservation
- Default browser behavior. No localStorage, no JS state preservation.
- Reasoning: form is name + optional description (~10 seconds to retype). Preservation is more code than the value.
- Cancel button is a plain `<a href="/projects.html">` (no JS) so back-from-cancel works naturally.

### T. Success redirect — to `/project.html?id={NEW_ID}`, accept Session-3 404
- Per decision C and sub-task 2.3 done-when. Target page doesn't exist until Session 3 ships it.
- Implementation: `window.location.href = '/project.html?id=' + encodeURIComponent(project.id)`. Use `href`, not `replace` (back-button-friendly).

### U. Card metadata — role badge + relative-time only
- Mockup shows three meta items per card (role, "5 members", "Updated 2h ago"). The `GET /api/projects` response has `role` and `updated_at` but **not** `member_count`.
- v1.1 cards show: role badge + "Updated Nh/Nd ago" (e.g. "Updated 2h ago", "Updated yesterday"). No member count.
- Honest to the data we have. Don't retrofit Session 1's API for a UI nicety; revisit in a Block 9 polish pass if anyone misses it.
- Relative-time formatting via `Intl.RelativeTimeFormat`, computed on page load only (no live ticking).

### Session 2 roles (who does what)

Three-way relay, established in Session 1 and unchanged for Session 2.

- **Jenny** — owns decisions, owns the verification, owns every push to `main`.
  - Approves each Cursor diff before commit.
  - Runs the manual browser smoke test on the merged-main deploy at end of session (admin flow + non-admin flow + 700px mobile).
  - Gives explicit "approve push" before Cursor pushes to `main`.
  - Updates `HANDOFF.md` with end-of-session state (or directs Cursor to draft it for review).

- **Claude** (this session) — owns design decisions and review.
  - Locked decisions N–U above before any code was written.
  - Reviews each Cursor diff after Cursor proposes it and before Jenny approves: catches scope creep, deviation from N–U, copyright/style drift from the production patterns, accessibility regressions, XSS gaps in HTML rendering of user content (project names).
  - Doesn't write production code. Doesn't run git.

- **Cursor** — owns implementation and git mechanics.
  - Proposes diffs sub-section by sub-section in the implementation order at the end of this section.
  - Stages, commits with Conventional Commits messages, opens a PR or pushes to a feature branch.
  - Never pushes to `main` without Jenny's explicit "approve push" message.
  - Owns the local dev server, schema introspection, and any `wrangler` invocations needed to verify behavior in preview.

**Verification model for Session 2 specifically:** unlike Session 1's 16-scenario curl matrix, this is UI work — the verification is a manual browser smoke test on the merged-main deploy. Jenny runs it. Claude doesn't have a browser; Cursor's local dev server gives a preview-deploy approximation but isn't the production verification. The session closes when Jenny has clicked through admin-creates-project, non-admin-sees-unauthorized, and a 700px mobile pass on the live site.

---

## Schema prerequisites (Sub-task 2.0)

**Run this BEFORE writing any application code in Session 1.** These are the schema gaps the Block 2 design assumes.

### D1 — `users.is_admin`

The Block 2 design assumes a boolean `is_admin` column on D1's `users` table. The existing admin/users endpoints already reference `is_admin` (see `admin.html` and `dashboard.html` reading `d.user.is_admin`), so it likely exists — verify.

**Step 1 — verify:** open `db/schema-d1.sql`. Look for an admin column on `users`.

**Step 2a — if column exists:** confirm name and type. If it's not `is_admin INTEGER`, decide whether to rename for clarity (small migration) or leave it. Update the projects API to read whatever column name is canonical.

**Step 2b — if column does NOT exist:** apply this migration:
```sql
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_admin = 1 WHERE email = 'jenny@elinnovation.net';
```
(D1 / SQLite uses `INTEGER` for booleans; `1`/`0` semantics. Update `db/schema-d1.sql` to make this canonical.)

Apply via:
```bash
npx wrangler d1 execute elinno-agent-db --remote --file=./migrations/add-is-admin.sql
```

### Postgres — `conversations.title`

The auto-title feature (decision H) needs a `title TEXT` column on `conversations`. Block 1 status notes don't confirm this column exists.

**Step 1 — verify:** open `db/schema-postgres.sql`. Look for a `title` column on `conversations`.

**Step 2 — if missing, apply:**
```sql
ALTER TABLE conversations ADD COLUMN title TEXT;
```

Apply via the Neon SQL console (or whichever Postgres migration pattern you used in Block 1 Task 3). Document the choice in HANDOFF if it's the first time.

### Other Postgres columns to verify exist

Block 2 application code assumes these columns. Check `db/schema-postgres.sql`:
- `projects`: `id`, `name`, `description`, `owner_user_id`, `created_at`, `updated_at`, `deleted_at`
- `project_members`: `project_id`, `user_id`, `role`, `created_at`, `invited_by` (recommended), `invited_at` (recommended). Unique on `(project_id, user_id)`.
- `conversations`: `id`, `project_id`, `title` (after migration above), `created_at`, `updated_at`, `deleted_at`
- `messages`: `id`, `conversation_id`, `role` ('user' | 'assistant' | 'system'), `content`, `created_at`, `deleted_at`

If any of these are missing or shaped differently, **stop and reconcile before writing code.** Schema drift will burn more time than the schema check.

---

## Sub-task breakdown

Six application sub-tasks plus the schema prerequisite. Each sub-task is one focused unit of work.

### 2.0 — Schema prerequisite (~10 min, head of Session 1)
View `db/schema-d1.sql` and `db/schema-postgres.sql`. Add `users.is_admin` (D1) and `conversations.title` (Postgres) if missing. Apply migrations. Verify in console.

**Done when:** Both columns exist; Jenny's user is `is_admin = 1`; the canonical schema files reflect the changes.

### 2.1 — Projects API
Create three endpoints under `functions/api/projects/`:
- `POST /api/projects` — create. Validates session has `is_admin`. Inserts into `projects` + `project_members` (creator as admin) in a single transaction.
- `GET /api/projects` — list projects the current user is a member of (joins `project_members` to `projects`, filters `deleted_at IS NULL`).
- `GET /api/projects/:id` — read one. Uses `requireProjectRole(..., 'member')` (admins are also members of their own projects, so this works for both roles).

Build the `requireProjectRole` helper alongside the existing session middleware. Returns `{ user, role }` or throws 403.

**Done when:** All three endpoints work via curl with a session cookie. Non-admin users get 403 on POST. Cross-project reads get 403.

### 2.2 — Project members API
Create three endpoints under `functions/api/projects/[id]/members/`:
- `POST /api/projects/:id/members` — invite by email. Admin-only. Looks up D1 by lowercase email. Returns 404 with explicit error if user not found. Inserts `project_members` row with `role = 'member'`. Optional `invited_by`/`invited_at` fields populated.
- `GET /api/projects/:id/members` — list members. Member-level access (any project member can see who else is in it). Joins to D1 for emails.
- `DELETE /api/projects/:id/members/:userId` — admin-only. Cannot remove the project's creator (return 403 with explicit error).

**Done when:** All three endpoints work via curl. Invite-non-existent-user returns the friendly error. Self-removal of creator is blocked.

### 2.3 — Projects list + create UI
Two static HTML files in `public/`:
- `projects.html` — uses production `app-nav` + `section-eyebrow/section-line/section-heading` pattern. Grid of project cards. "+ New project" button visible only if `/api/me` returns `is_admin = true`.
- `projects/new.html` — form with name + description fields. Posts to `/api/projects`. On success, redirects to `/project.html?id=NEW_ID`. Workspace-admin gate enforced server-side; UI hides the page link for non-admins but the API is the source of truth.

Both files use the existing `auth.css`. New components (`.project-card`, `.section-head-row`, etc. — see mockup-v2 for full set) added to `auth.css`.

**Done when:** Logged-in admin can navigate to `/projects.html`, click "+ New project", fill the form, hit Create, and land on the new project's detail page (which won't exist yet — that's 2.5).

### 2.4 — Conversations + messages API
Endpoints under `functions/api/projects/[id]/conversations/`:
- `POST /api/projects/:projectId/conversations` — create. Member-level. Returns the new conversation with default title `"New conversation"`.
- `GET /api/projects/:projectId/conversations` — list. Filters `deleted_at IS NULL`, orders by `updated_at DESC`.
- `GET /api/projects/:projectId/conversations/:conversationId/messages` — fetch messages, ordered `created_at ASC`. Verifies conversation belongs to project.
- `POST /api/projects/:projectId/conversations/:conversationId/messages` — send. Single round-trip:
  1. Insert `messages` row: `{ conversation_id, role: 'user', content: req.body.content, created_at: NOW() }`.
  2. If this is the first user message in the conversation, update `conversations.title` to the truncated content.
  3. Generate echo: `You said: "${content}" — Real AI coming in Block 5.`
  4. Insert second `messages` row: `{ conversation_id, role: 'assistant', content: echo, created_at: NOW() }`.
  5. Update `conversations.updated_at`.
  6. Return both messages + the (possibly updated) conversation title.

**Done when:** Curl flow works: create project → create conversation → POST a message → GET messages returns user + assistant pair → conversation auto-titles correctly.

### 2.5 — Project detail page + chat UI
`public/project.html` — the three-tab shell.

Reads `?id=...&c=...&tab=...` from URL. Calls in this order:
1. `GET /api/projects/:id` — fetch project (also serves as auth check; 403 → redirect to `/projects.html`).
2. `GET /api/projects/:id/conversations` — fetch sidebar list.
3. If sidebar list is empty, `POST /api/projects/:id/conversations` to auto-create one. (Implements decision G.)
4. If `?c=` is missing, set it to most recent conversation's id and update URL via `history.replaceState`.
5. `GET /api/projects/:id/conversations/:c/messages` — fetch active conversation messages.

Renders three tabs:
- **Chat** (active by default) — sidebar + main pane per mockup. Composer posts to `/messages`, receives both user + assistant rows back, renders both.
- **Members** — empty for now; populated in 2.6.
- **Connections** — empty state with copy: "No tools connected yet. Slack, Jira, Monday, and Google Drive are coming." Centered, with the icon-in-tinted-square pattern (style guide §5.3) for visual continuity.

**Done when:** Click into a project, land in chat, send a message, see the echo, switch conversations via sidebar, create a new conversation, click the Members tab (empty), click the Connections tab (empty state), all without page reloads.

### 2.6 — Members tab UI
Members section inside `project.html`'s tab system.
- Invite row at top: email field + "Send invite" button. On 404 from API, show inline error in the field area (not an alert).
- Members list below — matches the mockup's table pattern (white-on-soft-grey container, `.btn-danger` outlined Remove button per row).
- Creator's "Remove" button is disabled (`disabled` attribute + faded styling).
- After invite/remove, refetch the list and re-render. Optimistic updates not needed at this scale.

**Done when:** Full Block 2 done-when criteria met — admin can create a project, open it, invite a real user, see them in the list, remove them, send chat messages, switch conversations, see Connections empty state. All while logged in as admin.

---

## Recommended session breakdown

Six sub-tasks, four sessions. Pair APIs with their UI consumer where it makes sense.

### Session 1 — Schema check + Projects API foundation
- **Sub-task 2.0** (schema check + migrations)
- **Sub-task 2.1** (projects API + `requireProjectRole` helper)
- **Sub-task 2.2** (members API)

Build all the project-scoped APIs together. They share the helper, share the auth pattern, share error shape. Designing them as a unit prevents two passes at the same plumbing.

End of session: Six endpoints work via curl. No UI yet. Trunk green on a preview branch.

### Session 2 — Projects list + create UI
- **Sub-task 2.3** (projects.html + projects/new.html)

Shortest session of the four. APIs from Session 1 are ready; this is form + grid wiring.

End of session: Admin can navigate to projects, create one, get redirected (to a not-yet-existing project page — that's fine, ends in 404 until Session 3).

### Session 3 — Conversations API + chat shell + chat UI
- **Sub-task 2.4** (conversations/messages API)
- **Sub-task 2.5** (project.html — three-tab shell, chat tab implemented, Connections empty state)

The biggest session. Most overrun risk. **Natural break point if it overruns:** API done and curl-verified, UI work for Session 4. Don't combine Session 4 with this if the chat UI has hiccups.

End of session: Click into a project, chat works end-to-end, conversation auto-creates, auto-titles, sidebar switches conversations.

### Session 4 — Members tab UI + (optional) invite email
- **Sub-task 2.6** (members tab)
- Optional bonus: Resend-based invite-notification email (subject + body + send call). Mechanism already exists for password reset.

End of session: Full Block 2 done-when criteria met. Update `HANDOFF.md` to mark Block 2 complete and Block 3 next.

---

## File layout this block will produce

New / modified files at the end of Block 2:

```
elinno-agent/
├── public/
│   ├── projects.html               ← NEW (Session 2)
│   ├── projects/new.html           ← NEW (Session 2)
│   └── project.html                ← NEW (Session 3, modified Session 4)
├── functions/
│   └── api/
│       ├── _lib/
│       │   └── auth.js             ← MODIFIED (add requireProjectRole)
│       └── projects/
│           ├── index.js            ← NEW (POST/GET — Session 1, 2.1)
│           └── [id]/
│               ├── index.js        ← NEW (GET one project — Session 1, 2.1)
│               ├── members/
│               │   ├── index.js    ← NEW (POST/GET — Session 1, 2.2)
│               │   └── [userId].js ← NEW (DELETE — Session 1, 2.2)
│               └── conversations/
│                   ├── index.js    ← NEW (POST/GET — Session 3, 2.4)
│                   └── [conversationId]/
│                       └── messages.js ← NEW (POST/GET — Session 3, 2.4)
├── auth.css                        ← MODIFIED (add Block 2 components)
└── db/
    ├── schema-d1.sql               ← MODIFIED IF is_admin missing (Session 1, 2.0)
    └── schema-postgres.sql         ← MODIFIED IF title missing (Session 1, 2.0)
```

Note: Cloudflare Pages Functions handle `[id]` routing natively (unlike static HTML), so the API can use clean nested paths. Adjust the helper path (`functions/_lib/` vs `functions/api/_lib/`) to match wherever the existing session/auth helpers already live.

---

## Things to remember while building Block 2

These don't have to be repeated in every session, but they apply throughout:

- **Read every diff.** Especially for `requireProjectRole` and the messages POST handler — those are the two places where a subtle bug ships you cross-project access or a duplicate message.
- **Don't trust the client for `project_id`.** Always derive it from the URL pattern (`:projectId` segment), and re-validate in `requireProjectRole`.
- **Conversation belongs to project — verify it.** When the URL has both `:projectId` and `:conversationId`, the message handler must check the conversation actually belongs to the project. Two-line guard, easy to forget.
- **Echo response format must match Block 5's eventual real format.** A `messages` row with `role = 'assistant'` and a string `content` field. No special placeholder schema. When Block 5 lands, only the *generation* changes — schema and API contract stay identical.
- **Use existing patterns from `auth.css`.** New components extend the system; don't invent new tokens, button variants, or color values.
- **Soft-delete is read-time only.** All SELECTs filter `deleted_at IS NULL`. No archive UI in Block 2; just respect the column for forward compatibility.

---

## After Block 2 — what's next

Once Block 2 is fully merged and verified:

- **Update `HANDOFF.md`:** mark Block 2 ✅ DONE, Block 3 as next. Document `is_admin` column and `conversations.title` column. Note the API patterns established (`requireProjectRole`, conversation-scoped URLs).
- **Update `BUILD_PLAN.md`** if anything changed about the order or scope (probably nothing).
- **Block 3 starts the connector framework** — TypeScript interface, registry, encryption helper, dummy connector. Backend-only block. The Connections tab built in Block 2 stays empty until Block 4 fills it with the first real "Connect" button.

---

*End of Block 2 Build Plan v1.0. Generated 2026-05-02.*
