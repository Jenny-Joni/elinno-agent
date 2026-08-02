# Elinno Agent — Working Agreement

Last updated: 2026-05-04 (Block 2 closed; restructured around Claude Code's plan→auto two-mode rhythm. Three phases — Plan, Approval, Execute — replace the per-action review model from earlier revisions. Hard limits enforced via `.claude/settings.json`. Added: session-start ritual, scope-expansion handling, iteration cap, rollback playbook.)

---

## Operating model: three phases per piece of work

A "piece of work" is a sub-task or session-sized chunk — typically one entry from BUILD_PLAN, sometimes a follow-up between blocks.

```
  ┌────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
  │  1. PLAN       │ →  │  2. APPROVAL     │ →  │  3. EXECUTE         │
  │  (plan mode)   │    │  (Jenny reads)   │    │  (auto mode)        │
  │                │    │                  │    │                     │
  │  Claude drafts │    │  Approves /      │    │  Claude implements, │
  │  plan +        │    │  revises /       │    │  verifies on        │
  │  mockups.      │    │  rejects.        │    │  preview, then      │
  │  No source     │    │  Approval is the │    │  STOPS at the       │
  │  edits.        │    │  one big gate.   │    │  push-to-main line. │
  └────────────────┘    └──────────────────┘    └─────────────────────┘
                                                          │
                                                          ▼
                                                  Jenny says
                                                  "approve push to main"
                                                          │
                                                          ▼
                                                       PUSH
```

Plan approval is the load-bearing gate. The push to main is a second, narrower confirmation — explicit, per-push, never standing.

---

## Phase 0 — Session-start ritual (every session, before anything else)

Before plan phase begins, Claude Code orients itself in the current state of the repo. This catches "Cursor left a half-edited file," "the branch isn't where I thought it was," and "Anthropic shipped a Claude Code update overnight" before any planning happens. Block 2 Session 3 surfaced enough state-drift hazards (worktree branch lag, WORKFLOW.md trailing-newline drift, untracked files from the previous session) that this needs to be a ritual, not an instinct.

In every new session, Claude Code's first three actions are:

1. **Read state.** `git status`, `git log main..HEAD --oneline` (if on a non-main branch), `git branch --show-current`, `git fetch origin --dry-run` (to spot a remote that's moved). State the result back to Jenny in one or two sentences: "On branch `session-3-foo`, 3 commits ahead of main, working tree clean except for one untracked file `verify-foo.sh`."
2. **Read recency.** Read the latest "Session N closeout" or "mid-state" note in HANDOFF.md. Read the relevant `BLOCK_N_PLAN.md` if mid-block. Surface anything that contradicts the working-tree state.
3. **Smoke-test the gates.** Once per session, before switching out of default mode, confirm the deny rules are still in force. Concrete check: attempt `git push origin main --dry-run` and confirm auto mode would prompt (the `--dry-run` is safe regardless). If a Claude Code version bump silently changed deny-rule syntax — this has happened upstream — you find out now, not after a bad push. Skip this on doc-only sessions where Phase 3 won't push to main anyway.

If any of the three turns up something unexpected, that's the conversation, not the planned work. Don't gloss past a dirty working tree to start planning.

---

## Phase 1 — Plan (Claude Code in plan mode)

Jenny presses Shift+Tab to plan mode. In this phase Claude Code does not edit source.

What Claude Code produces in plan mode:

1. **A read of the current state.** Already done in Phase 0; reference it here rather than re-running.
2. **A locked-decisions list.** Working through them in conversation with Jenny, in order, one at a time. Block 2 used decisions A–AC; Block 3 starts a fresh sequence.
3. **The plan document itself** — `BLOCK_N_PLAN.md` (or an addendum if mid-block). Contains:
    - Goal of this piece of work, in one sentence.
    - Locked decisions (numbered, citable in commit messages).
    - **File-level change list** — which files Claude expects to create or modify, and roughly what each change does. This list is the scope contract for execute phase; treat it as load-bearing.
    - **Verification plan** — the curl matrix or smoke-test list Claude will run on the preview deploy before requesting the push to main. Claude runs these automatically; Jenny eyeballs the preview as a second check.
    - Explicit uncertainty list — "I'm guessing at X, please confirm or correct in your review."
    - Out-of-scope list — what Claude will NOT touch in this piece of work, even if tempted.
4. **Mockups, if the work is UI** — static HTML rendered via Preview MCP, screenshotted, iterated in plan mode until Jenny is satisfied. Mockups become reference artifacts the executing phase pins to.

Plan mode is also the right place for any "should we even build this the way the BUILD_PLAN says?" conversations. Architecture questions, scope cuts, decision-revisits all happen here. Once the plan is approved, those questions are closed for this piece of work.

---

## Phase 2 — Approval (Jenny)

Jenny reviews the plan and the mockups. Three outcomes:

- **Approve.** Jenny says "approved, execute." Claude Code commits the approved `BLOCK_N_PLAN.md` (and any mockup files) as the first commit of the work's branch — this commit is the artifact that records "plan approved at this version." Then Claude Code switches to auto mode (Shift+Tab) and starts Phase 3.
- **Revise.** Jenny names what to change. Claude Code stays in plan mode, edits the plan, comes back with v2. Loop until approved.
- **Reject.** Jenny scraps the plan. Claude Code stays in plan mode and either restarts or asks what changed.

**The approval is explicit and verbal.** A nod, a "looks good," or "go for it" is fine — what matters is that Claude Code does not switch out of plan mode without hearing it. If Claude Code is uncertain whether approval was given, it asks.

**What plan approval covers, and what it doesn't:**
- ✅ Covered: every commit Claude Code makes during execute phase. Every file edit *within the plan's change list*. Every test run. Every preview deploy. Every fast-forward merge to main locally. Pushes to non-main branches (e.g., to trigger a preview deploy).
- ❌ Not covered: the push to main itself. That's a separate per-push approval at the end of Phase 3.
- ❌ Not covered: anything outside the file-level change list in the plan. See "Scope expansion during execute" below.

---

## Phase 3 — Execute (Claude Code in auto mode)

Jenny presses Shift+Tab to auto. Claude Code runs the plan end-to-end.

**What auto mode does without prompting:**
- File edits within the plan's change list.
- Local commits with Conventional Commits messages, citing the relevant decision letters.
- Local bash for development: `npm install`, `npx wrangler pages dev`, `git status`, `git diff`, `git log`, `git checkout -b`, `git add`, `git commit`, `git merge --ff-only`.
- Pushes to non-main branches (to trigger a Cloudflare Pages preview deploy).
- Curl-based verification against the preview URL.
- Reading and analyzing logs from `wrangler pages deployment tail`.

**What auto mode stops for, every time:**
- The push to main (denied at the settings layer; the prompt forces Jenny in).
- Anything in the "Hard limits" table below (denied at the settings layer).
- Any file edit outside the plan's change list — see "Scope expansion" below.
- Any failure during execution — see "When something goes wrong."
- Iteration cap reached — see "Iteration cap."

**At the end of Phase 3, Claude Code:**
1. Has all commits on the work's branch, ff-merged into local `main`.
2. Has run the verification matrix from the plan against the preview deploy and pasted the results.
3. Surfaces the preview URL for Jenny's manual look (both automated AND manual verification).
4. Reports: "Branch is at commit X, local main is fast-forwarded, verification matrix is N/N PASS, preview is at <URL>. Approve push to main?"
5. Waits.

Jenny opens the preview URL, eyeballs it, and either says "approve push to main" (Claude Code pushes) or names what's wrong (Claude Code goes back to plan mode for a revision plan, or fixes-and-re-verifies if the fix is small and obvious).

---

## Scope expansion during execute

Plans don't predict everything. Mid-execute, Claude Code may discover that the plan's change list is incomplete — a tiny adjacent edit in `functions/api/_lib/auth.js` is needed to make the planned change in `messages.js` work, or a CSS class referenced in the mockup doesn't exist yet and needs adding to `auth.css`.

The rule: **any file edit outside the plan's change list stops execute and surfaces the addition.** No silent in-scope-creep.

The approval doesn't have to be heavyweight, though. Jenny has three responses:

- **One-line approval.** "Yes, add `auth.css`." Claude Code adds it to the change list (in the plan file itself, as a one-line addendum), continues. This is the right response 90% of the time.
- **Plan amendment.** "Wait, that means we're also touching the login page — let me think." Drop back to plan mode, revise, re-approve. Right response when the addition reveals a bigger missed piece.
- **Reject.** "No, find another way." Claude Code goes back to plan mode and proposes an alternative.

The discipline is in *surfacing* the scope expansion, not in making the approval ceremony elaborate. Drift happens silently; this rule makes silence impossible.

---

## When something goes wrong mid-execution

Something goes wrong = a test fails, the classifier blocks an action, a curl check returns the wrong status, a commit hook fails, an unexpected file shows up dirty, anything off-script.

**The rule: try one fix, then stop and report.**

1. **First diagnosis.** Claude Code reads the error, forms a hypothesis, fixes it. Does not commit yet — keeps the fix in the working tree, runs the failing check again. If green, commits the fix as a normal step in the plan and continues.
2. **If the first fix doesn't work — STOP.** Do not write a second fix commit. Do not try a different angle in auto mode. Switch out of auto mode (Shift+Tab back to default), report to Jenny:
    - What the original failure was.
    - What hypothesis was tried.
    - What the result of the first fix attempt was.
    - What the current state of the working tree and branch is.
3. Jenny decides next steps in default mode. Possible outcomes: a deterministic diagnostic (tail logs while reproducing), a plan amendment, a scope cut, or a session-end with state captured in HANDOFF.

The one-fix rule is tighter than the old "stop after two consecutive misses" rule. Auto mode makes a second fix commit too cheap to write — Block 2 Session 3 burned three commits on Decision H without identifying the real cause. One fix attempt, then human eyes.

**Classifier-blocked actions count as "something went wrong."** If auto mode's classifier blocks a tool call:
- Claude Code does NOT retry with a reworded command to slip past the classifier. Reword-to-bypass is an integrity break.
- Reports verbatim: what the action was, what was attempted, what the classifier said.
- If it's a true false positive (classifier blocked something genuinely benign), Jenny can approve the one action manually. If it happens twice in a session, drop the rest of the session to default mode.

---

## Iteration cap

Auto mode's failure mode that the one-fix rule doesn't catch: Claude Code in a slow loop where each iteration is technically a "different problem" — reading a file, trying a fix, finding a new error, reading another file, trying another fix. The one-fix rule fires per problem, not per session. Without a separate cap, a stuck-but-progressing session can burn an hour and a meaningful chunk of cost before anyone notices.

**The rule: end execute phase if Claude Code makes more than 10 tool calls on a single sub-task without checkpoint progress.** Checkpoint progress = a successful commit that advances the plan, OR a successful verification check that wasn't passing before.

When the cap fires, Claude Code:
1. Switches out of auto mode (Shift+Tab to default).
2. Reports: "I've made N tool calls on [sub-task] without a successful commit or check. Pausing for your read." Includes the last few tool calls and what each was trying to accomplish.
3. Waits for Jenny.

Cost discipline is a v1.1 first-class concern (HANDOFF principle 5: "free product = no revenue offset"). The iteration cap protects spend; the one-fix rule protects diagnosis quality. Both fire independently — whichever hits first wins.

---

## Hard limits — enforced by `.claude/settings.json`

These never run autonomously, regardless of phase or mode. Prose alone is not a control surface auto mode reads — every item below has a corresponding rule in `.claude/settings.json`, committed to the repo. When a denied tool call is attempted, auto mode surfaces a prompt; Jenny decides per-instance.

| Hard limit | Settings rule |
|---|---|
| **No push to main without explicit per-push approval.** Plan approval covers everything up to the preview; main push is its own gate. | `deny: Bash(git push:*main*)`, `deny: Bash(git push:*origin main*)`, `deny: Bash(git push:*HEAD:main*)`. Pushes to non-main branches stay allowed (preview deploys depend on them). |
| **No production schema migrations.** No `wrangler d1 execute --remote`, no DDL against the Neon production branch. Drafting and reviewing SQL together is fine; running it is Jenny's. | `deny: Bash(wrangler d1 execute:*--remote*)`, `deny: Bash(psql:*)`, `ask: Bash(wrangler hyperdrive update:*)`. |
| **No credential generation or secrets to disk.** Don't pick passwords, don't generate API keys, don't suggest specific secret values. Never write a credential to a file or commit one. Jenny exports `JENNY_PASSWORD` per shell session; Claude Code inherits it via env, never reads it back, never writes it anywhere. | `deny: Write(**/.env*)`, `deny: Write(**/secrets/**)`, `deny: Write(**/.claude/secrets*)`. Plus the prose rule: never `cat $JENNY_PASSWORD`, never `echo` it. |
| **No `--amend`, no force-push, no rewriting merged history.** Hook fail = create a new commit; the prior commit didn't actually happen. | `deny: Bash(git commit:*--amend*)`, `deny: Bash(git push:*--force*)`, `deny: Bash(git push:*-f*)`, `deny: Bash(git rebase:*-i*)`, `deny: Bash(git reset:*--hard*HEAD~*)`. |
| **No production deploy rollbacks via CLI.** Rollback URLs and instructions: yes; clicking the button: Jenny's. See "Rollback playbook." | `deny: Bash(wrangler pages deployment rollback:*)`, `ask: Bash(wrangler pages deployment:*)` (the `ask` covers other deployment subcommands like `tail`, where Claude reading logs is fine but Jenny should see the prompt). |
| **No auto-appended commit trailers.** No `Co-authored-by:`, no `Generated-by:`. Use commit messages exactly as the plan or Jenny specifies. | Prose rule + spot-check at preview-review time. (Claude Code doesn't auto-append by default, but tooling changes can sneak this in.) |
| **No architecture-level unilateral decisions** (e.g., "let's disable Hyperdrive caching globally"). Surface the option in plan phase, recommend, but Jenny decides. | Prose rule. Architecture choices belong in plan mode, never as a fait accompli edit during execute. |
| **No "good enough to merge" calls.** Whether the verification matrix passes is Claude Code's read; whether the work is *done* is Jenny's. | Prose rule. Codified after Block 2 to prevent drift toward "I shipped it." |

The settings file is the load-bearing artifact for this table. If a deny rule is missing or weakened, the corresponding hard limit is effectively gone — flag it before working, don't discover it after.

### Auto-mode UI prompts during carve-out blocks (added 2026-05-06)

Auto-mode UI prompts that would change Claude Code's mode are a **separate gate from plan approval, even when plan approval is fresh.** During execute phase of a block that contains any carve-out commits, any such prompt (e.g., the "switch to auto mode" / "stay in default" prompt that can appear mid-execute, or a prompt to dismiss a denied-tool surface) requires explicit verbal confirmation in chat from Jenny **before Claude Code clicks**. Claude Code states the prompt verbatim, the proposed click, and waits.

This holds even if the prompt offers what looks like the obvious safe choice — the rule is that the choice gets named in chat, not that Claude Code declines all prompts. Scope is **carve-out blocks only**; non-carve-out blocks continue under standard auto-mode UI behavior.

Rationale: Block 4 saw the auto-mode UI signal fire 4 times across the block. The substantive carve-out contract held — every code commit in slack.js / events.js / OAuth files went through per-action review — but the recurrence of UI-driven mode-switch prompts is itself a pattern worth treating as a gate rather than a click-through. Behaviorally a hard limit; placed here rather than in settings.json because it's a UI-side rule the harness can't enforce.

---

## Rollback playbook — when a push to main breaks production

Production breaking is rare but not impossible, especially once Block 5+ ships AI-generated content to users. WORKFLOW needs to say what happens.

**Roles:**
- Claude Code: surfaces the rollback URL and the exact steps. Reads logs, identifies the last-known-good deploy, drafts a one-line "what broke" summary for HANDOFF.
- Jenny: clicks the rollback button. Decides whether to roll forward (fix and re-push) or stay rolled back (revert the commit on main and figure out the fix in a new branch).

**The playbook (when production is broken):**

1. **Confirm it's broken.** `curl -s -o /dev/null -w "%{http_code}" https://elinnoagent.com/api/db-health` — if not 200, or if the response shape is wrong, production is down. Hitting elinnoagent.com in the browser as a sanity check is also fine.
2. **Identify the last-known-good deploy.** Cloudflare Pages dashboard → Workers & Pages → `elinno-agent` → Deployments. Find the most recent deploy *before* the breaking one. Each deploy has a permanent URL like `abc1234.elinno-agent.pages.dev` — verify that one is healthy with the same curl.
3. **Surface the rollback to Jenny.** Claude Code says: "Production is broken. Last-known-good deploy is `abc1234`, deployed at `<timestamp>`, verified healthy. To roll back: dashboard → Deployments → `…` menu next to `abc1234` → 'Rollback to this deployment'. Want me to drop to default mode while you do that?"
4. **Jenny clicks. Production recovers within ~30 seconds.**
5. **Decide the fix path.**
   - **Roll forward** (small, obvious fix): drop to default mode, fix the bug, push to a preview branch, verify, request approval to push to main. The rolled-back state stays in place until the new push lands.
   - **Stay rolled back, investigate longer** (cause unclear, larger refactor needed): on `main`, create a `revert: <breaking commit message>` commit via `git revert <sha>` — this is a normal forward commit, not a history rewrite, so it's allowed in auto mode if the plan covers it. Push to main as a separate per-push approval. The rolled-forward main now matches the rolled-back deploy.
6. **Record in HANDOFF.** What broke, what the fix path was, what the rollback URL was, what shipped to fix it. This is its own doc-only commit.

**What's deliberately NOT automated:**
- The dashboard click. Cloudflare's CLI does support `wrangler pages deployment rollback`, but that's denied at the settings layer. Rollback is irreversible-shaped (it does undo, but it changes which version users see, immediately, on production) — exactly the kind of action where a one-second pause for Jenny to look at the screen is worth more than the speed gain.
- Deciding which deploy to roll back to. Claude Code recommends the one immediately before the breaking deploy; Jenny confirms it's actually healthy and not also broken.

---

## Work that doesn't fit the plan→auto rhythm

Some work shouldn't go through Phase 3 auto mode regardless of how good the plan is. For these, the plan phase still applies, but execute happens in **default mode with per-action review** — the old workflow.

- **Crypto code** — Block 3's encryption helper for connector tokens; envelope encryption with master key in Workers Secrets.
- **OAuth callbacks** — Block 4 (Slack), Block 6 (Jira), Block 8 (Drive). Token exfiltration risk if redirect handling is wrong.
- **Project-scoping enforcement** — Block 5's tool layer. Per HANDOFF principle #3, `project_id` is enforced server-side; subtle bugs ship cross-project leakage.
- **Webhook handlers** — Slack/Jira webhooks if any block adds them. Signature verification and replay protection.
- **Schema migrations** — anything that runs DDL on production D1 or Neon. (Already denied at the settings layer; default mode is for the design and dry-run conversation around them.)
- **Rollback fixes when production is broken** — see playbook above. Drop to default mode for the duration, even if the fix itself is small.

**Carve-out neighborhoods (added 2026-05-06).** The bulleted list above names specific code categories. Beyond those, code paths in security-adjacent *neighborhoods* get carve-out treatment by default — i.e., per-action review (default mode), not auto. The neighborhoods:

- **Credential decryption frequency.** Any code path that calls into `crypto.js`, reads `ciphertext_credentials`, or expands the set of call sites where decryption happens. New decryption call sites are themselves a carve-out, even if the called helper is unchanged.
- **Freshness-layer signals.** Any code that reads `sync_runs.detail`, computes "data as of" timestamps, or branches on rate-limited / inert sync status (Block 4 decisions E2 + L). These signals shape what the AI presents to the user as fresh; subtle bugs ship false-fresh answers.
- **Project-isolation enforcement.** Any code that constructs a SQL `WHERE project_id = …` clause for user-data tables, AND any code path that touches an LLM-supplied or webhook-supplied identifier the server uses to scope or authorize a database operation (e.g., `project_id` echoed back in tool input, `team_id` from a webhook body).

**Carve-out exit** (i.e., committing a code path in one of these neighborhoods in auto mode) requires an explicit decision + rationale recorded **in the block plan** before the commit lands. Matches Block 4's E2/F-base/F2/I/L precedent — rationale lives in the plan, not in commit messages or per-decision notes. The default is carve-out; auto is the exception.

Rationale: Block 5's tool layer surfaced that "is this commit project-isolation-sensitive?" is a recurring per-commit judgment. Naming the neighborhoods up front makes the judgment a check ("is this in a named neighborhood?") rather than a vibe.

The plan for any of the above must say at the top: `Execute mode: DEFAULT (security carve-out, no auto)`. Files in these categories carry a top-of-file `// SECURITY-CARVE-OUT: do not edit in auto mode` comment so future plans that touch them notice.

---

## Roles

**Jenny** — sole developer. Owns plan approval, every push to main, every rollback click, and every revision when execute hits something off-script.

**Claude Code** — designer, writer, reviewer of own work, executor. In plan mode: produces plans, mockups, decision lists. In auto mode: implements the approved plan, runs verification, surfaces results. In default mode (security carve-outs and post-failure recovery): per-action review like the pre-auto-mode workflow.

---

## Mockup and preview review

- **Static HTML mockups (plan phase).** Claude Code uses Preview MCP to render and screenshot during iteration — render → screenshot → edit loop runs in plan mode. Jenny reviews mockups as part of plan approval.
- **Dev server (`localhost`) smoke tests.** Claude Code surfaces the URL; Jenny opens and tests if the work needs it. Claude Code does not drive the rendered page.
- **Deployed previews** (Cloudflare Pages branch URLs). Claude Code runs the verification matrix automatically AND surfaces the URL for Jenny's manual eyeball before the main push.
- **Merged-main deploys.** Jenny verifies by opening the production URL after the push lands. The Phase 0 smoke-test ritual catches any regression on the next session start.

---

## Doc-only commits

Doc-only changes (HANDOFF.md, WORKFLOW.md, BLOCK_N_PLAN.md, README, comments-only edits) ship in their own commits, separate from code commits. Keeps code diffs reviewable.

Doc-only work uses a lightweight version of the three phases: a one-line plan ("update HANDOFF with Session N closeout details") gets a verbal approval, execute runs in auto mode, push to main still waits for the per-push confirmation. Phase 0 session-start ritual still applies; the smoke-test gate check can be skipped on doc-only sessions.

---

## End-of-session discipline

- End every session in a runnable state. Trunk green, working tree clean (except documented untracked files), deploys passing.
- HANDOFF.md updated at every session close: last-updated date, current block status, new env vars or services, new follow-ups, anything the next session's Phase 0 ritual needs to find.
- Honor natural break points. When a plan calls one out, don't stretch the session to push past it.
- The session-close HANDOFF update is its own doc-only commit.
- Before writing the HANDOFF closeout, run the **What's New check** (below). It happens once per session, at close, and never mid-session.

### The What's New check

At session close, before the HANDOFF closeout commit, Claude Code reviews what shipped this session and asks whether any of it belongs in What's New (PRD §5.11). Claude Code proposes; Jenny decides. Claude Code never adds an entry unprompted and never publishes one.

**The four steps**

1. **Classify.** Claude Code sorts the session's commits into three buckets: *feature* (a user would notice and might use differently), *fix* (a user would notice something stopped being wrong), and *internal* (no user-visible effect).

2. **Draft.** Claude Code writes preview text for the feature and fix items — the actual copy that would appear on the page, in user-facing register, not a summary of the commits.

3. **Present.** Claude Code shows the draft, plus a one-line list of what it classified as internal and is proposing to omit. Jenny can pull anything out of that list.

4. **Await the word.** Jenny replies `add` or `skip`, per item or for the batch. On `add`, Claude Code appends to the current draft entry. On `skip`, nothing is written. Silence is `skip`.

**Register rules for the preview text**

The draft is user-facing copy, not a changelog of the work. It must not contain commit SHAs, file paths, function or table names, block numbers, or internal vocabulary (`entities`, `executor`, `carve-out`, `Hyperdrive`).

Write what changed from the user's side of the screen:

| Not this | This |
|---|---|
| `mapIssueToEntity` took `sprintArray[0]`, so carried-over issues were filed under a closed sprint | Issues carried over from an earlier sprint were counted against the wrong sprint. Sprint View now matches your board. |
| Added `functions/api/sync-all.js` with `requireWorkspaceAdmin` gating | Refresh every connected source across all your projects in one go. Admins only. |

**Feature items need a preview image.** Per PRD §5.11.6, features carry a cropped screenshot and fixes do not. If a feature item is added and no image exists yet, Claude Code notes the gap; the entry is not publishable until the image lands.

### Capture step (feature items only)

When Jenny says `add` on a feature item, Claude Code offers to capture the preview. Runs only on `add`, never speculatively.

1. Claude Code names the target: the page, the CSS selector it intends to capture, and the output filename (`v{major}-{minor}-{slug}.png`).
2. On Jenny's go-ahead, it runs the `scripts/` capture helper against a local `wrangler pages dev` with seeded data — **never against production, and never with Jenny's session**. Credential handling stays a hard limit.
3. Claude Code surfaces the resulting PNG for review.
4. Jenny approves or asks for a re-shoot. The image is not committed until approved.

**Claude Code captures; it never generates.** No drawn approximations, no synthesised mocks. If a page can't be rendered, the answer is "no image yet", not an invented one. (PRD §5.11.6.1.)

**Check every shot for names.** Real project names, Jira keys, and assignee names must not appear. Seeded data plus a tight crop normally handles this; it is confirmed per image, not assumed.

### Draft state and publication

**Adding is not publishing.** These are two separate commands, usually days apart.

Entries carry a status. The page renders published entries only, so a draft is invisible to users even when it is sitting on `main`. This matters: session closeouts push to `main`, so without the flag a half-assembled weekly issue would go live mid-week.

| | Trigger | Effect |
|---|---|---|
| **Add** | Jenny says `add` at session close | Item appended to the current draft entry. Not visible to users. |
| **Publish** | Jenny says so explicitly, separately | Version number assigned, status flipped to published, entry goes live on next deploy. |

**Version numbers are assigned at publish, not at draft.** Several sessions feed one weekly issue; whether that issue is a minor or a patch bump (PRD §5.11.3) is not knowable until the week closes.

**The draft entry accumulates.** A second session in the same week appends to the existing draft rather than creating a new one. If no draft entry exists, `add` creates one.

**Publishing is a normal push to `main`** and therefore already sits behind the per-push approval gate. Claude Code cannot publish; the deny hook blocks pushes to `main`.

### Commit treatment

Changes to the What's New content constant are **doc-only commits** under the existing doc-only rule: separate from code commits, lightweight plan, auto mode, per-push approval still required.

The What's New commit is separate from the HANDOFF closeout commit. Two different audiences, two different registers.

### What this does not do

- It does not make What's New automatic. Every entry passes through an explicit `add`.
- It does not let Claude Code decide what users see. Classification is a proposal; the internal-omissions list is shown precisely so the judgment is reviewable.
- It does not publish. Publication is a separate command on a separate day.
- It does not run mid-session. One check, at close.
- It does not run on doc-only sessions. Nothing user-facing ships.

---

## Settings file

`.claude/settings.json` lives at repo root, ships in the repo, travels to fresh clones — same model as the workspace-scope IDE settings policy from Block 2.

```json
{
  "permissions": {
    "defaultMode": "default",
    "deny": [
      "Bash(git push:*main*)",
      "Bash(git push:*origin main*)",
      "Bash(git push:*HEAD:main*)",
      "Bash(git commit:*--amend*)",
      "Bash(git push:*--force*)",
      "Bash(git push:*-f*)",
      "Bash(git rebase:*-i*)",
      "Bash(git reset:*--hard*HEAD~*)",
      "Bash(wrangler d1 execute:*--remote*)",
      "Bash(wrangler pages deployment rollback:*)",
      "Bash(psql:*)",
      "Write(**/.env*)",
      "Write(**/secrets/**)",
      "Write(**/.claude/secrets*)"
    ],
    "ask": [
      "Bash(wrangler hyperdrive update:*)",
      "Bash(wrangler pages deployment:*)",
      "Bash(npm publish:*)",
      "Bash(rm:*-rf*)",
      "Bash(rm:*/*)"
    ]
  }
}
```

`defaultMode: default` is intentional — auto mode is opt-in per session via Shift+Tab after plan approval. Anthropic's `defaultMode: auto` setting has known reliability issues (issue #49273); explicit toggle is more dependable and forces a moment of thought at session start.

Adding, removing, or weakening a rule in this file is a re-lock trigger.

---

## Re-lock triggers

This agreement holds until Jenny says otherwise. These changes require explicit re-lock (Jenny revises this file, commits it, pushes it as a doc-only commit before any code lands under the new rules):

- Bringing in a second human reviewer for a specific block or PR.
- Switching tooling (e.g., adding a new IDE or AI assistant alongside Claude Code).
- Adding CI / pre-commit hooks that change any phase's gate.
- Going public with the repo (the security carve-out list expands).
- Expanding what Claude Code drives in the browser (current carve-out: Preview MCP for static mockups during plan phase only).
- Editing `.claude/settings.json` to add, remove, or weaken a permission rule.
- Changing the operating model (e.g., dropping plan phase, allowing auto mode to push to main, moving to bypassPermissions).
- Raising or removing the iteration cap.

Claude Code flags any of these when they come up; Jenny decides.
