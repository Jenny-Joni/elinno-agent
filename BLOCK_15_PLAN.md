# Block 15 Plan — Project logo upload

> **Status:** Draft 2026-05-26. Block 14 (QA pass, `a9c45ee`) + bug-fix
> `796016d` (conv-title overflow) are production. Block 15 unblocks the
> v1.3.1 carry-forward originally deferred per BLOCK_12_PLAN decision N.
>
> **Cadence:** two ff-merged sub-blocks, each verified on preview then
> in production before the next.
> - **15.1** — R2 + schema + upload endpoint + settings-page UI (the
>   feature ships closed-loop on the project_settings.html surface).
> - **15.2** — wire the uploaded logo into the four display surfaces
>   (dashboard cards, cross-project chat scope chips, citation chips,
>   project page header avatar).

---

## 1. Context

The project_settings.html General tab renders a deliberately disabled
"Upload logo" button (`disabled title="Coming in v1.3.1"`) per Block 12
decision N. The deferral was scoped explicitly: "R2 binding,
`projects.logo_r2_key` column, multipart upload endpoint, signed-URL
retrieval — none of these are in the Block 12 critical path" (BLOCK_12
lines 83–86).

This block delivers the deferred feature. Decisions locked 2026-05-26
in chat:

- **Public R2 bucket via custom domain** (`logos.elinnoagent.com`) is
  the retrieval strategy. Project logos are not sensitive (the URL
  is no more revealing than the project name already on the dashboard);
  the simplest pattern wins. Worker proxy and signed URLs were
  considered and rejected as overkill.
- **Sub-block 15.1 = upload + persist on the settings page only.**
  Display surfaces are 15.2. Smaller commits, smaller blast radius,
  ship-and-verify each.

---

## 2. Scope (Block 15.1)

### 2.1 Cloudflare account-level setup (Jenny — outside the repo)

These are the prereqs Claude cannot do because they're Cloudflare
dashboard / account-level actions. **Jenny runs each step before the
matching repo change lands.**

1. **Create R2 bucket** `elinno-agent-logos` (dashboard → R2 → Create
   bucket). Default settings — no preview/staging override needed
   since the bucket is shared across prod + preview deploys (matches
   the D1/Hyperdrive pattern). Logos are versioned by key, so prod
   uploads don't collide with preview uploads.
2. **Connect custom domain** `logos.elinnoagent.com` to the bucket
   (R2 bucket → Settings → Custom Domains → Connect Domain). Cloudflare
   auto-creates the DNS record because the apex `elinnoagent.com` is
   already on Cloudflare. Verify a manual `PUT` lands and a public
   `GET https://logos.elinnoagent.com/<key>` returns 200.
3. **CORS config** on the bucket (R2 → bucket → Settings → CORS):
   - `AllowedOrigins`: `https://elinnoagent.com`,
     `https://*.elinno-agent.pages.dev`
   - `AllowedMethods`: `GET` (uploads go through the Worker, not
     direct browser → R2; only reads need CORS)
   - `AllowedHeaders`: none (no custom headers on GET)

### 2.2 wrangler.toml R2 binding (Claude)

Add to the top-level block (mirrors the `[[d1_databases]]` and
`[[hyperdrive]]` stanzas):

```toml
[[r2_buckets]]
binding = "LOGOS"
bucket_name = "elinno-agent-logos"
```

Binding name `LOGOS` (uppercase, matches `DB` and `HYPERDRIVE`
convention). Applies to Production and Preview environments per the
top-level (no `[env.preview]` / `[env.production]` override pattern
already in use). Verification: a Pages preview deploy after this
commit + `ctx.env.LOGOS` is truthy from a smoke endpoint.

### 2.3 Schema migration (Claude drafts, Jenny runs — security carve-out)

**File:** `db/migrations/2026-05-26-block-15-projects-logo.sql`

```sql
-- Block 15: project logo upload (deferred from Block 12 decision N).
-- logo_r2_key stores the R2 object key when a logo is uploaded; NULL
-- means "no logo, render the initial-letter placeholder."
-- The key embeds a random suffix to bust the CF edge cache on re-upload
-- (e.g., '2fc38f6b-954d-44ca-8d1d-8d6bf947ba88/abc123.png').

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS logo_r2_key TEXT;

-- No index needed: logo_r2_key is per-row metadata, never queried by.
-- No backfill: NULL is the desired default (= placeholder rendering).
```

Per CLAUDE.md security carve-outs, **Jenny pastes this into the Neon
SQL Editor** after Claude's plan + draft is approved. Claude does NOT
run remote DB DDL.

### 2.4 Upload endpoint (Claude)

**File:** new `functions/api/projects/[id]/logo.js`

**POST** `/api/projects/:id/logo`:

- Auth gate: existing session check (mirrors
  `functions/api/projects/[id].js` patterns).
- Project-scoping: verify the authed user is the project owner via
  `projects.owner_user_id = <session.user_id>` (v1.3-and-later
  membership model: workspace-admin = project-admin). **Security
  carve-out: project-scoping enforcement. Default mode, never auto.**
- Body parse: `await request.formData()` (Workers/Pages native
  multipart support); read field `file`.
- Validation:
  - MIME type ∈ {`image/png`, `image/jpeg`}. Reject otherwise → 415.
  - Size ≤ 1 MB (1,048,576 bytes). Reject larger → 413.
  - **No dimension check.** UI says "square recommended" but server
    accepts any aspect; frontend renders via `object-fit: cover`.
    Image dimension parsing in a Worker requires WebAssembly or pure-
    JS PNG/JPEG decoders; out of scope.
- R2 put:
  - Key format: `<project-id>/<8-char-random>.<ext>` where ext is
    derived from MIME (`png` or `jpg`). Random suffix = cache-bust on
    re-upload.
  - `ctx.env.LOGOS.put(key, file.stream(), { httpMetadata: { contentType: file.type } })`.
- DB update:
  - `UPDATE projects SET logo_r2_key = $1, updated_at = NOW() WHERE id = $2`.
  - If the project had a previous `logo_r2_key`, capture it before
    the update and **delete it from R2 after the DB update commits**
    (orphan-safe ordering: keep old key live until new key is
    persisted; clean up only after DB confirms).
- Response: 200 `{ logo_url: 'https://logos.elinnoagent.com/<key>', logo_r2_key: '<key>' }`.

**DELETE** `/api/projects/:id/logo`:

- Same auth + project-scoping.
- If `logo_r2_key` is set: delete the R2 object, then
  `UPDATE projects SET logo_r2_key = NULL, updated_at = NOW() WHERE id = $2`.
- Response: 204.

### 2.5 GET endpoint patches (Claude)

**File:** `functions/api/projects/[id].js`

Add `logo_url` to the response. Computed server-side:

```js
logo_url: row.logo_r2_key
    ? `https://logos.elinnoagent.com/${row.logo_r2_key}`
    : null,
```

Same pattern in `functions/api/projects.js` (list endpoint) — 15.2 needs
it on dashboard cards; safer to ship the field in 15.1 so 15.2 is a
pure-frontend block.

### 2.6 Frontend (Claude)

**File:** `public/project_settings.html`

Replace the disabled button (line 739) with:
- A real `<input type="file" accept="image/png,image/jpeg">` (visually
  hidden) + a styled `<button>` label that triggers the file input.
- File-selected state: show client-side preview (FileReader → data
  URL) + an "Upload" / "Cancel" action pair.
- Upload-in-flight state: disable both buttons, show inline spinner.
- Success state: replace placeholder avatar with `<img src="...">`,
  show "Replace" + "Remove" buttons.
- Existing logo state (page load with `project.logo_url` truthy):
  render the `<img>` directly + "Replace" + "Remove" buttons.
- Error states: too-large file (client-side check ≤ 1 MB before POST
  + server-side enforcement), wrong type, network failure. Surface a
  single-line error under the upload control with the existing
  `.ps-action-msg` styling pattern.

### 2.7 Out of scope (deferred to 15.2)

- Dashboard cards (`public/dashboard.html`) — render `project.logo_url`.
- Cross-project chat scope chips (`public/cross-project/chat.html`).
- Citation chips (project-prefix pill — multiple call sites).
- Project page header avatar (`public/project.html` — currently the
  initial-letter circle on the header).

---

## 3. Carve-outs flagged

Per CLAUDE.md, these run in default mode (never auto). Each one
gets its own pre-execute approval:

| Carve-out | Where | Default-mode reason |
|---|---|---|
| Schema migration | `db/migrations/2026-05-26-block-15-projects-logo.sql` | DDL on production Neon. Claude drafts, Jenny runs. |
| Project-scoping enforcement | `functions/api/projects/[id]/logo.js` (the `owner_user_id` check) | New write surface; the auth gate is security-critical. |

The R2 binding edit, the `wrangler.toml` change, the frontend HTML/CSS,
and the GET response patches are regular code — auto mode under an
approved plan.

---

## 4. Iteration cap + rollback

- **One-fix rule** applies. If the upload endpoint or schema migration
  fails verification, drop to default mode and report; don't write a
  second fix commit in auto mode.
- **Rollback** for 15.1 if the upload endpoint regresses anything:
  - Revert the wrangler.toml R2 binding (forces preview rebuild
    without `ctx.env.LOGOS`).
  - Revert the endpoint file.
  - The DB column stays (NULL by default = safe; nothing reads
    `logo_r2_key` until 15.2).
  - The R2 bucket + custom domain stay (no harm without traffic).
- **Rollback** for the schema migration: `ALTER TABLE projects DROP
  COLUMN logo_r2_key;` (Jenny runs). Only do this if 15.1 is being
  fully abandoned.

---

## 5. Order of operations (Block 15.1)

1. **Jenny:** create R2 bucket + custom domain + CORS (2.1).
   Verify with a manual upload via the Cloudflare dashboard.
2. **Claude:** branch `block-15-1-logo-upload`, add R2 binding to
   `wrangler.toml` + write a one-line smoke endpoint that confirms
   `ctx.env.LOGOS` is truthy. Preview-deploy verify.
3. **Jenny:** run the schema migration in Neon SQL Editor.
   Confirm the column exists.
4. **Claude:** write `functions/api/projects/[id]/logo.js` (POST +
   DELETE), patch `functions/api/projects/[id].js` to include
   `logo_url`, patch `functions/api/projects.js` to include `logo_url`.
   Preview-deploy verify with `curl` (matrix in `curl-matrix-block-15-1.md`).
5. **Claude:** rebuild the upload section of `public/project_settings.html`.
   Preview-deploy verify with the live Chrome session.
6. **Jenny:** approve push to main → ff-merge → verify on prod
   (`elinnoagent.com`).
7. **Claude:** delete the branch (local + origin, per Jenny's standard
   cleanup pattern).
8. **Claude:** add a "Block 15.1 SHIPPED" section to HANDOFF.md.

15.2 plans land in a follow-up planning slot.

---

## 6. Open questions before execute

None — all decisions locked 2026-05-26 in chat. Plan ready for
approval.
