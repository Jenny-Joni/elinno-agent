# Elinno Agent — Working Agreement

> The working agreement for the rest of the project (Block 2 remainder
> through Block 9). Drop this in the repo root or reference it from
> HANDOFF.md so every fresh Claude Code session inherits it.

Last updated: 2026-05-03 (mid-Block-2 Session 3, post-switch from Cursor + Claude.ai to Claude Code).

---

## Roles

**Jenny** — sole developer. Owns decisions, owns reviews, owns every push to `main`.

**Claude Code** — designer, writer, reviewer of own work, executor. Produces all content (code, mockups, schema migrations, curl matrices, docs, system prompts, tool schemas, copy) AND runs the shell, git, wrangler, curl, and the dev server in Jenny's environment under her per-action approval.

---

## How a change moves through the system

For every change — code, doc, schema, anything:

1. **Claude Code writes the file** at the target path. Includes a header comment naming the decisions it implements where that's customary for the file type.
2. **Claude Code flags own uncertainty** explicitly. If a path, helper signature, CSS class name, or behavior is a guess rather than a verified fact, Claude Code says so.
3. **Claude Code shows the staged diff** (`git diff --staged`) and proposes the Conventional Commits message.
4. **Jenny approves** the diff and the commit message.
5. **Claude Code commits.** Does not push.
6. **Jenny gives explicit "approve push to <branch>"** per push (each push to a remote, including each push to `main`, is a separate explicit approval — never standing). Claude Code then pushes.

No PRs. Fast-forward merges only: branch → preview deploy → verification → ff-merge to main → push. The GitHub PR review interface is not used.

---

## Reviewing mockups and other previewable artifacts

For HTML mockups, screenshots, or anything that needs to render to be reviewed:

- **Claude Code opens the file in Jenny's browser** (`open <path>` on macOS) rather than describing it in chat. The mockup workflow is: Claude Code writes the mockup HTML, runs `open <path>` to launch it, and Jenny reviews it visually before any code that implements it gets written.
- **For deployed previews** (Cloudflare Pages branch previews, the dev server at localhost), Claude Code surfaces the URL and Jenny opens it. Claude Code does not interact with the rendered page itself — manual smoke tests stay Jenny's per WORKFLOW's "What Jenny does" section.
- Iteration on a mockup happens the same way: Claude Code edits the file, re-runs `open`, Jenny re-reviews.

---

## Hard limits on what Claude Code does autonomously

- **No schema migrations on production D1 or Neon production branch.** Drafting the SQL and reviewing it together is fine. Running it via `wrangler d1 execute --remote` or against Neon production is Jenny's. Falls under the schema-migrations security carve-out below.
- **No credential generation.** Don't pick passwords for real accounts, don't generate API keys, don't suggest specific secret values. If a secret is needed, Claude Code points Jenny at the right Cloudflare/Neon/etc. UI.
- **No persisting secrets to disk.** Never write a credential to a file, never commit one, never paste one into an output that gets logged. Jenny exports `JENNY_PASSWORD` per shell session; Claude Code inherits it via the env var, never reads it back, never writes it anywhere.
- **No architecture-level unilateral decisions** (e.g., "let's disable Hyperdrive caching globally"). Surface the option, recommend, but Jenny decides.
- **No "good enough to merge" calls.** Whether the verification matrix passes or not is Claude Code's read; whether the work is *done* is Jenny's decision.
- **No `--amend` or force-push without per-action approval.** Default to creating a new commit when a hook fails — never `--amend` after a failure (the prior commit didn't actually happen on hook fail).
- **No auto-appended `Co-authored-by:` trailers.** Use commit messages exactly as Jenny approves them.

---

## What Jenny does

- Reads (or skims) every diff Claude Code produces before approving the commit.
- Approves every commit.
- Approves every push to any remote, per push.
- Runs the IDE-side verifications: tab management, save events, browser smoke tests, manual UI walkthroughs on merged-main deploys.
- Flags when she sees Claude Code drifting from the agreement.

---

## Decision-locking pattern

Before any code is written for a new block:

1. Claude Code proposes a list of decisions to lock for the block.
2. Jenny works through them in order, approving or revising each.
3. Claude Code consolidates the locked decisions into a `BLOCK_N_PLAN.md` addendum or new file.
4. Claude Code commits the plan as the first commit of the block's branch (under Jenny's approval per the gate above).
5. Code commits follow on the same branch, each implementing decisions cited in their commit messages.

Block 2 used decisions A–AC. Block 3 will start a fresh letter sequence (or use a different naming scheme — Claude Code's call when Block 3 starts).

---

## Security carve-out — code that warrants extra review

The single-reviewer model (Jenny only) has known weak points. For these specific changes, Claude Code flags explicitly that "this would normally be a code-review-required change," and Jenny decides per-case whether to:

- Open a one-time PR for that file specifically and request external review.
- Spot-check against a known reference (e.g., libsodium docs for crypto).
- Accept the single-reviewer risk and proceed with extra care.

The flagged categories:

- **Crypto code** — Block 3's encryption helper for connector tokens; envelope encryption with master key in Workers Secrets.
- **OAuth callbacks** — Block 4 (Slack), Block 6 (Jira), Block 8 (Drive). Token exfiltration risk if redirect handling is wrong.
- **Project-scoping enforcement** — Block 5's tool layer. Per HANDOFF principle #3, `project_id` is enforced server-side; subtle bugs here ship cross-project leakage.
- **Webhook handlers** — Slack/Jira webhooks if any block adds them. Signature verification and replay protection.
- **Schema migrations** — anything that runs DDL on production D1 or Neon. Reversibility check, dry-run on a Neon branch.

When one of these comes up, Claude Code says so up-front. Jenny decides whether to enlist extra eyes.

---

## Stopping rules

- **End every session in a runnable state.** Trunk green, working tree clean except documented untracked files, deploys passing.
- **HANDOFF.md updated at every session close.** Last-updated date, current block status, any new env vars or services, any new follow-ups.
- **Natural break points are honored.** When a block plan calls out a break point (e.g., Block 2's "API done, UI to next session if chat UI hiccups"), don't combine sessions to push past it.
- **Stop after two consecutive failed diagnoses of the same bug.** Don't write a third fix commit. Run a deterministic diagnostic (e.g., tail logs while reproducing) and find the actual failure mode before touching code again. (Codified after Block 2 Session 3 burned three fix commits on Decision H without identifying the real cause.)

---

## Process changes that require an explicit re-lock

This agreement holds until Jenny says otherwise. Some specific changes worth surfacing explicitly:

- **Bringing in a second human reviewer** for a specific block or PR.
- **Switching tooling** (e.g., adding a new IDE or AI assistant alongside Claude Code). The Cursor + Claude.ai → Claude Code switch happened mid-Session-3 and is reflected in this revision.
- **Adding CI / pre-commit hooks** that change the commit gate.
- **Going public with the repo** (the security carve-out list expands).

Claude Code flags any of these when they come up; Jenny decides.

---

## What this document is not

- Not a substitute for HANDOFF.md (which captures current project state).
- Not a substitute for `BLOCK_N_PLAN.md` files (which capture per-block locked decisions).
- Not exhaustive — edge cases not covered here get worked out in chat and folded back into this doc as amendments at session close.

---

*Originally generated 2026-05-03 mid-Block-2-Session-3 after Jenny consolidated the
roles. Revised same day after the switch from Cursor + Claude.ai to Claude Code
collapsed the three-role workflow to two. Update this file as the working agreement
evolves; date the "Last updated" line every time.*
