# BLOCK_17_PLAN.md — What's New

**Status:** approved 2026-08-02. Locked design decisions for the What's New
feature. Block 16.9 (`_dev` mockup data exposure) landed first and is recorded
in HANDOFF.md — see that section, not this one.

---

## Context

Users have no way to learn what changed in the product. Ten sessions shipped
between 2026-05-24 and 2026-08-02 — Sprint View, shared-workspace visibility,
workspace Sync now, the Jira sprint-membership fix — with no in-product
announcement of any of it. Features that shipped correctly go unused because
nobody knows they exist.

**What's New** is a hand-authored, roughly-weekly digest of user-facing
changes, published only at Jenny's explicit command. Not an automatic
deployment log. No backend, no schema change, strictly additive to existing
screens, gated behind the existing per-push-to-main approval.

### Authoritative sources

Four drafts, external to the repo at plan time (`~/Downloads/files/`):

| Draft | Merges into |
|---|---|
| `PRD_whats_new_addendum.md` | `PRD.md` as **§5.11** (PRD currently stops at §5.10) |
| `WORKFLOW_whats_new_addendum.md` | `WORKFLOW.md` § **End-of-session discipline** |
| `whats-new-mockup.html` | the `/whats-new.html` page layout |
| `dashboard-whatsnew-mockup.html` | the dashboard strip + nav link/unread dot |

Both mockups are placed **untracked** in `public/_dev/` for Preview-MCP
verification, enforced by the `public/_dev/` ignore rule added in Block 16.9.

---

## Source verification (checked against the tree, not assumed)

| Check | Result |
|---|---|
| **`.app-nav-actions` below 700px** | Defined once at `auth.css:313` (`flex; gap:18px`); **never touched in any `@media`**. Only `.app-nav.is-hidden` handles mobile (`auth.css:2963`). Hiding the link at ≤700px needs a **new rule** — nothing existing to inherit or fight. |
| **`.wn-*` collisions** | **None** anywhere in `public/`. Namespace clean. |
| Mockup CSS tokens exist? | Yes — a second `:root` at ~`auth.css:2402` defines `--brand`, `--text`, `--text-2/3`, `--brand-soft/tint/strong`, `--border(-soft)`, `--success(-tint)`, `--r-md/sm/pill`, `--font`, `--t-fast`, `--bg(-subtle)`. Distinct from the older `--color-*` set at `auth.css:13`. |
| Referenced classes exist? | Yes — `.surface(--lg)`, `.eyebrow`, `.pill`, `.btn--ghost`, `.brandmark`, `.wordmark`, `.app-brand`. |
| Dashboard nav static or JS? | **Static** (`dashboard.html:392`). `render()` builds only `#dashRoot` (line 621). Strip goes into `parts` between `renderGreeting` (611) and `renderProjectsSection` (619). |
| Capture tooling exists? | **No.** `scripts/` holds only `delete-all-projects.sql` + `seed-admin.mjs`; no Playwright/Puppeteer in `package.json`. §5.11.6.1's "existing headless tooling" means **Preview MCP**; the helper is net-new. |
| Bootstrap to replicate | `/_lib/no-zoom.js` (head, defer), `/_lib/sticky-topbar.js` (before `</body>`, defer); static nav with `#adminLink` (hidden→shown when `is_admin`), `#navUserAvatar`, `#logoutBtn`; identity from `/api/dashboard`; logout → `POST /api/logout`. |

---

## Rulings on source-doc discrepancies

**A. Publication model — status-flag, not git-gating.** PRD §5.11.7 ("gated by
git, not by a `draft` flag") predates the session-close workflow and is wrong:
session closeouts push to `main` mid-week, so git-gating alone would publish a
half-assembled entry. On merge, §5.11.5 gains `status: 'draft' | 'published'`
and §5.11.7 is rewritten so push-to-main means *deploy*, with *visibility*
gated by status. (Same decision as WORKFLOW open decision #1.)

**B. Cache-bust is uniform, not split three ways.** §5.11.12 claims
`2026-06-01-2` on one page and `2026-06-03-1` on five. Reality: **all shipping
pages are uniform at `2026-06-03-1`**. The odd `2026-06-01-2` is on
`_dev/components.html`, a dev gallery, not a shipping page (`_dev/sprint-view-mockup.html`
carries `2026-05-26-1`; also immaterial). Correct §5.11.12 on merge.

**C. Six authed pages, not five.** `dashboard`, `projects`, `project`,
`project_settings`, `workspace_settings`, `admin` all carry `.app-nav-actions`.
`project.html` was missing from the source set.

**D. Capture tooling.** Correct §5.11.6.1's "existing headless tooling"
reference to name Preview MCP, and state the `scripts/` helper is net-new.

---

## Per-file change list (strictly additive — no existing screen restructured)

### New files

**`public/_lib/whats-new-data.js`** — the content constant (open decision 5:
separate file, since it is edited weekly and the page is not). Shape per
ruling A:

```js
{ version, date, headline, status: 'draft' | 'published', features: [], fixes: [] }
```

Seeded: **v1.5 `draft`** (features, pending preview images), **v1.4
`published`**, **v1.3 `published`** (fix-only, no images needed). Page and
strip render **latest published**, so the feature has day-one content without
waiting on the capture helper.

**`public/_lib/whats-new-badge.js`** — shared unread logic, following the
existing `no-zoom.js` / `sticky-topbar.js` pattern: one file, one
`<script defer>` per page. Reads the `localStorage` key against the latest
**published** version, toggles `.wn-navlink__dot` on all six pages, exposes
state for the strip's `New` pill, and marks-read on `whats-new.html`. Not
duplicated per page.

**`public/whats-new.html`** — the page, per `whats-new-mockup.html`. Static
authed nav (link `is-active`), the three script includes, `boot()` wiring nav
identity from the existing endpoint (**no new API endpoint** — §5.11.11).
Renders published entries: latest expanded, earlier collapsed to `.wn-past`
rows with expand JS, `.wn-foot`. Empty state per the copy section below.

*(deferred to commit 8)* **`scripts/capture-whats-new.mjs`** — headless
element-capture helper (fixed viewport, CSS selector, output filename).

### Edited files (all additive)

**`public/auth.css`** — append **only** the `.wn-*` block at end of file: page
styles, strip and nav-dot styles, and the `@media (max-width: 700px)` rules
(`.wn-navlink { display: none }`, strip stacks, `.wn-strip__read` affordance).
**Do not copy** `.dash-shell`, `.dash-greeting`, or `.pcard*` from the
dashboard mockup — those already exist as page-local rules in `dashboard.html`
and appear in the mockup only so the strip has context. No existing selector
modified.

**`public/dashboard.html`** — (a) nav `<a class="wn-navlink">` inserted first
in `.app-nav-actions`, before `#adminLink` (line 393); (b) `renderWhatsNewStrip()`
pushed into `parts` between lines 611 and 619, rendering the latest published
release plus the `New` pill; (c) `whats-new-badge.js` script line; (d)
cache-bust bump.

**`public/projects.html`, `public/project.html`, `public/project_settings.html`,
`public/workspace_settings.html`, `public/admin.html`** — the same nav `<a>`
first in `.app-nav-actions`; `whats-new-badge.js` script line; cache-bust bump.

### Cache-bust

One new value `?v=2026-08-02-1`, applied to the six touched authed pages and
the new `whats-new.html`. Untouched pages (`404`, `forgot-password`,
`reset-password`) stay at `2026-06-03-1` — they use no `.wn-*`. Aligning them
is explicitly out of scope.

---

## User-facing copy — review-gated

All strings below are **proposals pending Jenny's approval**; the commits that
carry them do not land until signed off. Register rules: no SHAs, file paths,
function or table names, block numbers, or internal vocabulary.

**Seeded entries** (gate commit 3):

- **v1.4** — headline: *"A new look across every screen."* · fix: *"Every
  screen has been redesigned — clearer type, calmer colours, and layouts that
  hold up on a phone."*
- **v1.3** — headline: *"Ask questions that span more than one project."* ·
  fix: *"Start a chat that draws on every project in your workspace at once,
  instead of asking each one separately."*

**Empty states** (gate commits 5 and 6):

- **Page, nothing published** — heading: *"Nothing new just yet"* · body:
  *"When we ship something you'd notice, it'll show up here. Check back after
  the next update."*
- **Dashboard strip, no published release** — title: *"What's new"* · body:
  *"Product updates will appear here as they ship."* · affordance unchanged.

The strip is permanent (§5.11.8), so it must read sensibly when empty. Both
avoid apologising for a gap, matching §5.11.4's "gaps read as normal."

---

## Commit ordering

No crypto, OAuth, webhook, project-scoping, or schema-migration surface is
touched, so the core feature is **AUTO-eligible**. Unread state is
`localStorage` (§5.11.10) — **no DDL, no migration**. The only sensitive piece
is the capture helper's local seeded auth.

| # | Commit | Mode | Notes |
|---|---|---|---|
| 1 | Author this file | AUTO (doc-only) | mockups placed untracked as a pre-step, not committed |
| 2 | Append `.wn-*` block to `auth.css` | AUTO | additive; no selector modified |
| 3 | `whats-new-data.js` — `status` field; v1.5 draft, v1.4 + v1.3 published | AUTO | **gated on entry-copy approval** |
| 4 | `whats-new-badge.js` — shared unread logic | AUTO | one file, one line per page |
| 5 | `whats-new.html` — page, nav, empty state, badge include | AUTO | **empty-state copy gated** |
| 6 | `dashboard.html` — nav link, `renderWhatsNewStrip()`, badge, cache-bust | AUTO | **strip empty copy gated** |
| 7 | Nav link + badge + cache-bust across the other five authed pages | AUTO | one commit |
| 8 | *(deferred)* capture helper + seeded local user + v1.5 images → flip v1.5 `published` | **DEFAULT** | local seeded auth + real-data-leak rules |
| 9 | Merge PRD addendum → §5.11 (rulings A–D) + WORKFLOW addendum; HANDOFF closeout | AUTO (doc-only) | HANDOFF is its own separate commit |

**Publishing** — flipping a draft visible — is a separate later push to `main`
by Jenny. Claude cannot publish; the deny hook blocks it.

### Capture-helper deferral

Deferred to commit 8, conditional on the seeding decision above. Safe **because**
commits 3 and 5 ship published v1.4/v1.3, so the page has content on day one.
The helper, a seeded local test user, and the first images are prerequisites
only for the v1.5 *feature* entry — not for shipping the infrastructure. Any
feature entry without an image is noted as a gap and is not publishable.

---

## Open decisions — resolved

**PRD §5.11:** 1 strip **above** Projects · 2 nav link **hidden <700px** ·
3 earlier issues **collapsed** · 4 images in **`public/`** · 5 content in a
**separate file**.

**WORKFLOW:** 1 **`status: 'draft' | 'published'`** (= ruling A) · 2 `add` is
**per-item** · 3 check does **not** run on doc-only sessions.

---

## Out of scope (noted, not fixed)

Per §5.11.12: `workspace_settings.html` being unreachable, the `Cross-project`
nav link only that page carries, and full cache-bust alignment across all
pages. Pre-existing, unrelated to this work.

---

## Verification

Preview MCP, per WORKFLOW § Mockup and preview review.

1. Dev server; open `/whats-new.html` and `/dashboard.html`.
2. `.wn-*` renders (tokens resolve); nav link present and `is-active` on the
   page; strip sits between greeting and Projects; **published v1.4/v1.3
   render and v1.5 draft stays hidden**; collapsed rows expand.
3. Unread: nav dot and strip `New` pill appear, then **clear together on
   visit**; confirm the single shared `badge.js` drives all six pages.
4. Empty state: temporarily set every entry to `draft` → page shows the
   empty-state copy and the strip its neutral variant; revert.
5. `resize_window` ≤700px: nav link hidden, strip stacks with "Read what's
   new"; ≥700px normal row.
6. `read_console_messages` clean; hard reload confirms touched pages serve the
   new `.wn-*`.
7. Grep-confirm no new API endpoint and no schema change; `git status`
   confirms both mockups untracked **and ignored**.
8. Screenshot both surfaces, desktop and mobile.
