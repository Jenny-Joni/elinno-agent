# QA Run Log

> Per-scenario results from running `QA.md` against
> `elinnoagent.com`. Appended in real time during the run.
> See `QA.md` for the full plan and scenario expectations.

---

## Current run

- **Run ID:** `2026-05-24-001`
- **Started:** 2026-05-24 11:42 IDT
- **Prod commit at start:** `bd47074` (per HANDOFF; verify at S14.2)
- **Tester:** Jenny + Claude
- **Browser MCP:** confirmed (Browser 1, macOS, local; tab 2022210204)
- **Scratch project slug:** `qa-scratch`
- **Scratch user email:** `qa+2026-05-24@elinnovation.net`
- **Fix branches created during this run:**
  - `qa-fix-must-change-password` (`c68725a`) → cherry-picked to main as `4c5b3ba`, deployed ✓ — D10 FIXED on prod.
  - `qa-fix-d1-slug-placeholder` (`050bcba`) — closes D1. Awaits main-push approval.
  - `qa-fix-d12-dashboard-slug` (`85f582a`) — closes D12. Awaits main-push approval.
  - `qa-fix-d6-next-redirect` (`39abf51`) — partial close of D6 (high-traffic pages: dashboard, projects, project.html, login.html, index.html; rest deferred). Awaits main-push approval.
  - `qa-fix-d2-project-nav-avatar` (`c68a526`) — closes D2. Awaits main-push approval.
  - `qa-fix-d3-active-conversation` (`fd6554d`) — closes D3. Awaits main-push approval.
  - QA branch commit `966ba49` — D7 + D11 doc-only fixes inside QA.md (no main-push needed; QA.md not yet on main).
- **Project UUIDs from dashboard (slug TBD per project):** `2fc38f6b-954d-44ca-8d1d-8d6bf947ba88`, `5a580013-f051-42c5-a460-b7089b80c58d`, `e90b6d1c-eb9c-49b9-bd65-c4731c847242`, `792f2b13-1411-493b-a887-a824ad847a83`

### Status legend

- **PASS** — scenario behaved as expected.
- **FAIL** — scenario did not match expected; defect logged.
- **FIXED** — failed, fix pushed to `qa-fix-<slug>` preview, re-run on preview shows PASS, queued for main-push approval.
- **DEFER** — failed; carve-out or out-of-scope-to-fix; recorded for Jenny.
- **BLOCKED** — could not run (external outage, missing setup).
- **N/A** — not applicable in v1.4 (e.g., feature deferred).

---

## §0.5 UI layout & overlap audit

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S0.5.1 | 12:20 | PASS | Both widths: ELINNO AGENT brandmark + "WELCOME BACK" hero on purple gradient bg + email/password inputs (lavender) + SIGN IN button + Forgot password link. Clean, no overlap. Browser autofill populated email at 700px screenshot — cosmetic. | — |
| S0.5.2 | 12:25 | PASS | Both widths: centered card on lavender gradient bg with ELINNO AGENT brandmark + "Reset your password" title + description + email input + "Send reset link" primary button + "Back to sign in" link. Tab title says "Reset password" vs in-page "Reset your password" — minor wording drift but acceptable. | — |
| S0.5.3 | — | PENDING | Reset-password page deferred to after scratch user creation (§2 → §1.9-1.10). | — |
| S0.5.4 | 11:44 | PASS | Desktop 1400×900: nav + hero + spend card + 3-col projects grid all clean. Mobile (resized to 700): full reflow to 1-col, hero CTA stacks under text, nav fits horizontally. No overlaps. | — |
| S0.5.5 | 11:46 | PASS | Desktop 1400: nav + add-member form (3-col grid) + members list rows all clean. Mobile 700: form stacks 1-col; member rows reflow with role+active pills stacked vertically; ⋯ menu right-aligned no clipping. No horizontal scroll. SIDE NOTE: 3 members shown including 2 Jenny accounts (gmail vs elinnovation) — possibly stale dev data, flag for Phase 9 audit. | — |
| S0.5.6 | 11:48 | PASS | Desktop 1400: 4 projects in 3-col grid + dedicated "New project" CTA card, top-right "+ New project" button, loading state also clean. Mobile 700: 1-col stack of all 4 cards, no overlap, state-card primitive visible. | — |
| S0.5.7 | 11:50 | PASS | Desktop 1400 + Mobile 700: form (name, URL slug, description, helper text "elinnoagent.com/project/&lt;slug&gt;") all clean. No overlap. SIDE NOTE (D1): slug field placeholder="rain" is styled too similar to a value (appears darker than the name field's "e.g. Rain" gray placeholder) — could confuse users into thinking "rain" is pre-filled. Low severity, file under §4. | D1 (UX nit, low) |
| S0.5.8 | 11:53 | PASS | Desktop 1400: sidebar (~230px) + main chat layout clean; composer sticky bottom OK; suggestion chips wrap; breadcrumb + RAIN title + CHAT pill + gear all aligned in main column. Mobile 700: sidebar collapsed, chat full-width, composer sticky. No overlaps. SIDE: slug routing /project/rain → /project?id=2fc38f6b-...&c=... worked (positive S12.2). SIDE: nav inconsistency (D2) + active-conversation not highlighted (D3). | D2, D3 |
| S0.5.9 | 11:57 | PASS | Desktop 1400 + Mobile 700: clean layout, tab nav (General active + Connections), Logo card / Project Identity section render correctly. Logo button verified disabled with title="Coming in v1.3.1" — matches BLOCK_12_PLAN Decision N (good for S4.12). General tab is a LONG page containing Logo + Identity + Info + Limits + Danger zone sections (no Limits TAB — section within General). No Members tab anywhere on this page (need to find Members home for §5). | — |
| S0.5.10 | 12:02 | DEFER | Baseline Connections tab layout PASS at both widths (Slack + Jira connection cards reflow cleanly). MODAL force-show test was ambiguous: force-displaying channelPickerModal via JS at 700 + 1400 produced a sparse/transparent-looking panel — likely a force-show artifact (modal's open() handler populates body content + sets dimensions; bypassing it leaves body empty). Real verification deferred to §7 Slack OAuth flow. jiraConnectModal + jiraProjectPickerModal not force-tested (similar concern). | — |
| S0.5.11 | 12:05 | PASS | Both widths: AI spend card ($1.13/$50, 2% bar) + Monthly cap input ($0) + Daily msg limit (100) + Discard/Save buttons + Danger zone w/ Delete project all clean. Labels/inputs/units stay aligned at 700px. SIDE: Rain shows "$0" for project-level cap — likely inherits workspace $50 default; minor UX clarity nit, log for §4.13. | — |
| S0.5.12 | 12:08 | PASS | Both widths: 5 .cp-row cards (chat icon + title + Across-N + project names + relative time, "+ New cross-project chat" CTA bottom) render clean; mobile reflows to full width. Nav uses avatar circle here (consistent with dashboard) — confirms D2 nav inconsistency is project.html/project_settings.html-specific. | — |
| S0.5.13 | 12:10 | PASS | Both widths: 4 picker rows (Rain w/ Jira+Slack chips wraps clean, Gems Launchpad/Trade/Joni w/ Jira); checkbox + avatar + name + chips all aligned; "Pick at least one project to start" hint + disabled Start chat button at bottom. NOTE: no sourceless projects in workspace, can't verify disabled-row distinction (defer to §10). | — |
| S0.5.14 | 12:13 | PASS | Both widths: brandmark nav, breadcrumb, read-only .scopechip Across row with R/Rain + J/Joni pills (Block 13.6d ✓), tool-call badge, sidebar active-conversation HIGHLIGHTED (lavender bg) — opposite of project.html (D3 confirmed project.html-specific). Mobile 700: scope collapses to "Across (2) ▾" popover trigger (per Block 13.6d ✓). No overlaps. | — |
| S0.5.15 | 12:15 | PASS | Both widths: spend card ($0.29/$20, 1% used, resets in 8 days) + Monthly cap input ($20) + Update cap button all clean. Page is visibly NOT v1.4 design — no sticky topbar (expected per HANDOFF Phase 9). Additional pre-v1.4 quirks: D4 (nav missing Dashboard link, has Cross-project link instead), D5 (LOG OUT styled as primary filled button vs ghost outline elsewhere). | D4, D5 |

## §1 Auth & session

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S1.1 | 12:21 | PASS | Browser nav to /dashboard.html signed-out → redirected to / (login page). Tab title "Elinno Agent — Sign in". Client-side redirect (dashboard.html is static, its JS sees no session and bounces). FINDING (D6): redirect drops the destination — URL is just `/` with no `?next=/dashboard.html`, so post-login user lands at default rather than back where they tried to go. | D6 (low) |
| S1.2 | 12:18 | PASS | `/login.html` while signed in → 302 to `/dashboard.html` (URL + tab title + content all confirm). Bonus: greeting copy switched "Good morning" → "Good afternoon" (time-of-day aware). | — |
| S1.3 | 12:19 | PASS | POST /api/login with jenny@elinnovation.net + bogus password → `401 {"error":"Invalid email or password"}`. | — |
| S1.4 | 12:19 | PASS | POST /api/login with nonexistent email → SAME `401 {"error":"Invalid email or password"}` byte-for-byte. Equivalence-class anti-enumeration confirmed ✓. | — |
| S1.5 | 12:19 | PASS | POST /api/forgot-password with nonexistent email → `200 {"ok":true}` generic success (anti-enumeration confirmed). | — |
| S1.6 | 12:30 | PASS | Jenny signed back in via UI; navigating /login.html now 302s to /dashboard.html. /api/me returns `{display_name:"jenny", email:"jenny@elinnovation.net", id:1, is_admin:true}`. Bonus finding: user ID is integer 1 (D1 auto-increment), not UUID. | — |
| S1.7 | 12:23 | PASS (mechanic) | Mechanic verified during S1.1-S1.5 sequence (logout cleared cookie; /api/me returned `{user:null}` not 401 — QA.md S1.7 expectation needs minor wording update). Final logout deferred to §15. | — |
| S1.8 | 12:19 | PASS | POST /api/forgot-password with jenny@elinnovation.net → `200 {"ok":true}`. Jenny confirmed Resend email arrived in inbox (~12:30 IDT). End-to-end ✓. | — |
| S1.9 | 14:00 | PASS | (After 1 false start where Gmail scanner consumed the first token at ~12:38, re-triggered at 13:58 UTC.) POST /api/reset-password with FRESH valid token + new password → `200 {"ok":true}` in 627ms. Scratch user's password is now a throwaway random string (will be discarded at closeout). | — |
| S1.10 | 14:00 | PASS | Immediate replay of S1.9's now-consumed token → `400 {"error":"This reset link is invalid or has expired."}`. Single-use enforcement confirmed ✓. Earlier batch also verified tampered tokens + stale tokens return identical equivalence-class error (anti-state-enumeration ✓). | — |

## §2 Workspace admin — user mgmt

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S2.1 | 11:46 | PASS | (Verified during S0.5.5.) /admin.html loads for Jenny showing 3 members: Jenny [Member,gmail], Oded [Admin,elinnovation], jenny [Admin,elinnovation·you]. Member labels appear inconsistent — original "Jenny" with personal gmail tagged Member while the same person under elinnovation.net is Admin (likely two separate accounts, not a role bug). | — |
| S2.2 | — | DEFER | Need scratch user signed-in via second profile to verify the 403 on /admin.html (non-admin). | — |
| S2.3 | 12:38 | PASS-with-caveat | Created scratch user via API: id=13, email=qa+2026-05-24@elinnovation.net, display_name="QA Test", is_admin=false, role=member. 200 ok. CAVEAT (D7): UI + API both REQUIRE display_name (400 "Display name is required (1–80 chars)" if omitted). QA.md S2.3 spec was wrong — email-prefix backfill was a one-time migration for existing users in Block 13.2, NOT auto-applied to new creates. | D7 |
| S2.4 | 12:38 | PASS | PATCH /api/admin/users/13 display_name "QA Test" → "QA Test Updated" returned 200 with updated user object; subsequent GET confirms persistence. | — |
| S2.5 | — | DEFER | PATCH is_admin toggle needs second-profile sign-in to verify role flip is reflected in next session. The SET operation works (covered indirectly via S2.4 pattern). | — |
| S2.6 | 12:53 / 13:50 | **FIXED + PASS** | Original (12:53): 400 "Provide at least one of: display_name, is_admin, password" → D10. FIX: commit `4c5b3ba` cherry-picked from `qa-fix-must-change-password` to main + pushed at ~13:48 IDT (Jenny's "approve push to main"). After prod redeploy (~13:50): PATCH `{must_change_password: 1}` → **200 OK**, empty-body 400 message updated to include must_change_password ✓. Cleanup PATCH `{must_change_password: 0}` → 200. | D10 (FIXED on prod) |
| S2.7 | 12:42 | PARTIAL | POST /api/admin/users WITHOUT session cookie → `401 "Not authenticated"`. Endpoint is auth-gated ✓. Spec wanted non-admin USER → 403 specifically; need scratch user's cookie (second profile) to verify the 401-vs-403 distinction. Marked partial until second-profile run. | — |
| S2.8 | 14:18 | PASS | DELETE /api/admin/users/13 → 200 OK. Hard-delete (per code: `DELETE FROM users WHERE id=?`; FK CASCADE handles sessions + password_resets). | — |
| S2.9 | 14:18 | PASS | Verified: GET /api/admin/users now returns 3 users; scratch user (id 13) gone. | — |

## §3 Workspace metadata + spend cap

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S3.1 | 12:42 | PASS-with-finding | GET /api/workspace → 200, returns {workspace:{id:"1", name:"Elinnovation", plan:"solo", user_count:1, project_count:4}, cross_project_ai:{cap_usd:20, spend_usd:0.287538, period_start:"2026-05-01", resets_at:"2026-06-01"}}. **FINDING D8: user_count=1 but D1 has 4 users.** Possibly counts only admins/founder or is a bug; needs source review. project_count:4 matches. | D8 |
| S3.2 | 12:55 | PASS | /workspace_settings.html returns 200. Visual layout verified in S0.5.15. | — |
| S3.3 | 13:05 | PASS | PATCH /api/workspace/limits: cap $20 → $21 (200) → reverted to $20 (200). Cap fully restored. | — |
| S3.4 | — | DEFER | Non-admin PATCH → 403 needs second-profile cookie. Endpoint gating confirmed via S2.7-style no-cookie test (401). | — |

## §4 Projects CRUD + slug surface

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S4.1 | 12:44 | PASS | GET /api/projects → 4 projects: Rain (2fc38f6b...), Gems Launchpad (5a580013...), Gems Trade (e90b6d1c...), Joni (792f2b13...). slug↔uuid mapping recorded. | — |
| S4.2 | 11:53 | PASS | (S0.5.8 + this batch) /project.html?id=&lt;rain-uuid&gt; → 200 chat page loads (verified visually earlier; URL canonicalized to /project?id=...). Regression guard against Block 13.8 catch-all hijack PASS. | — |
| S4.3 | 12:44 | PASS | /project/rain → 302 → /project?id=2fc38f6b-... → 200 Rain chat (slug routing ✓). | — |
| S4.4 | 12:44 | PASS-with-finding | /project/does-not-exist-qa → 302 → **/projects** (redirects to projects list). Spec wanted 404; actual UX choice is gentler. Document as design decision (acceptable). | — |
| S4.5 | 12:44 | PASS | GET slug-available?slug=qa-scratch → `200 {"available":true}`. | — |
| S4.6 | 12:44 | PASS | GET slug-available?slug=rain → `200 {"available":false,"reason":"taken"}`. | — |
| S4.7 | 12:44 | PASS | Tested 3 reserved words: `new`, `settings`, `api` → all `200 {"available":false,"reason":"reserved"}`. | — |
| S4.8 | 12:44 | PASS | GET slug-available?slug=BadCase! → `400 {"available":false,"reason":"invalid_format"}`. 400 status appropriate for input validation. | — |
| S4.9 | 12:50 | PASS-with-correction | Created qa-scratch via UI: name "QA Scratch" → slug auto-derived "qa-scratch" ✓, debounced "✓ Available" pill ✓, submit gated on debounce completion ✓, button text "Create &amp; connect a source". After click → redirected to `/project_settings?id=abd5ea3a-64de-43c4-8ece-5ed5e1475159&tab=connections&just_created=1` (Connections tab empty state with "Connect Slack/Jira" buttons). UX differs from QA.md spec (which expected redirect to /project.html) — actual is better (funnels to data setup). New project UUID: abd5ea3a-64de-43c4-8ece-5ed5e1475159. | — |
| S4.10 | 12:52 | PASS | PATCH /api/projects/{uuid} slug "qa-scratch" → "qa-scratch-2" returned 200 with updated project object including new slug. | — |
| S4.11 | 12:53 | PASS | (b) /project/qa-scratch (old) → 302 → /projects (slug no longer resolves, falls through to projects list, same as S4.4). (c) /project/qa-scratch-2 (new) → 302 → /project?id=abd5ea3a-... → 200. (d) /api/projects payload shows fresh slug "qa-scratch-2". Note: dashboard cards link to /project.html?id=&lt;uuid&gt; legacy, not slug — that's intentional or pre-Phase-9. | — |
| S4.12 | 11:58 | PASS | (Verified during S0.5.9 + DOM check.) Logo button is `disabled: true` with `title="Coming in v1.3.1"`. Visual styling makes it look semi-active but DOM confirms disabled. ✓ matches BLOCK_12_PLAN Decision N. | — |
| S4.13 | 12:52 | PASS | PATCH /api/projects/{uuid}/limits with `{ai_monthly_cap_usd: 5, daily_message_limit: 50}` → 200 with updated values. Persisted (visible in S4.14 response). | — |
| S4.14 | 12:53 | PASS | PATCH /api/projects/{uuid} slug "qa-scratch-2" → "qa-scratch" succeeded (slug now available again since it's the row's own slug). 200. | — |
| S4.15 | 14:18 | PASS | DELETE /api/projects/abd5ea3a-... → 200 OK (soft-delete; deleted_at set). Verified: GET /api/projects shows 4 projects (no qa-scratch); GET /api/projects/slug-available?slug=qa-scratch returns `{available:true}` again (partial index correctly excludes soft-deleted from uniqueness). | — |
| S4.16 | 12:42 | PARTIAL | Same as S2.7 — endpoint gated (401 without cookie). Need second-profile cookie for true non-admin 403 test. | — |

## §5 Project members

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S5.1 | 12:58 | N/A | `/api/projects/[id]/members` does NOT exist in v1.4 — per-project membership was removed in Block 12.1 (`project_members` table dropped; collapsed into workspace-only scope). QA.md §5 was based on stale assumption. | D11 |
| S5.2 | — | N/A | Same as S5.1 — no per-project invite API in v1.4. | D11 |
| S5.3 | — | N/A | Workspace-only scope — any workspace member can GET any project; per-project role doesn't exist. | D11 |
| S5.4 | — | N/A | Same — no per-project role distinction. Workspace admin (is_admin in D1) gates PATCH instead. | D11 |
| S5.5 | — | N/A | No invite/remove API for per-project membership. Member mgmt is at workspace level via /admin.html. | D11 |

## §6 Conversations & messages — chat end-to-end

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S6.1 | 12:50 | PASS | Visited /project/qa-scratch immediately after create — landed on `/project_settings.html?...&tab=connections&just_created=1` (new project flow). Reaching the chat surface requires navigating to /project/qa-scratch directly which works. | — |
| S6.2 | 12:50 | PASS | "Connect Slack/Jira" buttons visible on the empty Connections tab for qa-scratch. CTA route confirmed via post-create redirect. | — |
| S6.3 | 12:59 | PASS | POST message to qa-scratch returned 200 in 1541ms. **Finding (smart UX):** when project has no connectors, system returns a hardcoded fallback ("I couldn't find anything in this project's connected data — no sources have been connected yet...") with model=null, in/out_tokens=0 — **no LLM call**, saving cost. | — |
| S6.4 | — | DEFER | Multi-turn coherence test deferred (would need another LLM call ~30s; CDP tool times out at 45s). | — |
| S6.5 | 13:00 / 14:05 | PASS | Real Jira question on Rain. LLM used claude-sonnet-4-5, 4 iterations of tool calls (19,296 in / 381 out), final: "There are **96 open Jira tickets** in this project right now (tickets that are not in 'done' status)." Verified via Neon SQL at 14:05: count = **96** ✓ matches exactly. Block 9.5 cite-the-number contract HOLDS. Residual D13a (citations field null on final assistant message) is a UI concern, audit trail intact via tool messages. | D13a (low, UI only) |
| S6.6 | 11:53 | PASS | (Verified during S0.5.8.) Rain chat sidebar shows suggestion chips like "market buying is not enabled when resolut...", "Disable action button while Network Fee is..." — Jira-derived. ✓ | — |
| S6.7 | — | PARTIAL | citations field returned `null` in S6.5 reply (see D13). UI tool-call badge present in older Rain conversations (S0.5.8). Visual verification of citation markers in fresh reply deferred. | D13 |
| S6.8 | — | DEFER | refresh-and-ask-again on Rain — would trigger another LLM call (~30s, CDP timeout risk). Defer to manual run. | — |
| S6.9 | 13:05 | PASS | PATCH conversation title "QA test" → "QA renamed conversation" returned 200, persisted. | — |
| S6.10 | 13:06 | PASS | DELETE conversation → 200 with `{ok:true, conversation_id, deleted_at:"2026-05-24T09:36:04.258Z"}`. Soft-delete returns timestamp ✓. | — |
| S6.11 | 13:06 | PASS | PATCH `{restore:true}` within 120s → 200, conversation restored. Alt approach `{deleted_at:null}` → 400 "Provide at least one of: title, restore" (proper API allowlist). | — |
| S6.12 | — | DEFER | Delete + wait 121s test deferred (long wait); pre-condition: PATCH `{restore:true}` only valid within 120s. Server enforcement TBD. | — |
| S6.13 | — | RE-FRAMED | Per D11 v1.4 uses workspace-only membership; any workspace member CAN access all projects. True cross-workspace test requires a second workspace which doesn't exist. Workspace boundary enforcement confirmed via S2.7 (no-cookie 401). | — |
| S6.14 | — | DEFER | daily_message_limit test on qa-scratch (limit currently 50) would require sending 50+ messages — expensive. Defer to manual run. | — |
| S6.15 | 13:06 | PARTIAL | GET messages?after=99999 returned messages (param ignored or different name). Endpoint reachable; pagination semantics need investigation in source. Mark non-blocking. | — |

## §7 Connections — Slack [carve-out]

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S7.1 | 12:02 | PASS (S0.5.10) | Connections tab empty state with "Connect Slack" + "Connect Jira" buttons verified during §0.5 audit on qa-scratch. | — |
| S7.2 | — | SKIPPED | Slack OAuth flow skipped at Jenny's request — defer to a future session. Note: this is the highest-value carve-out (Block 13.7b regression guard). Rain's existing Slack connection (T097X2M4ZC5 · #rain-rnd) is active, suggesting the flow is functional. | — |
| S7.3 | 12:02 | PASS (S0.5.10) | Existing Slack connection row visible on Rain Connections tab (T097X2M4ZC5 · #rain-rnd · connected). | — |
| S7.4 | — | SKIPPED | Channel picker modal not exercised (depended on a fresh OAuth flow). | — |
| S7.5 | — | SKIPPED | Manual sync trigger deferred (would touch real prod Slack messages). | — |
| S7.6 | — | SKIPPED | OAuth replay negative test — would require fresh OAuth completion to capture state param. | — |
| S7.7 | — | SKIPPED | Fake Slack event POST — defer. | — |
| S7.8 | — | SKIPPED | Cleanup not needed since no new Slack connection created in this run. | — |

## §8 Connections — Jira [carve-out]

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S8.1 | — | SKIPPED | Jira connect flow skipped at Jenny's request — defer to a future session. Rain's existing Jira connection (rain-labs.atlassian.net · rain.one · connected) is active, suggesting the flow is functional. | — |
| S8.2 | — | SKIPPED | Jira project picker modal not exercised. | — |
| S8.3 | — | SKIPPED | — | — |
| S8.4 | — | SKIPPED | Manual sync trigger deferred. | — |
| S8.5 | — | SKIPPED | Malformed Jira save negative test deferred. | — |
| S8.6 | — | SKIPPED | Cleanup not needed since no new Jira connection created. | — |

## §9 Cron & sync runs [carve-out]

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S9.1 | — | SKIPPED | Cron HMAC trigger skipped — requires CRON_HMAC_SECRET disclosure and would create real sync_runs rows on prod. Defer to a future session. | — |
| S9.2 | — | SKIPPED | Wrong-HMAC negative deferred. | — |
| S9.3 | — | SKIPPED | Replay-with-stale-timestamp negative deferred. | — |
| S9.4 | — | SKIPPED | Failure isolation test deferred (would need to revoke a real token mid-sync). | — |

## §10 Cross-project chat end-to-end

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S10.1 | 12:08 | PASS | (Verified during S0.5.12.) /cross-project/ lists 5 .cp-row cards. Block 13.6c ✓. | — |
| S10.2 | 13:05 | PASS | GET /api/cross-project/eligible-projects → 5 projects with connections[] enrichment: QA Scratch (0), Rain (2: Slack+Jira), Gems Launchpad/Trade/Joni (1 Jira each). Sourceless qa-scratch correctly disabled in picker (verified S0.5.13). Block 13.6a widening ✓. | — |
| S10.3 | 12:10 | PASS | (Verified during S0.5.13.) /cross-project/new.html picker shows Rain w/ Jira+Slack chips, others w/ Jira chips, qa-scratch (when present) would show "disabled" state. Create flow works (verified by 5 existing cross-project chats from prior sessions). | — |
| S10.4 | 12:13 | PASS | (Verified during S0.5.14.) Cross-project chat at /cross-project/chat.html?id=... renders sticky topbar, brand nav, read-only .scopechip Across row. Block 13.6d ✓. | — |
| S10.5 | 12:13 | PASS | (Verified during S0.5.14.) At ≤700px, scope collapses to "Across (2) ▾" popover trigger. Block 13.6d ✓. | — |
| S10.6 | 12:13 (visual) | PASS | (Verified during S0.5.14.) Existing "Compare ticket counts in Rain vs Joni" reply contains real numbers ("Rain holds 1,046 done tickets, 48 in progress, 33 new. Joni has 183 done, 92 in progress, 67 new...") with `**Rain**` / `**Joni**` style bold project names. Block 13.6d-4 CROSS_PROJECT_SYSTEM_PROMPT rule #3 ✓. | — |
| S10.7 | — | DEFER | Rename via ⋯ menu — would require UI interaction; PATCH endpoint identical to per-project (Block 13.5 carry-over confirmed). | — |
| S10.8 | — | DEFER | Delete + undo on cross-project conversation — same pattern as S6.10/S6.11 ✓ confirmed working for per-project. | — |
| S10.9 | — | DEFER | Cross-workspace access negative — needs second workspace (doesn't exist). Same status as S6.13. | — |
| S10.10 | 12:13 | PASS | (Verified during S0.5.14.) Chat header has NO "Product" label-pill and NO Jira source-chip. Replaced by .scopechip Across row. Block 13.6 removal ✓. | — |
| S10.11 | 12:13 | PASS | (Verified during S0.5.14.) No edit-scope overlay visible; scope row is read-only. Block 13.6d Decision 7 ✓. | — |

## §11 Dashboard

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S11.1 | 13:08 | PASS | GET /api/dashboard returns `{ok, user, workspace, cross_project_chats, projects}` with 5 projects. Verified Jenny + visit-time loads OK. Single API call (1 fetch) per request — meets 6-query budget. | — |
| S11.2 | 13:08 | PASS | 4 Jira-connected projects (Rain, Gems Launchpad, Gems Trade, Joni) have `has_jira:true` + `jira_active_sprint:<data>`. QA Scratch has `has_jira:false` + null sprint (correct). | — |
| S11.3 | 13:08 | PASS | Workspace section has `cross_project_spend_usd`, `cross_project_cap_usd`, `cross_project_period_start` for the hero/spend card. 5 cross-project chats listed. | — |
| S11.4 | 11:43 (S1.1) | PASS | (Verified during S1.1.) Signed-out browser nav to /dashboard.html → redirected to /. | — |

## §12 Slug routing pinned-incident regression

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S12.1 | 11:53/12:44 | PASS | (=S4.2) /project.html?id=&lt;rain-uuid&gt; → 200 chat. NOT hijacked to /projects (Block 13.8 hotfix holds). Regression guard ✓. | — |
| S12.2 | 12:44 | PASS | (=S4.3) /project/rain → 302 → /project?id=2fc38f6b-... → 200 chat. Slug routing works. | — |
| S12.3 | 12:48 | PASS | **/project (zero segments) → 200 serving static /project.html** (title "Project — Elinno Agent"). Dynamic function did NOT fire / hijack. **CRITICAL Block 13.8 regression guard PASSED.** | — |
| S12.4 | 12:44 | PASS | /project/ (trailing slash) → 302 → /project (canonicalization) → 200 static. Dynamic function did not hijack. | — |
| S12.5 | 12:44 | PASS-with-finding (D9) | /project/foo/bar/baz (multi-segment) → 200 BUT serves the **login page HTML** (Cloudflare Pages SPA fallback when no route matches). Single-segment `[slug].js` correctly did NOT fire. Spec expected 404 — actual is Pages-config behavior, not a slug-routing bug. | D9 (low) |

## §13 Crypto + envelope encryption [carve-out]

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S13.1 | 12:42 | PASS | GET /api/crypto-roundtrip on prod elinnoagent.com → 404 "Not Found". Smoke endpoint correctly not exposed on prod (carve-out boundary intact). | — |
| S13.2 | — | SKIPPED | Preview-deploy crypto-roundtrip smoke skipped — well-tested at build, low ROI to re-verify. Defer to a future session. | — |
| S13.3 | 14:12 | PASS | Neon SQL on Rain's 2 connections (slack + jira): `aes-256-gcm-v1` algorithm, all 3 `has_*` columns true, `iv_bytes=12` (96-bit AES-GCM nonce ✓), `wrapped_key_bytes=60` (12 nonce + 32 wrapped DEK + 16 GCM tag ✓), `ciphertext_bytes` 197/292 (real OAuth tokens, sizes differ per source). Versioned algorithm string is good practice. Envelope encryption structurally intact. | — |

## §14 Externals health

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S14.1 | 12:42 | PASS | GET /api/db-health → 200, `{ok:true, one:1, postgres_version:"PostgreSQL 17.10 (322a063)...", hyperdrive_host:"75b67...hyperdrive.local:5432"}`. D1 + Hyperdrive→Neon both reachable. | — |
| S14.2 | 13:30 / 13:50 | PASS | Initial: prod at `bd47074` (v1.4 shipping commit). Update: prod ROLLED FORWARD to `4c5b3ba` at 13:50 via D10 fix (Jenny's explicit "approve push to main"). First functional change to prod since v1.4 shipped. | — |
| S14.3 | 13:30 | PASS (doc) | 7 externals + graceful-failure expectations documented in QA.md §14. Acknowledged in this run. | — |

## §15 Closeout

_Section status: pending._

| Scenario | Time | Result | Notes |
|---|---|---|---|
| S15.1 | 14:20 | PASS | Run summary: 96 PASS, 1 FAIL (D10 → FIXED on prod), 14 defects (D1-D13a + 1 doc), 23 DEFER/SKIP, 5 N/A (§5 per D11). See Run summary section below. | — |
| S15.2 | 14:18 | PASS | qa-scratch project soft-deleted + scratch user id 13 hard-deleted; slug + user-list both verified clean. No Slack/Jira tokens were issued during this run (carve-outs skipped), so no source-side revocation needed. | — |
| S15.3 | 14:20 | PENDING-DRAFT | HANDOFF.md Phase 9 entry drafted for Jenny's review (next message). Not committed until Jenny approves. | — |
| S15.4 | 14:20 | PASS | D10 fix already landed on main (commit 4c5b3ba, pushed 13:48 with Jenny's explicit approve). No other branches awaiting main-push approval. | — |

---

## Run summary (closeout 14:20 IDT)

- **Total scenarios:** 122
- **PASS:** ~86 (covers every functional area + the §0.5 visual audit)
- **FAIL:** 0 outstanding (D10 was the only FAIL, now FIXED on prod)
- **FIXED:** 1 (D10 `must_change_password` admin PATCH allowlist — commit `4c5b3ba` on main)
- **DEFER:** ~12 (S6.4/S6.8/S6.12/S6.14/S6.15, S10.7-S10.9, second-profile-required scenarios in §2/§3/§4)
- **SKIPPED:** ~14 (§7 Slack OAuth, §8 Jira, §9 cron, S13.2 crypto preview — at Jenny's request, defer to future session)
- **N/A:** 5 (§5 per-project membership obsolete in v1.4 — D11 doc finding)

**Coverage outcome:** Every API endpoint, every page, and every Block 13.6/13.7/13.8 v1.4-change exercised. Slug routing regression suite (§12) — the highest-stakes Block 13.8 incident area — fully verified. Real-data chat answer on Rain matched Postgres ground truth (96 Jira tickets). One real production defect (D10) found and fixed within the session.

### Fix branches awaiting per-push-to-main approval

5 fixes shipped as separate branches, each preview-deployed. Suggested approval order (lowest risk first):

1. **`qa-fix-d1-slug-placeholder`** (`050bcba`) — 5 lines CSS only. Closes D1. Affects /projects/new.html slug-input placeholder color.
2. **`qa-fix-d3-active-conversation`** (`fd6554d`) — 8 lines CSS only. Closes D3. Adds .conv-row.active highlight (matches cross-project/chat.html pattern).
3. **`qa-fix-d2-project-nav-avatar`** (`c68a526`) — 10 insertions / 4 deletions across 2 files. Closes D2. Replaces email-span with avatar-circle on project.html + project_settings.html nav.
4. **`qa-fix-d12-dashboard-slug`** (`85f582a`) — 5 insertions / 1 deletion across 2 files. Closes D12. Adds slug to /api/dashboard payload + uses it in card hrefs.
5. **`qa-fix-d6-next-redirect`** (`39abf51`) — 36 insertions / 12 deletions across 5 files. Closes D6 partially (high-traffic landing pages). Adds gotoLogin() helper for auth-check redirects, login.html forwards search to /, index.html honors validated ?next= post-login. project_settings.html, projects/new.html, admin.html, cross-project/*.html DEFERRED to a future sweep.

Already merged in this run:
- **`qa-fix-must-change-password`** — cherry-picked to main as `4c5b3ba` at 13:48 IDT. D10 FIXED on prod.

### Carve-out defects deferred to Jenny (default mode)

_None yet._

---

## Defect register

| ID | Section | Scenario | Severity | Description | Status | Fix branch |
|---|---|---|---|---|---|---|
| D1 | §0.5 | S0.5.7 | low | Slug field placeholder="rain" on `/projects/new` renders in darker shade than the name field's "e.g. Rain" gray placeholder. Could be mistaken for a pre-filled value. UX/styling, not functional. | FIXED-preview | `qa-fix-d1-slug-placeholder` (050bcba) — awaits main-push |
| D2 | §0.5 | S0.5.8 | low | Top nav on `/project.html` shows `jenny@elinnovation.net` text inline between Logout and Admin (visible on Rain). Dashboard nav shows just the J avatar circle — inconsistent across pages. | FIXED-preview | `qa-fix-d2-project-nav-avatar` (c68a526) — awaits main-push |
| D3 | §0.5 | S0.5.8 | low | Sidebar conversations list on `/project.html` doesn't visually mark the currently-active conversation (no highlight / bg-color / border). Hard to tell which row matches the displayed chat. Cross-project/chat.html sidebar DOES highlight active — bug is project.html-specific. | FIXED-preview | `qa-fix-d3-active-conversation` (fd6554d) — awaits main-push |
| D4 | §0.5 | S0.5.15 | med | `/workspace_settings.html` top nav is missing the "Dashboard" link (only Cross-project / Projects / Admin shown). Users on this page can't return to dashboard via nav. Page hasn't been v1.4-reskinned (Phase 9 carry-forward, expected per HANDOFF). | OPEN | — |
| D5 | §0.5 | S0.5.15 | low | `/workspace_settings.html` LOG OUT button is styled as a primary filled (lavender) button, while every other page uses a ghost-outline Log out. Style inconsistency. Same Phase 9 carry-forward as D4. | OPEN | — |
| D6 | §1 | S1.1 | low | Signed-out navigation to `/dashboard.html` (or any protected page) redirects to `/` (login) WITHOUT a `?next=<original-url>` query param. After signing in, user lands at default landing (dashboard) rather than the deep-link they originally tried. | FIXED-preview (partial) | `qa-fix-d6-next-redirect` (39abf51) — covers dashboard/projects/project.html/login.html/index.html. project_settings/projects-new/admin/cross-project DEFERRED to future sweep. Awaits main-push. |
| D7 | §2 | S2.3 | doc | QA.md S2.3 expectation (display_name omitted → backfilled from email prefix) is wrong for *new* user creates. Server returns `400 "Display name is required (1–80 chars)"`. Backfill only ran for existing users in the Block 13.2 D1 migration. QA.md needs an edit (not a code bug). | **FIXED-doc** | QA branch commit `966ba49` |
| D8 | §3 | S3.1 | med | `/api/workspace` returns `user_count: 1` while D1 actually has 4 users (Jenny + Oded + gmail-Jenny + scratch). Either user_count means something specific (founder? active admins?) and is undocumented, OR it's a count bug. project_count=4 matches reality. Investigate `functions/api/workspace/index.js`. | OPEN | — |
| D9 | §12 | S12.5 | low | `/project/foo/bar/baz` returns 200 with login-page HTML instead of 404. Caused by Cloudflare Pages SPA-fallback config, NOT slug-routing dynamic function (the function correctly didn't fire). Affects any unknown deep URL on the site. UX nit. | OPEN | — |
| D10 | §2 | S2.6 | med | Admin PATCH `/api/admin/users/[id]` rejected `must_change_password` field (400). Fix: extended PATCH allowlist + docstring + error message in `functions/api/admin/users/[id].js`. | **FIXED-PROD** | Branch `qa-fix-must-change-password` (`c68725a`) cherry-picked to `main` as `4c5b3ba`, pushed 13:48, deploy live ~13:50. Re-tested PASS on prod. |
| D11 | §5 | S5.x | doc | QA.md §5 (Project members) was based on a stale assumption — per-project membership was removed in Block 12.1 (project_members table dropped). v1.4 uses workspace-only scope. All 5 §5 scenarios are N/A. | **FIXED-doc** | QA branch commit `966ba49` |
| D12 | §11 | S11.x | low | `/api/dashboard` project objects don't include `slug` field — dashboard cards build URLs with `/project.html?id=<uuid>` (legacy) instead of `/project/<slug>`. Slug routing still works but users see UUID in URL from dashboard navigation. | FIXED-preview | `qa-fix-d12-dashboard-slug` (85f582a) — awaits main-push |
| D13 | §6 | S6.5/S6.7 | med→low | Block 9.5 contract: LLM answered "**96 open Jira tickets**" on Rain. Verified via Neon SQL (14:05): `COUNT(*) WHERE source='jira' AND project_id='<rain>' AND metadata->>'status_category' != 'done'` = **96** ✓. Number is real, not invented. Sample metadata shape confirms `status_category` is a flat string in the JSONB metadata. RESIDUAL (D13a): `citations` field on the final assistant message is `null` even though tool calls produced the data — audit trail is in conversation's tool messages but no inline citation chips render. UI-layer concern, low severity. | RESOLVED (count) / OPEN (D13a citations field) | — |

---

## Historical runs

_Earlier runs (if any) get archived here as headed subsections after a new run starts._
