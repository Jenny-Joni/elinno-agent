# Block 20 — dark mode across the authed app

## Context

The app is light-only. Every authed screen assumes a white page under dark
text, and there is no `prefers-color-scheme` rule anywhere in the repo — this
would be the first.

**The toggle is the easy part. The work is that most colours never pass
through a token.** Measured:

| | Count |
|---|---|
| Tokens defined, across **three** `:root` blocks | 78 (60 colour-bearing) |
| Hard-coded colour literals in `auth.css` rules | 179 |
| More in the 11 pages' local `<style>` blocks | 104 |
| …of which plain white backgrounds | 31 |
| Inline `style=` colours | 2 |

So ~283 declarations — `background: #fff` on every card, `color: #fff` on
every filled button — bypass theming entirely and would stay light. Dark mode
is a **token migration**; the theme switch is the last 5%.

There is a second structural problem. Two token namespaces coexist:

| Namespace | In the 11 pages | In `auth.css` |
|---|---|---|
| v1.4 (`--brand`, `--text-*`, `--bg-*`, `--border`) | **366** | ~165 |
| legacy (`--color-*`) | 1 | **243** |

The pages are v1.4; `auth.css` still drives 243 declarations off the legacy
namespace. Theming only v1.4 would flip the pages while the shared components
inside them stayed white. Both need dark values.

## The palette is a decision, not a derivation — and it needs Jenny

Flipping backgrounds is not enough, because **the brand purple fails contrast
on dark**. Measured (WCAG AA needs 4.5:1 for text):

| Foreground on background | Ratio | |
|---|---|---|
| `#6234fc` on `#121215` | **3.04** | fails |
| `#6234fc` on `#1a1530` (the hero surface) | **2.86** | fails |
| `#9b7dff` on `#121215` | 6.03 | passes |
| `#fff` on `#6234fc` | 6.15 | passes — filled buttons are fine |

So dark mode needs a **lighter brand purple for text and borders**, while
filled buttons keep the existing purple with white on top. That is a real
brand decision, not an implementation detail, and `DESIGN.md` currently
documents one purple. **Jenny signs off the dark palette before 20.2 starts.**

Starting point to react to, anchored on surfaces the app already has
(`--color-bg-dark: #121215`, `--hero-bg: #1a1530`):

| Role | Light | Proposed dark |
|---|---|---|
| page | `#f7f7f7` | `#121215` |
| card / raised | `#fff` | `#1a1a1f` |
| input / subtle | `#fcfcfd` | `#212127` |
| border | `#e6e6e6` | `#2e2e36` |
| text | `#121215` | `#ececf0` |
| text-2 | `#5a5a5a` | `#a8a8b3` |
| text-3 | `#9a9a9a` | `#7c7c88` |
| brand, *text and borders* | `#6234fc` | `#9b7dff` |
| brand, *filled surfaces* | `#6234fc` | `#6234fc` (unchanged) |
| brand tint | `#f0ebff` | `rgba(155,125,255,.14)` |

These are a proposal. Every one is Jenny's to change.

## Locked decisions

Settled in plan-mode Q&A, 2026-08-16.

- **A. Trigger: system default, with an override.** Three states — follow
  system / force light / force dark — persisted per device in
  `localStorage`. `@media (prefers-color-scheme: dark)` carries the default;
  `:root[data-theme="dark"]` and `[data-theme="light"]` win over it.
- **B. Applied pre-paint by the existing rail boot script.** Block 19 already
  ships an inline, synchronous, byte-identical `<head>` script on all 11
  pages that sets classes on `<html>` before first paint. The theme goes
  there. Anything later flashes white — the exact failure Block 19 spent
  four rounds eliminating for the rail, and there is no reason to re-learn it
  on a whole-page background.
- **C. Migrate every colour, both namespaces.** No half-themed screens.
- **D. One block, all 11 pages, verified in both themes before merge.**
- **E. The toggle lives in the rail's bottom group**, beside What's new —
  it is per-device chrome, like the rail's own state, and that group is
  already the home for things that are not destinations.

## Architecture

Three layers, in order:

1. **`:root`** keeps the light values, unchanged. Light stays the fallback
   for any surface the migration misses, which fails safe.
2. **`@media (prefers-color-scheme: dark)`** redefines the ~60 colour tokens
   — *only* inside `:root:not([data-theme="light"])`, so an explicit light
   choice beats the OS.
3. **`:root[data-theme="dark"]`** redefines the same tokens again, so an
   explicit dark choice beats a light OS.

Rules never reference a theme. They reference tokens; the tokens change.
That is what makes the migration the whole job.

The boot script gains one line: read `elinno.theme`, set `data-theme` on
`<html>`. It already reads `localStorage` and already runs before paint.

## Sub-tasks

| # | Sub-task | Mode |
|---|---|---|
| 20.0 | `BLOCK_20_PLAN.md` + the dark palette agreed with Jenny and written into `DESIGN.md` | AUTO |
| 20.1 | Migrate `auth.css`'s 179 literals to tokens. No visual change — light must render byte-identically after | AUTO |
| 20.2 | Migrate the 104 literals in the 11 pages' local `<style>` blocks. Same rule: no visual change in light | AUTO |
| 20.3 | Add dark values for all ~60 colour tokens, both namespaces, in the two guarded blocks | AUTO |
| 20.4 | Theme toggle: rail markup (11 pages, byte-identical), boot-script line, `_lib/side-nav.js` handler, `localStorage` | AUTO |
| 20.5 | Sweep the surfaces tokens cannot reach: `box-shadow` colours, `rgba(0,0,0,…)` overlays, the `.drawer-backdrop`, focus rings, and the two inline `style=` colours | AUTO |
| **20.6** | **VERIFICATION GATE — the matrix below, both themes, all 11 pages. 20.7 is blocked on it** | DEFAULT |
| 20.7 | Cache-bust sweep + What's New entry (Jenny's copy) | AUTO |

20.1 and 20.2 are the bulk. They are mechanical but large, and they are the
sub-tasks where a mistake is invisible in light mode and obvious in dark.

## Files

- **Modified:** `public/auth.css` (the bulk — ~4,200 lines, both `:root`
  blocks plus 179 literals), the 11 authed pages' local `<style>` blocks and
  their shared boot/rail blocks, `public/_lib/side-nav.js`, `DESIGN.md`
- **Reused:** the Block 19 boot script (decision B), the rail's bottom group
  (decision E), `readStore`/`writeStore` in `_lib/side-nav.js`
- **Out of scope:** `public/index.html` and the other pre-login pages — the
  request was explicitly "after the login". `public/_dev/*`.

## Verification matrix (20.6)

Every item runs **twice**, once per theme, on all 11 pages.

| # | Check | Threshold |
|---|---|---|
| 1 | No light leaks | **0** elements with a computed background in `#fff`/`#f7f7f7`/`#fcfcfd` while `data-theme="dark"`, scanned across every rendered node |
| 2 | No dark-on-dark text | **0** text nodes whose computed colour contrasts **< 4.5:1** with their own computed background. Scripted, not eyeballed — this is the check that catches a missed token |
| 3 | Light is unchanged | 20.1 + 20.2 alter **0** pixels in light mode: computed background/colour/border for every element identical to `origin/main`, sampled per page |
| 4 | No flash | **0** layout-shift entries and no background change between first paint and settled, dark mode, cold load — same method that verified the rail |
| 5 | Override beats OS | OS dark + `data-theme="light"` renders light; OS light + `data-theme="dark"` renders dark; "follow system" tracks a change to `prefers-color-scheme` live |
| 6 | Persistence | Choice survives navigation across all 11 pages and a cold reload |
| 7 | Brand contrast | Brand-coloured text and borders ≥ **4.5:1** against their surface in both themes; filled buttons ≥ 4.5:1 for their label |
| 8 | Status colours | success / amber / danger all ≥ 4.5:1 in both themes — these are easy to forget and only appear in states you have to provoke |
| 9 | Shadows and overlays | `rgba(0,0,0,…)` shadows and the drawer backdrop are visible against dark surfaces, not invisible-black-on-black |
| 10 | Console | **0** errors, both themes, all 11 pages |

**The member rail is still unverified from Block 19** (gate item 2b). If a
member account becomes available, both themes should be checked on it too;
if not, that gap now spans two blocks and should be stated in the closeout.

## Risks worth naming

- **`auth.css` is ~4,200 lines and this touches a large fraction.** Item 3
  exists because the most likely failure is not a bad dark colour but an
  accidental change to light mode, which is the theme everyone is using
  today.
- **The 4-hour cache TTL.** A half-cached stylesheet against new markup is
  what nearly shipped a broken rail in Block 19. The stamp bump in 20.7 is
  load-bearing.
- **Screenshots and images.** No product screenshots ship today (What's New
  uses wireframes), so nothing needs a dark variant yet — but the first real
  screenshot will.
