# Elinnovation Style Guide

A complete design reference distilled from `elinnovation.net` — a Web3 studio site with a dark-hero / light-content split, purple accent system, and Clash Grotesk typography. Hand this entire file to Claude (or any agent) and it can rebuild a site with the same visual language.

---

## 1. Brand Personality

- **Feel:** modern, technical, premium. Bold uppercase headlines over a dark video/gradient hero, then airy light sections below.
- **Contrast model:** dark hero (almost-black `#121215`) → light body (`#fff` / `#f7f7f7`) → soft purple-tinted hover states (`#f0ebff`).
- **Motion:** generous `0.7s` ease transitions on cards, gentle `0.3s linear` on inputs. Smooth scroll site-wide.

---

## 2. Color System

### Primary palette
| Role | Hex | Usage |
|---|---|---|
| Brand purple | `#6234fc` | Primary buttons, links, icon backgrounds on hover, accent line, active states |
| Purple tint (10%) | `rgba(98, 52, 252, 0.1)` | Default icon backgrounds in cards |
| Purple wash | `#f0ebff` | Card hover background |
| Near-black | `#121215` | Body / hero background |
| Pure black | `#000` | Headings on light sections, dark text |
| White | `#fff` | Headings on dark sections, card backgrounds |
| Off-white | `#f7f7f7` | Section backgrounds, footer, default card background |
| Mid grey | `#4f4f4f` | Body paragraph text |
| Light grey | `#888` | Muted text, helper labels |
| Border grey | `#e0e0e0` / `#eaeaea` | Form field idle background, card borders |
| Placeholder grey | `#a5a5a5` | Input placeholders |

### Status / accent colors
| Role | Hex |
|---|---|
| Success green | `#4dd388` (text), `#6dff39` (vivid) |
| Warning yellow | `#ffc13d` |
| Error / pink | `#ff0083` |
| Danger red | `#f41e5e` / `red` |
| Deep blue | `#133572` |

### Overlays
- Translucent white button bg: `rgba(255, 255, 255, 0.1)` with `1px solid #fff`
- Frosted button: `hsla(0,0%,100%,0.27)` + `backdrop-filter: blur(4.5px)`
- Frosted nav: `rgba(0,0,0,0.3)` + `backdrop-filter: blur(3.5px)`
- Subtle field bg on light: `rgba(0,0,0,0.05)`
- Pill / tag bg: `rgba(0,0,0,0.06)`

---

## 3. Typography

### Font families
The site uses **Clash Grotesk** (custom OTF) with five weights, plus Google Fonts as fallbacks.

```css
@import url('https://fonts.googleapis.com/css2?family=Mada:wght@200..900&family=Space+Grotesk:wght@300..700&display=swap');

/* Clash Grotesk weights, exposed as named families */
font-family: 'clight';     /* 300 — light */
font-family: 'cregular';   /* 400 — body */
font-family: 'cmedium';    /* 500 — UI, buttons, sub-heads */
font-family: 'csemibold';  /* 600 — emphasis inside headings */
font-family: 'cbold';      /* 700 — rare, heaviest */

/* Web-safe fallback stack */
font-family: 'cregular', 'Space Grotesk', 'Mada', system-ui, -apple-system, sans-serif;
```

> If you can't load Clash Grotesk, **Space Grotesk** is the closest free substitute — same geometric grotesk feel.

### Type scale (desktop → mobile)

| Token | Desktop | Mobile (≤600px) | Family | Style |
|---|---|---|---|---|
| Hero headline | `60px` | `41px` (≤425: `34px`) | `cregular` w/ `csemibold` spans | UPPERCASE, line-height 110%, max-width 770px |
| Section heading (light bg) | `45–60px` | `26–35px` | `cmedium` | UPPERCASE, line-height 110% |
| Section heading (dark bg) | `60px` | `26px` | `cmedium` | white, UPPERCASE |
| Card heading L | `26–28px` | `18px` | `cmedium` | line-height 100% |
| Card heading M | `22px` | `18px` | `csemibold` | line-height 130% |
| Card heading S | `18–20px` | — | `cmedium` | UPPERCASE |
| Hero paragraph | `18px` | `16px` | `cmedium` | line-height 130%, max-width 770px |
| Body paragraph | `16–18px` | `14–16px` | `cregular` | line-height 130–140%, color `#4f4f4f` on light, `#fff` on dark |
| Eyebrow / label | `18px` | `14px` | `cmedium` | UPPERCASE, color `#6234fc`, letter-spacing `1.08px` |
| Button text | `14px` | `14px` | `cmedium` | UPPERCASE, line-height 100% |
| Nav link | `16px` | `20px` (mobile drawer) | `cregular` | line-height normal |
| Tag / pill | `14px` | — | `cregular` | line-height 120% |
| Caption / fine print | `14px` | — | `cregular` or `400` | color `#9f9f9f` |

### Heading rules
- Headlines are **UPPERCASE** with `line-height: 110%`.
- Inside headlines, mix `cregular` for the bulk of the line and wrap accent words in a `<span class="dark">` that switches to `csemibold` (creates the two-weight headline look).
- Default headline color: `#fff` on dark hero, `#000` on light sections.

---

## 4. Layout & Spacing

### Container
```css
.custom-container {
  max-width: 1230px;
  width: 100%;
  padding: 0 15px;
  margin: 0 auto;
}
```

### Section padding rhythm
- Hero: `min-height: 100vh`, content centered, ~`-15px` margin-top on inner block.
- Standard light section: `padding: 70px 0` (e.g., contact). Some go `padding: 120px 0 60px`.
- Legal / "header-then-content" pages: `padding-top: 200px; padding-bottom: 90px;` so the header sits below the fixed nav with breathing room.
- Footer top: `padding: 50px 0`.
- Vertical gap utility: `.ptb60` = `60px 0`, `.ptb20` = `20px 0`.

### Grid usage
- Bootstrap 5.3 grid (`row` / `col-md-*`) is loaded.
- Two-column form layouts use raw CSS grid: `grid-template-columns: 1fr 1fr` with `border-radius: 15px` wrapping both halves.

### Border radius scale
- `8px` — buttons, inputs, tag chips on dark
- `10px` — image containers, icon badges
- `15px` — cards, form wrappers
- `20px` — large content blocks
- `50px` — pills

---

## 5. Components

### 5.1 Navigation Bar

```css
.main-navbar {
  position: absolute;          /* sits over hero */
  top: 0; left: 0;
  width: 100%;
  z-index: 999;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(3.5px);
  -webkit-backdrop-filter: blur(3.5px);
}
.main-navbar .navbar { padding: 13px 0; }
.main-navbar .navbar-nav { gap: 40px; margin: 0 auto; }
.main-navbar .nav-link {
  color: #fff;
  font: 16px/normal 'cregular';
  text-align: center;
  padding: 0;
}
/* Variant for light pages */
.specialnavbar .nav-link { color: #000; }
```

**Nav CTA button (outlined-on-glass):**
```css
.main-navbar .btn-common {
  border-radius: 8px;
  border: 1px solid #fff;
  background: rgba(255, 255, 255, 0.1);
  padding: 15px 25px;
  color: #fff;
  font: 14px/100% 'cmedium';
  text-transform: uppercase;
}
```

### 5.2 Buttons

There are four button styles. All share: `border-radius: 8px`, `padding: 20px 0` (or `15px 25px` for compact), `font: 14px/100% 'cmedium'`, `text-transform: uppercase`, `border: none`, `outline: none`.

| Variant | Background | Text | Use |
|---|---|---|---|
| **Primary (purple)** | `#6234fc` | `#fff` | Main CTAs |
| **Frosted dull** | `hsla(0,0%,100%,0.27)` + `backdrop-filter: blur(4.5px)` | `#fff` | Secondary CTA on hero |
| **Outlined on glass** | `rgba(255,255,255,0.1)` + `1px solid #fff` | `#fff` | Nav CTA |
| **Light dismiss** | `#f7f7f7` | `#000` | Cookie banner "decline" |

Default hero button width: `165px`. Form-submit buttons: `width: 100%`.

```css
/* Primary purple button */
.greenbtn {
  display: flex; justify-content: center; align-items: center;
  padding: 20px 0; width: 165px;
  background: #6234fc;
  color: #fff;
  text-align: center;
  font: 14px/100% 'cmedium';
  text-transform: uppercase;
  border: none; outline: none;
  border-radius: 8px;
}
```

> Note: although the site's class is `.greenbtn`, the actual color is purple `#6234fc`. Keep the visual, rename the class.

### 5.3 Cards (Services / "Why Choose Us")

The signature card pattern — purple-wash hover with icon-color invert:

```css
.specialcard {
  border-radius: 15px;
  background: #f7f7f7;
  padding: 40px;
  cursor: pointer;
  transition: 0.7s;
}
.specialcard .specialcardimg {
  width: 100px; height: 100px;
  border-radius: 10px;
  background: rgba(98, 52, 252, 0.1);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 30px;
  transition: 0.7s;
}
.specialcard .specialcardimg path { fill: #6234fc; stroke: #6234fc; transition: 0.7s; }
.specialcard .specialcardhead {
  color: #000;
  font: 26px/100% 'cmedium';
  margin-bottom: 25px;
}
.specialcard .specialcardpara {
  color: #000;
  font: 18px/140% 'cregular';
  margin-bottom: 40px;
}
.specialcard .viewmorelink {
  color: #6234fc;
  font: 18px/100% 'cregular';
  display: flex; align-items: center; gap: 5px;
}

/* Hover: card turns purple-wash, icon flips solid purple, icon glyph turns white */
.specialcard:hover { background: #f0ebff; }
.specialcard:hover .specialcardimg { background: #6234fc; }
.specialcard:hover .specialcardimg path { fill: #fff; stroke: #fff; }
```

A second smaller variant (`.choosecard`) uses `padding: 25px 25px 35px`, white default background, centered text alignment, smaller icon (`70x70`).

### 5.4 Forms

**Floating-label "material" textfield (dark variant):**
```css
.material-textfield input {
  background: #000;
  border: 1px solid #fff;
  border-radius: 0;
  padding: 17px 18px;
  color: #fff;
  font: 700 14px/117% 'cregular';
  width: 100%;
}
.material-textfield label {
  position: absolute; left: 0; top: 50%;
  transform: translateY(-50%);
  background: #000;
  padding: 0 6.4rem 0 1.3rem;
  margin: 0 0.5rem;
  color: #343434;
  font: 400 14px/120% sans-serif;
  pointer-events: none;
  transition: 0.1s ease-out;
}
.material-textfield input:focus + label,
.material-textfield input:not(:placeholder-shown) + label {
  top: 0;
  transform: translateY(-50%) scale(0.9);
  color: #fff;
  padding: 0 0.3rem;
  width: unset;
}
```

**Light form field (career / contact pages):**
```css
.option-field input {
  background: #eaeaea;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 18px 16px;
  color: #000;
  font: 400 14px/100% sans-serif;
  width: 100%;
  transition: 0.3s linear;
}
.option-field input:focus {
  background: rgba(0, 0, 0, 0.05);
  border: 1px solid #6234fc;
}
.option-field input::placeholder { color: #a5a5a5; }
```

**Form wrapper:**
```css
.apply-form {
  border-radius: 15px;
  border: 1px solid #e0e0e0;
  background: #f7f7f7;
  padding: 25px;
}
```

### 5.5 Hero / Banner

```css
.mainbanner {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.mainbanner .main-banner-video {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover; object-position: center;
  z-index: -999;
}
/* Purple color wash sitting over the video */
.mainbanner .thisdiv {
  position: absolute; inset: 0;
  background: #6234fc;
  mix-blend-mode: color;
  z-index: 9;
}
.mainbanner .innerbanner {
  position: relative;
  z-index: 99;
  text-align: center;
}
.mainbannerhead {
  color: #fff;
  font: 60px/110% 'cregular';
  text-transform: uppercase;
  max-width: 770px;
  margin-bottom: 30px;
}
.mainbannerhead .dark { font-family: 'csemibold'; }  /* highlighted words */
.mainbannerpara {
  color: #fff;
  font: 18px/130% 'cmedium';
  max-width: 770px;
  margin-bottom: 55px;
}
.bannerbtns {
  display: flex; justify-content: center; align-items: center;
  gap: 20px;
}
```

### 5.6 Section Heading (eyebrow + line + heading + para)

```css
.contactgreenpara {        /* eyebrow */
  color: #6234fc;
  font: 18px/100% 'cmedium';
  text-transform: uppercase;
  letter-spacing: 1.08px;
  margin-bottom: 20px;
}
.contactline {             /* divider line under eyebrow */
  display: block;
  width: 107px; height: 2px;
  background: #6234fc;
  margin-bottom: 30px;
}
.contactmainhead {         /* big heading */
  color: #000;
  font: 50px/110% 'cmedium';
  text-transform: uppercase;
  margin-bottom: 20px;
}
.contactpara {             /* supporting paragraph */
  color: #000;
  font: 18px/140% 'cregular';
}
```

### 5.7 Two-Panel Block (e.g., Contact)

```css
.innercontact {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.03);
}
.contactleft {
  width: 100%;
  padding: 70px 50px;
  background: #f0ebff;          /* purple wash side */
  border-radius: 20px 0 0 20px;
}
.contactright {
  width: 100%;
  padding: 40px 50px 46px;
  background: #f7f7f7;          /* neutral side */
}
@media (max-width: 600px) {
  .innercontact { grid-template-columns: 1fr; }
  .contactleft { border-radius: 20px 20px 0 0; }
}
```

### 5.8 Tag / Pill

```css
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  border-radius: 50px;
  background: rgba(0, 0, 0, 0.06);
  padding: 8px;
  color: #000;
  font: 14px/120% 'cregular';
}
```

### 5.9 Footer

```css
.mainfooter {
  padding: 50px 0;
  background: #f7f7f7;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.innerfooter {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.footerleft .logopara {
  color: #000;
  font: 16px/140% 'cregular';
  margin-top: 38px;
  max-width: 290px;
}
.footerright {
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  gap: 90px;
}
.footerlinks {
  display: flex; flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
.footerlinkhead {
  color: #000;
  font: 20px/normal 'cmedium';
  text-transform: uppercase;
}
.footerlinkpara {
  color: #4f4f4f;
  font: 16px/normal 'cregular';
  text-decoration: none;
  display: flex; align-items: center; gap: 8px;
  margin: 0 0 10px;
}

@media (max-width: 600px) {
  .innerfooter,
  .innerfooter .footerleft { flex-direction: column; align-items: center; }
  .footerlinkhead { display: none; }
  .footerright { flex-direction: column; gap: 0; }
}
```

### 5.10 Cookie Banner (fixed corner)

```css
.cookiesmain {
  position: fixed;
  right: 22px; bottom: 50px;
  width: 348px;
  padding: 20px;
  border-radius: 8px;
  border: 1px solid #333;
  background: #fff;
  z-index: 999;
}
.cookeishead { display: flex; align-items: center; gap: 20px; margin-bottom: 16px; }
.cookeismainimg {
  width: 40px; height: 40px;
  border-radius: 10px;
  background: #6234fc;
  display: flex; align-items: center; justify-content: center;
}
.cookeismainimg svg path { fill: #fff; }
.cookeisheadpara { color: #000; font: 20px/100% 'cmedium'; }
.cookeisbodypara { color: #000; font: 14px/140% 'cregular'; margin-bottom: 24px; }
.cookeisbodypara .greentext { color: #6234fc; font-weight: 500; text-decoration: underline; }
.cookeisbuttons { display: flex; justify-content: space-between; gap: 12px; }
```

---

## 6. Interaction & Motion

```css
/* Universal smooth scroll */
html { scroll-behavior: smooth; }

/* Default global transition (background colors only) */
a, button, div, h1, h2, h3, h4, h5, h6, p, span, ul {
  transition: background-color 1s ease-out;
}

/* Card hover transition speed */
.card-like { transition: 0.7s; }

/* Form transitions */
input, textarea { transition: 0.3s linear; }

/* Floating label */
.material-textfield input { transition: 0.1s ease-out; }
```

### Hover patterns (cheat sheet)
- **Light card → purple wash:** `background: #f7f7f7` → `#f0ebff`.
- **Icon badge:** tinted background (`rgba(98,52,252,0.1)`) + purple glyph → solid purple background (`#6234fc`) + white glyph.
- **Link:** purple `#6234fc`, often with a small chevron icon and `gap: 5px`.
- No underline on `<a>` by default (`text-decoration: none !important`); reintroduce `underline` only on inline body links.

---

## 7. Imagery & Backgrounds

- **Hero:** background `<video>` set to `object-fit: cover`, layered with a purple `mix-blend-mode: color` div for unified tint. Falls back to a vector `bodybg.svg` repeated cover-positioned at 50% center.
- **Body fallback:** `background: #121215;` plus the SVG above.
- **Image radius:** `.border-img { border-radius: 10px; }`

---

## 8. Iconography

- Font Awesome 5.15.4 is loaded for utility icons.
- Section/feature icons are inline `<svg>` so `path { fill: ...; stroke: ...; }` can be color-controlled by hover state.
- Default icon size in cards: `48px` glyph inside `100x100` (large) or `70x70` (medium) padded badge.

---

## 9. Responsive Breakpoints

| Breakpoint | Behavior |
|---|---|
| `≤ 992px` | `.choosecard` enforces `min-width: 285px` for horizontal scroll layouts |
| `≤ 600px` | Headlines drop to ~30px / 41px, two-column grids stack, footer goes column-and-centered, footer link headings hide, modals go full-width |
| `≤ 425px` | Hero headline shrinks to `34px`, footer link text shrinks to `14px` |
| iPhone 12-class (390×844 @3x) | Hero headline locked at `3rem`, vertical padding tightens to `20px 0` |

---

## 10. Drop-in CSS Variables (recommended starter)

Use this as the top of your stylesheet:

```css
:root {
  /* Colors */
  --color-bg-dark: #121215;
  --color-bg-light: #fff;
  --color-bg-soft: #f7f7f7;
  --color-bg-wash: #f0ebff;

  --color-brand: #6234fc;
  --color-brand-tint: rgba(98, 52, 252, 0.1);

  --color-text-dark: #000;
  --color-text-body: #4f4f4f;
  --color-text-muted: #888;
  --color-text-placeholder: #a5a5a5;
  --color-text-inverse: #fff;

  --color-border: #e0e0e0;
  --color-field-bg: #eaeaea;

  --color-success: #4dd388;
  --color-error: #ff0083;
  --color-danger: #f41e5e;
  --color-warning: #ffc13d;

  /* Glass */
  --glass-nav: rgba(0, 0, 0, 0.3);
  --glass-blur-nav: blur(3.5px);
  --glass-button: hsla(0, 0%, 100%, 0.27);
  --glass-blur-button: blur(4.5px);

  /* Type */
  --font-light: 'clight', 'Space Grotesk', system-ui, sans-serif;
  --font-regular: 'cregular', 'Space Grotesk', system-ui, sans-serif;
  --font-medium: 'cmedium', 'Space Grotesk', system-ui, sans-serif;
  --font-semibold: 'csemibold', 'Space Grotesk', system-ui, sans-serif;
  --font-bold: 'cbold', 'Space Grotesk', system-ui, sans-serif;

  --fs-hero: 60px;
  --fs-h1: 50px;
  --fs-h2: 45px;
  --fs-h3: 30px;
  --fs-card-lg: 26px;
  --fs-card-md: 22px;
  --fs-body: 18px;
  --fs-body-sm: 16px;
  --fs-meta: 14px;

  /* Layout */
  --container-max: 1230px;
  --section-pad-y: 70px;

  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 15px;
  --radius-xl: 20px;
  --radius-pill: 50px;

  /* Motion */
  --t-fast: 0.1s ease-out;
  --t-form: 0.3s linear;
  --t-card: 0.7s;
}
```

---

## 11. Build Checklist for a New Page

- [ ] Load Bootstrap 5.3 + Font Awesome 5.15 + Google Fonts (Mada, Space Grotesk).
- [ ] Wrap content in `.custom-container` (max 1230px, 15px gutter).
- [ ] Hero: `min-height: 100vh`, dark video/image background, purple `mix-blend-mode: color` overlay, glass nav floating on top.
- [ ] Headline pattern: UPPERCASE, 60px, mix `cregular` + `csemibold` spans.
- [ ] Body sections: light (`#fff` or `#f7f7f7`) with black headings and `#4f4f4f` body text.
- [ ] Use the eyebrow + 107×2px purple line + uppercase heading + paragraph pattern for section intros.
- [ ] Cards: 15px radius, `#f7f7f7` bg, hover to `#f0ebff` + icon badge inverts to solid purple with white glyph (0.7s transition).
- [ ] Buttons: 8px radius, 14px uppercase `cmedium`, primary `#6234fc`, secondary frosted glass.
- [ ] Footer: light `#f7f7f7`, three-column links on desktop, stacked & centered on mobile.
- [ ] Smooth-scroll, no underlines on links by default, transition `background-color 1s ease-out` globally.
