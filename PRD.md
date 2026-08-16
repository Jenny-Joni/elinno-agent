# Product Requirements Document

**Elinno Agent — Project Intelligence Platform**

| Field | Value |
|---|---|
| Document | PRD v1.4 |
| Owner | Jenny (jenny@elinnovation.net) |
| Status | Living doc — reflects the shipped v1.4 product |
| Last updated | 2026-06-03 |
| Related | Build Plan, HANDOFF.md, PROJECT.md |

---

## 1. Summary

Elinno Agent is a multi-tenant project intelligence platform. An admin creates a project, connects the team's existing tools (Jira and Slack in v1.1; Monday and Google Drive in v1.2 — see §11.2), and the platform syncs and indexes that data into a unified store. Team members then chat with an AI assistant scoped to a single project, asking questions like "How many tickets are still open in this sprint?" or "How much did we spend on testing this quarter?"

The AI does not guess. Every answer is derived from a tool call against the synced data, and every fact in a response links back to its source so the user can verify. The v1.1 MVP set (Slack + Jira) is deliberate; the architecture is built so additional connectors (Monday and Google Drive planned for a later release; Notion, Telegram, GitHub, etc. as plug-in modules after that) can be added without core changes.

---

## 1.1 What's shipped since v1.2 (current state — v1.4)

The original PRD framed cross-project AI, mobile, and most of the workspace surfaces as future work. Several of those have since shipped. This section (added 2026-06-03) is the authoritative list of what is **live in production today**; the detailed requirements in §§3–11 have been updated in place to match, and the items below note where a feature graduated out of the §11 backlog.

- **Cross-project AI mode — SHIPPED** (was §11.1 "planned for v1.2"). A workspace-level chat surface lets a user query across multiple projects at once. Combos are addressed by `'+'`-joined, alphabetically-sorted project slugs in the URL (e.g. `/cross-project/joni+rain`). Tools accept a `project_ids` array; the agent path enforces per-project authorization server-side. See §11.1 for the as-built notes.
- **Shared-workspace project visibility — SHIPPED** (2026-05-27). Projects are now **shared across all users in the workspace** rather than scoped to a single owner: any authenticated workspace user sees every live project. Cross-project **chats remain per-creator** — each user keeps their own combinations and history. (The v1.4 workspace model is still "solo": one workspace == one D1 user; a real `workspaces` table is a future migration.)
- **Workspace dashboard — SHIPPED.** A single summary screen (`/dashboard`) renders, in one load: the user identity, the workspace cross-project AI cap + month-to-date spend, the user's recent cross-project chats, and a card per project with its active Jira sprint summary (sprint name, dates, days-left, % complete) and ticket counts (total / open / done). Projects render above cross-project chats.
- **Sprint View — SHIPPED.** A read-only "Sprint View" tab on the project page renders the active Jira sprint as a dashboard: header + date-based progress bar, summary cards, status-category and board-status charts (columns colored by category, with story-point subtitles), assignee workload, and a grouped/filterable issue list. It reads Neon directly via the existing sprint executors — **no agent loop, no extra model spend**. It's the default tab whenever Jira is connected (empty state when there's no active sprint).
- **Global project ordering — SHIPPED.** Workspace admins can drag-and-drop to set a **workspace-global** display order for projects (`projects.sort_position`); the order is the same for every user and is honored by both the projects list and the dashboard. Admin-only, enforced server-side.
- **Project logos — SHIPPED.** Projects carry an optional logo (`logo_r2_key`) served from a CDN (`logos.elinnoagent.com`); an initial-letter placeholder renders when none is set.
- **Workspace settings — SHIPPED.** A workspace-settings screen surfaces workspace metadata (name, plan, project count) and the cross-project AI cap state (cap, MTD spend, period start, reset date).
- **Mobile-responsive web + zoom lock — SHIPPED.** All authed screens are responsive (stacked cards, single-column collapse, off-canvas drawers). Pinch- and double-tap-zoom are disabled app-wide so screens stay at a fixed device-width size (viewport `user-scalable=no` plus a JS backstop for iOS Safari, which ignores the meta). This is an intentional product decision — note it supersedes the earlier WCAG-1.4.4 "consider reversing" caveat. **Native mobile apps remain out of scope.**

- **What's new — SHIPPED** (2026-08-02, see §5.11). A hand-curated, roughly-weekly in-product digest of user-facing changes at `/whats-new.html`, with a dashboard strip and a nav link on every authed page. Entries carry a `draft`/`published` status so a half-written issue cannot go live on an unrelated push; publication is a separate explicit command. Static — no endpoint, no schema change.

**Still deferred** (unchanged from the backlog): Monday + Google Drive connectors (§11.2 — v1.4 ships Jira + Slack only), write-back to source systems, per-user permission mirroring, audit log, and paid tiers (§11.3).

---

## 2. Problem & Goals

### 2.1 The problem

Project information lives across at least four tools. Status updates require humans to manually aggregate from Jira, cross-reference Monday for budget, scan Slack for context, and hunt through Drive for the relevant spec. This is slow, error-prone, and produces stale answers by the time a question is asked twice. v1.1 covers the Jira + Slack pieces; Monday and Drive ship in v1.2 (see §11.2).

### 2.2 Goals (what success looks like)

- **Single source for project questions:** answers come back in seconds, with citations to the underlying record.
- **Trustworthy by construction:** the AI never invents numbers; aggregations are computed in SQL, not by the model.
- **Scoped per project:** data and AI access are isolated so cross-project leakage is not possible.
- **Pluggable connectors:** adding the fifth, sixth, tenth integration is days of work, not weeks.

### 2.3 Non-goals

- ~~Cross-project AI mode.~~ **Shipped in v1.4** (see §1.1 and §11.1). Both project-scoped and cross-project chat now exist; project chat remains the default surface.
- Writing back to source systems (creating Jira tickets, posting to Slack, etc.). Read-only through v1.4.
- Real-time streaming chat dashboards. The chat is request/response.
- Mobile-**native** apps. The web app is mobile-responsive (see §1.1), but there is no native iOS/Android app.
- Per-user permission mirroring from source systems. The bot operates with the credentials provided at connection time; what the bot can see, every user in the workspace can see.

---

## 3. Users & Roles

| Role | What they do | Key capabilities |
|---|---|---|
| **Admin** | Creates the workspace and projects, connects external systems, manages members and billing, and sets the workspace-global project display order. | Full control: workspace settings, projects, connectors, members, billing, global project ordering. |
| **Member** | Asks questions in project chat and cross-project chat. | Read-only chat access; sees citations and source links. |
| **AI Bot** | Internal actor that runs tools on behalf of users. | In project mode, scoped to a single project. In cross-project mode, scoped to the explicit set of projects the user selected, with per-project authorization re-checked server-side on every tool call. |

> **Shared-workspace visibility (v1.4):** projects are shared across the whole workspace — every authenticated user sees all live projects (the earlier per-owner scoping is retired). Cross-project **chats** remain per-creator. The v1.4 workspace model is still "solo" (one workspace == one D1 user); a multi-user `workspaces` table is a future migration.

---

## 4. Core User Stories

### As an Admin

- I can create a new project with a name and description.
- I can add connections to Jira and Slack in v1.1 (Monday and Google Drive in v1.2) using each service's recommended auth method (OAuth where supported, API token otherwise).
- I can see the sync status of each connection: last sync time, record counts, and any errors.
- I can disconnect or reconnect a service, and trigger a manual full re-sync.
- I can invite teammates to the project as Members.

### As a Member

- I can open a project and see a chat interface.
- I can ask natural-language questions and get answers with citations linking back to Jira issues or Slack threads (Monday items and Drive files in v1.2).
- I can see when data was last synced, so I know how fresh the answer is.
- I can view my conversation history within a project.

### As the System

- I encrypt every credential at rest with envelope encryption.
- I sync incrementally; full re-sync is an explicit action.
- I scope every AI tool call to the project ID; cross-project access is rejected at the tool layer regardless of prompt content.

---

## 5. Functional Requirements

### 5.1 Account & access

- Email + password authentication for app users (Admin, Member).
- Session cookies: HTTP-only, Secure, SameSite=Lax.
- Roles enforced at the API layer; the frontend role gating is convenience only.

### 5.2 Projects

- A project has: name, slug, description, owner, created_at, updated_at, an optional logo (`logo_r2_key`, served from `logos.elinnoagent.com` with an initial-letter placeholder fallback), and a workspace-global `sort_position`.
- Each project has its own connection set, sync schedule, AI conversation history, and entity store.
- **Visibility is workspace-wide (v1.4):** every authenticated workspace user sees all live projects (see §3).
- **Global display order (v1.4):** admins set a single workspace-global project order by drag-and-drop. `sort_position` is workspace-global (no per-user state); the projects list and the dashboard both honor it. Reordering is admin-only, validated and applied server-side as an exact permutation of the live project set.
- Soft delete (archive); hard delete is an admin-only action with a confirmation step.

### 5.3 Connectors (MVP set)

| System | Auth method | Sync mode | Primary use |
|---|---|---|---|
| **Jira** | OAuth 2.0 (3LO) or API token + email | Incremental every 15 min; webhooks where available | Tickets, sprints, statuses, story points |
| **Slack** | OAuth bot token (workspace-scoped) | Real-time via Events API; backfill on connect | Channel messages, threads, reactions |

Monday and Google Drive deferred to v1.2 — see §11.2 for connector designs (auth, sync modes, tools, storage views).

### 5.4 Credential storage

- All credentials stored in a dedicated secrets store (cloud KMS-backed) or, if stored in the app database, encrypted with envelope encryption: a KMS-managed master key encrypts a per-tenant data key, which encrypts the actual secret.
- Database holds only references and minimal non-secret metadata (e.g., scope, expiry, account_id).
- OAuth refresh tokens are rotated automatically; failed refreshes mark the connection as DEGRADED and surface a re-auth prompt to the admin.
- Plaintext credentials are never logged. Logs and error reports redact secret fields by allow-list.

### 5.5 Data ingestion & storage

- All synced records are normalized into a single `entities` table with: project_id, source, source_type, source_id, title, body, url, author, metadata (jsonb), raw payload, timestamps.
- Specialized SQL views (`jira_issues`, `slack_messages`) provide fast typed access for structured queries. v1.2 adds `monday_items` and `drive_files` views.
- Vector embeddings are computed at sync time for searchable content and stored in pgvector.
- Sync jobs run on a queue with retries, backoff, dead-letter handling, and per-connector rate limiting.

### 5.6 Freshness & manual re-sync

- Every AI response shows a "data as of" timestamp per source cited, so users can judge freshness at a glance.
- Admins can trigger a manual full re-sync per connection. Rate-limited to **1 per hour** per connection to protect source-system rate limits.
- Members cannot trigger a full re-sync. They can use a "refresh and ask again" action on any AI response, which performs a targeted refresh of only the sources cited in that response, then re-runs the question. Rate-limited to **5 per user per hour**.
- The agent loop can opt into a synchronous pre-fetch on the relevant source(s) when a question contains time-sensitive language (e.g., "right now," "today," "just") or when confidence is low. This is invisible to the user.
- If a re-sync fails (rate limit, auth failure, source outage), the user sees a clear message and the existing answer remains valid with its original timestamp.

### 5.7 AI assistant

- Backed by a tool-calling LLM (Anthropic Claude). The model never produces facts directly; it picks tools and synthesizes results.
- Tool catalogue (MVP):
  - `search_project_data` — hybrid keyword + semantic search across all sources.
  - `query_jira_issues`, `list_jira_sprints`, `get_jira_sprint_summary`, `aggregate_jira` (counts, sums by group).
  - `list_slack_channels`, `query_slack_messages`.
  - Monday + Drive tools (`list_monday_boards`, `get_monday_board_schema`, `query_monday_items`, `aggregate_monday`, `list_drive_files`, `read_drive_file`) ship in v1.2 — see §11.2.
- **Project mode:** every tool requires `project_id`; the server rejects cross-project calls regardless of LLM input.
- **Cross-project mode (v1.4):** tools accept a `project_ids` array; the server re-validates authorization for **every** project on **every** tool call — the LLM's argument list is never trusted.
- Every response includes citations (links to source records). Responses with zero citations are treated as a model failure and surfaced as such.
- Hard cap of ~6 tool iterations per user message to bound cost and latency.
- The Sprint View tab reuses the Jira sprint executors (`get_jira_sprint_summary`, `aggregate_jira`, sprint/issue list reads) **directly, bypassing the agent loop** — it's a read-only data view, so it incurs no model spend.

### 5.8 Admin UI

- Project list, project create flow, project members management.
- Connections panel per project: connect new, view status, manual re-sync (1/hour per connection), disconnect.
- Sync activity log: last 50 sync runs per connection with outcome and duration.

### 5.9 Member UI

- Chat interface, message history, citations rendered as inline links + source-record cards.
- "Data as of" freshness indicator on every AI response, per source cited.
- "Refresh and ask again" action on each AI response: targeted re-sync of only the cited sources, then the question is re-run automatically.
- Suggested example questions on first open per project.
- **Sprint View tab (v1.4):** read-only active-Jira-sprint dashboard (date-based progress, summary cards, status-category + board-status charts, assignee workload, grouped/filterable issue list). Default tab when Jira is connected; empty state when no active sprint.

### 5.10 Workspace surfaces (v1.4)

- **Dashboard (`/dashboard`):** one-load workspace summary — identity, cross-project AI cap + MTD spend, recent cross-project chats, and a per-project card showing the active Jira sprint summary (name, dates, days-left, % complete) and ticket counts (total / open / done). Projects render above cross-project chats.
- **Cross-project chat:** workspace-level multi-project chat surface. Combos are addressed by `'+'`-joined, alphabetically-sorted project slugs in the URL (e.g. `/cross-project/joni+rain`). Sidebar filters to the active combo; chats are per-creator.
- **Workspace settings:** workspace metadata (name, plan, project count) and cross-project AI cap state (cap, MTD spend, period start, reset date).
- **Mobile:** all of the above are mobile-responsive with zoom locked to device width (see §1.1 and §7).

### 5.11 What's new

#### 5.11.1 Purpose

Users have no way to learn what changed in the product. Ten sessions of work shipped between 2026-05-24 and 2026-08-02 — Sprint View, shared-workspace visibility, workspace Sync now, the Jira sprint-membership fix — with no in-product announcement of any of it. Features that shipped correctly go unused because nobody knows they exist.

**What's new** is a manually-curated, roughly-weekly digest of user-facing changes, published at the owner's explicit command. It is not an automatic deployment log.

#### 5.11.2 Scope

**In scope**

- A `/whats-new.html` page listing releases, newest first.
- A dashboard strip surfacing the latest release.
- A per-user unread marker, stored client-side.
- Content authored by hand, one entry per release, reviewed before publication.

**Out of scope**

- Automatic generation from commits, deploys, or `HANDOFF.md`.
- Email or push delivery. The digest is in-product only.
- Per-role or per-project filtering of entries (see 5.11.9).
- An admin UI for authoring entries. Content ships as code.
- Comments, reactions, or any read-receipt telemetry.

#### 5.11.3 Versioning

Releases are versioned (v1.5, v1.6, …), continuing the existing v1.1 → v1.4 line, which has had no version marker since v1.4 shipped on 2026-05-23.

**Version numbers are assigned by hand, per issue.** There is no bump rule to consult and no automatic derivation. Two constraints follow, both on how code reads the field:

- **Never order or compare by parsing the version string.** Ordering is by array position or date. String comparison would sort v1.10 below v1.9.
- **Version strings must be unique.** The unread marker (§5.11.10) fires when the stored value differs from the newest published version, so reusing a number means nobody gets a marker for the second issue. `whats-new-badge.js` warns on load when two entries share a version.

A release carries a date alongside its version. The date is the week the digest is published, not the date the underlying code shipped — manual curation means these differ, and that is expected.

#### 5.11.4 Cadence

Target is weekly. A week in which nothing user-facing shipped produces **no entry** — an empty or padded issue is worse than a gap. Because entries are headed by date, gaps read as normal rather than as neglect.

#### 5.11.5 Content model

Each release is one object:

```js
{
  version:  'v1.5',
  date:     '2026-08-02',
  status:   'draft',            // 'draft' | 'published'
  headline: 'Sprint numbers now match your Jira board, and you can refresh every connection at once.',
  features: [
    { tag: 'New', title: 'Sync now', body: '…', image: '/whats-new/v1-5-sync-now.png', alt: '…' }
  ],
  fixes: [ 'Issues carried over from an earlier sprint were counted against the wrong sprint.' ]
}
```

| Field | Rule |
|---|---|
| `version` | Required. Semantic, `v`-prefixed. Assigned at publish, not at draft — several sessions can feed one weekly issue. |
| `date` | Required. Publication date. |
| `status` | Required. `'draft'` or `'published'`. Only published entries render. |
| `headline` | Required. One sentence. Rendered in the dashboard strip and in collapsed rows. |
| `features` | Zero or more. Each gets a tag, title, short explanation, and a preview image. |
| `fixes` | Zero or more `{ tag, text }` objects, `tag` defaulting to `Fixed`. **Never** carry images. The tag exists because not every line under "Also fixed" is a fix — small new behaviour belongs there too, and would otherwise be mislabelled or pushed into `features[]`, which then owes a preview image it does not need. |

`tag` is one of `New`, `Improved`, `Fixed`.

**Features get previews; fixes do not.** If every item carried an image, a thin week would read as a large one and the authoring cost would make the weekly cadence unsustainable.

#### 5.11.6 Preview images

Preview screenshots may be **captured by Claude Code**. *Amended 2026-08-16 on Jenny's explicit direction. Previously: "supplied by Jenny … Claude Code does not capture, generate, or edit them", with the capture pipeline deliberately removed when authoring moved to Jenny (see §5.11 notes and the 2026-08-02 closeout).*

The amendment covers **images only**. Entry copy remains Jenny's, unchanged — see the division of labour in HANDOFF.md, "Adding an entry to What's New".

Every other rule in this section still binds. The **Contents** row binds hardest and is the reason this amendment is narrow: a captured screenshot must carry no real project names, Jira keys or assignee names, so captures are taken against invented stand-ins — not against the live workspace, whose projects and members would otherwise be frozen into the release notes permanently. Block 16.9 is the cautionary case and is still open in HANDOFF.

| Item | Rule |
|---|---|
| Location | `public/whats-new/`, committed to the repo and served by Pages |
| Naming | `v{version}-{slug}.png` — e.g. `v1-5-sync-now.png`. Version in the filename makes cache-busting automatic and stale images identifiable. |
| Format | PNG |
| Crop | Tight to the element that changed — the button, the row, the chart. A full-screen desktop capture is unreadable in the ~270px mobile column. |
| Contents | No real project names, Jira keys, or assignee names. What's New is visible to every user in the workspace. (Block 16.9 is the cautionary case: two `_dev` mockups carrying real assignee names and sprint data were tracked into `public/` and served publicly. See HANDOFF.md.) |

R2 was considered and rejected: it would allow publishing an image without a deploy, but publication requires a deploy anyway since the content constant ships as code.

**A feature entry is not publishable without its image.** If copy arrives without one, the entry stays `draft` — unless Jenny explicitly chooses to publish ahead of the screenshot, in which case the preview slot renders a labelled placeholder until the PNG lands. v1.5 shipped this way on 2026-08-02.

The placeholder is a **schematic wireframe**, captioned "Placeholder — real screenshot goes here" so it reads as a stand-in rather than as a picture of the screen.

Two forms are allowed, chosen by what the feature actually is:

- **Abstract** — grey bars, no product copy. The default, and correct whenever the change is structural: a new button, a moved row, a chart.
- **Verbatim** — the real shipped strings. Correct only where the feature's content *is* text and grey bars would convey nothing, as with suggested questions, where which sentences appear is the entire change.

What stays forbidden is the middle ground: a realistic drawn approximation that invents plausible-looking copy. That would publish a preview showing behaviour the product does not have, which is the failure this section exists to prevent. A verbatim preview avoids it by being exactly true; an abstract one avoids it by claiming nothing.

**Verbatim previews are accurate at publication and frozen thereafter.** The strings must match the shipped strings exactly on the day the entry is published — a pre-publication check, made once, alongside the copy review. They are not maintained afterwards. A later release changing a question does not make an older entry wrong: an entry records what shipped in that release, and rewriting it to match current behaviour would destroy the record it exists to keep. For that reason preview strings are duplicated here rather than imported from the live catalog. The duplication is deliberate.

**Interpolated strings take an invented value.** Where a shipped string interpolates real data — a sprint name, a project name — the preview shows a plausible invented stand-in, never a real one. Verbatim means verbatim to the template, not to any workspace's data. See the Contents row above, and Block 16.9.

Placeholder markup lives in `whats-new.html`, keyed by a `placeholder` field on the feature, so the content constant stays copy-only.

#### 5.11.7 Publication workflow

Visibility is gated by the `status` field; deployment is gated by git. These are two separate things.

1. Owner requests a draft. Content is written into the changelog constant with `status: 'draft'`.
2. Pushing to `main` deploys that code. A draft entry is **still invisible to users** — the page and strip render published entries only.
3. Owner says publish, explicitly and separately. `status` flips to `'published'`, and the entry goes live on the next deploy.

The flag is load-bearing because session closeouts push to `main` mid-week. Without it, a half-assembled weekly issue would go live the moment any unrelated commit shipped. Claude Code cannot publish: the deny hook blocks pushes to `main`, so step 3 is always Jenny's.

#### 5.11.8 Surfaces

**Page — `/whats-new.html`**

- Latest published release expanded; earlier releases collapse to a single row showing version, date, and headline. Prevents unbounded scroll as issues accumulate.
- Reachable from a permanent nav link, so the page cannot become orphaned the way `workspace_settings.html` currently is (nothing links to it).
- Renders an empty state when nothing is published.

**Dashboard strip**

- Sits above the Projects section on `/dashboard.html`. Shows the latest published release's version, date, and headline; links to the page.
- Permanent. Only the unread markers clear on read — if the strip itself disappeared, the dashboard would reflow and the entry point would exist only for users who had not yet clicked it. Renders a neutral variant when nothing is published.

**Nav link**

- `What's new`, first in `.app-nav-actions`, left of `Admin`. Present on all six authed pages — dashboard, projects, project, project_settings, workspace_settings, admin. Members see it, giving that row something besides avatar and Log out.
- **Hidden below 700px.** A fourth item does not fit the mobile nav row, and `.app-nav` translates offscreen on scroll-down anyway. The dashboard strip carries discovery on mobile.

#### 5.11.9 Audience

All users see the same entries. Admin-only features (for example workspace Sync now) are described in neutral language and labelled as admin-only in the body text rather than filtered out.

Rationale: per-role filtering means tagging every entry by audience and maintaining that tagging forever, to spare members the mild confusion of reading about a button they do not have. The trade is not worth it at this scale.

#### 5.11.10 Unread state

A single `localStorage` key holds the last version the user has read. When it differs from the newest published version, an unread dot renders on the nav link and a `New` pill renders on the dashboard strip. Both clear together on visit.

Per-device, so the marker can reappear on a second browser. Accepted: cross-device correctness would require a `last_seen_version` column on the D1 users table — a schema migration, therefore a security carve-out and a DDL approval gate — in exchange for not seeing a dot twice.

**Forward-compatible.** If per-device drift proves annoying, the server-side column can be added later without changing the content model or either surface.

#### 5.11.11 Non-functional

| Requirement | Detail |
|---|---|
| No backend | Static page, static content constant. No new API endpoint, no D1 or Neon read. The page reuses `/api/me` for its auth gate. |
| No migration | Nothing added to any schema. |
| Additive CSS | New `.wn-*` block appended to `auth.css`. No existing selector modified. Verified: no `.wn-` prefix existed in the codebase beforehand. |
| Mobile | Existing constraints apply — 44px tap targets, `overflow-x: clip`, zoom locked. |
| Accessibility | Every preview image carries an `alt`. Unread dot is decorative and not the sole carrier of meaning; the `New` pill is text. |
| Reduced motion | No animation introduced. |

#### 5.11.12 Dependencies and consequences

- **Cache-bust.** New CSS in `auth.css` only reaches pages whose query string is bumped. Verified 2026-08-02: all shipping pages were **uniform** at `2026-06-03-1` — the one outlier, `2026-06-01-2`, is on `public/_dev/components.html`, a dev gallery rather than a shipping page. Every page touched by this work moves to a single new value; untouched pages are left alone.
- **Preview images.** A *feature* entry needs its image before it can publish (§5.11.6); Jenny supplies both image and copy. Fix-only entries need neither, which is why v1.4 and v1.3 ship published while v1.5 waits on its two previews. There is no capture tooling and no seeded-user prerequisite — that pipeline was removed once authoring moved to Jenny.
- **`.app-nav-actions` below 700px.** Verified 2026-08-02: defined once, never touched inside any `@media` block — the only mobile nav rule is `.app-nav.is-hidden` (sticky hide/show). Hiding the link on mobile therefore required a new rule, not an override.
- **Deferred, not adopted here.** `workspace_settings.html` being unreachable, the `Cross-project` nav link that only that page carries, and full cache-bust alignment across all pages are pre-existing issues. They are noted, not fixed, in this work.

#### 5.11.13 Success criteria

- A user who has not visited in a week sees an unread marker on login and can read what changed in under a minute.
- Publishing an issue requires no code change beyond editing one constant and adding image files.
- No release ships with an empty or padded entry.

---

## 6. Architecture & Hosting

Elinno Agent runs on Cloudflare's platform with one external piece for heavy-duty data. The auth foundation (Pages, Pages Functions, D1, Resend) is already deployed in production at elinnoagent.com; the connector and AI work builds on top of that, not next to it.

### 6.1 Stack

| Layer | Choice | Status |
|---|---|---|
| Frontend (welcome, login, admin, chat UI) | Cloudflare Pages | Live. |
| Light API (auth, projects, sessions) | Cloudflare Pages Functions | Live (auth endpoints shipped). |
| Auth database | Cloudflare D1 (SQLite, Frankfurt) | Live (users, sessions, password_resets). |
| Sync workers + AI agent | Cloudflare Workers | To build. |
| Job queue | Cloudflare Queues | To build. |
| Connector data + embeddings | Neon Postgres (with pgvector) via Hyperdrive | Provisioned (Block 1 in progress). |
| Email | Resend | Live (domain verified). |
| LLM | Anthropic Claude API (called from Workers) | To wire up. |

### 6.2 Why this split

- **Two databases by purpose, not by accident.** D1 is excellent for small, auth-shaped, edge-replicated data. Postgres + pgvector is what the connector data layer needs (real FTS, vector search, large JSON, heavy aggregations). Forcing one to do both would compromise either auth latency or query power.
- **Stay where things already work.** Auth, email, and hosting are deployed. Re-platforming would throw away working code and verified configuration without a clear win.
- **Free model alignment.** Cloudflare's free tier + Neon's scale-to-zero is one of the cheapest production stacks available. Important when there is no revenue offsetting infra cost.
- **Sidecar escape hatch.** If a specific connector ever needs a Node-only library that can't run in Workers, that one connector can run on a Render or Fly sidecar reached over HTTPS. The architecture does not assume Cloudflare-only forever.

### 6.3 Cloudflare-specific constraints

- Workers have a 30s CPU time limit (60s on Workers Unbound). Sync jobs and AI agent loops must chunk work; full backfills run as many small invocations rather than one long one.
- PBKDF2 iterations are capped at 100,000 in Workers Web Crypto. The auth system already accommodates this. Any future password-hashing change should verify runtime support before increasing iterations.
- Cloudflare Queues are still maturing. Adequate for v1.1; if limitations emerge, BullMQ on a Render/Fly sidecar is the migration path.
- Workers cold-start is not zero. Latency-sensitive endpoints (chat) should keep handlers small and avoid heavy cold-path initialization.
- **No managed KMS.** Cloudflare doesn't offer AWS-KMS-style managed key management. "KMS-backed" envelope encryption in our context means app-level envelope encryption with the master key stored in Workers Secrets (encrypted at rest by Cloudflare), wrapping per-tenant data keys in code. This satisfies the envelope-encryption property; it just isn't a separate managed service.

---

## 7. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | P50 chat response < 6s; P95 < 15s. Sync jobs do not block user-facing requests. |
| Availability | 99.5% target in v1.1. Single-region acceptable; multi-region is post-v1.1. |
| Security | All credentials encrypted at rest with envelope encryption. Transport TLS 1.2+. No secrets in logs. Project-scoped access enforced server-side. |
| Privacy | Users can request export and deletion of all data for a project. Sync data deletion cascades to embeddings. |
| Cost ceiling | Service is free to users; infrastructure cost is the company's burden. Per-project monthly AI cost cap; over-cap usage queues for next cycle and notifies the admin. Hard rate limits on chat messages per project per day. |
| Observability | Structured logs, per-connector sync metrics, AI tool-call traces, error budgets. |

---

## 8. Pricing & Limits

Elinno Agent is free to use in v1.1. There is no paid tier, no per-seat pricing, and no usage billing. All infrastructure cost (LLM calls, embeddings, hosting, storage) is borne by the company. This shapes several downstream decisions: usage limits exist to bound cost, not to upsell.

### 8.1 Per-project limits (v1.1 defaults)

| Limit | Default | Rationale |
|---|---|---|
| Chat messages per project per day | 100 | Bounds LLM cost. Soft limit — over-cap messages queue or return a friendly cap message. |
| Tool iterations per chat message | 6 | Caps a single question's cost; aligns with PRD section on AI assistant. |
| Connected systems per project | All MVP connectors | No artificial cap on which integrations a project can use. |
| Synced records per project | Soft cap 250k | Beyond this, ingestion slows and admin is notified. Prevents runaway storage. |
| Manual full re-sync per connection | 1 per hour (admin only) | Prevents accidental thrash on source-system rate limits. |
| Targeted re-sync per member | 5 per user per hour | "Refresh and ask again" action on a chat response; refreshes only cited sources. |
| Cross-project AI monthly cap | Per-user, configurable (default ~$20/mo) | Cross-project chat (project_id-null messages) is metered against a per-user month-to-date spend cap with a monthly reset; surfaced on the dashboard and workspace settings. |
| Members per project | Unlimited | No reason to cap; usage cost is dominated by chat volume, not membership. |

### 8.2 Cost discipline

Because there is no revenue offsetting infrastructure cost, the AI layer must be economical by design:

- Cheap model (Haiku) for routing and tool selection; strong model (Sonnet) only for final synthesis.
- Aggressive caching of stable lookups (sprint lists, board schemas, channel lists).
- Trim tool results before passing to the LLM — never raw 80-field JSON when 8 fields suffice.
- Embed once on sync, never on query. Use a small embedding model.
- Per-project monthly hard cap (configurable). Hitting the cap pauses AI for that project until the next cycle, with admin notification and a clear in-product message.

### 8.3 Future pricing

Free in v1.1 is a deliberate choice for adoption, not a permanent commitment. Post-v1.1 may introduce paid tiers (e.g., higher message caps, priority sync, more connectors, longer history retention) without changing the architecture. The cost-cap and rate-limit infrastructure built in v1.1 is the same machinery that would later differentiate tiers.

---

## 9. Success Metrics

- **Activation:** % of new projects that connect at least 2 systems within 24 hours of creation. Target: 70%.
- **Engagement:** median chat messages per active project per week. Target after launch: 15.
- **Trust:** % of AI responses with at least one citation. Target: 95%+.
- **Reliability:** % of sync runs that complete without error. Target: 98% rolling 7-day.
- **Latency:** P95 chat response time. Target: < 15s.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Hallucinated answers erode trust | Tool-calling architecture; LLM cannot produce facts without a tool result. Always show citations. Prompt explicitly forbids guessing. |
| Credential breach | KMS-backed envelope encryption, no plaintext in logs, scoped least-privilege OAuth scopes, rotation on schedule, immediate revocation flow on incident. |
| Cross-project data leakage via prompt injection | Project ID enforced server-side on every tool call; cannot be overridden by user/model input. Tool implementations re-verify caller authorization. |
| Source-system rate limits | Per-connector token-bucket rate limiter, exponential backoff, queued retries, prefer webhooks over polling where supported. |
| Infrastructure cost runaway (no revenue offset) | Hard per-project monthly AI cost cap with auto-pause. Daily message limits. Cheap-model routing before strong-model synthesis. Aggressive caching of stable lookups. Trimmed tool result payloads. Embed once at sync, never at query. Watch metrics closely; ratchet caps down if needed. |
| Stale data at query time | "Data as of" timestamp shown in every answer; high-stakes queries can opt into a synchronous pre-fetch. |

---

## 11. Post-v1.1 Backlog

Items deferred from earlier releases. §11.1 (cross-project AI) is retained in full as the **as-built record** — it has since shipped. The remaining items are still deferred and listed briefly.

### 11.1 Cross-project AI mode — SHIPPED in v1.4

> **Status: shipped.** This section was originally the v1.2 design sketch; the feature is now live. The design below held up as built — the notes are kept as the authoritative record. The key as-built specifics: combos are addressed by `'+'`-joined, alphabetically-sorted project slugs in the URL (e.g. `/cross-project/joni+rain`); projects are workspace-shared but cross-project **chats are per-creator**; and cross-project spend is metered against a per-user monthly cap (see §8.1).

The platform supports a second chat mode where a user can ask questions across multiple projects — "which project is most behind schedule?", "total spent on testing across all projects?", "compare velocity between Project A and Project B." This is the highest-privacy-risk feature in the system, so it was deliberately built only after the project-scoped flow was solid. The design:

#### Modes

- **Project mode (v1.1, unchanged).** Chat is bound to one project. Tools require `project_id`. Server rejects any cross-project access regardless of LLM input.
- **Cross-project mode (v1.2).** Separate chat surface at the workspace level. User explicitly opts in by entering this surface; mode is visible in the header at all times.

#### Access control

- The user must be a member of every project included in the query. Server validates membership per project on every tool call — the LLM's argument list is never trusted.
- New per-project setting: "Include in cross-project queries." Admin-only, default ON. Off by default for projects flagged as sensitive (NDA work, M&A, HR).
- If any selected project excludes itself, the AI says so plainly rather than silently dropping it.

#### Tool changes

- Existing tools accept either `project_id` (single) or `project_ids` (array). Behavior is identical otherwise.
- New tools: `compare_projects(metric, project_ids)` and `aggregate_across_projects(metric, project_ids, group_by)`.
- System prompt for cross-project mode is distinct — explicitly tells the LLM it is in cross-project mode and lists the projects in scope.

#### UI

- Workspace-level "Cross-project chat" entry point, separate from any single project.
- Project picker at the top: "All projects (5)" with checkboxes to narrow. Excluded projects are visibly grayed out with a tooltip.
- Citations grouped by project; "Sources from 4 projects" expandable rollup.
- Per-project breakdown rendering for comparison answers.

#### Limits & cost

- Separate, tighter daily message cap for cross-project mode (defaulting lower than per-project).
- Slightly higher iteration ceiling per message (e.g., 8 vs. 6) to accommodate broader scope, still bounded.
- Cross-project queries count against the workspace cost cap, not any single project's cap.

#### Risks specific to this mode

- **Permission elevation:** covered by per-call membership re-validation.
- **Prompt-injection blast radius widens;** project-scoped guardrails enforced server-side reduce but don't eliminate the risk. Treat any cross-project tool call as security-sensitive in logs.
- **Confidential project bleed:** covered by the "Include in cross-project queries" setting.
- **Citation noise from many sources:** covered by per-project rollup rendering.

#### v1.1 forward-compatibility

- v1.1 tool signatures should accept `project_id` as a string today but be defined in code in a way that extending to `project_ids: string[]` in v1.2 is non-breaking.
- v1.1 storage already keys all entities by `project_id`, so cross-project queries are a question of authorization + UI, not a data migration.

### 11.2 Monday + Google Drive connectors (planned for v1.2)

Originally locked as MVP connectors in v1.1; deferred to v1.2 to shorten the path to the first non-Jenny user. v1.1 ships with Slack + Jira. The connector designs are already settled at the shape level — what changes in v1.2 is execution, not architecture.

#### Monday

- **Auth:** API token (GraphQL).
- **Sync mode:** incremental every 30 min.
- **Surface:** boards, items, custom columns (budget/time tracking).
- **Storage:** `monday_items` SQL view over `entities`.
- **Tools:** `list_monday_boards`, `get_monday_board_schema` (boards have custom columns — schema must be checked before aggregation), `query_monday_items`, `aggregate_monday`.
- **Risk carried forward:** board heterogeneity (custom columns) — mitigated by the schema-discovery tool plus defensive type handling and currency normalization.

#### Google Drive

- **Auth:** OAuth 2.0 (read-only scopes).
- **Sync mode:** incremental every 60 min; change notifications.
- **Surface in v1.2:** Docs, Sheets, PDFs (text extracted). Images and OCR deferred further.
- **Storage:** `drive_files` SQL view over `entities`.
- **Tools:** `list_drive_files`, `read_drive_file`.
- **Long-document handling:** chunk + embed each chunk; the v1.1 hybrid keyword + semantic search handles unstructured retrieval without further changes.

### 11.3 Other deferred items

- **Audit log for admin actions.** Track who connected/disconnected what, who invited/removed members, who triggered re-syncs. Add when there are multi-admin projects or compliance pressure.
- **Drive: images and OCR.** Extract text from screenshots, scanned PDFs, and image files in Drive (after core Drive lands in v1.2 per §11.2).
- **Additional connectors.** Notion, Telegram, GitHub, Linear, HubSpot, etc. — added as plug-ins via the connector registry.
- **Write-back actions.** Creating Jira tickets, posting Slack messages, updating Monday items from chat. v1.1 is read-only by design.
- **Paid tiers.** Higher message caps, priority sync, longer history, more connectors. Architecture is ready; pricing is the open question.
- **Per-user permission mirroring.** Surface only data the asking user has access to in the source system, instead of project-level admin access.
- **Per-project sub-roles.** Project-scoped admin without billing access (re-introducing some of the Owner/Admin split from earlier drafts).
- **Mobile native apps.** v1.1 is web-only.

---

*End of PRD.*
