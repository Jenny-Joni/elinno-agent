# Block 19 — persistent left side menu (v2.0)

## Context

The authed app has no navigation. It has a top bar that was copy-pasted into
11 HTML files and has since drifted:

| Nav items | Pages |
|---|---|
| What's new · Admin · Log out | dashboard, projects, project, project_settings, whats-new, admin |
| Admin · Log out (**no What's new**) | projects/new, cross-project/index, cross-project/new, cross-project/chat |
| What's new · **Cross-project** · Admin · Log out | workspace_settings |

Two destinations are effectively unreachable:

- **`/workspace_settings.html` is in no page's nav.** Its only inbound link is a
  spend-cap banner inside cross-project chat
  ([chat.html:1264](public/cross-project/chat.html:1264)).
- **`/projects.html` is in no page's nav either.** The brand mark goes to
  `/dashboard.html` and that is the whole of the app's navigation.

The top bar is also losing a fight with mobile: `auth.css:3879–3913` documents a
reversed decision, pinned `flex-shrink`, a hidden wordmark below 430px, and a
tightened gap for the one page with a fifth item. Four items plus a brand do not
fit a 375px row.

A persistent left rail fixes all of it: every destination in one place on every
page, one definition of what the nav *is*, and the mobile row problem disappears
because the rail is off-canvas on phones.

**Naming collision to settle:** `BUILD_PLAN.md:245` already reserves "v2.0" for
Blocks 7 + 8 (Monday + Drive connectors), and `HANDOFF.md` has four other
"v2.0-locked" references. This plan uses **Block 19 / v2.0** as named, but either
those connectors move to a later version or this ships as v1.10. Jenny's call —
it does not block execution.

## Locked decisions

Settled in plan-mode Q&A on 2026-08-16.

- **A. The rail replaces the top bar.** `<nav class="app-nav">` is removed from
  all 11 authed pages. Brand at the rail top, destinations in the middle,
  secondary group pinned at the bottom. No page keeps a horizontal bar on
  desktop.
- **B. Collapsed by default at 64px, icon-only.** Labels appear as `title`
  tooltips and as `aria-label`.
- **C. Expands in place to 260px**, pushing page content right, with the state
  persisted in `localStorage`. Not an overlay on desktop. *Revised from 240px in
  round 4 — the tree is three levels deep now (rail → project → action) and
  240px leaves the third level about 150px of text width.*
- **D. Below 1100px viewport width the expanded rail overlays instead of
  pushing**, with the existing `.drawer-backdrop` treatment. Measured on the
  full-screen mockup, project chat page:

  | Viewport | Rail | Chat pane |
  |---|---|---|
  | 1180px | collapsed 64px | **822px** |
  | 1180px | expanded 260px | **640px** |
  | ~1040px | expanded 260px | **~500px** — the floor |

  Expanding costs 182px of chat pane. The pane crosses the 500px floor at about
  1040px of viewport, so 1100px is the nearest round threshold with margin.
  **This is a net-new breakpoint** and `auth.css:64` explicitly says not to
  invent breakpoints per page — the canonical list is 700 / 480 / 360 and has
  nothing above 700. So 1100px must be **added to that comment block** as a
  fourth canonical value, not used ad hoc. Flagged for Jenny's review; it is
  the one threshold in this plan that nobody chose deliberately.
- **E. Primary group, in order:** Dashboard · Projects · Cross-project chats.
  Three items, all member-accessible. *Revised in plan-mode round 3 — Workspace
  settings was originally the fourth here; see the role-gating audit below.*
- **F. Admin group, in order:** divider · Workspace settings · Members. Both
  hidden entirely when `is_admin` is false.
- **F2. Bottom group, in order:** divider · What's new (with unread dot) ·
  avatar · Log out.
- **F3. `/admin.html` is labelled "Members"**, matching the page's own H1
  (`admin.html:239`) and disambiguating it from Workspace settings directly
  above. This changes a label shipped since v1.2; Jenny has no preference and
  can veto the string during execute.
- **G. Projects is the only accordion, and it is three levels deep.** Dashboard
  and **Cross-project chats are plain links** — the latter points at
  `/cross-project/index.html`, which already *is* the list of all chats.
  Projects expands to the project list, and **each project expands again** to
  its actions — Sprint View · Chat · Settings. The project list is fetched
  lazily on first expand and capped at **5 rows + "All projects"** (+ "New
  project" for admins).
- **G1b. Individual chat conversations are not children of the rail.** *Set in
  plan-mode round 5.* The rail therefore reads **one** data source,
  `/api/projects` — `/api/cross-project/conversations` is not called at all,
  and the `chatUrl` / `?ids=` fallback shape that caused the reload loop in
  `fdf25be` never enters this feature. Both chat surfaces already carry their
  own conversations sidebar; the rail was duplicating it.
- **G2. Only one project is expanded at a time**, and only one top-level section.
  **This is load-bearing, not tidiness** — measured on the rendered mockup
  against production `auth.css` (2026-08-16):

  | State | Admin rail | Member rail | Fits 768px |
  |---|---|---|---|
  | G2 enforced — one project expanded | **767px** | **631px** | yes, by 1px (admin) |
  | G2 violated — two projects expanded | **836px** | 631px | no |

  Dropping chat children (G1b) cut the unenforced worst case from 1090px to
  836px, but did **not** move the G2-enforced number — under G2 the chat list
  was never open alongside Projects anyway. So G2 and G2b both still stand on
  their own.
- **G2b. The primary group scrolls independently.** `.sn-group` gets
  `overflow-y: auto; min-height: 0`; the brand row and the bottom group are
  `flex-shrink: 0` outside the scroll area, so **What's new / avatar / Log out
  are never pushed off-screen**. G2 alone clears 768px by a single pixel — a
  workspace with five long project names, or a browser with a bookmarks bar,
  eats that margin immediately. Same pattern as `#convList`
  ([auth.css:753](public/auth.css:753)), which exists for exactly this reason.
- **G3. A project row is an expander only when it has ≥2 actions; otherwise it
  is a direct link to its chat.** The action set is role- and connector-shaped:

  | `has_jira` | Role | Actions | Row behaves as |
  |---|---|---|---|
  | ✅ | admin | Sprint View · Chat · Settings | expander (3) |
  | ✅ | member | Sprint View · Chat | expander (2) |
  | ❌ | admin | Chat · Settings | expander (2) |
  | ❌ | member | Chat only | **direct link** to `/project/<slug>` |

  Sprint View is gated on `has_jira` because the Sprint View / Chat segmented
  control on the project page is itself `hidden` without Jira
  ([project.html:834](public/project.html:834)) — a rail link to
  `/project/<slug>/sprint` on a Jira-less project routes fine but lands on a
  surface the page will not show.
- **G4. `has_jira` is added to the `GET /api/projects` list response.** The rail
  needs per-project connector state and that endpoint does not return it;
  `/api/dashboard` already computes exactly this field
  ([dashboard.js:285](functions/api/dashboard.js:285)) from a
  `connections WHERE source='jira' AND status='active'` query
  ([dashboard.js:114](functions/api/dashboard.js:114)). Port that query, do not
  invent a second definition. **This is the one net-new backend change in the
  block** — additive, no scoping change, no new endpoint.
- **G5. Settings is hidden for members**, matching the existing gate on the
  project page's settings gear ([project.html:845](public/project.html:845)).
  `project_settings.html` itself has no client-side gate, so a member with the
  URL can still view it — but every mutating API behind it is admin-gated
  server-side (`projects/[id]/index.js`, `order.js`, `logo.js`, connector
  save/sync/OAuth), so this is view-only and pre-existing. Not changed here.
- **H. Mobile (≤700px): off-canvas rail behind a backdrop**, opened from a
  **52px** fixed head bar that belongs to the rail component and carries only
  the brand mark and the rail toggle (`ti-menu-2`). Rail width **280px,
  max-width 85%** — the same figures the existing conversations drawer uses
  ([auth.css:1668](public/auth.css:1668)), so the two drawers move identically.
  The conversations hamburger on `project.html` / `cross-project/chat.html`
  stays where it is, in `.project-main-header` — a different row, a different
  icon, never adjacent. **Measured on the 375px mockup:** the two controls are
  **65px apart vertically and 303px horizontally**, and the backdrop starts
  below the head bar so the rail toggle stays live while the rail is open.
- **H1b. The brand lockup is reused verbatim, never re-drawn.** The rail's brand
  row uses the existing markup every authed page already carries:

  ```html
  <span class="brandmark"></span>
  <span class="wordmark" style="font-size:15px;">Elinno&nbsp;Agent</span>
  ```

  `.brandmark` ([auth.css:2666](public/auth.css:2666)) is an 18px circle with a
  1.4px `--brand` border whose `::after` fills the right half — the half-moon
  that `favicon.svg` renders as `◐`. It is **not** a lettermark and **not** a
  filled square. `.wordmark` is uppercase, weight 600, `0.04em` tracking. In the
  collapsed 64px rail only `.brandmark` shows; `.wordmark` is hidden with the
  other labels. No new brand CSS, no inline SVG — this also keeps the rail clear
  of the inline-SVG-in-JS failure mode.
- **H2. The bottom group is pinned on mobile too.** The 375px mockup pushed
  What's new / avatar / Log out below the fold with the rail open — G2b's
  `margin-top: auto` footer outside the scroll area is what prevents that, and
  it matters more here than on desktop.
- **I. Markup is static in each of the 11 pages; behavior is shared in
  `public/_lib/side-nav.js`.** This matches the existing convention
  (`.app-nav` markup + `sticky-topbar.js` + `whats-new-badge.js` behavior) and
  avoids two failure modes a JS-rendered rail would introduce: a flash of no
  navigation, and a script-order break — every page's boot code calls
  `$('#logoutBtn').addEventListener(...)` **synchronously** in an inline script
  at the bottom of `<body>`, which runs *before* any `defer`red external script.
  Cost, stated plainly: 11 copies of ~34 lines of markup, which is the same
  duplication that produced the drift above. Mitigated by writing all 11 in one
  pass and by verification item 3; a lint guard is proposed as follow-up, not
  scope.
- **J. The rail reuses the ids `#navUserAvatar`, `#adminLink`, `#logoutBtn` and
  the classes `.wn-navlink` / `.wn-navlink__dot`.** Every page's existing avatar,
  admin-reveal and logout wiring then keeps working with **zero edits to page
  boot code**, and `_lib/whats-new-badge.js` (which does
  `querySelectorAll('.wn-navlink__dot')`, line 115) needs no change.

## Role gating — the rail is role-shaped, and the member rail is a strict subset

Audited in plan mode. Three surfaces are admin-only, and one of them was a
top-level rail item in the first draft of this plan:

| Surface | Member | Enforcement |
|---|---|---|
| `/workspace_settings.html` | ❌ | `render()` swaps in "Only workspace admins can view workspace settings" — [workspace_settings.html:401](public/workspace_settings.html:401) |
| `/admin.html` | ❌ | hard `location.replace('/dashboard.html')` — [admin.html:412](public/admin.html:412); API also 403s in `functions/api/admin/users.js:15` |
| `/projects/new.html` | ❌ | `renderUnauthorized()` — [projects/new.html:204](public/projects/new.html:204) |
| Dashboard · Projects · Cross-project (incl. new chat) · project settings | ✅ | none |

**Nothing in the rail is ever visible-but-forbidden.** The member rail is a
strict subset of the admin rail: admins additionally get the "+ New project"
child and the two-item admin group.

### Member — 3 primary · 3 bottom

```
[E] Elinno Agent                       «
────────────────────────────────────────
▣  Dashboard                               /dashboard.html
▤  Projects                           ⌄
     ├ Rain                           ⌄    ← has Jira: expander
     │    ├ Sprint View                     /project/rain/sprint
     │    └ Chat                            /project/rain
     ├ Atlas                          ›
     ├ Beacon                                ← no Jira: direct link, no expander
     ├ Northwind                      ›
     ├ Helios                         ›      ← up to 5, /api/projects order
     └ All projects  →                      /projects.html
                                            ✗ no "+ New project" — admin-only
▧  Cross-project chats                     /cross-project/index.html
                                            ← plain link, no children (G1b)
────────────────────────────────────────
✦  What's new                       ●      /whats-new.html
(J) Jenny                                  #navUserAvatar
⏻  Log out                                 #logoutBtn
```

### Admin — 3 primary · 2 admin · 3 bottom

Identical, plus a third action on every project, a create row, and the admin
group:

```
▤  Projects                           ⌄
     ├ Rain                           ⌄
     │    ├ Sprint View                     /project/rain/sprint
     │    ├ Chat                            /project/rain
     │    └ Settings                  ★     /project_settings/rain
     ├ Beacon                         ⌄     ← no Jira, but 2 actions → expander
     │    ├ Chat                            /project/beacon
     │    └ Settings                  ★     /project_settings/beacon
     ├ …
     ├ All projects  →                      /projects.html
     └ + New project                  ★     /projects/new.html
────────────────────────────────────────
⚙  Workspace settings                ★     /workspace_settings.html
⛊  Members                           ★     /admin.html
────────────────────────────────────────
✦  What's new                       ●
(J) Jenny
⏻  Log out
```

★ = admin-only. Every ★ row is absent from the member DOM, not hidden in it.

Both trees above were rendered against production `auth.css` and the real
Tabler 2.47 webfont on 2026-08-16 and measured: collapsed **64px**, expanded
**260px**, third-level label column **172px**. The admin tree is drawn with two
projects expanded so every child is visible at once — that state is *not*
reachable under G2, and it is where the 836px worst case comes from.

Icons are Tabler webfont classes: `ti-layout-dashboard`, `ti-folders`,
`ti-messages`, `ti-settings`, `ti-shield`, `ti-sparkles`, `ti-logout`,
`ti-plus`, `ti-chevron-right`, `ti-menu-2`.

## Not a security carve-out

Per WORKFLOW's carve-out list this touches no crypto, OAuth callback,
project-scoping enforcement, webhook handler, or schema migration. No new
endpoints and no DDL — the accordion reads `/api/projects` and nothing else
(G1b), an already workspace-scoped handler the projects page already calls.

The one backend change (decision G4, `has_jira` on `GET /api/projects`) is a
read-only additive field on an existing workspace-scoped handler, ported
verbatim from `dashboard.js`. It still gets **DEFAULT mode** — it is the only
sub-task touching `functions/`, and a scoping mistake there is exactly the class
of error the carve-out list exists for, even though this change is not on it.

One sink does need care and gets DEFAULT mode for it: **project names and
conversation titles are user-entered text going into `innerHTML`.** They are
escaped at the sink, same discipline as `_lib/chat-suggestions.js`. Chat links
use `/cross-project/chat.html?id=<id>`, the form `cross-project/index.html`
already ships — deliberately *not* a hand-built `?ids=` combo URL, which is the
shape that caused the reload loop fixed in `fdf25be`.

## Height math

Removing a 70px sticky bar changes five coupled expressions. All mechanical:

| Where | Now | After |
|---|---|---|
| `auth.css:341` `.app-main` | `min-height: calc(100vh - 70px); padding: 70px 0` | `min-height: 100vh` |
| 8× inline `<main style=…>` | `calc(100vh - 70px)` | `100vh` |
| `auth.css:736` `.project-shell` | `calc(100vh - 210px)` | `calc(100vh - 140px)` |
| `project.html:196` + `:350` | `calc(100vh - 130px)` | `calc(100vh - 60px)` |
| `cross-project/chat.html` `.xc-grid` | `calc(100vh - 130px)` | `calc(100vh - 60px)` |

At ≤700px the 52px rail head is added back, so the two chat formulas take a
mobile override of `calc(100vh - 112px)` and `<body>` takes `padding-top: 52px`.

## Sub-tasks

| # | Sub-task | Mode |
|---|---|---|
| 19.0 | `BLOCK_19_PLAN.md` — this plan, committed | AUTO |
| 19.1 | `has_jira` on `GET /api/projects` (decision G4) — port the query from `dashboard.js:114`, no second definition | DEFAULT |
| 19.2 | `.side-nav*` CSS in `auth.css` — collapsed, expanded 260px, three indent levels, <1100px overlay, ≤700px off-canvas + head | AUTO |
| 19.2b | `public/_lib/side-nav.js` — toggle, `localStorage` persistence, active-item mapping, lazy `/api/projects` fetch (one data source, G1b), role/connector action rules (G3), **escaping** | DEFAULT |
| 19.3 | Rail markup + nav removal + height math: `dashboard.html`, `projects.html`, `projects/new.html`, `whats-new.html`, `admin.html` | AUTO |
| 19.4 | Same: `workspace_settings.html`, `project_settings.html` | AUTO |
| 19.5 | Same: `project.html`, `cross-project/chat.html` — includes the two page-local height overrides and the hamburger-separation check | AUTO |
| 19.6 | Same: `cross-project/index.html`, `cross-project/new.html` | AUTO |
| 19.7 | Retire dead CSS (`.app-nav`, `.app-nav-inner`, `.app-nav-actions`, the ≤700px and ≤430px crowding rules, `.app-nav.is-lifted` / `.is-hidden`) and the 10 `sticky-topbar.js` includes; delete `public/_lib/sticky-topbar.js` — nothing else references it | AUTO |
| **19.8** | **VERIFICATION GATE — the matrix below, on the preview deploy. 19.9 and 19.10 are blocked on this passing. A failure stops the block; it does not get noted and merged.** | DEFAULT |
| 19.9 | Cache-bust sweep — all 14 `auth.css?v=2026-08-10-1` sites to a new stamp | AUTO |
| 19.10 | v2.0 What's New entry — Claude drafts structure, **Jenny writes the copy** | AUTO |

Twelve sub-tasks is a large block — larger than Block 18's nine. If it needs
splitting, **19.0 → 19.3 plus the gate** is a coherent first half: the rail fully
working on the five simple pages, with the top bar still live on the other six.
The two halves are independently shippable because decision J means no page's
boot code changes either way.

## Files

- **New:** `public/_lib/side-nav.js`, `BLOCK_19_PLAN.md`
- **Deleted:** `public/_lib/sticky-topbar.js`
- **Backend (the only one):** `functions/api/projects/index.js` — add `has_jira`
- **Modified:** `public/auth.css`, and the 11 authed pages —
  `dashboard.html`, `projects.html`, `projects/new.html`, `project.html`,
  `project_settings.html`, `workspace_settings.html`, `whats-new.html`,
  `admin.html`, `cross-project/index.html`, `cross-project/new.html`,
  `cross-project/chat.html`
- **Reused unchanged:** `_lib/whats-new-badge.js` (decision J),
  `.drawer-backdrop` (`auth.css:1644`), Tabler webfont icons already loaded on
  every page — `ti-layout-dashboard`, `ti-folders`, `ti-messages`,
  `ti-settings`, `ti-sparkles`, `ti-shield`, `ti-logout`, `ti-menu-2`,
  `ti-chevron-right`, `ti-plus`. No inline SVG in JS anywhere.
- **Out of scope:** `public/_dev/*` mockups (7 files also carrying `.app-nav`) —
  they are dev-only and already flagged as an exposure item in HANDOFF.

## Verification matrix (19.8)

Run against the preview deploy, all 11 pages, before any ff-merge.

| # | Check | Threshold |
|---|---|---|
| 1 | Rail geometry | Collapsed `getBoundingClientRect().width` = **64px**; expanded = **260px**, at ≥1100px viewport. Third-level label column ≥ **150px** with no clipped text |
| 2 | Item count, admin | Every page on an admin account: exactly **3** primary, **2** admin, **3** bottom items |
| 2b | Item count, member | Every page on a **non-admin** account: exactly **3** primary, **0** admin, **3** bottom items; the Projects accordion shows **no** "+ New project" row. **0** rail links resolve to a forbidden/redirect page |
| 3 | Markup identity | The 11 rail blocks are **byte-identical** (`diff` of the extracted block) — the anti-drift check for decision I |
| 4 | Active item | Exactly **1** element with `aria-current="page"` per page, matching: dashboard→Dashboard; projects, projects/new, project/*, project_settings/*→Projects; cross-project/*→Cross-project; workspace_settings→Workspace settings; whats-new, admin→none |
| 5 | Console | **0** errors on load, each of the 11 pages |
| 6 | Existing wiring intact | `#navUserAvatar` shows initials, `#adminLink` reveals for admin, `#logoutBtn` POSTs `/api/logout` and lands on `/` — on all 11, with **0** page-script edits |
| 7 | Chat height | At 900px viewport height: `.project-shell` and `.xc-grid` computed height = **840px**, and `document.body.scrollHeight ≤ window.innerHeight` |
| 8 | Expanded, no crush | At 1280px width with rail expanded: chat main pane width **≥ 500px**. Mockup baseline at 1180px: 822px collapsed → 640px expanded |
| 8b | Primary items reachable | At **768px** viewport height with the rail expanded, all **3** primary items are reachable — visible, or reachable by scrolling `.sn-group` without the footer moving. The 640px-tall mockup pushed Cross-project chats below the scroll fold, which is acceptable only because G2b keeps the footer pinned |
| 9 | Overlay threshold (decision D) | At 1100px width with rail expanded: content `margin-left` stays **64px** and the backdrop is visible |
| 10 | Mobile off-canvas | ≤700px: rail `transform: translateX(-100%)` when closed; head bar height = **52px**; rail width **280px / max 85%**; rail toggle and conversations hamburger are **2 distinct elements ≥24px apart** (mockup baseline at 375px: 65px vertical, 303px horizontal) |
| 10b | Mobile footer pinned (H2) | At 375×812 with the rail open, the Log out row's `getBoundingClientRect().bottom` is **within** the viewport without scrolling the rail |
| 11 | Mobile vertical budget | `project.html` empty-state requirement must **not regress above 623px** (the Block 18 measured number). Record the new number — the expected direction is *down*, chrome goes 70px → 52px |
| 12 | Accordion, level 2 | Expanding Projects renders **≤5** project rows + "All projects" (+ "New project" for admins only); each href returns **200** for the role that can see it |
| 12b | Accordion, level 3 (G3 matrix) | On a Jira project as admin: exactly **3** actions (Sprint View · Chat · Settings). As member: **2**, Settings absent from the DOM. On a Jira-less project as admin: **2** (Chat · Settings). As member: the row is an `<a>` to `/project/<slug>` with **0** child rows and no chevron |
| 12c | `has_jira` parity | For every project, `has_jira` from `GET /api/projects` **equals** `has_jira` from `GET /api/dashboard` — the two must not diverge the way `dashboard.js`'s sprint rule diverged from `_lib/jira-sprint.js` |
| 12d | One-at-a-time (G2) | With a project expanded, expanding a second leaves exactly **1** project expanded and **1** top-level section open |
| 12f | Rail fits the screen (G2b) | At **768px** viewport height, admin account, Projects + one project expanded: `.side-nav` height **≤ viewport**, and the Log out row's `getBoundingClientRect().bottom` is **within** the viewport. Mockup baseline: admin 767px / member 631px |
| 12g | No chat fetch (G1b) | Across all 11 pages, **0** requests to `/api/cross-project/conversations` originate from the rail, and Cross-project chats has **0** child rows and no chevron |
| 12e | Sprint View lands | `/project/<slug>/sprint` for a `has_jira` project renders the Sprint View with the segmented control **visible** — i.e. the rail never links to a surface the page hides |
| 13 | Escaping | A project named `<img src=x onerror=alert(1)>` renders as **literal text** at level 2, and its slug is escaped into the level-3 `href`s; `0` script executions |
| 14 | Unread dot | With `localStorage` version ≠ newest published, `.wn-navlink__dot` is present and visible in the rail |

**Known limits on where these can run.** Per the preview-verification note: the
alias needs its own sign-in and lags the push, and it cannot be driven at real
phone widths. Items 10 and 11 run via `resize_window` in the Browser pane, which
emulates rather than reproduces a phone. The SE-class question left open at the
end of Block 18 still needs Jenny on a real device and is **not** answered by
this matrix.

**Item 2b needs a non-admin account on the preview.** The member rail is half
the design and nothing in this repo proves it renders correctly without one. If
no member account exists, Jenny creates one from `/admin.html` before 19.8 — the
alternative is shipping the member experience unverified, which item 2b exists
to prevent.

## Follow-ups, not scope

- A lint/CI guard asserting the 11 rail blocks stay identical (item 3 catches
  drift once; nothing prevents it recurring).
- HANDOFF's standing Browser Cache TTL defect means 19.9's stamp bump reaches
  warm-cache users up to four hours late, as it does every release.
