# Elinno Agent — Project Handoff

> Drop this into a fresh Claude session (chat or Cursor) so the assistant can pick up where the last session left off. This file is the single source of truth for "where are we and what's next." Update it after each working session.

**Last updated:** 2026-05-02
**Current product version:** v1.1 (the MVP being built now)
**Owner / sole developer:** Jenny ([jenny@elinnovation.net](mailto:jenny@elinnovation.net))
**AI tooling:** Cursor + Claude

---

## TL;DR for a new Claude session

You are joining a project mid-build. Here's the shape of it:

- **Elinno Agent** is a multi-tenant project intelligence platform. An admin creates a project, connects external tools (Jira, Slack, Monday, Google Drive), and the platform syncs that data into a unified store. Members chat with an AI assistant scoped to a single project, asking questions like "how many tickets in this sprint?" or "how much did we spend on testing?"
- **The auth foundation is already deployed** at [https://elinnoagent.com](https://elinnoagent.com) (Cloudflare Pages + Pages Functions + D1).
- **Block 1 of 9 is in progress — Tasks 1 and 2 are done.** Neon Postgres provisioned with pgvector, Hyperdrive bound to the Pages project, `/api/db-health` live in production. Next up is Block 1 Task 3 — designing the Postgres schema for the eight tables (`projects`, `project_members`, `connections`, `entities`, `entity_embeddings`, `sync_runs`, `conversations`, `messages`).
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

1. **Block 1 — Database setup** (Neon, pgvector, Hyperdrive, schema) ← **in progress**
2. Block 2 — Project shell (create projects, invite members, placeholder chat)
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

**Task 3 — Schema:** not started. Will draft together in a separate planning session before applying. Tables to design: `projects`, `project_members`, `connections`, `entities`, `entity_embeddings`, `sync_runs`, `conversations`, `messages`. Per PRD §5.5, embeddings use pgvector with HNSW indexes (pgvector 0.8.0 supports HNSW).

**Task 4 — Test insert/read endpoint:** not started. Depends on Task 3.

**Where the project is right now:** Foundation is deployed. Block 1 Tasks 1 and 2 are complete (Hyperdrive plumbing verified end-to-end against Neon in production). Next: Block 1 Task 3 — Postgres schema design (`projects`, `project_members`, `connections`, `entities`, `entity_embeddings`, `sync_runs`, `conversations`, `messages`).

When you (Claude in a new session) are joining mid-build, the developer will tell you which task within which block they're on. If they don't, ask. Don't assume.

---

## How the developer wants to work with you

These rules came out of how the project has been run so far. They matter:

- **Plan in chat, build in Cursor.** Use Claude chat sessions like this one for design/schema/tradeoff decisions. Use Cursor for actual code changes once the approach is settled.
- **One scoped change per Cursor session.** "Add the Slack OAuth callback" works. "Build the connector layer" doesn't.
- **Always show diffs before commits.** The developer is hands-on. Read every diff before accepting AI changes.
- **Cursor handles git commands** (`add`, `commit`, `push`, branch operations) on the developer's behalf.
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


| File              | What's in it                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| **PROJECT.md**    | Stack, repo layout, conventions. Read first.                                                              |
| **PRD.md**        | Product requirements: what's being built and why. Roles, requirements, pricing, risks, post-v1.1 backlog. |
| **BUILD_PLAN.md** | Ordered task list (this is your roadmap). Nine blocks in strict order.                                    |
| **DESIGN.md**     | Visual style guide.                                                                                       |
| **schema.sql**    | Postgres schema (canonical). To be drafted in Block 1 Task 3.                                             |
| **README.md**     | Minimal deploy notes.                                                                                     |
| **HANDOFF.md**    | This file. Project handoff for new sessions.                                                              |


If any doc contradicts another, **the PRD is the source of truth for what to build, the Build Plan is the source of truth for the order, and the latest status notes are the source of truth for what's actually done.**

---

## Production / repo facts

- **Production URL:** [https://elinnoagent.com](https://elinnoagent.com) (also [www.elinnoagent.com](http://www.elinnoagent.com))
- **Production health endpoint:** [https://elinnoagent.com/api/db-health](https://elinnoagent.com/api/db-health) — verified working as of 2026-05-02. Returns `{ ok: true, one: 1, now, postgres_version, hyperdrive_host }`, proving the Pages Function → Hyperdrive → Neon path is live.
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