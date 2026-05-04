# Elinno Agent — Project Handoff

> Drop this into a fresh Claude Code session so the assistant can pick up where the last session left off. This file is the single source of truth for "where are we and what's next." Update it after each working session.

**Last updated:** 2026-05-04 (Block 3 closeout)
**Current product version:** v1.1 (the MVP being built now)
**Owner / sole developer:** Jenny ([jenny@elinnovation.net](mailto:jenny@elinnovation.net))
**AI tooling:** Claude Code (switched from Cursor + Claude.ai mid-Block-2-Session-3, 2026-05-03)

---

## TL;DR for a new Claude Code session

You are joining a project mid-build. Here's the shape of it:

- **Elinno Agent** is a multi-tenant project intelligence platform. An admin creates a project, connects external tools (Jira, Slack, Monday, Google Drive), and the platform syncs that data into a unified store. Members chat with an AI assistant scoped to a single project, asking questions like "how many tickets in this sprint?" or "how much did we spend on testing?"
- **The auth foundation is already deployed** at [https://elinnoagent.com](https://elinnoagent.com) (Cloudflare Pages + Pages Functions + D1).
- **Blocks 1, 2, and 3 are fully done.** Data layer foundation is wired end-to-end through Cloudflare Pages Functions → Hyperdrive → Neon Postgres. Block 2 closed 2026-05-04 — projects + members APIs, projects list + create UI, conversations + messages API, project.html three-tab shell with chat / members / connections tabs. Block 3 closed 2026-05-04 — connector framework (Connector interface, registry, dummy connector), envelope encryption helper (AES-256-GCM, master key in Workers Secret), connections + sync HTTP API, all verified via the 22-scenario curl matrix on the preview deploy and ff-merged to main. **Block 4 (Slack connector) is next** — first real connector, exercises the framework end-to-end with OAuth + webhooks.
- **Solo build with Claude Code.** No team. One task at a time.

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
2. Block 2 — Project shell (create projects, invite members, placeholder chat) ← **✅ DONE**
3. Block 3 — Connector framework (interface + dummy connector + connections HTTP API) ← **✅ DONE**
4. **Block 4 — Slack connector** ← next
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

The binding rules — three-phase rhythm (Plan → Approval → Execute), Phase 0 session-start ritual, hard limits enforced via `.claude/settings.json`, security carve-outs (run in default mode, not auto), scope-expansion handling, one-fix rule, iteration cap, rollback playbook — live in [WORKFLOW.md](WORKFLOW.md). Read it before suggesting changes. The 2026-05-04 revision restructures around Claude Code's plan→auto rhythm; the 2026-05-03 revision (tooling switch from Cursor + Claude.ai to Claude Code) is part of the same revision lineage.

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

### Cursor co-author trailer (resolved — moot)

Three Session-3 commits (`25a005c`, `9ef44f6`, `0b793c3`) carry a
`Co-authored-by: Cursor <cursoragent@cursor.com>` trailer auto-appended
by Cursor's IDE. Moot 2026-05-03 — the switch to Claude Code resolves
it (no auto-trailers per WORKFLOW.md). Existing trailers stay in the
merged commits as historical record; no rewrite of merged history.

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

---

## Block 2 closeout — 2026-05-04

> Appended at Block 2 completion. Sub-tasks 2.5 and 2.6 shipped this
> session, closing Block 2. The TL;DR + BUILD list at the top of this
> file are updated to reflect Block 3 as next; this addendum is the
> historical detail for anyone reading back through the trail.

### Sub-task 2.5 — project.html three-tab shell + chat UI (`923108e`)

`public/project.html` (731 lines, NEW) + `public/auth.css` (+471 lines)
on `session-4-project-html`, ff-merged to main. All locked decisions
V–AC implemented:

- **Decision V** — single `applyState({ conversationId, tab })` routing
  point. `history.replaceState` on every state change; never `pushState`,
  never reload. Sidebar click, tab click, auto-create, default-to-most-
  recent all flow through this function.
- **Decision W** — IME-safe composer. `keydown` bails on `e.isComposing
  || e.keyCode === 229` before checking Enter/Shift+Enter. Auto-resize
  via scrollHeight; CSS-clamped at 140px max-height. Avatar initial =
  `email[0].toUpperCase()` for user, hardcoded `EA` for assistant.
- **Decision X** — server response is canonical for conversation title.
  POST /messages always includes `conversation.title` in the response;
  client updates sidebar row + chat-conv-title heading directly from
  it, no refetch.
- **Decision Y** — Members and Connections placeholders use `.state-card`
  (Block 2 Session 2 primitive). The Members tab pill is added in
  sub-task 2.6 alongside the real members UI.
- **Decision Z** — every assistant message gets `.placeholder` class
  client-side (no `placeholder` column in the messages schema). Block 5
  removes the unconditional rule in the same diff that wires up real AI
  generation. Echo banner copy verbatim, non-dismissible.
- **Decision AA** — mobile drawer (≤700px) behind a hamburger. In-memory
  boolean state, never persisted, never in URL. Closes on hamburger,
  backdrop, conv-item, `+` (after creation), and Escape.
- **Decision AB** — sidebar two-line rows: ellipsized title + `Nh ago ·
  N message(s)` meta with ternary plural. `fmtRelativeShort` is a sibling
  to `projects.html`'s `fmtRelative`, dropping the "Updated " prefix.
- **Decision AC** — server enforces per-user conversation scoping
  (`user_id = $session_user_id` filter on every read and insert); client
  just renders what comes back. Verified scenarios 10/11/12 of the 2.4
  matrix.

### Sub-task 2.6 — members tab UI (`f0a3fe0`)

`public/project.html` (modified) + `public/auth.css` (+192 lines) on
`session-4-members-tab`, ff-merged to main. Replaces the placeholder
Members tab with a real invite + list + remove flow against the 2.2
members API:

- Admins see invite-by-email row + Remove buttons (creator's disabled).
- Non-admins see a read-only list (decision: `.read-only` modifier
  collapses the trailing Remove column for non-admin viewers).
- Members fetched eagerly in the boot pipeline so the tab count pill
  (decision Y, deferred from 2.5) renders from initial paint.
- Server error strings render verbatim via `.invite-error` slot per
  decision N: `"Invalid email"` / `"No Elinno account with this email…"`
  / `"User is already a member of this project"` / `"The project creator
  cannot be removed"`.
- Mobile (≤700px) drops the role badge to reclaim horizontal space —
  Block 9 polish if anyone misses it.
- 403 handling intentionally splits by endpoint: invite POST 403 bounces
  to /projects.html (stale-admin recovery); remove DELETE 403 renders
  verbatim (creator-block carries a user-facing message).

### API patterns codified by Block 2

These should apply directly to Block 3+ work — adopt as defaults.

**Auth helpers** (in `functions/api/_lib/auth.js`):
- `getSessionUser(request, db)` — returns the D1 user row or null. Used
  upstream of every API handler.
- `requireWorkspaceAdmin(request, env)` — D1 `is_admin = TRUE` gate.
  Still inline in legacy `admin/users.js` and `admin/users/[id].js`;
  migration deferred (see Open follow-ups below).
- `requireProjectRole(request, env, projectId, role)` — project-scoped
  auth helper. `role` is `'admin'` (creator) or `'member'` (any project
  member). Returns `{ user, role }` or a Response object on failure.
  403-collapse on access denial — caller pattern is
  `const { error: errResp, user } = await requireProjectRole(...)`,
  `if (errResp) return errResp;`.

**URL shapes:**
- Project-scoped: `/api/projects/:projectId/...`
- Conversation-scoped: `/api/projects/:projectId/conversations/:conversationId/messages`
- Member-scoped: `/api/projects/:projectId/members/:userId` (DELETE only)
- Two-guard pattern: `requireProjectRole` (project) + in-handler
  conv-belongs-to-project-and-user check (single SELECT collapses both).

**Schema gotchas:**
- `messages.project_id` is a denormalized NOT NULL column. Every INSERT
  must populate it from `params.id`. Removing it reproduces the Block 2
  Session 3 500-on-every-send bug (fixed `25a005c`).
- `LEFT JOIN messages` for sidebar `message_count` must put
  `m.deleted_at IS NULL` in the JOIN ON clause, **not** WHERE. Putting
  it in WHERE drops zero-message conversations from the sidebar.
- D1 INTEGER user_id ↔ Postgres TEXT user_id. Coerce at write
  (`String(user.id)`) and at read for cross-DB lookups.

**Decision H — title-state trigger:** auto-title fires when conversation
title equals the literal `'New conversation'`, not when COUNT of user
messages is 0. The COUNT-based reading was tried first; it failed on
Hyperdrive's stale query cache. Title-state sidesteps the read-after-
write round-trip entirely. Trade-off: a future user-renameable
conversation that gets manually renamed back to `'New conversation'`
would re-trigger auto-title. Stretch case; Block 9 if it surfaces.

**Hyperdrive query caching** is disabled at the binding level on
`elinno-agent-hyperdrive`:
```
npx wrangler hyperdrive update 78af00bbf464468cb902e35099aa0dfe \
                               --caching-disabled true
```
Cost: ~10–50ms per read (every read round-trips to Neon Frankfurt).
Acceptable for v1.1 chat scale. **Revisit before Block 5** when AI
tool calls multiply read-after-write volume — the cache-bypass-by-
real-NOW()-reference pattern is the documented escape hatch (the
SQL-comment marker form in `0b793c3` was dead code; comments don't
get parsed by Hyperdrive's STABLE-function detector).

### Mockup file + verification matrix tracked this commit

Both were "deferred to Block 2 closeout" per HANDOFF and project memory:

- `block-2-mockups-v2.html` — visual reference for sub-tasks 2.3 / 2.5
  / 2.6. Production-CSS-pinned mockup with four screens and design
  annotations. Useful provenance for Block 9 polish revisits and any
  re-design conversations.
- `curl-matrix-2-4.md` — sub-task 2.4's 22-scenario verification matrix
  (cross-project leakage, per-user scoping, conv-belongs-to-project,
  auto-title timing, LEFT JOIN correctness with soft-deleted messages,
  validation, JSON-error). Useful as a regression baseline when Block 5
  replaces the echo placeholder with real AI generation — the schema
  and API contract stay identical per decision Z, so the matrix should
  still all PASS post-Block-5.

### Block 3 kickoff — what's next

Per BUILD_PLAN, Block 3 is the connector framework. **Backend-only block.**
Deliverables:

- Connector TypeScript interface — `Connector` + `ConnectorRegistry`
  contracts.
- Encryption helper for connector credentials (AES-GCM via Web Crypto;
  master key from a Cloudflare Pages secret).
- A dummy connector (returns hardcoded fake data) to validate the
  framework end-to-end before Block 4's first real connector (Slack).
- D1 table for connector instances (one row per project-connector pair):
  schema TBD as part of Block 3.

The Connections tab built in Block 2 stays as the placeholder state-card
("No tools connected yet…") until Block 4 fills it with the first real
"Connect" button.

### Open follow-ups carried into Block 3

- **`requireWorkspaceAdmin` migration of `admin/users.js` +
  `admin/users/[id].js`.** Helper exists; legacy handlers still inline
  the same check. Behavior-identical refactor; deferred from Block 2
  Session 1 to keep commits scoped. Good "between blocks" task. While
  there, fix `admin/users.js`'s POST returning 200 instead of 201 for
  user-create.
- **Stale cache-related comments** in `db-test.js:71`,
  `projects/[id]/index.js:38`, `db-health.js:15` — doc-consistency
  sweep; cache-disable made these slightly inaccurate but none affect
  behavior.
- **Cross-DB orphan in production data.** P1 has a `project_members`
  row (`user_id="4"`) with no matching D1 user (Alice was deleted
  during 2.2 verification). The orphan is preserved as live
  documentation of the cross-DB cleanup TODO until the broader fix
  lands.
- **Soft-deleted test projects on Neon** (P1 + P2 from the 2.2
  verification matrix). Invisible to the API; cosmetic only. Hard-
  delete when noisy.
- **Test data accumulation on Neon.** Conversations from the 2.4
  diagnostic + auto-created `"New conversation"` rows from every 2.5
  boot + invite test users from 2.6 verification. Combined cleanup
  is a between-blocks task.
- **Tab-switch loses textarea drafts** in the chat composer (Block 9
  polish, NOT Block 3 scope).
- **Tab strip overflow-scrolls horizontally** on narrow viewports if
  all three tabs don't fit (Block 9 polish).
- **Two leftover remote branches** — `origin/session-4-project-html`
  and `origin/session-4-members-tab`. Local copies were deleted post-
  merge; remote prune deferred to whenever convenient (no impact on
  main).

### Things that closed in Block 2 (don't re-flag)

- Tooling switch from Cursor to Claude Code mid-Block-2-Session-3 —
  WORKFLOW.md and CLAUDE.md updates landed in `efdac86` + `867df9a`.
- IDE markdown-formatter policy — `.vscode/settings.json` workspace-
  scope override committed earlier in Block 2; no further action.
- Decision H regression risk — fixed at the Hyperdrive cache layer
  (binding-level cache disabled), verified all 22 scenarios PASS.
- Block 2 Session 4 / sub-task 2.6 invite-notification email (Resend-
  based) — was a "bonus end-of-Block-2 task if time permits" per
  BLOCK_2_PLAN line 633; deferred to Block 9 per decision M, not
  shipped in 2.6.

---

## Block 3 closeout — 2026-05-04

> Block 3 (connector framework) verified end-to-end on the preview
> deploy and ff-merged to main. Production now runs the connector
> framework + dummy connector + connections + sync HTTP API.
> Replaces the prior "Block 3 mid-flight pause" section that lived
> here between commit 4 and commit 5.

### Branch state (final)

`block-3-connector-framework` was 5 commits ahead of main at the
ff-merge (4 feature/docs commits + the closeout commit that contains
this addendum):

```
<closeout-sha>  docs(block-3): closeout — verification matrix + HANDOFF addendum
d6e6b5f         feat(block-3): add connections + sync HTTP API
c8175c6         feat(block-3): add Connector interface + registry + dummy connector
b624726         feat(block-3): add envelope encryption helper + algorithm tag migration
43a8b22         docs(block-3): lock Block 3 design decisions A–R
```

The mid-flight pause commit `b301c32` is preserved on the branch as
historical record but its contents in HANDOFF.md were superseded by
this closeout addendum (the closeout commit replaces lines 876–1080
of the prior version).

### Code shipped

- **`BLOCK_3_PLAN.md`** (commit 1) — locked design decisions A–R with
  seven mid-review revisions before commit 1 landed (AAD encoding
  made length-prefixed `Uint8Array`; smoke-endpoint single-locked
  answer; `external_account_id` slice 12; master-key value rotation
  paragraph added to E; connector authoring guidance added to H;
  commit-2 "landed but NOT applied" sequencing language; R-2
  ownership split).
- **`functions/_lib/crypto.js`** (commit 2) — envelope encryption
  helper. AES-256-GCM via SubtleCrypto, length-prefixed AAD bound to
  `(connection_id, project_id, source)`, `Map<string, CryptoKey>`
  cache keyed by secret name, IMPORTANT comment near `keyCache`
  warning against in-place rotation.
- **`db/migrations/2026-05-04-encryption-algorithm-v1.sql`** (commit
  2) — applied to Neon production via SQL Editor before commit 4's
  connect endpoint shipped traffic. `column_default` verified
  post-apply.
- **`functions/api/crypto-roundtrip.js`** (commit 2) — env-gated
  smoke endpoint. 404 in production; 200 with all-true checks JSON
  on Preview when `ALLOW_CRYPTO_SMOKE=true`. Stays in the repo as a
  permanent preview-only smoke surface for future crypto-touching
  blocks.
- **`functions/_lib/connectors/types.js`** (commit 3) — Connector
  contract (JSDoc, no TypeScript per decision G). Decision H narrowed
  during commit 3 review: `getMetadata` exempt from ctx-first rule
  per YAGNI; rationale inline + cross-referenced from `registry.js`.
- **`functions/_lib/connectors/registry.js`** (commit 3) — static
  map; only `dummy` registered. No pre-stubs for Slack/Jira/Monday/
  Drive.
- **`functions/_lib/connectors/dummy.js`** (commit 3) — zero-auth
  synthetic connector. `testConnection` exercises encrypt/decrypt
  round-trip on the stored row; `fullSync` UPSERTs 3 fixture
  entities. SECURITY comment near the testConnection error throw
  warns future connector authors NOT to log decrypted plaintext.
- **Five HTTP endpoints** under `functions/api/projects/[id]/
  connections/` (commit 4):
  - `POST /connections` — admin; create + encrypt + persist
  - `GET /connections` — member; list whitelisted columns
  - `DELETE /connections/:connId` — admin; soft-delete
  - `POST /connections/:connId/sync` — admin; synchronous fullSync
  - `GET /connections/:connId/sync-runs` — member; recent runs

### Verification — 22/22 PASS

Full per-scenario record at [curl-matrix-block-3.md](curl-matrix-block-3.md).

- **Phase A** (Jenny's hands): schema migration applied; `MASTER_
  ENCRYPTION_KEY` set on Production AND Preview with two different
  values; `ALLOW_CRYPTO_SMOKE=true` on Preview only (as a Secret due
  to the wrangler.toml plaintext-var lock — see follow-ups);
  Cloudflare dashboard "Retry deployment" rebuild on the Preview
  branch so the just-set secrets bound to the Function bundle.
- **Phase B** (smoke endpoint at `/api/crypto-roundtrip` on preview):
  all checks `true`, `algorithm_tag: 'aes-256-gcm-v1'`, envelope
  shapes match the v1 spec exactly (`wrapped_data_key_length: 60`,
  `iv_length: 12`).
- **Phase C** (22 scenarios across auth/scoping 1–6, functional flow
  7–14, silent-failure-mode 15–17, validation 18–22): all PASS, with
  S16 a composite pass via Phase B's helper-layer AAD-tampering
  check (data-path version deferred to Block 4 — see follow-ups)
  and S22 a pass-by-inspection on the schema constraint (no API path
  collides with random `external_account_id`).

Highlights:

- **403-collapse equivalence holds**: byte-identical `{"error":"Forbidden"}`
  (21 bytes) across S2 / S3 / S5a / S5b / S6 — four structurally
  distinct authorization failures, one error.
- **Response whitelist holds**: S7 / S8 / S13 return only the
  whitelisted columns. No `wrapped_data_key`, `iv`,
  `ciphertext_credentials`, `encryption_algorithm`, or
  `credential_metadata` ever leak in API responses.
- **Idempotency holds**: S9 first sync `records_inserted=3,
  records_updated=0`; S11 re-sync `records_inserted=0,
  records_updated=3`. The `xmax = 0` insert-vs-update split in
  `RETURNING` correctly populates `sync_runs.records_inserted` vs
  `records_updated`.
- **Plaintext-leak guard holds**: S15 `ciphertext_hex` for the
  `{}` plaintext is `307f129f860a13425c66abebd351f87d5f61` (18 bytes
  = 2 plaintext + 16 GCM tag). First byte `0x30`, not `0x7b`. The
  encrypted bytes are opaque.
- **Algorithm tag holds**: S17 `encryption_algorithm = 'aes-256-gcm-v1'`
  exact match.
- **Verbatim validation strings holds**: S18 / S19 / S21 return the
  exact strings BLOCK_3_PLAN's decision Q specified. S20's
  whitespace-only `display_name` falls back to the connector's
  `displayName` per decision M.

### Security carve-out outcomes (commit 2 review, restated)

Per BLOCK_3_PLAN's three-sub-item carve-out for crypto code:

- **Sub-item 1 — crypto helper:** spot-check vs reference. Phase B
  smoke validates the round-trip on every preview deploy.
- **Sub-item 2 — AAD binding:** accept single-reviewer risk. Phase
  B's `aad_tampering_detected: true` confirms AAD is actually being
  passed through SubtleCrypto's `additionalData`.
- **Sub-item 3 — master-key loading:** spot-check + IMPORTANT
  no-in-place-rotation comment. Phase A's two-different-values
  setup verifies the cache keyed-by-secret-name pattern works.

### Production deployment

After ff-merge to main:

- Production redeployed automatically.
- `https://elinnoagent.com/api/crypto-roundtrip` returns `404 Not
  Found` (gate fails closed; `ALLOW_CRYPTO_SMOKE` not set on
  Production).
- `https://elinnoagent.com/api/db-health` returns 200 (Block 1
  regression check).
- The five connection endpoints under `/api/projects/:id/
  connections/` are live but unused in production — the Block 2
  Connections tab in `project.html` still shows the placeholder
  state-card. The first real "Connect" button lands in Block 4.

### Block 4 kickoff — what's next

Per BUILD_PLAN, Block 4 is the Slack connector. **First time the
framework gets exercised by a real connector.** Deliverables (per
BUILD_PLAN.md §Block 4):

1. Register a Slack app, capture OAuth client ID + secret.
2. Build the Slack OAuth install flow: "Connect Slack" button →
  Slack consent screen → callback that stores the encrypted bot
   token via the Block 3 envelope helper.
3. List channels visible to the bot.
4. Backfill: pull recent messages from a test channel, write as
  entities.
5. Slack Events API webhook for real-time message ingestion.
6. `slack_messages` SQL view over `entities` for fast lookups.

Block 4 is also the natural place to:

- Implement the **data-path version of scenario 16** (Slack's sync
  calls `decrypt` to use the OAuth token; tampering AAD will cause
  the sync to actually fail).
- Land the deferred **`requireWorkspaceAdmin` migration** of
  `admin/users.js` + `admin/users/[id].js` (the Slack OAuth callback
  will touch admin-adjacent paths).
- **Revisit Hyperdrive caching** if Slack backfill creates
  read-after-write hotspots (currently disabled at the binding
  level; cache-bypass-by-real-NOW()-reference is the documented
  re-enable pattern).

### Open follow-ups carried into Block 4

- **Data-path AAD-tampering test** (scenario 16, deferred from Block
  3). Block 4's Slack connector decrypts during sync — natural place
  to add a Neon-branch-based test: tamper `project_id` on a stored
  row via SQL, trigger a `/sync`, assert `sync_run.status = 'failed'`
  with a decrypt-error in `error`. Helper-layer version is already
  passing via the Phase B smoke endpoint.
- **Workspace-admin password rotation.** During Block 3 verification,
  `JENNY_PASSWORD` was visible in a terminal scrollback paste shared
  with Claude Code. Rotate the workspace-admin password before Block
  4 ships (admin → users → reset, or via the password-reset email
  flow). Treat the old value as compromised in the scope of that
  conversation transcript only — no commit log or shipped file
  contains it.
- **Misnamed Cloudflare Pages secret** named literally `Plaintext`,
  added during the `ALLOW_CRYPTO_SMOKE` setup before realizing the
  dashboard's Add dialog had crossed the Type and Name fields.
  Cosmetic — the runtime never reads `env.Plaintext`. Delete via
  Cloudflare dashboard or `wrangler pages secret delete Plaintext`
  once Jenny's permissions allow it (the dashboard delete button
  reported a permissions error at first try; cause unclear).
- **`requireWorkspaceAdmin` migration** of `admin/users.js` +
  `admin/users/[id].js` (carry-over from Block 2 → Block 3 → Block
  4). Behavior-identical refactor; deferred again to keep Block 3's
  commits scoped. Block 4's Slack OAuth callback will touch
  admin-adjacent code so this is a natural place to fold it in.
  While there, fix `admin/users.js`'s POST returning 200 instead of
  201 for user-create.
- **Stale Hyperdrive-cache comments** in `db-test.js:71`,
  `projects/[id]/index.js:38`, `db-health.js:15` (carry-over from
  Block 2). Doc-only; defer to Block 9 polish unless convenient.
- **Test data accumulated on Neon production from the verification
  matrix.** Cleanup SQL is in `curl-matrix-block-3.md`'s "Cleanup"
  section. P3a (`03829f71-1f8e-4573-bae8-a52571d9f6be`) and P3b
  (`13414356-b8df-4f7c-aa3a-20c8f61b85b9`) should be soft-deleted
  before Block 4 starts. Connections (C1, C2 on P3a) cascade-deleted
  via FK ON DELETE CASCADE on hard delete; soft-delete leaves them
  intact but invisible to the API.
- **Bob test user** (`bob+block3@example.com`, D1 `user_id=10`) left
  in place as a permanent test user. Deleting him via
  `/api/admin/users/:id` would create a third cross-DB orphan in
  Postgres `project_members` (one each from the Block 2 verification
  matrix and now this Block 3 matrix). Combined cleanup waits for
  the workspace-admin migration follow-up.
- **`wrangler.toml` env-scoping** (carry-over from Block 3
  mid-flight). The flat top-level `[vars]` block forced
  `ALLOW_CRYPTO_SMOKE` to ship as a Secret rather than a plaintext
  var — fine for the gate semantics (runtime check is `=== 'true'`
  either way) but the gap is real and surfaces if any future
  plaintext var needs Preview-only scoping. Restructuring to
  `[env.preview]` / `[env.production]` requires re-declaring
  top-level bindings/vars per env; Block 9 unless brittleness shows.
- **`postgres` v3 BYTEA serialization** (carry-over from Block 3
  mid-flight). Commit 4's connect handler passes `Uint8Array`
  directly to postgres tagged-template params for BYTEA columns.
  The library is documented to handle this, and the verification
  matrix's S7 / S15 confirm it works at runtime. No action; just
  the data point if a future schema change makes BYTEA inserts
  fragile.
- **Worker 30s CPU limit unhandled in `sync.js`.** Per decision P,
  dummy syncs in <50ms so this is moot for v1.1. Real connectors
  with long backfills will hit this; a `'running'` `sync_run` row
  with no `finished_at` will be left orphaned. `sync.js`'s header
  comment documents the upgrade path to Cloudflare Queues. Block 4+
  work the moment Slack backfill plausibly approaches 30s.
- **Production smoke endpoint failsafe.** Verified by the post-merge
  `404` curl; if `ALLOW_CRYPTO_SMOKE` ever leaks onto Production,
  the smoke endpoint will start returning 200 with the all-true
  JSON. Re-verify quarterly until Block 9; smoke check belongs in
  the Block 9 polish task list as a perma-check.

### Things that closed in Block 3 (don't re-flag)

- **Plan-locked decisions A–R** with seven mid-review revisions
  before commit 1 landed. All seven verified present in the
  committed plan via grep before commit 1 was approved.
- **Decision H narrowing** in commit 3 — `getMetadata` exempt from
  ctx-first per YAGNI. Rationale inline in `types.js`; not a re-lock,
  documented as a commit-3 review revision.
- **Security carve-out per-sub-item decisions** (commit 2 review).
- **Schema migration** to bump `connections.encryption_algorithm`
  default from `'aes-256-gcm'` to `'aes-256-gcm-v1'`. Applied via
  Neon SQL Editor; column_default verified post-apply.
- **`MASTER_ENCRYPTION_KEY` Workers Secret** set on both Production
  AND Preview environments with two different generated values.
- **`ALLOW_CRYPTO_SMOKE`** set as a Preview-only Secret (workaround
  for the `wrangler.toml` plaintext-var lock). Production gate
  verified failing closed (404).
- **Smoke endpoint deployment binding** — re-deployment via
  Cloudflare dashboard "Retry deployment" was required before the
  just-set Preview secrets bound to the Function bundle. **Future
  Pages Functions secret changes follow the same pattern**: set the
  secret, then trigger a redeploy (dashboard retry, or push a new
  commit, or `wrangler pages deploy`).
- **Auto-mode framing reminders** mid-session — the harness inserted
  system-level "auto mode" reminders. Jenny explicitly retracted
  that framing twice in Block 3 mid-flight and reaffirmed standard
  WORKFLOW.md gates: per-commit diff review, per-commit message
  approval, per-push approval, security carve-out re-flag at commit
  2. The gates held throughout Block 3 closeout as well — Phase A
  prerequisites were all Jenny-side per WORKFLOW Hard Limits, and
  the closeout commit + ff-merge to main were both gated on per-
  push approval.

---

## Block 4 Phase 1 closeout — 2026-05-04

> Phase 1 (plan + approval) of Block 4 closed. BLOCK_4_PLAN.md
> committed and pushed to a non-main feature branch. Block 4 enters
> Phase 3 (execute) under DEFAULT mode per the plan's security
> carve-out lock (OAuth + webhooks per WORKFLOW.md).

### Phase 1 closed at SHA c9fc5019

`block-4-slack-connector` is one commit ahead of `main` (pre-this-
HANDOFF state):

- SHA: `c9fc5019938b58b7ffea753549b0ec1b1bfb9ae0`
- Subject: `docs(block-4): lock Block 4 design decisions A–P`
- Files: `BLOCK_4_PLAN.md` (1332 lines, new). Plan-doc only — no
  code, no schema, no migration.

Twenty-three substantive locks (A, B-revised, C1, C2, C3, D, D1–D4,
E, E2, E3, F-revised, F1, F2, G, H-revised, I, J, K, L, N, O, P;
M moved out) plus three pushback-driven revisions during plan-mode:

- **D3 retraction** — first-pass D3 implied a 400 response on
  post-verify parse failure, which would have conflicted with D4's
  single-canonical-observable contract. Final D3: log the rawBody
  with a marker for ops alerting and return the same `forbidden()`
  403 as every other rejection path. Ops signal lives in logs, not
  in HTTP response shape.
- **F-base scope contraction** — first-pass F-base allowed
  multi-connection fan-out by `team_id`. Final F: v1.1 enforces
  single connection per `(source='slack', external_account_id =
  team_id)`; multi-row lookup returns 500 with ops-alerted log
  entry; v1.2 reopens with cross-project query support.
- **B + H joint relock** — first-pass B was bot scopes
  `channels:read` + `channels:history` only, with H deferring
  `author_display_name` to null. Deferring would have forced every
  Block 4 connection to re-install during Block 5's citation work.
  Final B widened to add `users:read`; final H populates
  `author_display_name` via in-memory-cached `users.info` lookups.

### Two parallel work streams open for next session

- **Phase A (Jenny's hands).** Slack app registration at
  api.slack.com/apps; `SLACK_CLIENT_ID` plaintext var to
  `wrangler.toml`; `SLACK_CLIENT_SECRET` + `SLACK_SIGNING_SECRET`
  Workers Secrets (Production AND Preview); Token Rotation OFF
  (per O); bot scope set verification — exactly `channels:read`,
  `channels:history`, `users:read`, no User Token Scopes, no
  commands, no incoming-webhook (per B + P); redirect URI
  configuration (per K). Schema migrations (commit 3's C1+C3 file,
  commit 6's J view file) wait for those commits to land. Gates
  commits 3/4/6/7 in various ways but **not** commit 2 directly.
- **Pre-Block-4 PR.** Fresh plan-mode session for the
  `requireWorkspaceAdmin` migration of `admin/users.js` +
  `admin/users/[id].js` + the POST 200→201 fix on user-create.
  Branches from `main`, ff-merges to `main`. After it lands on
  `origin/main`, `block-4-slack-connector` absorbs both this
  HANDOFF commit AND the pre-Block-4 PR commits via
  `git merge origin/main` (Block 3 precedent — the `2f869b8`
  merge-main-into-feature-branch pattern), then commit 2 (Slack
  connector module) starts.

### Mid-session harness note (not blocking; for future re-lock)

The Claude Code harness presented an "Accept & Automode" UI signal
after the plan re-approval; the click fired but Claude Code held
to DEFAULT mode per the plan's carve-out lock and CLAUDE.md hard
rule "Security carve-outs run in default mode, never auto." Commit
1 shipped under per-action review semantics. Same pattern occurred
twice in Block 3 mid-flight (already recorded in HANDOFF). Worth a
WORKFLOW re-lock conversation about UI-level guidance for carve-
out blocks before Block 6 starts — the auto-mode UI signal keeps
firing on every plan re-approval and creates churn even though the
substantive contract holds.

### Open follow-ups carried INTO Block 4 commit 2+

(Adds to Block 3's already-queued list, which carries forward
unchanged.)

- **BLOCK_3_PLAN.md AAD-on-both addendum** — `crypto.js` applies
  AAD to BOTH the DEK wrap AND the credential ciphertext, but
  BLOCK_3_PLAN.md decision B only specified AAD on the credential.
  Plan should match the helper. Doc-only commit; ships AFTER
  Block 4 closes so it doesn't compete with Block 4 doc commits.
- **S22 `url_verification` response shape pinning** — Slack has
  changed the `url_verification` response shape multiple times
  historically. At commit 7 coding time, pin the docs URL +
  dated comment in `events.js` header per F1's contract-pinning
  rule.
- **S12 `OperationError` substring pinning** — SubtleCrypto's
  exact error message could change between Workers runtime
  versions. Pin at commit 7 coding time; doc-only update if
  Workers runtime upgrades break the match.

### Where future-Claude resumes

Phase 0 of next session finds:
- `origin/main` advanced by THIS HANDOFF commit on top of
  `3659d554`.
- `block-4-slack-connector` at SHA `c9fc5019`, one commit ahead of
  `3659d554` but **NOT** including this HANDOFF on `main`. The
  branch absorbs `main`'s new commits via `git merge origin/main`
  after the pre-Block-4 PR also lands on `main`. Both the HANDOFF
  commit and the pre-Block-4 commits enter `block-4-slack-
  connector` in one merge before commit 2 begins.
- `BLOCK_4_PLAN.md` at repo root on `block-4-slack-connector`,
  1332 lines, locked decisions A–P. Read it as primary input.

Recommended first move next session: pre-Block-4 PR's plan-mode
session. Phase A doesn't gate it; once it lands on `main`, the
`block-4-slack-connector` merge-from-main is mechanical.

---

## Block 4 mid-flight — 2026-05-04 evening

> Block 4 feature commits 2–8 + two import-depth fix-ups (3a, 7a)
> shipped to `block-4-slack-connector` on top of commit 1's plan doc.
> All Block 4 connector-side decisions (A–P) are implemented in code.
> End-to-end verification awaits Phase A (Jenny's hands); closeout
> commit 10 awaits verification. Production is unchanged; no Block 4
> code is on `main` yet — only this HANDOFF + the Phase 1 closeout
> HANDOFF live there.

### Branch state

`block-4-slack-connector` is **10 commits ahead of `main`** (which
sits at `c27593b` from the Phase 1 closeout HANDOFF, plus this
mid-flight HANDOFF after this commit pushes). Local in sync with
origin.

| #   | SHA       | Subject                                                                                          |
| --- | --------- | ------------------------------------------------------------------------------------------------ |
| 1   | `c9fc501` | docs(block-4): lock Block 4 design decisions A–P                                                 |
| 2   | `4bbf89f` | feat(block-4): add Slack connector — startAuth/completeAuth/refreshAuth/testConnection           |
| 3   | `777a600` | feat(block-4): refactor connections POST for OAuth authUrl flow + Slack OAuth start endpoint    |
| 3a  | `1a26c42` | fix(block-4): correct import depth in slack/oauth/start.js                                       |
| 4   | `6af0a50` | feat(block-4): add Slack OAuth callback endpoint                                                 |
| 5   | `f5ee0c5` | feat(block-4): add Slack channel listing endpoint                                                |
| 6   | `e7258f3` | feat(block-4): add Slack fullSync + incrementalSync + slack_messages view migration             |
| 7   | `495a142` | feat(block-4): add Slack Events API webhook handler                                              |
| 7a  | `9945503` | fix(block-4): correct import depth in slack/events.js                                            |
| 8   | `89785b0` | feat(block-4): wire Connect Slack UI in project.html + PATCH endpoint                            |

### Sequencing-deltas vs Phase 1 closeout

The Phase 1 HANDOFF entry recommended a **pre-Block-4 PR** (the
`requireWorkspaceAdmin` migration of `admin/users.js` +
`admin/users/[id].js` + 200→201 fix) as the first move next session.
**That was deferred during this session** — Jenny chose "Commit 2
now; defer all merges" when commit 2 work began. The pre-Block-4 PR
remains on the open-follow-ups carry-forward list (still good
"between blocks" work) but it didn't ship in this session.

`block-4-slack-connector` and `origin/main` have diverged from common
base `3659d55`:
- `origin/main`: + Phase 1 closeout HANDOFF (`c27593b`) + this
  mid-flight HANDOFF (next push).
- `block-4-slack-connector`: + 10 Block 4 commits (`c9fc501` →
  `89785b0`).

Per Jenny's "defer all merges" call, no merge-from-main into the
feature branch has happened. Block 3's precedent (commit `2f869b8`
"Merge branch 'main' into block-3-connector-framework") is the
pattern when merge becomes needed; for Block 4 the merge is
deferred to closeout (after Phase A + verification + commit 10).

### What's done (code-side)

All Block 4 connector decisions (A–P) implemented:

- **slack.js** ([functions/_lib/connectors/slack.js](functions/_lib/connectors/slack.js))
  — full Connector interface: startAuth (commit 2) / completeAuth
  (commit 2) / refreshAuth (commit 2 — no-op per O) / testConnection
  (commit 2) / fullSync (commit 6) / incrementalSync (commit 6) /
  handleWebhook (commit 7). Plus the `listChannels(ctx, connection)`
  helper export (commit 2; consumed by commit 5's bespoke endpoint
  per G).
- **OAuth surface** — start endpoint
  ([start.js](functions/api/connectors/slack/oauth/start.js), commit 3
  + 3a depth fix), callback endpoint
  ([callback.js](functions/api/connectors/slack/oauth/callback.js),
  commit 4). Implements C2 single-use UPDATE on `status='pending'`,
  C3 initiated-by-user binding, K hardcoded server-side redirect
  destination, P scope shape with `user_scope` parameter omitted
  entirely.
- **Channel listing** —
  [channels.js](functions/api/projects/[id]/connections/[connId]/slack/channels.js)
  (commit 5) at depth 7 with 6-up imports.
- **Events API webhook** —
  [events.js](functions/api/connectors/slack/events.js) (commit 7 +
  7a depth fix). Implements D1 constant-time HMAC verify via
  `crypto.subtle.verify`, D2 symmetric ±5min timestamp window, D3
  raw-body fidelity (read text → verify → parse on same bytes), D4
  reject-before-dispatch single-canonical-403, F1 url_verification
  challenge as first code path with JSON-only `{ challenge }`
  response (per locked F1 contract-pinning comment dated 2026-05-04
  in events.js header), F2 dispatch on `body.event.type`, F single-
  connection-per-team_id v1.1 lock (multi-row → 500 with
  console.error), I message_changed UPSERTs + message_deleted
  hard-DELETEs.
- **PATCH endpoint** for selected_channel — `onRequestPatch` on
  [connections/[connId]/index.js](functions/api/projects/[id]/connections/[connId]/index.js)
  (commit 8). Atomic JSONB `||` merge with allowlisted keys
  (`selected_channel_id`, `selected_channel_name` per locked
  sub-decision (a) for commit 8).
- **Connections POST refactor** (commit 3) — replaces Block 3's 501
  stub for OAuth source with a 400 + guidance string telling callers
  to use `/oauth/start`. Plus Q whitelist extension (commit 8) via
  JSONB projection: `selected_channel_id` + `selected_channel_name`
  flow into GET/POST/PATCH responses; OAuth scopes / bot_user_id /
  team_name remain off the wire.
- **UI** in [project.html](public/project.html) (commit 8) — full
  Connections-tab flow: Connect Slack button (full-page redirect per
  K), channel-picker modal (per L; auto-opens on
  `?just_connected=slack` once via `justConnectedHandled` guard),
  connection-row with status pill derived from `selected_channel_id`
  + `last_sync_at`, disconnect button with native `confirm()`. Boot
  pipeline loads connections eagerly in parallel with members. Plus
  [auth.css](public/auth.css) extended with connection-row + modal
  + status-pill selectors (~189 lines).
- **sync.js modifications** (commit 6 plan amendment) —
  [sync.js](functions/api/projects/[id]/connections/[connId]/sync.js)
  writes `syncResult.detail` to `sync_runs.detail` on the success
  path (E3 cap-hit signal) and SKIPS the
  `connections.last_sync_at` bump when `syncResult.detail?.inert`
  (per L's freshness contract — inert syncs write a sync_runs row
  but don't poison the freshness signal).
- **Two schema migration files** committed but **NOT YET APPLIED**
  to Neon production:
  1. [db/migrations/2026-05-04-pending-oauth-state.sql](db/migrations/2026-05-04-pending-oauth-state.sql)
     — C1 NULL-allow on encryption columns + CHECK constraint
     enforcing presence at non-pending status + C3
     `initiated_by_user_id` column.
  2. [db/migrations/2026-05-04-slack-messages-view.sql](db/migrations/2026-05-04-slack-messages-view.sql)
     — J's `slack_messages` view.
- **wrangler.toml** — `SLACK_CLIENT_ID` added as plaintext var
  (commit 2) but populated as empty string `""`. **Phase A populates
  this with the real value from Slack app registration**; Claude
  commits the change as a small fix-up before closeout.
- **BLOCK_4_PLAN.md amended twice** during execute:
  - Row 3a inserted after row 3 (start.js depth fix-up).
  - Row 7a inserted after row 7 (events.js depth fix-up).
  Both surface the same root cause: directory-depth miscount when
  adding new function files. Pattern detail in "Anomalies" below.

### What's NOT done — gates Block 4 going live

**Phase A — Jenny's hands. Recommended order:**

1. **Apply schema migrations to Neon production** via SQL Editor:
   - `db/migrations/2026-05-04-pending-oauth-state.sql`
   - `db/migrations/2026-05-04-slack-messages-view.sql`

2. **Register Slack app at api.slack.com/apps:**
   - **Bot Token Scopes** (exactly): `channels:read`,
     `channels:history`, `users:read`. NO others.
   - **User Token Scopes**: NONE (per P).
   - **OAuth Redirect URLs** (both):
     - `https://elinnoagent.com/api/connectors/slack/oauth/callback`
     - `https://block-4-slack-connector.elinno-agent.pages.dev/api/connectors/slack/oauth/callback`
   - **Token Rotation**: OFF (per O).
   - **No Slash Commands. No Incoming Webhooks.**
   - Capture **Client ID** (paste into the next-session
     conversation — not secret), **Client Secret** (Workers
     Secret), **Signing Secret** (Workers Secret).

3. **Set Workers Secrets on BOTH Production AND Preview** (Cloudflare
   dashboard → Pages → `elinno-agent` → Settings → Variables and
   Secrets):
   - `SLACK_CLIENT_SECRET`
   - `SLACK_SIGNING_SECRET`

4. **Tell Claude the SLACK_CLIENT_ID** so the wrangler.toml empty-
   placeholder is replaced. Claude commits the change to
   `block-4-slack-connector`; the push triggers a preview re-deploy
   that picks up both the new var and the secrets.

5. **Configure Events API URL in Slack app** (preview first):
   - URL: `https://block-4-slack-connector.elinno-agent.pages.dev/api/connectors/slack/events`
   - Slack POSTs `url_verification` challenge; F1 responds; "Verified ✓"
     on success.
   - Subscribe to bot event: `message.channels` (covers
     `message_changed` and `message_deleted` via subtype dispatch
     per F2 + I).

6. **Add the bot to a test channel** in the test workspace.

**Verification matrix run** (Phases B/C/D/E, S1–S26). Driven by Claude
after Phase A signals complete; Jenny exports `JENNY_PASSWORD` in
her shell for the curl commands that need an admin session.

**Closeout commit 10:**
- `curl-matrix-block-4.md` (per-scenario PASS/FAIL record)
- HANDOFF Block 4 closeout addendum (replaces this mid-flight section)
- BLOCK_3_PLAN.md AAD-on-both addendum stays as a **separate**
  post-Block-4 doc-only commit per the locked plan.

**ff-merge `block-4-slack-connector` → `main` + per-push approval +
Cloudflare auto-deploy** to elinnoagent.com.

**Production-side Phase A finishing touches** (after merge):
- Switch the Slack app's Events API URL to
  `https://elinnoagent.com/api/connectors/slack/events` (Slack
  allows only one Events URL per app).
- Re-verify the challenge handshake against production.
- Production regression check: db-health 200; /oauth/start with
  admin session 302 to slack.com consent.

### Anomalies and lessons

**Two import-depth bugs in Block 4** (3a + 7a), both due to
miscounting directory depth when adding new function files. `node
--check` passes on the broken state because it doesn't resolve
imports; Cloudflare Pages' esbuild bundling is what fails the build,
and that feedback loop is 60–180 seconds. Both fixes were 1-line
edits.

- **3a**: `start.js` at `functions/api/connectors/slack/oauth/start.js`
  (depth 5) used 5 `../` segments instead of 4.
- **7a**: `events.js` at `functions/api/connectors/slack/events.js`
  (depth 4) used 4 `../` segments instead of 3.

Pattern is real and actionable. **Block 9 polish opportunity:** a
pre-push smoke check — either a tiny `find functions -name '*.js'
| xargs grep '^import.*_lib'` cross-reference, or a local `wrangler
pages dev` build that fails fast on resolution errors. Either would
have caught both bugs locally without the Cloudflare build cycle.
**Workflow conversation worth having before Block 6 starts** —
Block 6 (Jira) will create new function files at varying depths
under `functions/api/connectors/jira/`, same risk class.

**Auto-mode UI signal kept firing** during Block 4 even though the
plan locked DEFAULT mode for the security carve-out. Same as Block
3 mid-flight pattern (recorded in HANDOFF). Worth a WORKFLOW
re-lock conversation about UI guidance for carve-out blocks before
Block 6 (also OAuth + webhooks).

**Plan amendments during execute were small and well-scoped:**
- Row 3a + row 7a in commit-ordering table (depth-bug fix-ups).
- sync.js added to "To modify" list in commit 6 (for L's
  inert-sync rule + E3 cap-hit signal write).
- CONNECTION_PUBLIC_COLUMNS extension in commit 8 (Q whitelist
  amendment for `selected_channel_*` fields via JSONB projection).

All shipped without separate plan-amendment commits — folded into
the substantive commits with documentation updates in the same
diff. Acceptable per Jenny's "anything bigger goes through scope
expansion" framing for plan amendments that don't require re-locking
substantive decisions.

### Where future-Claude resumes

Phase 0 ritual on next session:
- `git status` on the worktree → on `block-4-slack-connector`,
  clean working tree.
- `git log main..HEAD --oneline` → 10 commits visible.
- `git fetch origin --dry-run` → verify nothing has moved.
- Read this HANDOFF section for state; ask Jenny what's done from
  Phase A.

**Recommended first move next session:** ask Jenny what's done from
Phase A. If she's worked through migration application + Slack app
registration: Claude commits the wrangler.toml `SLACK_CLIENT_ID`
update, then drives the verification matrix. If still in progress:
stand by; offer step-by-step assistance with any specific Phase A
task.

After Phase A complete + verification passes:
- Commit 10 (closeout) lands on `block-4-slack-connector`.
- ff-merge to main + per-push approval + production deploy.

### Open follow-ups carried INTO closeout / next sessions

(Adds to Block 3's already-queued list, which carries forward
unchanged.)

- **BLOCK_3_PLAN.md AAD-on-both addendum** (drift item 3 from Block
  4 Phase 1) ships as a separate post-Block-4 doc-only commit per
  the locked plan.
- **S22 `url_verification` response shape pinning** — re-verify
  Slack's url_verification docs at the time of verification matrix
  run; confirm the response shape locked in F1 still works.
- **S12 `OperationError` substring pinning** — pin the exact
  SubtleCrypto error string at verification time; doc-only update
  if Workers runtime upgrades break the match.
- **Pre-push depth-check / local wrangler dev smoke** (Block 9
  polish; both 3a and 7a would have been caught by it). Worth a
  WORKFLOW-level conversation before Block 6.
- **Cross-sync `users.info` cache** (Block 9 polish; v1.1 uses
  in-memory-per-sync only).
- **`slack_messages` view subtype projection** edge-case
  verification under Phase C — null subtype on plain messages,
  thread_broadcast filtering.
- **WORKFLOW re-lock on auto-mode UI signal** during carve-outs.
  Same situation arose three times now (twice in Block 3, once+
  in Block 4); the substantive contract holds but the UI churn is
  real.
- **`requireWorkspaceAdmin` migration** of `admin/users.js` +
  `admin/users/[id].js` + 200→201 fix on user-create. Carry-over
  from Block 2 → 3 → Phase 1 → mid-flight. Still good "between
  blocks" work; not blocking Block 4 closeout.
- **Test data accumulation on Neon production** — verification
  matrix runs in Phase B/C/D will write entities + sync_runs + a
  pending-then-active connection on the Rain project (or whatever
  test project Jenny picks). Cleanup is a between-blocks task once
  Block 4 closes.

### Things that WON'T need re-flagging next session

- The two depth-bug fix-ups (3a, 7a) are landed; the deploy is healthy.
- All connector decisions (A–P) are implemented.
- Schema migration files exist in repo and are reviewable; just
  not applied yet.
- The branch divergence with main is intentional ("defer all merges"
  call); no rush to merge until closeout.
