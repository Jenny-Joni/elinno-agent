# Block 25 — Finance ships: real page, storage, API, rail

**Status: APPROVED 2026-08-23.** Decisions worked through with Jenny one at a
time and locked below. This commit is the artifact recording "plan approved at
this version," per WORKFLOW Phase 2.

Uncertainty 2 (the xlsx library) is explicitly *not* covered by this approval —
the library's name, version and byte size come back to Jenny before anything is
vendored.

---

## Context

The Finance dashboard was prototyped over 2026-08-20/21 and **nothing shipped**.
The whole thing lives in `public/_dev/finance-mockup.html` + `finance-data.js`,
which is gitignored on purpose (Block 16.9) because the fixture carries the real
122 payments — $65,716.91 of company card spend — inline. `public/` is the Pages
build output, so committing it would serve that data unauthenticated.

The prototype is finished as a design: three cards over one filter row, four-level
drill-downs in both Chart and Table views, per-project colours taken from the
spreadsheet's own cell fills and contrast-corrected. What does not exist is any of
the machinery that makes it a real page: no `finance.html`, no storage, no
endpoint, no rail entry.

Block 25 builds exactly that, plus two regressions the prototype carries and one
security hazard found while planning this block.

## Goal

Ship the Finance dashboard as a real, authenticated page at `/finance.html`,
reading Reap payment data from an endpoint, with an admin-only full-replace
upload path and a Finance section in the side rail on every authenticated page.

---

## Locked decisions

**A — Storage: R2, one JSON object per dataset.** New private bucket
`elinno-agent-finance`, binding `FINANCE`, **no custom domain** (the existing
`LOGOS` bucket is public-read via `logos.elinnoagent.com`; finance data must not
go anywhere near it). Keys: `reap/current.json`, `reap/previous.json`.

Chosen on the criterion Jenny named — simplest to update. Full-replace is one
PUT; a new spreadsheet column needs no migration; and nothing in the block stalls
waiting on hand-run DDL, which `wrangler d1 execute --remote` and `psql` being
denied would otherwise force. Accepted cost: the payments are not in SQL beside
`entities`, so the AI agent cannot query spend. Not a one-way door — 122 rows
backfill from the R2 object in one migration when the agent needs them.

**B — Upload format: `.xlsx`, parsed in the browser.** Jenny drops the file Reap
produces; the page parses it and POSTs JSON. The Worker stays dependency-free and
validates shape server-side rather than trusting the client's parse.

Parser handles the known shape traps, each with its own test row: header is on
row 3, rows 1–2 are titles, the last row is a totals footer to skip, and the
`Category` column is misspelled `Catrgory`. Cell fill colours are **not** read —
`PROJECT_COLOR` stays the static map with the contrast-corrected values and the
originals in a comment.

**C — Access: read is open to every authenticated user; upload is admin-only.**

Read matches how Projects already behave. `functions/_lib/workspace.js` records
that since 2026-05-27 project visibility is a single shared workspace across all
authenticated users, and `owner_user_id` is a creator record, not a visibility
scope. So this is not a new exposure class. Upload uses
`requireWorkspaceAdmin` ([auth.js:220](functions/_lib/auth.js:220)) — no new auth
helper, which keeps the carve-out surface small.

This **revises the 2026-08-20/21 closeout**, which said "admin-gated API". Read is
no longer admin-gated; upload still is. Noted so the two documents do not silently
disagree.

**D — Rail: generalise the section-open state per-section.** Replace the single
global `sn-section-open` boolean with one class per section. See "The rail trap"
below for why the current shape cannot carry a second section.

**E — Upload UI lives on `finance.html`**, in the tab header, rendered only when
`/api/me` reports `is_admin` — the same display-hint pattern `admin.html` already
uses at `admin.html:473`, with the real gate server-side. The active tab names the
dataset being replaced, so Fiat and Crypto inherit the control for free.

**F — Close the `_dev` exposure before anything else.** See "Pre-flight" below.

**G — by MONTH grouped table column order: Month → Total → selected projects.**
Applied to the prototype 2026-08-23 and verified in the browser; it must survive
the port.

**H — Both by MONTH regressions are folded into this block**, not fixed
separately. `public/_dev/` is gitignored, so a fix there is never committed and
would have to be written a second time in `finance.html`. Fixing them during the
port is the only way to do it once.

**I — A full-replace keeps exactly one previous version.** The upload writes
`current.json`, moving the prior object to `previous.json` first, so a bad upload
has an undo. *Proposed, not locked — see Uncertainties.*

**J — Freshness.** The read endpoint sets `Cache-Control: private, no-store`, and
the payload carries `uploadedAt`. This is the closeout's stale-data trap: during
the prototype session the browser twice served a stale `finance-data.js` after the
file changed. A real upload that nobody can see is worse than no upload.

**K — Fiat and Crypto are titles and an empty state only**, per the closeout.

---

## Pre-flight (blocks everything else)

While planning this block I checked whether `.assetsignore` would protect `_dev/`
from the manual deploy escape hatch. **It does not.** `wrangler pages deploy` uses
its own walk in `src/pages/validate.ts` with a hardcoded ignore list —
`_worker.js`, `_redirects`, `_headers`, `_routes.json`, `functions`,
`**/.DS_Store`, `**/node_modules`, `**/.git`, `.wrangler` — with no
`.assetsignore`, no `.gitignore`, and no way to extend it. The `.assetsignore`
support that does exist is in `buildAssetManifest`, the Workers Assets path used
by `wrangler deploy`, a different command.

Symlinking `_dev` elsewhere does not help either: the walk calls `fs.stat`, which
follows symlinks, then tests `isSymbolicLink()` — always false, so the guard is
dead code and a symlinked directory is recursed into normally.

The git-based deploy is safe; `_dev/` never reaches the repo. The exposure is the
escape hatch `wrangler pages deploy public`, documented in HANDOFF as the fix for
the webhook silently dropping commits — i.e. the command reached for when things
are already going wrong.

So, before any other work:

1. **Regenerate `public/_dev/finance-data.js` with synthetic values** — amounts,
   account-owner emails and card digits replaced; real project and vendor names
   kept so layout, colours and grouping stay honest. Nothing sensitive is left on
   disk, so no deploy command can leak it however it is invoked.
2. **Fix the documented escape hatch** in `HANDOFF.md` and `PROJECT.md` to deploy
   from a staged copy that excludes `_dev/`, which also covers the other seven
   mockups.

---

## The rail trap, and what D actually changes

`auth.css` currently expresses "a section is open" as **one boolean on `<html>`**:

```css
.side-nav [data-sn-children] { display: none; }
html.sn-section-open .side-nav [data-sn-children] { display: block; }
html.sn-section-open .side-nav [data-sn-section] .sn-chev { transform: rotate(90deg); }
```

It is a class rather than a JS-set inline style deliberately — the boot script sets
it before first paint so an open section *paints* open instead of snapping open a
frame later. Any fix has to preserve that.

With one expandable section this is fine. Add Finance and both rules match both
sections: opening Finance opens Projects, and rotates both chevrons.

Decision D keys the rules to the section name instead. The change is uniform:
**11 pages × exactly 3 occurrences each**, verified by grep, with no per-page
variation — the comment block, the boot script, and the restore script.

Also needed: `.sn-l2[aria-current="page"]` has no style in `auth.css`, because the
Projects tree never needed one — project names are not destinations. Finance's
children are. The prototype's local `.sn-l2.is-current` moves into `auth.css`.

---

## Sub-tasks

Modes follow WORKFLOW: the API and rail work are the security carve-outs Jenny
named, and run in **default mode**, not auto.

| # | Sub-task | Mode | Blocked on |
|---|---|---|---|
| 25.1 | Pre-flight: scrub the fixture, fix the documented escape hatch | auto | — |
| 25.2 | **Jenny:** create bucket `elinno-agent-finance`, no custom domain | Jenny | 25.1 |
| 25.3 | `wrangler.toml`: add the `FINANCE` R2 binding | auto | 25.2 |
| 25.4 | `GET /api/finance/[dataset]` — session-gated read, `no-store` | **default** | 25.3 |
| 25.5 | `POST /api/finance/[dataset]` — `requireWorkspaceAdmin`, validate, rotate `current`→`previous`, PUT | **default** | 25.4 |
| 25.6 | Vendor the xlsx parser + browser-side parse of the known shape traps | auto | 25.5 |
| 25.7 | `public/finance.html` — port the prototype, fetch from 25.4, carry decision G | auto | 25.4 |
| 25.8 | Restore the by MONTH Week/Month toggle | auto | 25.7 |
| 25.9 | Bound the by MONTH card's height across modes | auto | 25.7 |
| 25.10 | Remove the orphaned "partial month" legend entry and the dead `(partial)` branch in `renderBreakdownTable` | auto | 25.7 |
| 25.11 | Admin-only upload control in the tab header | **default** | 25.6, 25.7 |
| 25.12 | `auth.css` + `_lib/side-nav.js`: per-section open state, `.sn-l2` current style | **default** | — |
| 25.13 | Rail markup + boot script in all 11 authenticated pages | **default** | 25.12 |
| 25.14 | **Blocking check:** rail isolation passes on all 11 pages (V5, V6) | **default** | 25.13 |
| 25.15 | **Blocking check:** by MONTH height variance within threshold (V9) | auto | 25.9 |

25.14 and 25.15 are rows, not prose, on purpose: WORKFLOW records that Block 18's
mobile-fit check failed and the block merged anyway, because nothing in the task
list said stop. **No ff-merge while either row is unchecked.**

---

## File-level change list

This is the scope contract. Anything outside it stops execute.

**New**
- `functions/api/finance/[dataset].js` — GET (25.4) and POST (25.5). Reuses
  `json` / `error` / `getSessionUser` / `requireWorkspaceAdmin` from
  `functions/_lib/auth.js`. Shape follows
  [functions/api/projects/[id]/logo.js](functions/api/projects/[id]/logo.js), the
  proven R2-write endpoint — MIME/shape allowlist, size cap, orphan-safe write
  ordering.
- `public/finance.html` — the real page, ported from the prototype.
- `public/_lib/xlsx-parse.js` — the vendored parser plus the shape-trap handling.

**Modified**
- `wrangler.toml` — second `[[r2_buckets]]` block for `FINANCE`.
- `public/auth.css` — the three section rules keyed per-section; `.sn-l2` current
  style added.
- `public/_lib/side-nav.js` — `setSection()` (line 507) takes a section key.
- **The 11 authenticated pages** — identical edit in each: rail markup for the
  Finance section, plus the boot and restore scripts. Representative paths:
  `public/dashboard.html`, `public/project.html`,
  `public/cross-project/chat.html`. The other eight take the same edit.
- `public/_dev/finance-data.js` — synthetic values (25.1, gitignored).
- `HANDOFF.md`, `PROJECT.md` — escape-hatch command (25.1).

**Explicitly not touched:** `functions/_lib/workspace.js`, `functions/_lib/auth.js`,
`functions/_lib/admins.js`, anything under `functions/_lib/connectors/` or
`functions/_lib/ai/`.

---

## Verification plan

Every item states a threshold. Run against the preview deploy before requesting
the push to main.

| # | Check | Passes when |
|---|---|---|
| V1 | `GET /api/finance/reap` authenticated | 200, exactly **122** rows, `footerTotal` **65716.91** |
| V2 | `GET /api/finance/reap` with no session | **401**, no body carrying row data |
| V3 | `POST /api/finance/reap` as a non-admin user | **403**, and `current.json` byte-identical afterwards |
| V4 | `POST` as admin with a 3-row test file | 200; GET returns **3** rows; `previous.json` still holds the prior **122** |
| V5 | On each of the 11 pages: open Finance | Projects stays closed, **1** chevron rotated, not 2 |
| V6 | On each of the 11 pages: open Projects | Finance stays closed; Projects still paints open with **no** visible flash on load |
| V7 | by MONTH grouped table header | reads literally `Month, Total, <p1>, <p2>, <p3>` |
| V8 | Week/Month toggle over 01/07–15/08 | Week yields **≥ 6** columns, Month yields **2** |
| V9 | by MONTH card height across 1 / 2 / 3 / 5 projects and combined | max − min **≤ 12px** |
| V10 | Re-upload, then reload without a hard refresh | new `uploadedAt` visible; response carries `Cache-Control: private, no-store` |
| V11 | `grep` the scrubbed fixture for real card digits and owner emails | **0** hits |
| V12 | Non-admin loads `/finance.html` | data renders; **no** upload control in the DOM |

V1 and V4 are stated against the current `Reap_NEW_1787263383.xlsx`. If Jenny
uploads a newer export first, the expected numbers move and the plan gets the new
ones written in before the check runs — not after.

---

## Uncertainties — please confirm or correct

1. **Decision I (one previous version) is proposed, not locked.** It costs one
   extra R2 write per upload and gives a bad upload an undo. Say if you would
   rather keep more history, or none.
2. **The xlsx parser is a vendored third-party dependency** — the first in the
   repo beyond `postgres`. I have not picked a library or checked its size yet;
   I will bring the name, version and byte size for approval before vendoring it
   rather than choosing unilaterally. It would load only on `finance.html`.
3. **V9's 12px threshold is my number, not a measured one.** Current spread is
   roughly 130px (320–450). If 12px turns out to be unreachable without changing
   the design, I will report the measured floor rather than quietly widening it.
4. **The combined / single-project by MONTH table** (`Month | Payments | Amount |
   Running total`) was left alone by decision G, since it has no project columns.
   Say if you want Amount and Running total swapped for consistency.
5. **Bucket name `elinno-agent-finance`** — matches the `elinno-agent-logos`
   convention, but you are creating it, so it is yours to name.

---

## Out of scope

- The six spreadsheet columns carried but never displayed (Category, Department,
  Requested by, Account owner outside drill-downs, Merchant, Name).
- Fiat and Crypto data of any kind — titles and empty state only (K).
- Any SQL/agent access to finance data (see A).
- The real-workspaces migration. When v2.0 lands, the finance endpoint becomes a
  **second** file needing a workspace filter, alongside the one
  `functions/_lib/workspace.js` already documents. Recorded, not built.
- The two unresolved deploy-pipeline faults (`commit_refs` push failures, the
  dropped webhook). 25.1 makes the escape hatch safe to use; it does not fix why
  it is needed.
- Adding a deploy hook as a third redundant deploy path — still worth doing, still
  not this block.
- Adding `wrangler r2 bucket create` to the settings deny list. Flagged separately;
  it is a one-line change and does not belong inside this block's scope contract.
