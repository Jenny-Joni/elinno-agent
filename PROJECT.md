# Elinno Agent — Project Reference

> Stack, repo layout, conventions, and concrete IDs. Read this first when joining
> the project. For "where are we and what's next," see HANDOFF.md.

Last updated: 2026-05-02

---

## 1. Project overview

**Elinno Agent** — a multi-tenant project intelligence platform.
Owner: Jenny (jenny@elinnovation.net).

The auth foundation is **live in production** at https://elinnoagent.com.
v1.1 (currently being built) adds four connectors (Jira, Slack, Monday, Google
Drive) and a per-project AI assistant on top of the existing auth.

For full product context, see PRD.md. For the ordered task list, see BUILD_PLAN.md.

---

## 2. URLs

| What | URL |
|---|---|
| Production site | https://elinnoagent.com |
| Production site (www) | https://www.elinnoagent.com |
| Cloudflare Pages default URL | https://elinno-agent.pages.dev |
| GitHub repository | https://github.com/Jenny-Joni/elinno-agent |
| Cloudflare Pages dashboard | https://dash.cloudflare.com → Workers & Pages → `elinno-agent` |
| Neon dashboard | https://console.neon.tech → `Elinno Agent` |

---

## 3. Stack

- **Hosting**: Cloudflare Pages (auto-deploy on push to `main`)
- **DNS / domain**: Cloudflare (domain `elinnoagent.com` is on the same Cloudflare account)
- **Source control**: GitHub
- **Frontend (today)**: static HTML + CSS, no framework, no build step yet
- **Light API (deployed)**: Cloudflare Pages Functions (auth: login, logout, me, password reset, admin/users)
- **Auth database (deployed)**: Cloudflare D1 (`elinno-agent-db`), bound as `env.DB`
- **Connector data + embeddings (provisioned)**: Neon Postgres with pgvector v0.8.0, reached via Cloudflare Hyperdrive, bound as `env.HYPERDRIVE`
- **Auth**: custom (PBKDF2, 100k iterations — Workers cap)
- **Email**: Resend (`elinnoagent.com` domain verified)
- **Sync workers + AI agent (planned)**: Cloudflare Workers
- **Job queue (planned)**: Cloudflare Queues
- **LLM (planned)**: Anthropic Claude API (Sonnet for synthesis, Haiku for routing)

---

## 4. Repository layout

```
elinno-agent/
├── public/                  ← static site, deployed as-is
│   ├── index.html           ← welcome page
│   ├── login.html, etc.
│   └── styles.css
├── functions/               ← Cloudflare Pages Functions (auth endpoints deployed; /api/db-health added in Block 1 Task 2)
│   └── api/
│       ├── login.js, logout.js, me.js
│       ├── forgot-password.js, reset-password.js
│       ├── admin/users.js, admin/users/[id].js
│       └── db-health.js     ← Hyperdrive → Neon health check (Block 1)
├── scripts/                 ← admin/maintenance scripts
│   └── seed-admin.mjs
├── db/                      ← canonical schemas
│   ├── schema-d1.sql        ← D1 auth schema (users/sessions/password_resets)
│   └── schema-postgres.sql  ← Neon Postgres schema (connector data + embeddings)
├── HANDOFF.md               ← state, design principles, how to work with AI assistants
├── PROJECT.md               ← this file: stack, layout, IDs
├── PRD.md                   ← product requirements
├── BUILD_PLAN.md            ← ordered task list, 9 blocks
├── DESIGN.md                ← visual style guide
└── README.md                ← minimal deploy notes
```

---

## 5. Cloudflare Pages build configuration

Set in the project's **Settings → Build & deployments**:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | *(empty for now — will become `npm install` once `package.json` lands in Block 1 Task 2)* |
| Build output directory | `public` |
| Root directory | `/` |
| Compatibility date | (set in dashboard; aim for the most recent stable date) |
| Compatibility flags | `nodejs_compat` (to be added in Block 1 Task 2 — required by the `postgres` library) |

**Behavior**: any push to `main` triggers a fresh deploy. Push to other
branches creates a preview deployment at a unique `*.elinno-agent.pages.dev`
URL.

---

## 6. Custom domains

Both connected via Cloudflare Pages → **Custom domains** tab:

- `elinnoagent.com` — Active, SSL enabled
- `www.elinnoagent.com` — Active, SSL enabled

DNS records (CNAMEs to `elinno-agent.pages.dev`) were added automatically by
Cloudflare. Nothing to manage manually.

---

## 7. Bindings on the Pages project

| Type | Variable name | Points to |
|---|---|---|
| D1 database | `DB` | `elinno-agent-db` (auth tables) |
| Hyperdrive | `HYPERDRIVE` | `elinno-agent-hyperdrive` config → Neon `elinno_agent_db` |

Both are applied to Production and Preview environments. Bindings only attach
to the next deployment after they're created — existing deployed builds don't
pick them up retroactively.

---

## 8. Credentials, secrets, and IDs

⚠️ **Do NOT commit credentials to the repo.** Use Cloudflare's **Settings →
Environment variables / Secrets** UI for anything sensitive that runtime code needs.

### Non-secret IDs (safe to keep in this file)

| Item | Value |
|---|---|
| Cloudflare Account ID | `da2174836d9863b4f2fcafeba4dbff3c` |
| Cloudflare Pages project name | `elinno-agent` |
| Cloudflare workers.dev subdomain | `jenny-da2.workers.dev` (disabled) |
| GitHub username | `Jenny-Joni` |
| GitHub repo name | `elinno-agent` |
| D1 database name | `elinno-agent-db` |
| Neon project name | `Elinno Agent` |
| Neon region | AWS Frankfurt (`eu-central-1`) |
| Neon branch | `production` (id `br-autumn-scene-aln7pf8j`) |
| Neon database name | `elinno_agent_db` |
| Neon role | `neondb_owner` |
| pgvector version | 0.8.0 |
| Hyperdrive config name | `elinno-agent-hyperdrive` |
| Hyperdrive config ID | `78af00bbf464468cb902e35099aa0dfe` |

### Secrets (NEVER in repo, NEVER pasted into chat)

| Secret | Where it lives |
|---|---|
| Neon `neondb_owner` password | Inside the Hyperdrive config (encrypted by Cloudflare) and in the developer's password manager. Code reads it at runtime via `env.HYPERDRIVE.connectionString`. |
| Resend API key | Cloudflare Pages → Settings → Variables and Secrets, as `RESEND_API_KEY` (secret). |
| Anthropic API key (when Block 5 starts) | Cloudflare Pages → Settings → Variables and Secrets, as `ANTHROPIC_API_KEY` (secret). |
| GitHub Personal Access Token | None currently active. Generate a new fine-grained token (Contents: Read and write on `elinno-agent`) when needed. |

### Standing rules

- **Never put plaintext credentials in code, in `.env` files committed to the repo, or in chat with an AI assistant.**
- The Neon connection string lives in exactly two places: the Cloudflare Hyperdrive config (encrypted at rest) and the developer's password manager. Anywhere else is a leak.
- If a credential is accidentally exposed (pasted into chat, committed, etc.), rotate immediately at the source (e.g., Neon → Roles & Databases → Reset password) before doing anything else.

---

## 9. Local development

```bash
# Clone
git clone https://github.com/Jenny-Joni/elinno-agent.git
cd elinno-agent

# Install dependencies (once package.json exists, after Block 1 Task 2)
npm install

# Quickest preview — just open the welcome HTML
open public/index.html

# Better — full Pages-like dev server with bindings (D1 + Hyperdrive)
npx wrangler pages dev public

# When functions are involved (auth or db-health endpoint)
npx wrangler pages dev public --compatibility-date=2026-04-28 --compatibility-flag=nodejs_compat
```

`wrangler` is Cloudflare's CLI. Install globally with `npm i -g wrangler` or
use `npx` per-command.

**Local Hyperdrive note:** when running `wrangler pages dev` locally, Hyperdrive
will tunnel through to the real Neon database using the connection string in
the Cloudflare config. Test queries from local count against the same database
as production. Use a Neon branch (free tier allows up to 10) if you need
isolation for destructive testing.

---

## 10. Deploying

**Automatic**: any commit pushed to `main` deploys to production within
~30 seconds.

```bash
git add .
git commit -m "your message"
git push origin main
```

**Convention**: push code to a branch first, verify on the preview deploy, then
merge to `main`. Don't push directly to `main` for anything that wasn't
previewed.

Watch the deploy at:
https://dash.cloudflare.com → Workers & Pages → `elinno-agent` → Deployments

**Rollback**: every deploy gets a permanent URL like
`abc1234.elinno-agent.pages.dev`. From the Deployments tab, click the
`...` menu next to any past deploy → "Rollback to this deployment".

---

## 11. Conventions for this repo

- **Branching**: `main` is production. Features go on short-lived branches and merge back via PR (or manual merge if solo). Don't push to `main` without verifying on a preview deploy first.
- **Commits**: prefer Conventional Commits style (`feat:`, `fix:`, `chore:`, `docs:`). Scope to the block when relevant: `feat(block-1): add db-health endpoint`.
- **Build step**: minimal. Once `package.json` lands, `npm install` runs at deploy time. No bundlers, no frameworks, no SSR.
- **Secrets** never go in the repo. Use Cloudflare's UI for anything sensitive.
- **AI changes** require manual diff review before commit. The developer runs all git commands themselves.

---

## 12. How to use these docs with Claude Code / Cursor

```bash
# In the project directory
cd elinno-agent
# Make sure HANDOFF.md, PROJECT.md, PRD.md, BUILD_PLAN.md are at the root
# Then launch Claude Code or Cursor
```

Then in your first prompt:

> Read HANDOFF.md, PROJECT.md, PRD.md, and BUILD_PLAN.md. Tell me what you understand about the project and which block we're on. Then I'd like to work on [task].

The assistant will read these files and have full context — stack, layout,
conventions, where things live, what's planned next.

---

*Last updated 2026-05-02 — during Block 1 Task 2 of the v1.1 build.*
