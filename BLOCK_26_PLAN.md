# Block 26 — Fiat and Crypto become real datasets

**Status: Phase 1 executed and verified locally. D1, D3 and D6 still open.**

Drafted 2026-08-25 with Jenny. Per WORKFLOW.md Phase 1 the open decisions
below get worked through before this document is final and before any code
is written.

---

## Goal

Fiat and Crypto stop being empty states and become working datasets with the
**same layout and the same functionality as Reap**, differing only in the
column names their spreadsheets carry. Once deployed, an admin can replace
the Fiat or Crypto data at any time exactly as they replace Reap's.

---

## Context

### What already works

The backend is done. `functions/api/finance/[dataset].js` allowlists all
three datasets (`DATASETS`, line 57). GET, the `requireWorkspaceAdmin`
full-replace POST, `previous.json` rotation, per-row revalidation against
`ROW_STRINGS`, and the footer-total integrity check already work for `fiat`
and `crypto`. The R2 keys are simply empty. **No change to that file is
expected** — see D1.

The tab furniture is done too: the tablist, the rail children, `?tab=` deep
links and arrow-key navigation are live (`finance.html:711-714`, `2233-2273`).

### What does not

Everything below the tabs. `finance.html` carries ~1,500 lines of panel
machinery built on singletons — one `state` object, `DATA` / `ROWS` /
`P_START` / `P_END`, `ORDER` / `COUNTS`, the date-range `dr`, a shared
`#finTip`, and ~40 `getElementById` lookups against unique ids. `boot()`
fetches `/api/finance/reap` by name, and the comment at line 2310 states the
assumption plainly: "Only Reap has a data path — Fiat and Crypto are static
empty states, so switching to them needs no fetch."

---

## Decisions locked with Jenny (2026-08-25)

**L1 — One panel, three datasets.** One copy of the DOM and one copy of the
engine. Switching tabs re-points the fetch at the chosen dataset, re-builds
the filters from it and re-renders. The rejected alternative was three
instances of the markup and machinery.

Why: identical UI becomes guaranteed by construction rather than maintained
by discipline; a future design change lands once instead of three times
(the last two Finance sessions produced eight reversals in two days); and
the live render path carrying real money data is barely touched.

Accepted cost: the three tabs share one `role="tabpanel"` element, a
deviation from the ARIA tabs pattern. Tabs, deep links and keyboard
navigation are unaffected.

**L2 — Identical layout and functionality on all three tabs.** Same filter
row, same three cards, same drill-downs, same upload control. The only
difference between datasets is the spreadsheet column names their uploads
carry.

**L3 — Admin replace-data works on all three.** The existing control targets
whichever tab is active, and its confirm names that dataset.

**L4 — Filters reset on every tab switch** (was D2). Fiat opens at its own
full date range with everything selected. A dataset can never display
another's filter values, and there is no remembered state to explain.

**L5 — All three datasets are USD** (was D4). `Intl.NumberFormat` at line
911 stays as it is; no per-dataset money formatting.

**L6 — The dashboard Finance section stays Reap-only** (was D5). Out of
scope here. It already pulls the full ~40 KB payload for one total, and
covering three would triple that; it belongs with the summary-mode fix.

---

## Fiat, first file reviewed (2026-08-30)

`Payment_Requests_1788083309.xlsx`, sheet `payment requests`: four title
rows, **header on row 5**, 14 payments, then a totals footer. Reviewed with
Jenny; **a revised file is coming** (see Pending below), so the alias table
below is not final.

| Fiat column | System field | Note |
|---|---|---|
| Name | `name` | matches as-is |
| Project | `project` | matches as-is — required |
| Suppliers / Vendor | `vendor` | matches only via the prefix fallback on `supplier`; to be made explicit — required |
| $ Value | `amount` | needs an alias — required |
| Payment Time | `date` | needs an alias — required |
| Payment Category | `category` | needs an alias |
| Created by | `requestedBy` | needs an alias |
| Payment Type | the fourth filter | see L8 |
| Value Rate: $ | — | 0.3 on every row; meaning unknown, Jenny revising |
| Mirror | — | dropped: empty on 12 of 14 rows, duplicates Name on the other two |

With the placeholder aliases this file scores 3 of 4 required columns and
fails with "Could not find a header row" — the intended loud failure.

### Two findings from the real file

1. **The footer is the Block 25 trap, and the current code survives it.**
   Row 20 carries `$ Value = 53139.825` against
   `Payment Time = "2026-07-12 to 2026-08-27"` — the same shape that was
   once stored as a $71,840 payment. The anchored date matcher and the
   two-signal footer test both reject it. The check also earns its keep:
   the 14 rows sum to 53,139.825, matching the footer exactly.

2. **Three-decimal amounts put the integrity check on a knife edge.**
   Three rows carry three decimals. The endpoint rounds each amount to 2dp
   and compares the sum to the footer within a **fixed 0.01 tolerance**.
   Here the errors cancel to 0.005 and it passes — by luck. More
   three-decimal rows and a good file is rejected with "the parse dropped
   or duplicated rows", which would be false. The tolerance should scale
   with row count. That is an edit to the carve-out endpoint: default mode,
   diff reviewed.

---

## Decisions locked 2026-08-30

**L7 — Rain and Rain Trade are different projects.** Both get their own bar
and colour. Fiat's projects are Gems Trade, Gems Launchpad, Elinnovation,
Rain, Rain Trade and Kai Banking; four are already in `PROJECT_COLOR`, so
only **Rain Trade** and **Kai Banking** need entries. This settles D3 for
Fiat.

**L8 — The fourth filter is per-dataset.** "Cards" on Reap; on Fiat it
carries the payment method (Bank Transfer / Cash) and is labelled
accordingly. **This is a deliberate, approved narrowing of L2**: the layout
stays identical, but one control's label and contents follow the dataset.
Recorded here so the plan and the page do not silently disagree.

---

## Fiat, second file — FINAL (2026-08-30)

`Payment_Requests_1788083738.xlsx`. `Value Rate: $` is gone and `Mirror` is
now `Description`. Nine columns, all nine mapped, no collisions:

    Name → name              Payment Category → department
    Project → project*       Created by → requestedBy
    Suppliers / Vendor →     $ Value → amount*
      vendor*                Payment Time → date*
    Description →            Payment Type → card (labelled per L8)
      description                              (* required)

Absent from Fiat: `accountOwner`, `department`, `merchant`. `merchant` is
never displayed, and `department` only feeds the vendor tooltip, which
already degrades ("No department or description recorded", finance.html
line 1005).

**L9 — the third drill level is per-dataset** (Jenny, 2026-08-30, after
seeing it empty). Reap groups it by `accountOwner` under the heading
"Account owner"; Fiat groups it by `requestedBy` under "Requested by". Same
level, same position, same interaction — only the column read and the
heading change, exactly as L8 does for the fourth filter. This resolves the
open empty-drill-level question: nothing is hidden, because on Fiat the
level now carries real values (Omri Hanover, Ziv Oz, Tomer Amar, Adan
Kedem, Omer Himi) instead of a single "(not set)" group.

**L10 — "Payment Category" fills the `department` slot, not `category`**
(Jenny, 2026-08-30). A header can claim only one field, so this is a choice
between the two, and `department` is the one that is *displayed*: it is what
the vendor tooltip lists. `category` is stored and shown nowhere. Fiat's
vendors now read Marketing / Technology / Operations on hover, the same way
Reap's read their departments. `category` is left empty for Fiat.

One wrinkle, not fixed: the tooltip's empty fallback reads "No department or
description recorded", which is the wrong noun for Fiat. It can only appear
when a vendor has neither field, and every Fiat row carries a payment
category, so it cannot fire on this dataset. Copy is Jenny's.

### Parsed against the real file

Run through the real `parseFinanceWorkbook` in the browser, not a fixture:
**14 rows**, footer excluded, sheet `payment requests`, period 2026-07-12 →
2026-08-27, total **53,139.82** — rows and footer agreeing exactly. Excel
date serials, Hebrew vendor and payment names all came through intact.

### Correction to the earlier rounding finding

The parser rounds **both** each row (line 282) and the declared footer
(line 312) to 2dp, so the knife-edge is narrower than first written. The
real risk stands but is differently shaped: per-row rounding accumulates
against an *independently* rounded footer, so enough three-decimal rows can
still exceed the fixed 0.01 tolerance. This file passes with nothing to
spare. Still worth scaling the tolerance with row count — carve-out
endpoint, default mode.

---

## Pending — Crypto only

Fiat is done. Crypto's alias table is still a placeholder inheriting Reap's
spellings, and its project colours (D3) are unknown until its export is
read. A Crypto upload fails loudly until then, which is the intended state.

---

## Open decisions — needed before execute

D2, D4 and D5 were answered on 2026-08-25 and are now L4, L5 and L6 above.

**D1 — The actual column names for Fiat and Crypto.** The blocker. The
per-dataset alias tables are the one thing that cannot be guessed. Both
genuine Block 25 bugs survived every test written beforehand because none
had opened a real workbook, and `finance-xlsx.js` documents four shape traps
that were only discoverable from the real file.

What is needed per dataset: the header row, and whether these nine concepts
are present and under what names —

| Field | Reap's header | Required? |
|---|---|---|
| `project` | Project | **yes** |
| `vendor` | Vendor | **yes** |
| `date` | Date | **yes** |
| `amount` | Amount in $ | **yes** |
| `card` | Card | no |
| `accountOwner` | Account Owner | no |
| `requestedBy` | Requested by | no |
| `department` | Department | no |
| `category` | Catrgory *(sic)* | no |
| `name` | Name | no |
| `merchant` | Merchant | no |
| `description` | Description | no |

Anything absent degrades to an empty string and its filter shows only
`(not set)`; the four required ones failing means the upload is rejected
with a message naming the headers it actually saw.

**If the nine concepts are the same and only the spellings differ, the
security carve-out endpoint needs no edit at all** — `ROW_STRINGS` is a
list of concepts, not of headers. A genuinely new field would change that
file, and that edit runs in default mode, never auto.

**D3 — Project colours (settled for Fiat by L7; Crypto still open).** `PROJECT_COLOR` (line 897) is ten names lifted
from the Reap export's cell fills. Every lookup already falls back to
`var(--fin-other)`, so unknown names do not break — but they all render the
**same grey**, which makes the by MONTH grouped chart unreadable when a
dataset's projects are not in the map. Options: extend the map with Fiat's
and Crypto's project names, or add a deterministic fallback palette.
*Needs D1's files to know which project names appear.*

**D6 — What's New v2.2.** v2.1 currently tells users Fiat and Crypto are
"not connected yet", so shipping this contradicts a published entry. An
entry is needed, **and its illustration must be added to the `PLACEHOLDER`
map in `whats-new.html`** — the omission that made v2.1 render blank on
first publish. Copy is Jenny's unless she directs otherwise.

---

## The defect this uncovers

`initFilters()` (line 1244) both builds the filter menus **and** binds
listeners: the `fReset` click, two `document`-level handlers, and every
`[data-view]` button. It is written as though it runs once — but
`applyDataset()` calls it, and `applyDataset()` runs again after every
upload (line 2429). **An upload already double-binds those handlers today.**

Under L1 a tab switch calls it too, so handlers would accumulate on every
switch. The fix is part of this block, not optional: split the one-time
binding out of the per-dataset building.

---

## The hazard: preview and production share one bucket

`wrangler.toml:111` — "Shared by Production + Preview, same as every other
binding in this file." A preview deploy reads and writes the **same**
`elinno-agent-finance` bucket production does. There is no isolated place to
test an upload:

- A POST to `reap` from a preview URL destroys production's real 164
  payments. The single-step undo is `reap/previous.json`; there is no second.
- A POST to `fiat` writes a file production starts serving immediately.

While Fiat and Crypto are empty this is survivable — there is nothing to
destroy and anything written can be replaced by the real file. **It stops
being survivable the moment they hold real data**, which is the end of this
block.

Consequences for this block:

1. Upload verification runs against `fiat` / `crypto` **only**, never `reap`,
   and only while they are still empty.
2. Anything uploaded during verification is visible in production until
   replaced. Use a file that is safe to expose, or accept that the real
   upload follows immediately.
3. A preview-only FINANCE bucket is the real fix. **Flagged, not built** —
   it is a binding change, outside this block's scope contract, and it is
   Jenny's to make.

---

## File-level change list

| File | Change | Mode |
|---|---|---|
| `public/finance.html` | Collapse three tabpanels to one; `setTab` loads the dataset; per-dataset load with a stale-response guard; split `initFilters` into bind-once / build-per-dataset; upload targets the active dataset; per-dataset alias config | auto |
| `public/_lib/finance-xlsx.js` | `parseFinanceWorkbook(file, opts)` takes a per-dataset alias table; current behaviour stays the default | auto |
| `functions/api/finance/[dataset].js` | **Expected: none.** Any change here is a security carve-out and runs in default mode | default |
| `public/whats-new-data.js` + `public/whats-new.html` | v2.2 entry **and** its `PLACEHOLDER` illustration | auto |

No CSS change is expected. If one proves necessary, the cache stamps on
`auth.css` and `side-nav.js` must be bumped uniformly across all 12 pages —
a warm cache otherwise serves stale CSS and the rail renders broken.

---

## Verification plan

Against a preview deploy, never straight to main.

| # | Check |
|---|---|
| V1 | Each tab loads its own dataset; no data bleeds between tabs |
| V2 | Fast tab switching cannot apply a stale response to the wrong tab |
| V3 | An empty Fiat/Crypto renders the empty state, not a broken page |
| V4 | Admin uploads to Fiat; Reap and Crypto are untouched |
| V5 | Same for Crypto |
| V6 | The upload confirm names the dataset being destroyed |
| V7 | `fReset` and the Chart/Table toggles fire **once** after an upload and after N tab switches — the defect above |
| V8 | `?tab=fiat` deep link loads Fiat directly; rail children still work |
| V9 | Arrow-key tab navigation still works with one shared panel |
| V10 | A non-admin sees no upload control on any tab **and** a POST to each of the three returns 403 |

**V10 is Block 25's unrun V3/V12, now covering three datasets and three
ways to destroy company financial data. It needs a real non-admin account,
which still does not exist.** It should not ship unproven a second time.

---

## Phase 1 — verification, as run (2026-08-25)

Against a local stub serving `public/` with `/api/me` and
`/api/finance/<dataset>` faked, seeded from the **synthetic scrubbed**
fixture in `public/_dev/finance-data.js`. No real spend data was used, and
nothing was uploaded to the shared R2 bucket. The stub is in the session
scratchpad, not the repo.

| # | Check | Result |
|---|---|---|
| V1 | Each tab loads its own dataset; no bleed | **PASS** — reap 122 rows, fiat 40, crypto 1, independent on server and screen |
| V2 | Fast switching cannot apply a stale response | **PASS** — Fiat delayed 2,500 ms, reader moved to Crypto, response dropped; Crypto stayed empty |
| V3 | Empty Fiat/Crypto renders the empty state | **PASS** — full UI, heading, filters, upload control; "Last updated —" |
| V4 | Upload targets the active dataset | **PASS** — on Crypto, POST went to `/api/finance/crypto` |
| V5 | Other datasets untouched by an upload | **PASS** — Reap unchanged at 122 rows and its own timestamp |
| V6 | The confirm names the dataset | **PASS** — "Replace the **Crypto** dataset with 1 payment from crypto-august.xlsx?" |
| V7 | Controls fire once after uploads and N switches | **PASS** — after 8 tab switches the Projects menu still opens, and one click = one toggle (label went to "9 projects") |
| V8 | `?tab=fiat` deep link | **PASS** — `?tab=crypto` loaded Crypto directly, rail child marked |
| V9 | Arrow-key tab navigation with one shared panel | **PASS** — ArrowRight wrapped Crypto → Reap, focus and URL followed |
| V10 | Non-admin sees no control; POST 403 on all three | **NOT RUN** — no non-admin account exists. Same gap Block 25 shipped with, now covering three datasets. |

ARIA was checked directly: one `role="tabpanel"`, all three tabs pointing at
it, `aria-labelledby` following the selection, roving `tabindex` correct.
No console errors at any point.

V4/V5/V6 were run with `parseFinanceWorkbook` stubbed, because no real Fiat
or Crypto workbook exists yet (D1). They prove the **targeting** — which is
what Phase 1 changed — not the parse. The parse is Phase 2's to prove, and
per the Block 25 lesson it is not proven until a real workbook has been
through it.

---

## Found during Phase 1, not fixed

1. **The rail child loses `aria-current` on a tab switch.** `side-nav.js`
   wraps `history.replaceState` (line 637) and its `refreshActive()` (line
   630) strips every `aria-current` in the rail, then re-marks by pathname
   only — so the `?tab=` child's attribute is wiped one task after `setTab`
   sets it. **Pre-existing**: `setTab` already called `replaceState` on
   every tab click before this block. The `is-current` class survives, so
   it is visually correct and the loss is screen-reader-only. The fix
   belongs in `side-nav.js`, which is outside this block's change list.

2. **"No payments match these filters" is the wrong copy for an empty
   dataset.** It is right when a filter excluded everything, but Fiat and
   Crypto now legitimately hold nothing, and nothing is being filtered. Copy
   is Jenny's.

---

## Out of scope

- The dashboard summary-mode fix (~40 KB payload for one total).
- Any live bank or exchange connection — this block is file upload only.
- Fiat/Crypto-specific cards or fields beyond Reap's. L2 says identical.
- The six spreadsheet columns carried but never displayed.
- The real-workspaces migration.
