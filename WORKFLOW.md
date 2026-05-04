# Elinno Agent — Working Agreement

Last updated: 2026-05-04 (Block 2 closed; Preview MCP carve-out added per re-lock A1; doc-only commit rule codified).

---

## Hard limits — what Claude Code never does autonomously

- **No production schema migrations.** No `wrangler d1 execute --remote`, no DDL against the Neon production branch. Drafting and reviewing SQL together is fine; running it is Jenny's.
- **No credential generation or secrets to disk.** Don't pick passwords, don't generate API keys, don't suggest specific secret values. Never write a credential to a file or commit one. Jenny exports `JENNY_PASSWORD` per shell session; Claude Code inherits it via env, never reads it back, never writes it anywhere.
- **No `--amend` or force-push without per-action approval.** Hook fail = create a new commit; the prior commit didn't actually happen.
- **No auto-appended `Co-authored-by:` trailers.** Use commit messages exactly as Jenny approves them.
- **No architecture-level unilateral decisions** (e.g., "let's disable Hyperdrive caching globally"). Surface the option, recommend, but Jenny decides.
- **No "good enough to merge" calls.** Whether the verification matrix passes is Claude Code's read; whether the work is *done* is Jenny's.

---

## Roles

**Jenny** — sole developer. Owns decisions, reviews, and every push to `main`.

**Claude Code** — designer, writer, reviewer of own work, executor. Produces all content (code, mockups, schema migrations, curl matrices, docs, system prompts, tool schemas, copy) AND runs the shell, git, wrangler, curl, and the dev server in Jenny's environment under her per-action approval.

---

## Change flow

Every change — code, doc, schema, anything:

1. Claude Code writes the file. Includes a header comment naming the decisions it implements where that's customary for the file type.
2. Claude Code flags own uncertainty explicitly (guesses about paths, helper signatures, CSS class names, behavior).
3. Claude Code shows `git diff --staged` and proposes the Conventional Commits message.
4. Jenny approves the diff and the message.
5. Claude Code commits. Does not push.
6. Jenny gives explicit "approve push to <branch>" per push (each push, including each push to `main`, is a separate explicit approval — never standing). Claude Code then pushes.

No PRs. Fast-forward merges only: branch → preview deploy → verification → ff-merge to main → push. The GitHub PR review interface is not used.

**Doc-only commits.** Doc-only changes (HANDOFF.md, WORKFLOW.md, BLOCK_N_PLAN.md, README, comments-only edits) ship in their own commit, separate from code commits. Keeps code diffs reviewable.

---

## Mockup and preview review

- **Static HTML mockups.** Claude Code may use Preview MCP to render and screenshot during iteration — render → screenshot → edit loop runs in-Claude. Jenny still reviews the final mockup visually before any code that implements it gets written.
- **Dev server (`localhost`) smoke tests.** Claude Code surfaces the URL; Jenny opens and tests. Claude Code does not drive the rendered page.
- **Deployed previews** (Cloudflare Pages branch URLs) and **merged-main deploys**. Same: Claude Code surfaces the URL; Jenny opens and tests. Manual UI walkthroughs on the real deploy stay Jenny's.

---

## Per-block discipline

**Decision-locking.** Before any code is written for a new block:

1. Claude Code proposes a list of decisions to lock.
2. Jenny works through them in order, approving or revising each.
3. Claude Code consolidates the locked decisions into `BLOCK_N_PLAN.md`.
4. Claude Code commits the plan as the first commit of the block's branch.
5. Code commits follow on the same branch, each citing decisions in their messages.

Block 2 used decisions A–AC (30 decisions). Block 3 starts a fresh sequence — naming scheme is Claude Code's call when the block opens.

**Stopping rules.**

- End every session in a runnable state. Trunk green, working tree clean (except documented untracked files), deploys passing.
- HANDOFF.md updated at every session close: last-updated date, current block status, new env vars or services, new follow-ups.
- Honor natural break points. When a block plan calls one out (e.g., Block 2's "API done, UI to next session if chat UI hiccups"), don't combine sessions to push past it.
- **Stop after two consecutive failed diagnoses of the same bug.** Don't write a third fix commit. Run a deterministic diagnostic (e.g., tail logs while reproducing) and find the actual failure mode before touching code again. Codified after Block 2 Session 3 burned three fix commits on Decision H without identifying the real cause.

**Security carve-outs — code that warrants extra review.** The single-reviewer model has known weak points. For these specific changes, Claude Code says up-front "this would normally be a code-review-required change," and Jenny decides per-case whether to open a one-time PR for external review, spot-check against a known reference (e.g., libsodium docs for crypto), or accept the single-reviewer risk and proceed with extra care:

- **Crypto code** — Block 3's encryption helper for connector tokens; envelope encryption with master key in Workers Secrets.
- **OAuth callbacks** — Block 4 (Slack), Block 6 (Jira), Block 8 (Drive). Token exfiltration risk if redirect handling is wrong.
- **Project-scoping enforcement** — Block 5's tool layer. Per HANDOFF principle #3, `project_id` is enforced server-side; subtle bugs ship cross-project leakage.
- **Webhook handlers** — Slack/Jira webhooks if any block adds them. Signature verification and replay protection.
- **Schema migrations** — anything that runs DDL on production D1 or Neon. Reversibility check, dry-run on a Neon branch.

---

## Re-lock triggers

This agreement holds until Jenny says otherwise. These changes require explicit re-lock:

- Bringing in a second human reviewer for a specific block or PR.
- Switching tooling (e.g., adding a new IDE or AI assistant alongside Claude Code).
- Adding CI / pre-commit hooks that change the commit gate.
- Going public with the repo (the security carve-out list expands).
- Expanding what Claude Code drives in the browser (current carve-out: Preview MCP for static mockups only).

Claude Code flags any of these when they come up; Jenny decides.
