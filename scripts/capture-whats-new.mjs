#!/usr/bin/env node
// scripts/capture-whats-new.mjs
//
// Captures a What's New preview image (PRD §5.11.6.2).
//
// Takes a URL, a CSS selector and an output filename, sets a fixed viewport,
// and writes the PNG. Week-to-week captures need identical viewport, device
// scale and framing or the page reads as ragged — that determinism is the
// whole reason this exists rather than shooting by hand.
//
// Element-level capture is deliberate: it produces the tight crop §5.11.6
// requires directly, rather than a wide shot cropped afterwards. A
// full-screen desktop capture is unreadable in the ~270px mobile column.
//
// Usage:
//   node scripts/capture-whats-new.mjs \
//     --url http://localhost:8788/whats-new.html \
//     --selector ".wn-issue" \
//     --out v1-5-whats-new.png
//
// Every page worth capturing sits behind login, so first save a session
// once (opens a real browser window; you sign in yourself):
//
//   node scripts/capture-whats-new.mjs --save-session \
//     --url http://localhost:8788/
//
// then capture as often as you like with --session.
//
// Options:
//   --url        Page to capture. LOCALHOST ONLY (see below).
//   --selector   CSS selector of the element to crop to.
//   --out        Filename, v{major}-{minor}-{slug}.png. Written to
//                public/whats-new/ unless --dir is given.
//   --dir        Output directory. Default: public/whats-new
//   --width      Viewport width.  Default: 1280
//   --height     Viewport height. Default: 800
//   --scale      Device scale factor. Default: 2 (retina-crisp at half size)
//   --wait       Extra settle time in ms after the selector appears. Default: 400
//   --full       Capture the whole page instead of an element (discouraged).
//   --session    Path to a saved session. Default: .wrangler/whats-new-session.json
//   --save-session
//                Open a visible browser, wait while you sign in, then save
//                the session and exit. Captures nothing.
//
// SESSIONS AND CREDENTIALS. This script never asks for, stores, or types a
// password. --save-session opens a real browser window and waits: you sign
// in to the LOCAL instance with the LOCAL seeded test user, by hand, then
// press Enter. Only the resulting session state is written, into
// .wrangler/ (already gitignored, alongside wrangler's own local state).
// Seeding that local user is likewise yours to run — generating credentials
// is a hard limit in .claude/settings.json.
//
// LOCALHOST ONLY — this is enforced, not advisory. Every page worth
// capturing sits behind login; credential handling is a hard limit in
// .claude/settings.json. Capture runs against a local `wrangler pages dev`
// with a seeded test user, never against production with a live session.
// Pointing this at elinnoagent.com would shoot real project names, real
// Jira keys and real assignee names into an image shown to every user in
// the workspace — exactly the Block 16.9 failure, one layer over.
//
// The tight crop normally keeps personal data out of frame, but that is
// confirmed per image, never assumed. Every shot is reviewed before commit.
//
// Captured, never generated (§5.11.6.1): this script screenshots a real
// rendered page. Drawing or synthesising an approximation is forbidden — it
// would eventually publish a preview showing behaviour the product lacks.

import { chromium } from 'playwright';
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function assertLocal(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`--url is not a valid URL: ${rawUrl}`);
  }
  if (!LOCAL_HOSTS.has(u.hostname)) {
    throw new Error(
      `Refusing to capture ${u.hostname}. This script is localhost-only by ` +
      `design (PRD §5.11.6.2) — capture runs against a local wrangler pages ` +
      `dev with seeded data, never production with a live session.`
    );
  }
  return u;
}

const args = parseArgs(process.argv);
const sessionPath = args.session
  ? String(args.session)
  : path.join('.wrangler', 'whats-new-session.json');

// ── --save-session ────────────────────────────────────────────────────────
// Opens a visible browser and waits while you sign in by hand. No password
// is read, prompted for, or stored by this script — only the resulting
// session state, into gitignored .wrangler/.
if (args['save-session']) {
  if (!args.url) {
    console.error('--save-session needs --url (e.g. http://localhost:8788/)');
    process.exit(2);
  }
  try {
    assertLocal(args.url);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  }

  await mkdir(path.dirname(sessionPath), { recursive: true });
  const b = await chromium.launch({ headless: false });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  await pg.goto(args.url, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\nA browser window is open.');
  console.log('Sign in to the LOCAL instance with your LOCAL seeded test user.');
  console.log('This script does not see, prompt for, or store your password.\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('Press Enter once you are signed in… ');
  rl.close();

  await ctx.storageState({ path: sessionPath });
  await b.close();
  console.log(`✓ session saved to ${sessionPath} (gitignored)`);
  console.log('  Re-run --save-session whenever it expires.');
  process.exit(0);
}

if (!args.url || !args.out || (!args.selector && !args.full)) {
  console.error(
    'Usage: node scripts/capture-whats-new.mjs --url <localhost-url> ' +
    '--selector <css> --out <v1-5-slug.png>\n' +
    'Run with --full instead of --selector to capture the whole page.'
  );
  process.exit(2);
}

try {
  assertLocal(args.url);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(2);
}

const outName = String(args.out);
if (!outName.endsWith('.png')) {
  console.error(`--out must end in .png (got "${outName}")`);
  process.exit(2);
}
if (!/^v\d+-\d+-[a-z0-9-]+\.png$/.test(outName)) {
  // Not fatal — a one-off is sometimes legitimate — but the convention keeps
  // cache-busting automatic and makes stale images obvious at a glance.
  console.warn(
    `⚠  "${outName}" does not match v{major}-{minor}-{slug}.png (§5.11.6.2).`
  );
}

const dir = args.dir || path.join('public', 'whats-new');
const width = Number(args.width) || 1280;
const height = Number(args.height) || 800;
const scale = Number(args.scale) || 2;
const settle = Number(args.wait) || 400;
const outPath = path.join(dir, outName);

await mkdir(dir, { recursive: true });

// Reuse a saved session if one exists. Absent, the capture still runs —
// unauthenticated pages work fine — and the redirect guard below will say
// plainly if the target needed a session after all.
let storageState;
try {
  await access(sessionPath);
  storageState = sessionPath;
  console.log(`· using session ${sessionPath}`);
} catch {
  if (args.session) {
    console.error(`✗ session file not found: ${sessionPath}`);
    console.error('  Create one with --save-session, or drop --session.');
    process.exit(2);
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: scale,
  // No animation mid-shot, and it matches the app's own reduced-motion path.
  reducedMotion: 'reduce',
  ...(storageState ? { storageState } : {}),
});
const page = await context.newPage();

let failed = false;
try {
  const res = await page.goto(args.url, { waitUntil: 'networkidle', timeout: 20000 });
  if (res && res.status() >= 400) {
    throw new Error(`Page returned HTTP ${res.status()}`);
  }

  // An auth redirect means there is no seeded session — capturing the login
  // screen instead of the feature is a silent failure worth shouting about.
  const landed = new URL(page.url());
  if (landed.pathname === '/' || landed.pathname.startsWith('/index')) {
    throw new Error(
      `Redirected to ${page.url()} — the local instance has no signed-in ` +
      `session. Seed a local test user and sign in before capturing.`
    );
  }

  if (args.full) {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: outPath, fullPage: true });
  } else {
    const el = page.locator(String(args.selector)).first();
    await el.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(settle);
    await el.screenshot({ path: outPath });
  }

  console.log(`✓ wrote ${outPath}  (${width}x${height} @${scale}x)`);
  console.log('  Review before committing: check the crop for real project');
  console.log('  names, Jira keys and assignee names (§5.11.6.2).');
} catch (err) {
  failed = true;
  console.error(`✗ capture failed: ${err.message}`);
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
