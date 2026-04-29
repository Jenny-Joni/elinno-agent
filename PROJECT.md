# Elinno Agent — Project Handoff

> Drop this file into your project root (or paste it into Claude Code) to give
> a fresh AI assistant full context on the project.

Last updated: 2026-04-28

---

## 1. Project overview

**Elinno Agent** — a web application currently launching with a "coming soon"
welcome page. Owner: Jenny (jenny@elinnovation.net).

The site is **live in production**. The roadmap is to grow it into a
full-stack app with **user accounts (signup / login / sessions)** as the next
major milestone.

---

## 2. URLs

| What | URL |
|---|---|
| Production site | https://elinnoagent.com |
| Production site (www) | https://www.elinnoagent.com |
| Cloudflare Pages default URL | https://elinno-agent.pages.dev |
| GitHub repository | https://github.com/Jenny-Joni/elinno-agent |
| Cloudflare Pages dashboard | https://dash.cloudflare.com → Workers & Pages → `elinno-agent` |

---

## 3. Stack

- **Hosting**: Cloudflare Pages (auto-deploy on push to `main`)
- **DNS / domain**: Cloudflare (domain `elinnoagent.com` is on the same Cloudflare account)
- **Source control**: GitHub
- **Frontend (today)**: static HTML + CSS, no framework, no build step
- **Backend (planned)**: Cloudflare Pages Functions (JavaScript / TypeScript)
- **Database (planned)**: Cloudflare D1 (SQLite at the edge)
- **Auth (planned)**: cookie-based sessions over D1, custom-built (not third-party)

---

## 4. Repository layout

```
elinno-agent/
├── public/             ← static site, deployed as-is
│   ├── index.html      ← welcome page
│   └── styles.css
├── functions/          ← reserved for Cloudflare Pages Functions (empty)
│   └── README.md
├── schema.sql          ← D1 schema placeholder (empty, examples commented)
└── README.md
```

---

## 5. Cloudflare Pages build configuration

Set in the project's **Settings → Build & deployments**:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `public` |
| Root directory | `/` |

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

## 7. Credentials & secrets

⚠️ **Do NOT commit this section to a public repo.** If checking this file in,
either delete this section or move secrets to `.env` / Cloudflare secrets.

| Item | Where it lives | Notes |
|---|---|---|
| GitHub Personal Access Token | (none currently active — was revoked after deploy) | Generate a new fine-grained token with `Contents: Read and write` on `elinno-agent` repo when needed. Expiration: 30 days. |
| Cloudflare API token | not yet created | Needed if a tool wants to manage Cloudflare resources programmatically. Create at: dash.cloudflare.com → My Profile → API Tokens. |
| Cloudflare Account ID | *(omitted — see Cloudflare dashboard)* | Visible in dashboard sidebar. |
| Cloudflare Pages project name | `elinno-agent` | |
| GitHub username | `Jenny-Joni` | |
| GitHub repo name | `elinno-agent` | |
| Cloudflare workers.dev subdomain | `jenny-da2.workers.dev` | Disabled. |

---

## 8. Local development

```bash
# Clone
git clone https://github.com/Jenny-Joni/elinno-agent.git
cd elinno-agent

# Quickest preview — just open the file
open public/index.html

# Better — full Pages-like dev server (needs Node.js)
npx wrangler pages dev public

# When functions are added later
npx wrangler pages dev public --compatibility-date=2024-01-01
```

`wrangler` is Cloudflare's CLI. Install globally with `npm i -g wrangler` or
use `npx` per-command.

---

## 9. Deploying

**Automatic**: any commit pushed to `main` deploys to production within
~30 seconds.

```bash
git add .
git commit -m "your message"
git push origin main
```

Watch the deploy at:
https://dash.cloudflare.com → Workers & Pages → `elinno-agent` → Deployments

**Rollback**: every deploy gets a permanent URL like
`abc1234.elinno-agent.pages.dev`. From the Deployments tab, click the
`...` menu next to any past deploy → "Rollback to this deployment".

---

## 10. Roadmap & next steps

Pick up from any of these:

### A. Polish the welcome page
- Iterate on copy, colors, typography
- Add a logo or hero illustration
- Add an **email-capture form** for "notify me at launch"
   - Could write to D1, Google Sheets, or a service like Buttondown / ConvertKit

### B. Build the user-account system (the main next milestone)
1. Create a D1 database via Cloudflare dashboard or `wrangler d1 create elinno-agent-db`
2. Bind it to the Pages project (Settings → Functions → D1 database bindings, name it `DB`)
3. Apply schema:
   ```bash
   npx wrangler d1 execute elinno-agent-db --file=./schema.sql
   ```
   (uncomment the example tables in `schema.sql` first)
4. Build the Pages Functions:
   - `functions/api/signup.js` — POST: create user, hash password (use Web Crypto API + scrypt or bcrypt-compatible), set session cookie
   - `functions/api/login.js` — POST: verify password, set session cookie
   - `functions/api/logout.js` — POST: delete session, clear cookie
   - `functions/api/me.js` — GET: return current user from session cookie
   - `functions/_middleware.js` — shared auth check, sets `request.user` for downstream functions
5. Build the frontend pages:
   - `public/login.html`
   - `public/signup.html`
   - `public/dashboard.html` (protected — checks `/api/me`)
6. Session strategy: HTTP-only, Secure, SameSite=Lax cookie containing a random session token; the token maps to a row in `sessions` table with an `expires_at`.

### C. Add Cloudflare Web Analytics
- Free, privacy-friendly, GDPR-friendly
- Setup: dashboard → Analytics & Logs → Web Analytics → Add a site → paste snippet into `<head>` of `public/index.html`

### D. SEO basics
- Add a real `og:image` (currently no image set)
- Add `robots.txt` and `sitemap.xml` in `public/`
- Verify with Google Search Console (DNS or HTML-file verification)

---

## 11. Conventions for this repo

- **Branching**: `main` is production. Features go on short-lived branches and merge back via PR (or direct push if solo).
- **Commits**: prefer Conventional Commits style (`feat:`, `fix:`, `chore:`, `docs:`).
- **No build step (yet)**. Keep `public/` directly servable. If/when a build step is added, update Cloudflare Pages settings.
- **Secrets** never go in the repo. Use Cloudflare's **Settings → Environment variables / Secrets** UI for anything sensitive that runtime code needs.

---

## 12. How to use this document with Claude Code

```bash
# In the project directory
cd elinno-agent
# Place this file at the root (already there if pulled from main)
# Then launch Claude Code
claude
```

Then in your first prompt:

> Read PROJECT.md and tell me you understand the project. Then I'd like to start working on [task].

Claude Code will read this file and have full context — stack, layout,
conventions, where things live, what's planned next.

---

*Generated during initial project setup, 2026-04-28.*
