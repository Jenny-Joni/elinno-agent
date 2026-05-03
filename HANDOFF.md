# Elinno Agent — Project Handoff

> Drop this into a fresh Claude session (chat or Cursor) so the assistant can pick up where the last session left off. This file is the single source of truth for "where are we and what's next." Update it after each working session.

**Last updated:** 2026-05-03
**Current product version:** v1.1 (the MVP being built now)
**Owner / sole developer:** Jenny ([jenny@elinnovation.net](mailto:jenny@elinnovation.net))
**AI tooling:** Cursor + Claude

---

## TL;DR for a new Claude session

You are joining a project mid-build. Here's the shape of it:

- **Elinno Agent** is a multi-tenant project intelligence platform. An admin creates a project, connects external tools (Jira, Slack, Monday, Google Drive), and the platform syncs that data into a unified store. Members chat with an AI assistant scoped to a single project, asking questions like "how many tickets in this sprint?" or "how much did we spend on testing?"
- **The auth foundation is already deployed** at [https://elinnoagent.com](https://elinnoagent.com) (Cloudflare Pages + Pages Functions + D1).
- **Block 1 is fully done; Block 2 Sessions 1 and 2 are shipped.** Data layer foundation is wired end-to-end through Cloudflare Pages Functions → Hyperdrive → Neon Postgres. Both `/api/db-health` and `/api/db-test` are live in production. Block 2's projects + members APIs and the projects list + create UI are deployed (sub-tasks 2.0–2.3 done); Session 3 (conversations + messages API + chat UI) is next.
- **Solo build with Cursor + Claude.** No team. One task at a time.

Your first move in any new session: read this file, read PROJECT.md, read the latest STATUS.md or git log, then check this handoff against reality before changing anything.

---

## What's already live in production

Already shipped (don't touch unless there's a reason):

- Static welcome page + login form at elinnoagent.com (Cloudflare Pages, auto-deploy on push to `main`)
- Auth endpoints under `/api/`: login, logout, me, forgot-password, reset-password, admin/users, admin/users/[id]
- D1 database `elinno-agent-db` with `users`, `sessions`, `password_resets` tables, bound as `env.DB`
- Resend integration for password reset emails. Domain elinnoagent.com verified.
- One admin user: [jenny@elinnovation.net](mailto:jenny@elinnovation.net)
- Custom auth using PBKDF2 with 100,000 iterations (the Cloudflare Workers cap — do NOT raise without verifying runtime support)

---

## What's being built (v1.1 scope)

Four connectors, AI chat scoped per-project, free to users.

**MVP connectors:**


| System       | Auth                | Use                                     |
| ------------ | ------------------- | --------------------------------------- |
| Jira         | OAuth or API token  | Tickets, sprints, statuses              |
| Slack        | OAuth bot token     | Channel messages                        |
| Monday       | API token (GraphQL) | Boards, items, budgets/time             |
| Google Drive | OAuth (read-only)   | Docs, Sheets, PDFs only (no images/OCR) |


**Roles:**

- **Admin** — creates projects, connects systems, manages members and billing
- **Member** — read-only chat access, sees citations
- **AI Bot** — internal actor, scoped to a single project

**Pricing:** Free in v1.1. No paid tiers yet. Per-project caps protect cost.

**Cross-project AI mode** is deferred to v1.2 (planned, not yet built). v1.1 is strictly project-scoped.

---

## Architecture decisions (locked in)


| Layer                       | Choice                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Frontend                    | Cloudflare Pages + vanilla HTML/CSS (existing)                                                                       |
| Light API                   | Cloudflare Pages Functions                                                                                           |
| Sync workers + AI agent     | Cloudflare Workers                                                                                                   |
| Job queue                   | Cloudflare Queues                                                                                                    |
| Auth database               | Cloudflare D1 (already deployed)                                                                                     |
| Connector data + embeddings | **Neon Postgres with pgvector via Hyperdrive** (provisioned, see Block 1 status below)                               |
| Secrets                     | Envelope encryption for connector tokens in Postgres (master key in Workers Secrets — Cloudflare has no managed KMS) |
| LLM                         | Anthropic Claude (Sonnet for synthesis, Haiku for routing)                                                           |
| Email                       | Resend (already deployed)                                                                                            |
| Auth                        | Custom (already deployed)                                                                                            |


**Why this split:** D1 is great for auth-shaped data; Postgres is what the connector + embeddings layer needs. Cloudflare's free tier + Neon's scale-to-zero matches the free pricing model.

**Sidecar escape hatch:** if any connector ever needs a Node-only library that can't run in Workers, that one connector runs on a Render or Fly sidecar. Architecture does not assume Cloudflare-only forever.

**Cloudflare gotchas to remember:**

- Workers 30s CPU limit — chunk long work
- PBKDF2 capped at 100k iterations
- Cloudflare Queues are still maturing; usable but watch them
- No managed KMS — envelope encryption is app-level with the master key in Workers Secrets

---

## Key design principles (don't violate these)

1. **The AI never invents numbers.** Counts and aggregations come from SQL queries, not from the model. If a number appears in an answer without a tool call, that's a bug.
2. **Every answer needs a citation.** If the AI can't cite a source, it should say "I couldn't find that," not guess.
3. **Project scoping is enforced server-side, not in the prompt.** Every tool requires `project_id`. The server rejects calls outside the current project. Don't trust the LLM to behave — enforce it.
4. **Tool signatures must be extensible.** v1.2 will add cross-project mode (`project_ids: string[]`). Today's v1.1 tools take `project_id: string`, but design them so adding the array variant later is non-breaking.
5. **Cost discipline is first-class.** Free product = no revenue offset. Cheap model for routing, strong model for synthesis. Cap iterations at 6 per chat message. Trim tool result payloads.
6. **Secrets never in plaintext.** Not in code, not in the database, not in logs. Connection strings live in Cloudflare's encrypted bindings (Hyperdrive config) and the developer's password manager — nowhere else.

---

## Current build status

Use the **Build Plan** doc (BUILD_PLAN.md) for the ordered task list. Nine blocks, in strict order:

1. Block 1 — Database setup (Neon, pgvector, Hyperdrive, schema) ← **✅ DONE**
2. **Block 2 — Project shell** (create projects, invite members, placeholder chat) ← **in progress: Sessions 1 and 2 of 4 done; Session 3 next**
3. Block 3 — Connector framework (interface + dummy connector)
4. Block 4 — Slack connector
5. Block 5 — First AI answer ← **milestone: product feels real here**
6. Block 6 — Jira connector
7. Block 7 — Monday connector
8. Block 8 — Google Drive connector
9. Block 9 — Polish for launch

### Block 1 detailed status (as of 2026-05-02)

**Task 1 — Neon Postgres provisioned: ✅ DONE**

- Neon project: `Elinno Agent`, free tier, AWS Frankfurt (`eu-central-1`) — matches D1 region
- Branch: `production` (id `br-autumn-scene-aln7pf8j`)
- Application database: `elinno_agent_db`, owned by role `neondb_owner`
- Postgres 17, pgvector extension v0.8.0 enabled and verified
- Database is clean (no junk tables)
- Direct (non-pooled) connection string saved in password manager — Hyperdrive is itself a pooler, so we use the direct endpoint
- Neon password was rotated mid-setup; current password is the rotated one

**Task 2 — Hyperdrive provisioned and bound: ✅ DONE**

- Hyperdrive config created in Cloudflare dashboard:
  - Name: `elinno-agent-hyperdrive`
  - ID: `78af00bbf464468cb902e35099aa0dfe`
  - Type: PostgreSQL, public connection, caching enabled (default TTL)
- Bound to the `elinno-agent` Pages project under variable name `HYPERDRIVE` (both Production and Preview environments)
- The existing D1 binding `DB` → `elinno-agent-db` is still in place from auth work
- `functions/api/db-health.js` ships through Hyperdrive to Neon. Verified end-to-end on production: `https://elinnoagent.com/api/db-health` returns the expected JSON with live Postgres 17 + Hyperdrive-shaped host (2026-05-02).
- `package.json` (postgres ^3.4.9) and `wrangler.toml` landed. `wrangler.toml` is now the **production source of truth** for the Pages project's bindings, vars, and compatibility settings — see "Production / repo facts" below for what that means in practice.

**Task 3 — Postgres schema designed and applied: ✅ DONE**

- Eight tables landed on Neon production branch (`elinno_agent_db`) on 2026-05-02. Verified: 8 tables present, `pgcrypto` 1.3 + `pgvector` 0.8.0 extensions active, HNSW index with `vector_cosine_ops` on `entity_embeddings`. Canonical SQL committed to `db/schema-postgres.sql` (merge commit `ce54a67`).
- Tables: `projects`, `project_members`, `connections`, `entities`, `entity_embeddings`, `sync_runs`, `conversations`, `messages`.
- Design decisions (documented inline in the schema header):
  - UUID v4 primary keys (`gen_random_uuid()` via `pgcrypto`)
  - 1536-dim embeddings, planning OpenAI `text-embedding-3-small`
  - HNSW with cosine distance (`vector_cosine_ops`, m=16, ef_construction=64)
  - Hybrid soft-delete: top-level records (projects, connections, conversations, messages) soft-deleted; derived data (project_members, entities, entity_embeddings, sync_runs) hard-deleted on FK cascade
  - Envelope encryption for connector credentials: 3 cols (`wrapped_data_key`, `iv`, `ciphertext_credentials`) plus `encryption_algorithm`
- Cross-DB seam: users live in D1 (auth), referenced from Postgres as `TEXT` with no FK enforcement — application code verifies user existence in D1 before inserting user-referencing rows in Neon.

**Task 4 — Test insert/read endpoint: ✅ DONE**

- Endpoint: `functions/api/db-test.js` (commit `8d28b60`, merged via `cdb9636`).
- `GET /api/db-test` inserts a row into `projects` and returns it via `RETURNING *` (single round-trip, atomic).
- Verified end-to-end on preview AND production: `ok: true`, fresh UUID per hit, ISO `created_at`/`updated_at`, Hyperdrive-shaped host, real Neon Postgres 17.8 response.
- Test rows accumulate under `owner_user_id = 'block-1-task-4-test-user'`; cleanup SQL is documented in the file's top comment (soft-delete with `UPDATE projects SET deleted_at = NOW() WHERE owner_user_id = '...'`).

**Where the project is right now:** Block 1 is fully closed. Data layer foundation is deployed end-to-end (Cloudflare Pages Functions → Hyperdrive → Neon Postgres + pgvector), with two live verification endpoints (`/api/db-health` and `/api/db-test`). Auth is intact. Ready to start Block 2 — Project shell (create projects, invite members, placeholder chat UI).

### Block 2 detailed status (as of 2026-05-03)

**Session 1 — Schema check + Projects API foundation: ✅ DONE**

- **Sub-task 2.0 (schema check):** collapsed to verification only — no migrations needed. `users.is_admin` (D1) and `conversations.title` (Postgres) were already shaped correctly by the Block 1 schema design.
- **Sub-task 2.1 (projects API):** three endpoints under `functions/api/projects/`:
  - `POST /api/projects` — workspace-admin only; atomic project + creator-as-admin transaction.
  - `GET /api/projects` — lists projects the session user is a member of (sorted `updated_at DESC, id DESC`).
  - `GET /api/projects/:id` — project-member access; whitelisted columns (no `deleted_at` leak).
- **Sub-task 2.2 (project members API):** three endpoints under `functions/api/projects/[id]/members/`:
  - `POST /api/projects/:id/members` — project-admin invites existing D1 user (existing-users-only per design decision D).
  - `GET /api/projects/:id/members` — project-member access; cross-DB email lookup (Postgres SELECT → bulk D1 IN-clause).
  - `DELETE /api/projects/:id/members/:userId` — project-admin only; creator-protected (SELECT-owner pre-flight before DELETE).
- **Two auth helpers added** to `functions/_lib/auth.js`:
  - `requireWorkspaceAdmin` — D1-side; gates workspace-admin operations (project creation today, eventual `admin/*` migration).
  - `requireProjectRole` — Postgres-side; gates per-project access. UUID validation, JOIN to `project_members`, role hierarchy (admin ≥ member), defensive `deleted_at IS NULL` filter, 403-collapse on every failure mode (PRD §10 cross-project enumeration prevention).
- **Build plan committed** to `BLOCK_2_PLAN.md` — locked design decisions A–M, sub-task breakdown, four-session work order, schema prerequisites.
- **Production verification:** 16-scenario curl matrix on the preview deploy (`https://3b2336e2.elinno-agent.pages.dev`), 16/16 PASS. Three orthogonal-property pairs hold:
  - State-preservation on failed mutation (scenarios 6 → 5b: byte-identical millisecond timestamps confirm no half-success on a rejected DELETE).
  - State-commitment on successful mutation (scenarios 7 → 8: fresh timestamps + no PK collision confirm the DELETE committed).
  - 403-collapse equivalence class (scenarios 4 → 13 → 15: byte-identical 21-byte `{"error":"Forbidden"}` from three structurally-distinct authorization failures).
  See PR #2 description for the full matrix and per-scenario assertions.
- **PR #2 merged** via fast-forward (`01b7d01..0f5204c`); 9 commit SHAs preserved intact on `main`.

**Session 2 — Projects list + create UI: ✅ DONE**

- **Sub-task 2.3 (projects list + create UI):** four UI files shipped under `public/`:
  - `projects.html` — list view with four states (loading skeleton grid, empty-admin, empty-non-admin, populated) + error overlay. Consumes `GET /api/projects`. `.state-card` primitive with icons (folder / two-person / alert triangle) for visual anchoring; XSS-safe rendering via `textContent` / `escapeHtml` / `encodeURIComponent`.
  - `projects/new.html` — create form with three states (loading skeleton, form, unauthorized). Consumes `POST /api/projects`. Two-tier error model per decision N. Submit-button state machine per decision Q.
  - `dashboard.html` + `admin.html` — top-nav Projects link wired (diff #4, strict scope).
  - `projects.html` + `projects/new.html` — Dashboard / Projects sibling links wired for nav consistency (diff #4.5). Page omits its own self-link.
- **CSS additions** to `public/auth.css`: net-new selectors only — `.section-head-row`, `.projects-grid`, `.project-card`, `.state-card` primitive (with `.state-card-icon`), skeleton shapes with shimmer animation, `.form-narrow`, `.form-actions`, `.field-hint`, single `@media (max-width: 700px)` mobile floor (decision R). No existing tokens or rules modified.
- **What Session 3 inherits as locked patterns** (apply directly to `project.html` + the chat / members / connections tab states):
  - **Decision N** — two-tier error model: UI translates terse auth strings (`"Not authenticated"`, `"Forbidden"`, `"Internal error"`); validation strings render verbatim in `.form-msg.error`. 401 → redirect to `/login.html?next=...`; 403 on POST → flip page to unauthorized state; 500 / network / malformed JSON → `"Something went wrong. Please try again."`
  - **Decision P** — four-state page model + error overlay, no timeout fallback. Explicit try/catch around `fetch()` with explicit error rendering.
  - **Decision Q** — client-light validation, server-truth, panel-only errors. Submit button disabled while required field empty after trim; in-flight button copy (`"Creating…"` / `"Sending…"`); form values stay populated on every failure path.
- **Nav convention** (apply when Session 3 adds `project.html`): within `.app-nav-actions`, order is `navUser → static sibling links → conditional links → logout`. Static siblings are **hierarchically ordered** (Dashboard first as canonical home, others by feature-importance — never alphabetical). Page omits its own self-link. Static sibling links use plain `<a>`, no class.
- **Verification:** manual browser smoke test on the `session-2-projects-ui.elinno-agent.pages.dev` preview deploy, all paths PASS (admin populated / empty / error overlay; non-admin empty; mobile at 375px and 700px; nav matrix across the four pages).
- **Branch:** `session-2-projects-ui`, 6 code commits + 1 docs closeout commit ahead of pre-session `main` (`df5e33b`); fast-forward merge to `main` at session closeout.

**Session 3 — Conversations + messages API + chat UI: next**

- Biggest session, most overrun risk per the plan. Sub-tasks 2.4 + 2.5. See `BLOCK_2_PLAN.md` for the detailed sub-task breakdown.

**Session 4:** members tab UI + optional invite-notification email (Sub-task 2.6).

**Current state:** Block 2 Sessions 1 and 2 are shipped to production via `main`. Six API endpoints live behind two centralized auth helpers (`requireWorkspaceAdmin` + `requireProjectRole`); the projects list + create UI consumes the project APIs end-to-end. Chat / members / connections tabs are Session 3+ work.

When you (Claude in a new session) are joining mid-build, the developer will tell you which task within which block they're on. If they don't, ask. Don't assume.

---

## How the developer wants to work with you

These rules came out of how the project has been run so far. They matter:

- **Plan in chat, build in Cursor.** Use Claude chat sessions like this one for design/schema/tradeoff decisions. Use Cursor for actual code changes once the approach is settled.
- **One scoped change per Cursor session.** "Add the Slack OAuth callback" works. "Build the connector layer" doesn't.
- **Always show diffs before commits.** The developer is hands-on. Read every diff before accepting AI changes.
- **Cursor handles git commands** (`add`, `commit`, `push`, branch operations) on the developer's behalf.
- **Sync local `main` before branching.** Run `git fetch && git merge --ff-only origin/main` before creating any feature branch. Caught twice this block (Session 1 close → Session 2 open) — local `main` drifted behind origin both times, forcing a corrective rebase that wasted review cycles. Make it a habit.
- **Developer reviews diffs and commit messages before authorization** — Cursor proposes, developer approves, Cursor executes.
- **Pushes to `main` still require explicit per-push approval.** No standing autonomous push to `main`.
- **Cursor never amends or force-pushes** without explicit per-action approval.
- **End every session in a runnable state.** Never leave the trunk mid-refactor.
- **Update PROJECT.md or write a STATUS.md after each session.** This is how future-you (and future Claude) get oriented.

> **Note:** as of 2026-05-02 (Block 1 Task 2), git operations are delegated to Cursor. Earlier sessions had the developer run git commands directly; the workflow shifted because of friction with editor-driven git tools (vim, hunk-by-hunk staging) eating into project velocity. The diff-review safety net stays — every commit message and diff goes through human approval before Cursor executes.

### What to use Claude for

- Boilerplate (schema migrations, OAuth callbacks, retry logic, rate limiters)
- Translating an API doc into a working client
- Drafting tool JSON schemas and system prompts
- Writing recorded-fixture tests
- Code review: "what could go wrong here?"

### What NOT to delegate to Claude

- Final security review of credential handling
- Schema decisions and irreversible migrations
- Production deploys and database operations
- Cost-affecting choices (which model, how many iterations)

---

## Reference docs in this project


| File                       | What's in it                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PROJECT.md**             | Stack, repo layout, conventions. Read first.                                                                                                        |
| **PRD.md**                 | Product requirements: what's being built and why. Roles, requirements, pricing, risks, post-v1.1 backlog.                                           |
| **BUILD_PLAN.md**          | Ordered task list (this is your roadmap). Nine blocks in strict order.                                                                              |
| **DESIGN.md**              | Visual style guide.                                                                                                                                 |
| **db/schema-d1.sql**       | D1 auth schema (canonical) — users, sessions, password_resets. Already applied to Cloudflare D1.                                                    |
| **db/schema-postgres.sql** | Neon Postgres schema (canonical) — 8 tables for connector data and embeddings. Applied to Neon production branch as of Block 1 Task 3 (2026-05-02). |
| **README.md**              | Minimal deploy notes.                                                                                                                               |
| **HANDOFF.md**             | This file. Project handoff for new sessions.                                                                                                        |


If any doc contradicts another, **the PRD is the source of truth for what to build, the Build Plan is the source of truth for the order, and the latest status notes are the source of truth for what's actually done.**

---

## Production / repo facts

- **Production URL:** [https://elinnoagent.com](https://elinnoagent.com) (also [www.elinnoagent.com](http://www.elinnoagent.com))
- **Production health endpoint:** [https://elinnoagent.com/api/db-health](https://elinnoagent.com/api/db-health) — verified working as of 2026-05-02. Returns `{ ok: true, one: 1, now, postgres_version, hyperdrive_host }`, proving the Pages Function → Hyperdrive → Neon path is live.
- **Production schema verification endpoint:** [https://elinnoagent.com/api/db-test](https://elinnoagent.com/api/db-test) — verified working as of 2026-05-02. Inserts a row into `projects` and returns it via `RETURNING *`, proving the full schema works end-to-end (not just the connection). Test rows accumulate under `owner_user_id = 'block-1-task-4-test-user'`; cleanup SQL is documented in the top comment of `functions/api/db-test.js`.
- **Cloudflare Pages project:** `elinno-agent`
- **Cloudflare Account ID:** `da2174836d9863b4f2fcafeba4dbff3c`
- **GitHub repo:** [https://github.com/Jenny-Joni/elinno-agent](https://github.com/Jenny-Joni/elinno-agent)
- **D1 database:** `elinno-agent-db` (region EEUR / Frankfurt), bound as `env.DB`
- **Neon project:** `Elinno Agent` (AWS Frankfurt / eu-central-1)
- **Neon database:** `elinno_agent_db`, role `neondb_owner`
- **Hyperdrive config:** `elinno-agent-hyperdrive` (id `78af00bbf464468cb902e35099aa0dfe`), bound as `env.HYPERDRIVE`
- **Default branch:** `main` (production deploy on push)
- **Build command:** `npm install` (set in Cloudflare dashboard for both Production and Preview, applied since `package.json` landed in Block 1 Task 2).

**Configuration source of truth:** as of Block 1 Task 2 (commit `9fa5376`), `wrangler.toml` at repo root is the **production source of truth** for the Pages project's bindings, vars, and compatibility settings. Previously these lived in the dashboard; now the dashboard's UI for these fields is read-only and the file is authoritative for every deploy (Production AND Preview). The switch was forced by a real Cloudflare friction point — see "Open follow-ups" below.

**Bindings + vars in `wrangler.toml`** (authoritative; deploys read these):

- `DB` (D1 binding → `elinno-agent-db`)
- `HYPERDRIVE` (Hyperdrive binding → `elinno-agent-hyperdrive` → Neon)
- `MAIL_FROM` = `Elinno Agent <noreply@elinnoagent.com>`
- `SITE_URL` = `https://elinnoagent.com`
- `compatibility_date` = `2026-04-21`, `compatibility_flags` = `["nodejs_compat"]`

**Secrets in the Cloudflare dashboard** (NOT in `wrangler.toml`; managed separately, survive the dashboard→file switch):

- `RESEND_API_KEY` (used by the password-reset email flow)

When Block 5 starts there will also be:

- An `ANTHROPIC_API_KEY` secret (Cloudflare dashboard)
- A Cloudflare Queues binding (declared in `wrangler.toml`)

---

## Open follow-ups carried over from previous work

These are tracked but not blocking. Pick up when adjacent:

- Fix `scripts/seed-admin.mjs` — its printed `--command="..."` line is shell-broken (`$310000` and `$<varname>` get expanded by zsh and corrupt the hash). Always use the SQL-file path: copy printed SQL into a file, run `npx wrangler d1 execute elinno-agent-db --remote --file=./your-file.sql`.
- Document the 100k PBKDF2 cap in PRD.md (rationale + alternatives like Argon2id-via-WASM). The Build Plan already has this as a Phase 0 deliverable.
- Document in PRD §5.4 that "KMS-backed" envelope encryption in our case is app-level encryption with the master key in Cloudflare Workers Secrets — Cloudflare has no managed KMS.
- Optional: clean up two diag commits (`2e9d80f` + `80311b0`) from history via interactive rebase. Cosmetic.
- Optional: delete local `cursor/fix-pbkdf2-iter-cap` branch. Cosmetic.
- **Cloudflare Pages dashboard quirk (worth knowing before next compat-config change).** The project's "Compatibility flags" panel in the dashboard only exposes a Production-environment field; there is no Preview-side equivalent in the UI. Setting `nodejs_compat` for Production alone does NOT propagate to Preview deploys — we hit this in Block 1 Task 2 (commit `0d553d5`'s preview build failed at runtime with `Uncaught Error: No such module "node:events"`) and resolved it by switching `wrangler.toml` to source-of-truth mode (commit `9fa5376`). Now that `wrangler.toml` is authoritative, all future compat-flag changes go in the file, not the dashboard. If you ever roll back to dashboard-only config, re-verify whether the Preview-side UI gap has been fixed before relying on it.
- **Migrate `admin/users.js` and `admin/users/[id].js` to use `requireWorkspaceAdmin`.** The helper was added in Block 2 Session 1 (`functions/_lib/auth.js`); the existing handlers still inline the same "session valid + `is_admin = 1`" check that the helper centralizes (`admin/users.js` has a private `requireAdmin`; `admin/users/[id].js` inlines the two-line check directly). Behavior-identical refactor; deliberately deferred to keep Session 1 commits scoped to one thing each. Good "between blocks" task — land it on its own branch when the trunk is green. While there, also fix `admin/users.js`'s POST returning 200 instead of 201 Created for the user-create case, mirroring `POST /api/projects`.
- **Cross-DB orphan rows in `project_members`.** When an admin deletes a D1 user via `admin/users/[id].js` DELETE, the cascade only covers D1 (sessions, password_resets) — Postgres `project_members` rows for that user are left orphaned (no FK across engines). v1.1 doesn't trigger this in normal use (we don't routinely delete users) but the schema permits it. Two-part fix:
  1. **Data:** update `admin/users/[id].js` DELETE to also remove Postgres `project_members` rows for the deleted user. Folds naturally into the `requireWorkspaceAdmin` migration above — same file, same review.
  2. **UI (Block 2 Sub-task 2.6 / Session 4):** the members list (`GET /api/projects/:id/members`) returns orphan rows with `email: null` rather than filtering them. Render those in the members tab as "(deleted user)" or similar so admins can see and clean them up.
- **SQLSTATE consistency datapoint.** Both `POST /api/projects/:id/members` (Block 2 PR #2, verification scenario 9) and `POST /api/admin/users` (legacy, surfaced incidentally during Bob-create in the same verification pass) return 409 + a specific message on PG error code `'23505'`. The two endpoints share the same `err.code === '23505'` detection contract, which strengthens the case that the deferred `requireWorkspaceAdmin` migration of `admin/*` above is a behavior-identical refactor.
- **Cross-DB orphan present in production data.** P1 (UUID `f0362121-c703-4459-b9de-456582141727`) in Postgres has a `project_members` row whose `user_id` (`"4"`) no longer matches any D1 user — Alice (`alice@example.com`) was deleted from D1 during scenario 16 of the Block 2 verification matrix. Decision N2's runtime behavior — orphan rows surface with `email: null` rather than being silently filtered — is verified end-to-end. The orphan is deliberately preserved as live documentation of the cross-DB cleanup TODO above until the broader fix lands.
- **Soft-deleted test projects in production.** P1 (`f0362121-c703-4459-b9de-456582141727`) and P2 (`79ba1898-cf7b-4af2-bc46-50579e29137a`) are tombstoned on Neon (`deleted_at = 2026-05-02 21:50:16.519669+00`, single UPDATE during the Block 2 verification cleanup). Invisible to the API thanks to `requireProjectRole`'s `deleted_at IS NULL` filter, but the rows are still on disk. If they ever become noisy in a query, a hard `DELETE FROM projects WHERE deleted_at < ...` cleanup is straightforward.
- **IDE markdown-formatter policy: FULLY RESOLVED 2026-05-03 (Session 3 pre-flight).** Five format-on-focus occurrences across Block 2 (BLOCK_2_PLAN.md, DESIGN.md, SETUP.md during Sessions 1+2 — each caught and reverted pre-merge; HANDOFF.md asterisk-corruption during Session 3 pre-flight — caught dirty in working tree during pre-flight `git diff` review, never committed; BLOCK_2_PLAN.md table-padding-and-list-spacing reformat during Session 3 pre-flight while drafting this amendment — caught via `git status` between staging and verification, reverted, never committed). The fifth occurrence is the strongest evidence that workspace-scope persistence was needed: the formatter fired on a backgrounded file while the IDE owner was focused on a different file, demonstrating that user intent and IDE behavior are decoupled and the policy must be a configuration file, not a UI preference. Chose Option 2: disable all format-on-* channels for `.md`. The Session-2-closeout attempt (commit `009ead2`) toggled the setting through the Cursor Settings UI at user-scope, but pre-Session-3 read-only inspection found `~/Library/Application Support/Cursor/User/settings.json` did not exist at all — the toggle never persisted on this Glass build of Cursor (suspected: the Settings UI doesn't write the file when no other settings are customized, leaving defaults virtual). Actual fix landed in `.vscode/settings.json` workspace-scope, in the same docs PR as this amendment. Disables `editor.formatOnSave`, `formatOnPaste`, `formatOnType`, and clears `editor.defaultFormatter` for `[markdown]`. Workspace-scope chosen over user-scope so the policy ships with the repo: travels to fresh clones, fresh worktrees, and fresh Cursor sessions opening this folder, and is reviewable in PR diffs.

  **If the formatter fires again on `.md`:**

  1. Confirm `.vscode/settings.json` still exists and still contains the four-key `[markdown]` block.
  2. Check for a competing user-scope `~/Library/Application Support/Cursor/User/settings.json` that may override workspace-scope. Workspace-scope normally wins per VS Code precedence, but a pinned `defaultFormatter` at user-scope can still be invoked.
  3. Confirm Cursor variant hasn't switched (Glass / Classic) — the fix-channel may differ.
  4. Check whether a newly-installed editor extension (markdownlint, Prettier, etc.) has registered itself as the markdown formatter — a fresh registration can re-introduce a fire path the four-key block doesn't anticipate.

  **Lesson for future settings work on this project:** prefer `.vscode/settings.json` workspace-scope for any IDE policy that needs to be reliable. The Cursor Settings UI's user-scope writes appear to fail silently on this Glass build; workspace-scope writes are reviewable, persistable, and ship with the repo.

---

## Things explicitly out of scope for v1.1

So you don't accidentally build them:

- Cross-project AI mode (planned for v1.2 — see PRD §11.1)
- Writing back to source systems (creating Jira tickets, posting Slack messages). Read-only in v1.1.
- Mobile native apps. Web only.
- Per-user permission mirroring from source systems. The bot operates with admin-level access in each connected system.
- Audit log for admin actions. Deferred.
- Rate limiting / lockout / 2FA on the auth system itself. Deferred.
- Drive: images and OCR. Docs/Sheets/PDFs only.
- Paid tiers. Free in v1.1.

---

## Suggested first prompt for a new Claude session

Copy-paste this into a fresh chat:

> I'm continuing work on Elinno Agent. Please read the attached HANDOFF.md, PRD.md, and BUILD_PLAN.md. Then tell me what you understand about the project and what block of the Build Plan we're on. After that, I'd like to work on [task].

Or in Cursor:

> Read HANDOFF.md, PROJECT.md, and BUILD_PLAN.md. We're on Block [N] of the Build Plan, Task [M]. Help me with [specific task] following the design principles in the handoff.

---

## How to keep this handoff useful

After each working session, update at least:

- The "Last updated" date at the top
- The "Current build status" section if a block was completed or progress was made
- Any new env vars, services, or external accounts added
- New "open follow-ups" if you found something but didn't fix it

If a session changes a major decision, update the relevant section *and* mention the change in the next git commit. Stale handoffs are worse than no handoff because they look authoritative while being wrong.

---

*Generated 2026-05-02. Designed to be uploaded to a fresh Claude session as the first context.*
## Session 3 mid-state — 2026-05-03 evening (sub-task 2.4 partial)

> Append to HANDOFF after the Block 2 detailed status section (around line
> 211, just before "How the developer wants to work with you"). Or merge
> manually into the Block 2 status if you want it inline; this is a
> standalone block on purpose so it's easy to read without rearranging.

### Where the branch is right now

`origin/session-3-conversations-and-chat` is **8 commits ahead of main**:

```
0b793c3 fix(block-2): mark conv-guard + messages SELECTs uncacheable for read-after-write
9ef44f6 fix(block-2): replace count-based decision-H trigger with title-state check
25a005c fix(block-2): add project_id to messages INSERTs (denormalized NOT NULL column)
dee6ec1 feat(block-2): add messages API (GET/POST) with auto-title + echo
8080684 feat(block-2): add conversations API (POST/GET) under projects/:id
5186838 docs(block-2): lock Session 3 design decisions V–AC
85a07d6 chore(docs): document working agreement
362abbf chore(repo): expand workspace-scope formatter policy with files.* keys
```

**NOT merged to main.** Production is on `5a789c2` and unchanged.

### What works

- **Schema fix (`25a005c`)** is genuine and verified. The `messages` table has a NOT NULL `project_id` uuid column with no default; the original INSERTs in `dee6ec1` omitted it, every POST /messages threw and 500-d. Both INSERTs in `messages.js` now populate `project_id` from `params.id`. POST /messages returns 200 with the right shape.
- **Decision I (echo format)** verified — `You said: "${content}" — Real AI coming in Block 5.` with em-dash U+2014, byte-exact.
- **Decision X (title in response)** verified — POST /messages always returns `conversation: { id, title }`.
- **All security/scoping scenarios pass:**
  - Decision AC per-user scoping on GET conversations (bob can't see Jenny's).
  - Decision AC per-user scoping on POST messages (bob can't post to Jenny's conversation).
  - Cross-project leakage prevention (bob can't access P2 conversations).
  - Conversation-belongs-to-project guard (Jenny can't access $C1 under P2's URL even as P2 admin).
  - 401 on no session, 400 on empty/oversize content, 403-collapse on all auth failures.
- **Decision AB LEFT JOIN preservation** verified via the empty-conversation proxy (`message_count: 0` when no messages exist; LEFT JOIN keeps the row).

### What's broken

- **Decision H (auto-title fires only on first user message) is broken.** Auto-title fires on EVERY user message, not just the first. Reproduced deterministically with two consecutive POST /messages calls to a fresh conversation: the second response shows `title` matching the second message's content, not preserving the first.

### What we tried (and why it didn't work)

Three diagnoses, three commits on the branch, none fixed H:

1. **`9ef44f6` — count→title-state refactor.** Original implementation in `dee6ec1` used `SELECT COUNT(*) FROM messages WHERE role='user' AND ...` to decide if first message. Suspected Hyperdrive cache was returning stale 0. Replaced with `if (conv.title === 'New conversation')` — read title from the conv-guard SELECT we already have.

2. **`0b793c3` — Hyperdrive cache-bypass markers.** When `9ef44f6` didn't fix H, realized the conv-guard SELECT itself is also being cached — it returns a stale title (`'New conversation'`) on the second send. Added `-- bypass Hyperdrive cache: NOW()` comment markers on three SELECTs (per [Cloudflare's documented workaround](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/) — text-pattern detection of STABLE function names marks queries uncacheable).

The third try also didn't fix H. The deployed file has the markers (verified by Cursor's diff review and post-push integrity check), the new preview built clean (`/api/db-health` returns 200 from the post-push deploy at `https://29715ffb.elinno-agent.pages.dev`), but the 2-curl test still shows `title` changing on the second send.

### Tomorrow's first move

**Don't write more code first. Diagnose whether the cache marker actually took effect.**

```bash
# Same setup as the broken 2-curl test, but with a tail running.
# Terminal A:
npx wrangler pages deployment tail [LATEST_DEPLOY_ID_HERE] --project-name=elinno-agent

# Terminal B (after Terminal A says "Connected to deployment..."):
BASE="[LATEST_PREVIEW_URL]"
COOKIE_J=$(mktemp)
# log in as Jenny (env var JENNY_PASSWORD set)
curl -sS -c "$COOKIE_J" -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"jenny@elinnovation.net\",\"password\":\"$JENNY_PASSWORD\"}" -o /dev/null
# Use a fresh project, fresh conversation
P1="f0f563f9-8f88-4f60-b645-7540fb911a1c"
CONV=$(curl -sS -X POST "$BASE/api/projects/$P1/conversations" -b "$COOKIE_J" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['conversation']['id'])")
echo "CONV=$CONV"
# First send — should set title
curl -sS -X POST "$BASE/api/projects/$P1/conversations/$CONV/messages" \
  -H "Content-Type: application/json" \
  -d '{"content":"FIRST"}' -b "$COOKIE_J" | python3 -m json.tool
# wait 3 seconds (Hyperdrive cache window)
sleep 3
# Second send — title should NOT change
curl -sS -X POST "$BASE/api/projects/$P1/conversations/$CONV/messages" \
  -H "Content-Type: application/json" \
  -d '{"content":"SECOND"}' -b "$COOKIE_J" | python3 -m json.tool
rm "$COOKIE_J"
```

The Cloudflare tail should show two POST /messages requests. If it shows
exception logs for either, the failure mode is different than we think.
If both show clean `Ok` responses (which is what the prior tail showed),
then we know the 500 catch-block isn't masking anything and the cache
hypothesis was wrong from the start.

**Branching from there:**

- **If H breaks even WITH a 3-second sleep between sends** — Hyperdrive cache isn't the problem. The bug is in the application code somewhere. Re-read `messages.js` carefully without the cache hypothesis — maybe the conv-guard SELECT result isn't being used correctly, or the UPDATE isn't actually persisting the title (try a direct Neon query to see what the row looks like after each send).
- **If H works correctly with a 3-second sleep** — Hyperdrive cache IS the issue but our marker syntax isn't right. Try alternatives: `-- @cache=off`, an actual `NOW()` reference in the WHERE clause (`AND ${sql`NOW()`} IS NOT NULL` as a no-op), a different STABLE function. Read the docs more carefully.
- **If H works correctly even WITHOUT the sleep** — turn out the cache marker DID work, and tonight's repro was a transient. Unlikely given how reproducible the bug was, but worth ruling out.

### Untracked files in working tree

- `block-2-mockups-v2.html` — Session 3 mockup, deferred to closeout commit per Session 3 plan. Do not commit yet.
- `curl-matrix-2-4.md` — the verification matrix doc Cursor added to repo root. Decide at closeout: leave at root or move to `docs/verification/`. Not tracked.
- `verify-2-4-v2.sh` — the throwaway script from tonight's verification. Delete or leave as-is; not for commit. Has no inline credentials (env-var-based).

### WORKFLOW.md drift

Twice during tonight's session, `git status` showed `WORKFLOW.md` modified
with only a trailing-newline change. Cause unclear — possibly the Cursor
IDE auto-saving the file without changes, possibly an editor setting that
strips final newlines on save. Resolved both times with `git checkout
WORKFLOW.md`. Doesn't block work but worth investigating: check
`.vscode/settings.json` for `files.insertFinalNewline: false` or similar.

### Cursor co-author trailer

Both fix commits (`25a005c`, `9ef44f6`, `0b793c3`) have a
`Co-authored-by: Cursor <cursoragent@cursor.com>` trailer auto-appended
by Cursor's IDE. Not malicious; just attribution. Decide at next
between-sittings: keep, or disable via the relevant Cursor IDE setting
or git hook.

### Cross-DB orphan reminder + test data still in Neon

Tonight's two failed-then-fixed-then-still-broken matrix runs created
and deleted two `bob` users in D1 (user_id 6 from the first run, user_id
7 from the second). Both leave orphaned `project_members` rows in
Neon — same cross-DB orphan pattern HANDOFF already documents. Plus
**four test projects** still soft-undeleted in Neon from tonight:

```sql
-- From the first matrix run:
-- (also from the previous Block 2 verification, already documented)
SELECT id, name, deleted_at FROM projects
WHERE name LIKE 'matrix-test-project-%'
  AND deleted_at IS NULL;
```

Soft-delete when convenient via:

```sql
UPDATE projects SET deleted_at = NOW()
WHERE name LIKE 'matrix-test-project-%'
  AND deleted_at IS NULL;
```

### Hyperdrive caching as a cross-cutting concern

Even if tomorrow's H fix turns out to be unrelated to caching, **it is
still likely that other read-after-write code paths in the codebase have
the same hazard.** Add to follow-ups: audit every endpoint that does
INSERT/UPDATE followed by SELECT on the same data, mark cacheable reads
explicitly, or consider disabling Hyperdrive caching globally (via
`wrangler hyperdrive update --caching-disabled true`) for v1.1 simplicity.

The current `0b793c3` commit's HYPERDRIVE CACHE NOTE in `messages.js`
header is a starting point — read it for the context. Suspect endpoints
to audit:
- `POST /api/projects` (then GET /api/projects from same user)
- `POST /api/projects/:id/members` (then GET /api/projects/:id/members)
- `POST /api/projects/:id/conversations` (then GET /api/projects/:id/conversations)
- Any future endpoint that mutates and reads in the same request

### Lessons from tonight (for future sittings)

- **The matrix worked.** It caught the schema bug (which was the most
  serious of the three issues) and the H bug (which would have shipped
  silently otherwise). Continue the trimmed-matrix discipline.
- **Cursor's role-as-executor pattern works well.** All three commits
  flowed cleanly through propose → approve → commit → approve → push.
  No security regressions. Spot-check discipline held.
- **Hyperdrive caching is a foot-gun.** Default-on caching with
  unreliable invalidation on writes is dangerous for any app with
  read-after-write semantics. Worth a real architectural decision
  before Block 5 (chat will multiply read-after-write volume).
- **Three failed diagnoses in one sitting is the signal to stop.** This
  HANDOFF amendment exists because we should have stopped two commits
  earlier, after `9ef44f6` didn't fix H. Future-Claude: heed
  WORKFLOW.md's stopping rules more aggressively when 2+ diagnoses
  miss in succession.

---

## Session 3 closeout addendum — 2026-05-03 night (Decision H fixed)

> Appended after the prior "Session 3 mid-state" amendment. The mid-
> state stands as the historical record of the failed-diagnoses
> sequence; this addendum captures the resolution. Switched tooling
> mid-session from Cursor + Claude.ai chat to Claude Code (Desktop) —
> WORKFLOW.md's role-split language is the old shape; agreement
> substance (Jenny gates every commit and every push, security
> carve-outs, stop-after-three-misses) is unchanged.

### What changed

- **Hyperdrive query caching disabled at the binding level.** Ran:
  ```
  npx wrangler hyperdrive update 78af00bbf464468cb902e35099aa0dfe \
                                 --caching-disabled true
  ```
  Effect immediate on production (no redeploy). Verified via
  `wrangler hyperdrive get` showing `"caching": {"disabled": true}`.
  This is an **architectural decision for v1.1**: cache off everywhere,
  every read round-trips to Neon Frankfurt (~10–50ms), no per-endpoint
  uncacheable-marker discipline required. Revisit before Block 5 when
  AI tool calls multiply read-after-write volume.
- **Decision H verified fixed.** Fresh-conversation diagnostic with
  ALPHA + BETA sends and no sleep: ALPHA → `title: "ALPHA"`,
  BETA → `title: "ALPHA"` (preserved). Title-state check now fires
  exactly once per conversation, as the decision specifies.
- **Code cleanup in `messages.js`.** Three dead
  `-- bypass Hyperdrive cache: NOW()` SQL-comment markers removed (one
  in onRequestGet's conv guard, one in onRequestGet's messages list,
  one in onRequestPost's conv guard); the HYPERDRIVE CACHE NOTE in the
  file header rewritten to document the cache-off state plus a warning
  for future cache-re-enable work.

### The lesson

The `0b793c3` markers were ineffective because Hyperdrive's text-pattern
detector for STABLE function names appears not to match function
references inside SQL comments. The Cloudflare docs read as if comment-
form would work; in practice it doesn't. If a future block re-enables
caching for hot-path latency, use a *real* `NOW()` reference inside the
WHERE clause (e.g. `AND NOW() IS NOT NULL`) on every read-after-write
SELECT, not a comment marker. The HYPERDRIVE CACHING NOTE in
`messages.js`'s file header captures this so the next person doesn't
repeat the mistake.

### Anomalies observed (one, didn't repro)

- **One 500 during the cache-disable diagnostic.** A "THIRD send" against
  the conv `40a4c213-…` (which had been written to twice already during
  the FIRST/SECOND repro) returned `{"error": "Internal error"}` after
  the 65-second sleep, with no tail running and no detail captured. The
  catch block in `messages.js` swallows the underlying exception (`_err`
  unused). Did NOT repro on the next test (fresh conv, ALPHA + BETA,
  both 200). Possible causes: transient Hyperdrive blip during the
  config flip, or a state-dependent issue on a multiply-mutated conv.
  Not blocking; track if it recurs. Worth a thought: changing the catch
  block to `console.error(err)` (without exposing detail in the
  response) so future 500s leave a tail-readable trace. Bucketed as a
  follow-up rather than this commit's scope.

### Sub-task 2.4 status

API is now correct end-to-end:
- Schema bug (`25a005c`) — fixed and verified.
- Decision I echo, X title-in-response, AC per-user scoping, conv-
  belongs-to-project guard, AB LEFT JOIN preservation — verified during
  the prior matrix attempts (see prior mid-state amendment "What works"
  list).
- Decision H — fixed via cache-disable, verified post-cleanup.

Closeout commit candidate: this HANDOFF addendum + the messages.js
cleanup. After commit, sub-task 2.4 is done. Sub-task 2.5 (chat UI on
`project.html`, decisions V–AC) is the next standalone unit;
sub-task 2.6 (members tab) is Session 4.

### Stale cache-related comments to sweep (deferred)

Cache-disable made these slightly inaccurate; all are documentation,
none affect behavior. Pick up on a follow-up doc-consistency pass:

- `db-test.js:71` — "Cached by Hyperdrive after the first hit, so the
  marginal cost is tiny." Marginal cost is now the round-trip latency.
  Conclusion ("tiny") still holds in absolute terms; reword for
  precision.
- `projects/[id]/index.js:38` — "row likely cached by Hyperdrive from
  the helper's join." Now false; the SELECT round-trips every time.
  The defensive query is still cheap and still justified by the
  refactor-protection rationale; just update the cost claim.
- `db-health.js:15` — refers to **prepared-statement** caching, which
  is a separate Hyperdrive layer from query caching; probably still
  accurate. Verify on the same pass.

### Tooling switch — file-delivery convention is dead

Mid-session move from Cursor + Claude.ai chat (with `/mnt/user-data/
outputs/` → Downloads → Cursor placement) to Claude Code (Desktop).
Claude now writes files directly to the repo and runs `git`/`wrangler`/
`curl` from in-terminal. WORKFLOW.md's "File delivery convention"
section and the "Cursor as executor" / "Claude does NOT run git
operations" lines are obsolete. Substance is unchanged: every commit
gated on diff review, every push gated on per-push approval, security
carve-outs flagged. WORKFLOW.md should get a session-close amendment
to reflect the new tool reality, but that's a separate doc-only commit
and can wait.

**Worktree note.** Claude Code Desktop creates a `.claude/worktrees/
<name>/` subtree per session that may be N commits behind the active
branch. For doc reads + file edits + git ops, prefer the parent repo
path (`/Users/jennyshane/elinno-agent/`) — Bash subshells reset cwd
between calls but the Edit/Write tools accept absolute paths fine, and
git ops can be `cd`-prefixed to the parent.

### Test data accumulating in Neon (cleanup deferred)

Tonight's diagnostic added several conversations to project P1
(`f0f563f9-…`):
- conv `40a4c213-…` (FIRST + SECOND, plus a failed THIRD)
- conv `f09aa12b-…` (ALPHA + BETA from the pre-fix diag)
- conv `5337c7ae-…` (ALPHA + BETA from the post-fix diag)

Plus the four `matrix-test-project-*` rows in Neon and two cross-DB
orphan `project_members` rows from the deleted bob users (already
documented in the prior mid-state). Combined cleanup is a between-
blocks task; soft-delete SQL is in the prior section.
