# Elinno Agent — v1.4 QA Plan

> Full manual QA checklist for the v1.4 production surface
> (`elinnoagent.com`). Run end-to-end after a release to verify
> nothing regressed. Pair with `QA-RUN.md` for per-run results.

**Authored:** 2026-05-24
**Target build:** v1.4 (`bd47074`, prod as of 2026-05-23; HANDOFF
closeout `697809b` 2026-05-24)
**Estimated time per pass:** 2–3 hours

---

## Purpose

This document is the single source of truth for "what to test on
v1.4." Every endpoint and every page is exercised at least once.
For each run, copy the section IDs into `QA-RUN.md` and record
PASS / FAIL / FIXED / DEFER + a timestamp. Mark this file's
checkboxes only if you want to track a single canonical run; for
repeated runs use `QA-RUN.md`.

---

## Production-testing guardrails

These six rules govern every scenario below. Read once, then run.

1. **Scratch-project pattern.** Write scenarios run against the
   pre-blessed scratch project (slug `qa-scratch`, recreated per
   pass, soft-deleted at the end). Never run destructive scenarios
   against `rain` / `joni` / `gems-launchpad` / `gems-trade`.
2. **Scratch-user pattern.** Admin-tab write scenarios use a
   `qa+<YYYY-MM-DD>@elinnovation.net` account (Resend plus-
   addressing). Disable or delete at the end.
3. **Read-only first.** Each section orders read-path checks before
   any write, so a 500 on read fails fast before state is touched.
4. **Per-scenario cleanup.** Every write scenario lists its cleanup
   inline. No separate "teardown" section.
5. **Carve-out scenarios tagged `[carve-out]`** touch encryption /
   OAuth / cron / schema / project-scoping. Jenny runs them
   herself; Claude surfaces failures rather than self-fixing.
6. **Pass/fail tracking.** Each scenario has a checkbox + a
   one-line expected result. Mark in `QA-RUN.md`, not here, for
   repeated runs.

---

## Before you start

- [ ] Signed in to `https://elinnoagent.com/dashboard.html` as the
  workspace admin (`jenny@elinnovation.net`) in your primary
  browser.
- [ ] Second browser profile signed in as the scratch user
  (`qa+<YYYY-MM-DD>@elinnovation.net`). Create this user first via
  S2.3 if it doesn't exist.
- [ ] `curl` cookie jar populated with your prod session cookie
  (for API-only scenarios). Extract via DevTools or from the
  Network tab.
- [ ] Cloudflare dashboard open in a separate tab for D1 query
  console + Pages logs + Neon project for sync_runs verification.
- [ ] Slack workspace with the Elinno Slack app installable (for
  §7 scenarios).
- [ ] Jira Cloud account with an API token (for §8 scenarios).

## Legend

- `[carve-out]` — touches a security-sensitive surface; default
  mode only.
- `[needs-second-user]` — requires the scratch user in a second
  browser profile.
- `[needs-cron]` — requires manual cron HMAC `curl` invocation.
- `[needs-slack-app]` — requires a Slack workspace + app install.
- `[needs-jira-app]` — requires Jira Cloud + API token.
- `[deferred-feature]` — feature is in mockup/UI shell but not
  wired in v1.4 (tests the disabled state, not the action).

---

## §0.5 UI layout & overlap audit (~15 scenarios)

Per-page visual sweep at **desktop ≥1200px** and **mobile floor
700px** (the single `@media (max-width: 700px)` breakpoint locked
in Block 2 Decision R). For each page, check: sticky topbar
doesn't overlap content beneath; modals don't bleed off-screen at
700px; long content (long project name, long conversation title,
long Slack channel name) wraps or truncates without breaking
layout; no horizontal scrollbar at page level; no overlapping
z-indexed elements (toast vs. modal vs. ⋯ menu); brandmark + nav
stays clear of right-side action buttons; form fields don't touch
container edges. Capture screenshots of any overlap into the
defect list at the bottom of `QA-RUN.md`.

- [ ] **S0.5.1** `/login.html` desktop + 700px — brandmark vs. form panel; reset link not clipped.
- [ ] **S0.5.2** `/forgot-password.html` desktop + 700px — same check as login.
- [ ] **S0.5.3** `/reset-password.html` desktop + 700px — same check; token-pre-filled state.
- [ ] **S0.5.4** `/dashboard.html` desktop + 700px — cross-project hero card vs. spending card vs. projects grid stack cleanly at 700px; per-project Jira summary doesn't push card height inconsistently.
- [ ] **S0.5.5** `/admin.html` desktop + 700px — users table; horizontal scroll inside table is OK, page-level horizontal scroll is NOT; edit/delete buttons don't wrap below row baseline.
- [ ] **S0.5.6** `/projects.html` desktop + 700px — projects grid wraps cleanly; empty/loading/populated states all sized consistently; state-card icons aligned.
- [ ] **S0.5.7** `/projects/new.html` desktop + 700px — slug-availability indicator doesn't overlap field; submit button state-machine copy doesn't shift form layout.
- [ ] **S0.5.8** `/project.html` desktop + 700px (open `/project/rain`) — chat composer sticky at viewport bottom doesn't cover last message; sidebar ⋯ menu opens without clipping at viewport edge; suggestion chips wrap cleanly; tab nav doesn't collide with sticky topbar.
- [ ] **S0.5.9** `/project_settings.html` General tab (open `/project_settings.html?id=<rain-uuid>&tab=general`) — slug field warning copy + 'Saved' pill don't shift layout; Danger zone visually separated; initial-letter avatar placeholder centered.
- [ ] **S0.5.10** `/project_settings.html` Connections tab — open each modal (channelPickerModal, jiraConnectModal, jiraProjectPickerModal); verify each centers and doesn't clip at 700px.
- [ ] **S0.5.11** `/project_settings.html` Limits tab — sliders + readouts stay aligned at both widths.
- [ ] **S0.5.12** `/cross-project/index.html` desktop + 700px — `.cp-row` cards stack at 700px; empty state centered.
- [ ] **S0.5.13** `/cross-project/new.html` desktop + 700px — multi-select picker rows don't break when source chips wrap; disabled (sourceless) row visual distinction unambiguous.
- [ ] **S0.5.14** `/cross-project/chat.html` desktop + 700px — `.scopechip` Across row doesn't overlap message area; mobile `Across (N) ▾` popover anchors correctly at 700px; per-project `**ProjectName**` bold headers in assistant messages render without spacing collapse.
- [ ] **S0.5.15** `/workspace_settings.html` desktop + 700px — spend cap slider + readout aligned. NOTE: sticky-topbar is NOT wired here (Phase 9 carry-forward, expected); page should not break visually without it.

---

## §1 Auth & session (~10 scenarios)

Endpoints: `POST /api/login`, `POST /api/logout`, `GET /api/me`,
`POST /api/forgot-password`, `POST /api/reset-password`.
Pages: `/login.html`, `/forgot-password.html`,
`/reset-password.html`, `/index.html` (redirect logic).

Reads / negatives first, then write scenarios with cleanup.

- [ ] **S1.1** Hit `/dashboard.html` while signed out → 302 to `/login.html?next=/dashboard.html`.
- [ ] **S1.2** Hit `/login.html` while signed in → 302 to `/dashboard.html`.
- [ ] **S1.3** Login with bad password → form error rendered; no session cookie set; `/api/me` 401.
- [ ] **S1.4** Login with unknown email → same equivalence-class 401 as bad-password (no email enumeration in response body or timing).
- [ ] **S1.5** Forgot-password with unknown email → same generic success response as known email (no enumeration).
- [ ] **S1.6** Login with valid creds (Jenny) → 302 to `/dashboard.html`; `__Host-session` cookie set (HttpOnly, Secure, SameSite=Lax); `/api/me` returns `{id, email, display_name, is_admin: true}`.
- [ ] **S1.7** Logout → cookie cleared; `/api/me` 401.
- [ ] **S1.8** Forgot-password with `jenny@elinnovation.net` → Resend mail received within ~30s; reset link has token query param.
- [ ] **S1.9** Reset-password with valid token → 200; can log in with new password; **cleanup: reset back to your real password immediately**; verify old (interim) password no longer works.
- [ ] **S1.10** Reset-password with expired/used/invalid token → 401.

---

## §2 Workspace admin — user mgmt (~9 scenarios) [needs-second-user]

Endpoints: `GET/POST /api/admin/users`, `PATCH/DELETE
/api/admin/users/[id]`.
Page: `/admin.html`.

- [ ] **S2.1** Jenny loads `/admin.html` → users list renders with all current users.
- [ ] **S2.2** Scratch user (non-admin) loads `/admin.html` in second profile → 403 / redirect.
- [ ] **S2.3** Create scratch user `qa+<YYYY-MM-DD>@elinnovation.net` with display_name omitted → 200; row appears in D1 `users`; `display_name` backfilled to email prefix.
- [ ] **S2.4** PATCH scratch user's `display_name = "QA Test"` → 200; renders updated on next list load.
- [ ] **S2.5** PATCH scratch user's `is_admin = 1` then back to `0` → 200; verify role toggle reflected by re-signing-in the second profile and hitting `/admin.html` (admin while flag is 1, 403 while flag is 0).
- [ ] **S2.6** PATCH scratch user's `must_change_password = 1` → next login forces password-change flow (verify with second profile sign-in).
- [ ] **S2.7** Non-admin attempting `POST /api/admin/users` via curl → 403.
- [ ] **S2.8** DELETE scratch user via admin UI → row removed (verify hard-delete vs soft via D1 query console); cascade clears D1 `sessions`.
- [ ] **S2.9** Cleanup: confirm scratch user gone; if any session cookie still cached in second profile, sign-out cleanly.

---

## §3 Workspace metadata + cross-project AI spend cap (~4 scenarios)

Endpoints: `GET /api/workspace`, `PATCH /api/workspace/limits`.
Page: `/workspace_settings.html`.

- [ ] **S3.1** Read: `GET /api/workspace` returns `{name, plan, user_count, project_count, cross_project_ai_monthly_cap_usd, cross_project_ai_spend_period_to_date_usd}`; name is derived from email domain (`elinnovation.net`).
- [ ] **S3.2** Read: `/workspace_settings.html` renders metadata + spend bar (MTD vs. cap).
- [ ] **S3.3** Write: bump `cross_project_ai_monthly_cap_usd` by $1 via UI slider → persists across reload. **Cleanup: revert to original value.**
- [ ] **S3.4** Negative: scratch user (non-admin) PATCH `/api/workspace/limits` via curl → 403.

---

## §4 Projects CRUD + slug surface (~16 scenarios)

Endpoints: `GET/POST /api/projects`, `GET/PATCH/DELETE
/api/projects/[id]`, `GET /api/projects/slug-available`,
`PATCH /api/projects/[id]/limits`.
Pages: `/projects.html`, `/projects/new.html`,
`/project_settings.html` General + Limits tabs.
Routing: `functions/project/[slug].js`.

Reads first.

- [ ] **S4.1** Read: `/projects.html` lists Rain, Joni, Gems Launchpad, Gems Trade (plus any active `qa-scratch*`).
- [ ] **S4.2** Read: `/project.html?id=<rain-uuid>` legacy URL loads Rain chat (must NOT 302 to `/projects.html` — Block 13.8 hotfix regression guard).
- [ ] **S4.3** Read: `/project/rain` slug URL 302 → `/project.html?id=<rain-uuid>` → loads Rain chat.
- [ ] **S4.4** Read: `/project/does-not-exist` → 404.
- [ ] **S4.5** Read: `GET /api/projects/slug-available?slug=qa-scratch` → `{available: true}` (assuming scratch project doesn't exist yet).
- [ ] **S4.6** Read: `GET /api/projects/slug-available?slug=rain` → `{available: false, reason: "taken"}`.
- [ ] **S4.7** Read: `GET /api/projects/slug-available?slug=new` → `{available: false, reason: "reserved"}` (verify all 13 RESERVED_SLUGS — pick at least 3: `new`, `settings`, `api`).
- [ ] **S4.8** Read: `GET /api/projects/slug-available?slug=BadCase!` → `{available: false, reason: "invalid_format"}`.

Writes.

- [ ] **S4.9** Write: create `qa-scratch` via `/projects/new.html` form. Verify (a) slug field live-derives from name as you type, (b) debounced 300ms availability check, (c) Create button disabled until slug valid + available, (d) on submit → 302 to `/project.html?id=<new-uuid>` or `/project/qa-scratch`.
- [ ] **S4.10** Write: edit `qa-scratch` slug to `qa-scratch-2` in `/project_settings.html` General tab. Verify (a) warning copy appears on edit (b) 'Saved' pill returns when reverted (c) Save gated on (unchanged OR valid + available).
- [ ] **S4.11** Read: **URL freshness after slug change** — immediately after Save: (a) browser URL bar updates if soft-redirect, OR if not, slug field shows new value; (b) `/project/qa-scratch` (old slug) now 404s; (c) `/project/qa-scratch-2` (new slug) loads correctly; (d) projects-list card link uses the new slug.
- [ ] **S4.12** Read: [deferred-feature] Logo upload button on `/project_settings.html` General tab is `disabled` with `title="Coming in v1.3.1"`; initial-letter placeholder renders in avatar slot. **Do NOT attempt upload — no working endpoint in v1.4.**
- [ ] **S4.13** Write: edit AI monthly cap + daily message limit on Limits tab → persists. **Cleanup: revert.**
- [ ] **S4.14** Write: rename `qa-scratch-2` back to `qa-scratch` via General tab → succeeds (slug now available again because it's the current row's own slug).
- [ ] **S4.15** Write: DELETE `qa-scratch` via Danger zone → soft-delete (deleted_at set). Verify (a) disappears from `/projects.html`, (b) `GET /api/projects/slug-available?slug=qa-scratch` returns `{available: true}` again (active partial index excludes soft-deleted).
- [ ] **S4.16** Negative: scratch user (non-admin) `POST /api/projects` via curl → 403.

---

## §5 Project members (~5 scenarios) [needs-second-user]

Endpoints: `GET/POST /api/projects/[id]/members`,
`DELETE /api/projects/[id]/members/[userId]`.
Page: `/project.html` Members tab (verify v1.4 actual home —
might be on `/project_settings.html` Members tab).

Prereq: re-create `qa-scratch` from S4.9 if it was deleted.

- [ ] **S5.1** Read members of `qa-scratch` → Jenny listed with role=admin (creator).
- [ ] **S5.2** Write: invite scratch user as member → 200; appears in list with role=member.
- [ ] **S5.3** Verify: scratch user (in second profile) can `GET /api/projects/<qa-scratch-uuid>` → 200.
- [ ] **S5.4** Negative: scratch user `PATCH /api/projects/<qa-scratch-uuid>` (rename) → 403 (member, not admin).
- [ ] **S5.5** Write: remove scratch user from `qa-scratch` → 204; gone from list; scratch user `GET /api/projects/<qa-scratch-uuid>` → 403 (creator-protected for Jenny).

---

## §6 Conversations & messages — "chat is working" end-to-end (~15 scenarios)

Endpoints: `GET/POST /api/projects/[id]/conversations`,
`GET/PATCH/DELETE /api/projects/[id]/conversations/[cid]`,
`GET/POST .../messages`,
`POST .../refresh-and-ask-again/[mid]`.
Page: `/project.html` Chat tab (sidebar + composer + ⋯ menu).

- [ ] **S6.1** Read: open `/project/qa-scratch` → empty chat + suggestion chips (none for scratch initially; should show generic chips or empty state).
- [ ] **S6.2** Read: chat empty-state CTA — when project has no connections, CTA routes to `/project_settings.html?id=<id>&tab=connections` (Block 13.7b strip change). Verify by clicking it.
- [ ] **S6.3** Write: send "hello" to `qa-scratch` → assistant reply within ~30s; conversation auto-titled (verify title is non-empty + sensible).
- [ ] **S6.4** Write: send a follow-up that references the first message → reply maintains context (multi-turn coherence).
- [ ] **S6.5** **Real-data chat check** — open `/project/rain` (or `/project/joni`), send a known-answerable question like "how many open Jira tickets are in the current sprint?". Verify (a) reply arrives within ~30s, (b) reply contains ≥1 citation marker, (c) cited count matches a manual Postgres `COUNT(*) FROM entities WHERE source='jira' AND project_id='<rain-uuid>'` (run via Neon SQL console), (d) Block 9.5 contract holds: no model-invented numbers — every number is cited.
- [ ] **S6.6** Read: visit Rain (already connected) with empty new conversation → `SUGGESTIONS_SLACK` / `SUGGESTIONS_JIRA` chips render.
- [ ] **S6.7** Read: citation rendering on Rain — verify `**bold**` source markers render; in v1.4 they are non-clickable per Block 13.6.
- [ ] **S6.8** Write: trigger refresh-and-ask-again on a Rain message → verify Block 10.1 path; `showConnToast` helper still appears.
- [ ] **S6.9** Write: rename a `qa-scratch` conversation via ⋯ menu → title updates in sidebar + tab title.
- [ ] **S6.10** Write: delete a `qa-scratch` conversation via ⋯ menu → row removed; undo toast appears.
- [ ] **S6.11** Write: undo within 120s of S6.10 → conversation restored.
- [ ] **S6.12** Write: delete again + wait 121s → reload sidebar → conversation permanently gone.
- [ ] **S6.13** Negative: scratch user (second profile) accesses a Rain conversation UUID via direct URL → 403.
- [ ] **S6.14** Negative: send message to a project at its `daily_message_limit` → graceful error matching v1.4 design copy (do not breach the cap on a real project — simulate by temporarily lowering `qa-scratch` limit to 1 via Limits tab, sending 2 messages; **cleanup: restore cap**).
- [ ] **S6.15** Read: `GET /api/projects/<id>/conversations/<cid>/messages?after=<cursor>` paginates if implemented; if not implemented, mark `N/A — pagination not in v1.4` in QA-RUN.md.

---

## §7 Connections — Slack [carve-out] [needs-slack-app] (~8 scenarios)

Endpoints: `POST /api/projects/[id]/connections` (init pending),
`GET /api/connectors/slack/oauth/start`,
`GET /api/connectors/slack/oauth/callback`,
`GET /api/projects/[id]/connections`,
`GET .../[connId]/slack/channels`,
`PATCH .../[connId]` (toggle channel),
`POST .../[connId]/sync`,
`POST /api/connectors/slack/events`,
`DELETE .../[connId]`.
Page: `/project_settings.html` Connections tab.

- [ ] **S7.1** Read: Connections tab on `qa-scratch` → empty state with "Connect Slack" + "Connect Jira" buttons.
- [ ] **S7.2** [carve-out] Write: click Connect Slack → OAuth flow completes; **callback retargets to** `/project_settings.html?id=<id>&tab=connections&just_connected=slack` (Block 13.7b carve-out — exact URL shape is the success criterion; check that param name is `id`, NOT `project_id`).
- [ ] **S7.3** Read: connection row appears with channels-pending state.
- [ ] **S7.4** Write: open channel picker modal → list of workspace channels; pick one; PATCH succeeds; row shows the chosen channel.
- [ ] **S7.5** Write: manual sync trigger → sync_runs row created (verify in Neon); status pending → running → success; Postgres `entities` count delta for source='slack', project_id=qa-scratch matches the messages synced.
- [ ] **S7.6** [carve-out] Negative: replay the OAuth callback URL (same `state` param) → second attempt fails (single-use SELECT-then-UPDATE).
- [ ] **S7.7** [carve-out] Negative: POST a fake Slack event to `/api/connectors/slack/events` without valid HMAC signature → 401.
- [ ] **S7.8** Cleanup: DELETE Slack connection from `qa-scratch` Connections tab → soft-delete; UI returns to empty state; revoke the app install on the Slack side too.

---

## §8 Connections — Jira [carve-out] [needs-jira-app] (~6 scenarios)

Endpoints: `POST /api/connectors/jira/auth/save`,
`GET .../[connId]/jira/projects`,
others mirror Slack.
Page: `/project_settings.html` Connections tab.

- [ ] **S8.1** [carve-out] Write: click Connect Jira → modal opens; paste Jira Cloud ID + API token; save → token encrypted in Postgres `ciphertext_credentials`; connection row active.
- [ ] **S8.2** Read: open Jira project picker modal → list of Jira projects you have access to.
- [ ] **S8.3** Write: pick one Jira project; PATCH succeeds; row updated.
- [ ] **S8.4** Write: manual sync trigger → sync_runs row; tickets appear (verify Postgres entities count for source='jira', project_id=qa-scratch).
- [ ] **S8.5** [carve-out] Negative: malformed `POST /api/connectors/jira/auth/save` (missing field) → 400, no row inserted.
- [ ] **S8.6** Cleanup: DELETE Jira connection → soft-delete; verify ciphertext columns gone or row marked deleted.

---

## §9 Cron & sync runs [carve-out] [needs-cron] (~4 scenarios)

Endpoint: `POST /api/cron/incremental-sync` (HMAC-authenticated).
Page: sync activity drawer in `/project_settings.html` Connections.

- [ ] **S9.1** [carve-out] Write: trigger cron via valid HMAC `curl` → 200; sync_runs rows created for all active connections (verify in Neon).
- [ ] **S9.2** [carve-out] Negative: trigger with wrong HMAC → 401.
- [ ] **S9.3** [carve-out] Negative: trigger with replayed (stale-timestamp) signature → 401.
- [ ] **S9.4** Verify failure isolation (Block 9 Decision U): if one connection's sync fails (revoke a test token between syncs), other connections still sync — check that one sync_run row shows status='failed' while others show 'success'.

---

## §10 Cross-project chat — "cross-project chat is working" end-to-end (~11 scenarios)

Endpoints: `GET /api/cross-project/eligible-projects`,
`GET/POST /api/cross-project/conversations`,
`GET/PATCH/DELETE .../conversations/[id]`,
`GET/POST .../conversations/[id]/messages`.
Pages: `/cross-project/index.html`, `/cross-project/new.html`,
`/cross-project/chat.html`.

- [ ] **S10.1** Read: `/cross-project/` lists existing cross-project chats as `.cp-row` cards (Block 13.6c).
- [ ] **S10.2** Read: `GET /api/cross-project/eligible-projects` returns ALL workspace projects with `connections[]` enrichment (Block 13.6a widening — verify sourceless projects appear too, marked disabled in UI).
- [ ] **S10.3** Write: from `/cross-project/new.html` — multi-select picker shows source chips per project; sourceless rows disabled; create a chat scoped to Rain + Joni → 302 to `/cross-project/chat.html?id=<new-uuid>`.
- [ ] **S10.4** Read: `/cross-project/chat.html?id=<id>` — sticky topbar, brand nav, read-only `.scopechip` Across row visible.
- [ ] **S10.5** Read: resize to ≤700px → `Across (N) ▾` popover renders and anchors correctly.
- [ ] **S10.6** **Real-data multi-project chat check** — in the Rain+Joni chat send a comparative question ("which project has more active Jira tickets?" or "summarise recent Slack activity in both"). Verify (a) reply arrives, (b) reply has a `**ProjectName**` paragraph for EACH scoped project (Block 13.6d-4 CROSS_PROJECT_SYSTEM_PROMPT rule #3), (c) citations include source links per project, (d) per-project content doesn't leak data from the other project (authorize.js boundary holds).
- [ ] **S10.7** Write: rename cross-project conversation via ⋯ menu → PATCH succeeds (Block 13.5 endpoint carry-over).
- [ ] **S10.8** Write: delete + undo within 120s → restored.
- [ ] **S10.9** Negative: scratch user (second profile) accesses this cross-project conversation UUID directly → 403 (workspace boundary, not just project boundary).
- [ ] **S10.10** UI: verify v1.4 chat header has NO "Product" label-pill and NO Jira source-chip (Block 13.6 removal; replaced by `.scopechip` row).
- [ ] **S10.11** UI: verify edit-scope overlay is GONE (Block 13.6d Decision 7) — scope row is read-only.

Cleanup for §10: delete the test cross-project conversation at the
end (soft-delete is fine; undo window doesn't matter).

---

## §11 Dashboard (~4 scenarios)

Endpoint: `GET /api/dashboard`.
Page: `/dashboard.html`.

- [ ] **S11.1** Read: `/dashboard.html` loads in < 2s for Jenny (4 real projects). Eyeball the 6-query budget per HANDOFF (open DevTools Network, filter `/api/dashboard`, verify single call).
- [ ] **S11.2** Read: per-project Jira sprint summaries + ticket counts render where Jira is connected (Rain / Joni / Gems where applicable).
- [ ] **S11.3** Read: cross-project hero card + workspace spending card both render with non-stale numbers.
- [ ] **S11.4** Negative: hit `/api/dashboard` while signed out (clear cookie) → 401.

---

## §12 Slug routing pinned-incident regression suite (~5 scenarios)

Explicitly pulled out because of the Block 13.8 incidents documented
in HANDOFF lines 5343–5349. Run this section every release.

- [ ] **S12.1** `/project.html?id=<rain-uuid>` loads Rain chat (regression guard against the catch-all hijack — must NOT 302 to `/projects.html`).
- [ ] **S12.2** `/project/rain` → 302 → `/project.html?id=<rain-uuid>` → loads Rain chat.
- [ ] **S12.3** `/project` (no trailing slash, zero segments) → must serve `/project.html` static OR 404, must NOT hit the dynamic function and 302 anywhere (the original `[[path]].js` bug).
- [ ] **S12.4** `/project/` (with trailing slash) → 404 or static, NOT a dynamic-function hit.
- [ ] **S12.5** `/project/foo/bar/baz` (multi-segment) → 404, NOT a dynamic-function hit (single-segment `[slug].js` guarantees this).

---

## §13 Crypto + envelope encryption [carve-out] (~3 scenarios)

Endpoint: `GET /api/crypto-roundtrip` (preview-only; 404 in prod).

- [ ] **S13.1** [carve-out] Hit `/api/crypto-roundtrip` on `elinnoagent.com` → 404 (sanity check that the smoke endpoint isn't exposed on prod).
- [ ] **S13.2** [carve-out] Hit it on a fresh preview deploy with `env.ALLOW_CRYPTO_SMOKE='true'` set on that preview → 200 with all roundtrip checks passing (encrypt → decrypt round-trip + AAD tampering detection).
- [ ] **S13.3** [carve-out] Inspect a real connection row in Postgres (Neon SQL console): `ciphertext_credentials`, `wrapped_data_key`, `iv` all non-NULL; AAD-related columns match `{connection_id, project_id, source}` shape. **No decryption attempted — purely structural.**

---

## §14 Externals health & failure-mode acknowledgement (~3 scenarios)

- [ ] **S14.1** `GET /api/db-health` → 200; D1 + Hyperdrive both reachable; latency reasonable (< 500ms).
- [ ] **S14.2** Verify Cloudflare Pages production deploy SHA matches the build under test (e.g., `bd47074` for v1.4). Check via Cloudflare Pages dashboard.
- [ ] **S14.3** Acknowledge the 7 live externals + graceful-failure expectations (record in QA-RUN.md, no action needed):
  - D1 (auth DB)
  - Hyperdrive → Neon (connector data + embeddings)
  - Resend (password reset) — if down, password reset is blocked
  - Anthropic (LLM) — if rate-limited, assistant reply pending; user message stays visible
  - Slack OAuth + Web API — if revoked, that connection's sync fails (isolated per Block 9 Decision U)
  - Atlassian / Jira REST — if token expired, that connection's sync fails (no refresh-token flow yet)
  - Cron (external trigger) — webhook-style; if not firing, syncs simply don't run

---

## §15 Closeout

- [ ] **S15.1** Compile pass/fail summary into QA-RUN.md closeout section (totals: PASS / FAIL / FIXED / DEFER / N/A / BLOCKED).
- [ ] **S15.2** Cleanup verification:
  - `qa-scratch` project soft-deleted (verify via `GET /api/projects/slug-available?slug=qa-scratch` → `{available: true}`).
  - Scratch user `qa+<YYYY-MM-DD>@elinnovation.net` removed via admin tab.
  - Test Slack/Jira tokens revoked at the source side (Slack workspace → Settings → Apps → revoke; Atlassian → API tokens → revoke).
  - Any test cross-project conversation soft-deleted.
- [ ] **S15.3** Draft a HANDOFF.md Phase 9 update entry: QA-pass date, defects found (with IDs), defects fixed (with fix-branch / commit SHAs), defects deferred.
- [ ] **S15.4** If any defects need to land in prod, queue the per-push-to-main approval request for the relevant fix branches; do NOT push to main without explicit Jenny approval.

---

## Defect list (template — actual defects go in QA-RUN.md)

| ID | Section | Scenario | Severity | Description | Status | Fix branch |
|---|---|---|---|---|---|---|
| D1 | §0.5 | S0.5.x | low/med/high | … | OPEN/FIXED/DEFERRED | qa-fix-… |

---

## Scenario count summary

| Section | Count |
|---|---|
| §0.5 UI overlap | 15 |
| §1 Auth | 10 |
| §2 Admin | 9 |
| §3 Workspace | 4 |
| §4 Projects + slug | 16 |
| §5 Members | 5 |
| §6 Conversations + chat | 15 |
| §7 Slack [carve-out] | 8 |
| §8 Jira [carve-out] | 6 |
| §9 Cron [carve-out] | 4 |
| §10 Cross-project | 11 |
| §11 Dashboard | 4 |
| §12 Slug regression | 5 |
| §13 Crypto [carve-out] | 3 |
| §14 Externals | 3 |
| §15 Closeout | 4 |
| **Total** | **122** |
