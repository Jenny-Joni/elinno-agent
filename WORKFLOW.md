# Elinno Agent — Working Agreement

> The working agreement for the rest of the project (Block 2 remainder
> through Block 9). Drop this in the repo root or reference it from
> HANDOFF.md so every fresh Claude / Cursor session inherits it.

Last updated: 2026-05-03 (mid-Block-2 Session 3).

---

## Roles

**Jenny** — sole developer. Owns decisions, owns reviews, owns every push to `main`.

**Claude** — designer, writer, reviewer of own work. Produces all content: code, mockups, schema migrations, curl matrices, docs, system prompts, tool schemas, copy.

**Cursor** — executor only. Reads files, places at target paths, proposes commits with messages Claude specifies, runs git operations Jenny approves. Cursor does NOT review Claude's content; Cursor only verifies file integrity (encoding, path, no transit corruption).

---

## How a change moves through the system

For every change — code, doc, schema, anything:

1. **Claude writes the file** to `/mnt/user-data/outputs/`. Includes a header comment naming the decisions it implements.
2. **Claude flags own uncertainty** explicitly. If a path, helper signature, CSS class name, or behavior is a guess rather than a verified fact, Claude says so.
3. **Jenny downloads** the file(s) from her sandbox/Downloads.
4. **Cursor reads** the file from `~/Downloads`, places it at the target path Claude specified, mkdir-ing the path if needed.
5. **Cursor verifies file integrity**: line count matches Claude's report, no encoding corruption (e.g., em-dashes preserved), file at correct path.
6. **Cursor proposes the commit** with the exact Conventional Commits message Claude provided.
7. **Jenny approves** the commit.
8. **Cursor commits.** Does not push.
9. **Jenny gives explicit "approve push to main"** when ready.
10. **Cursor fast-forward merges** to main and pushes. No PRs, no GitHub review interface.

---

## What Cursor does NOT do

- Review Claude's content for correctness against locked decisions.
- Propose code that Claude didn't write.
- Suggest changes to Claude's code beyond flagging file-integrity issues (encoding, path, truncation).
- Push to `main` without Jenny's explicit per-push approval.
- Force-push or amend commits without explicit per-action approval.

---

## What Claude does NOT do

- Run git operations.
- Execute shell commands in Jenny's environment.
- Open or close IDE tabs, manage buffers, or interact with the IDE UI in any way.
- Push, commit, or otherwise modify Jenny's repo directly. All file delivery is via `/mnt/user-data/outputs/` for Jenny to download.

---

## What Jenny does

- Reads (or skims) every file Claude writes before approving the commit.
- Approves every commit.
- Approves every push to `main`.
- Runs the IDE-side verifications: tab management, save events, browser smoke tests, manual UI walkthroughs on merged-main deploys.
- Flags when she sees Claude or Cursor drifting from the agreement.

---

## Decision-locking pattern

Before any code is written for a new block:

1. Claude proposes a list of decisions to lock for the block.
2. Jenny works through them in order, approving or revising each.
3. Claude consolidates the locked decisions into a `BLOCK_N_PLAN.md` addendum or new file.
4. Cursor commits the plan as the first commit of the block's branch.
5. Code commits follow on the same branch, each implementing decisions cited in their commit messages.

Block 2 used decisions A–AC. Block 3 will start a fresh letter sequence (or use a different naming scheme — Claude's call when Block 3 starts).

---

## Security carve-out — code that warrants extra review

The single-reviewer model (Jenny only) has known weak points. For these
specific changes, Claude flags explicitly that "this would normally be a
code-review-required change," and Jenny decides per-case whether to:

- Open a one-time PR for that file specifically and request external review.
- Spot-check against a known reference (e.g., libsodium docs for crypto).
- Accept the single-reviewer risk and proceed with extra care.

The flagged categories:

- **Crypto code** — Block 3's encryption helper for connector tokens; envelope encryption with master key in Workers Secrets.
- **OAuth callbacks** — Block 4 (Slack), Block 6 (Jira), Block 8 (Drive). Token exfiltration risk if redirect handling is wrong.
- **Project-scoping enforcement** — Block 5's tool layer. Per HANDOFF principle #3, `project_id` is enforced server-side; subtle bugs here ship cross-project leakage.
- **Webhook handlers** — Slack/Jira webhooks if any block adds them. Signature verification and replay protection.
- **Schema migrations** — anything that runs DDL on production D1 or Neon. Reversibility check, dry-run on a Neon branch.

When one of these comes up, Claude says so up-front. Jenny decides whether to enlist extra eyes.

---

## Stopping rules

- **End every session in a runnable state.** Trunk green, working tree clean except documented untracked files, deploys passing.
- **HANDOFF.md updated at every session close.** Last-updated date, current block status, any new env vars or services, any new follow-ups.
- **Natural break points are honored.** When a block plan calls out a break point (e.g., Block 2's "API done, UI to next session if chat UI hiccups"), don't combine sessions to push past it.
- **Claude pushes back when Jenny is tired.** A long chat thread degrades reviewer fidelity; Claude flags this and proposes a stopping point rather than continuing into security-sensitive review work in a degraded state.

---

## File delivery convention

- Claude saves files to `/mnt/user-data/outputs/` and presents them.
- Jenny downloads to `~/Downloads`.
- Cursor reads from `~/Downloads`, places at the target path Claude specified.
- After Cursor confirms placement, Claude can clear the sandbox files (no-op for Jenny; just keeps the outputs directory uncluttered next session).

---

## Process changes that require an explicit re-lock

This agreement holds until Jenny says otherwise. Some specific changes
worth surfacing explicitly:

- **Bringing in a second human reviewer** for a specific block or PR.
- **Switching tooling** (Cursor → Claude Code, etc.).
- **Adding CI / pre-commit hooks** that change the commit gate.
- **Going public with the repo** (the security carve-out list expands).

Claude flags any of these when they come up; Jenny decides.

---

## What this document is not

- Not a substitute for HANDOFF.md (which captures current project state).
- Not a substitute for `BLOCK_N_PLAN.md` files (which capture per-block locked decisions).
- Not exhaustive — edge cases not covered here get worked out in chat and folded back into this doc as amendments at session close.

---

*Generated 2026-05-03 mid-Block-2-Session-3 after Jenny consolidated the
roles. Update this file as the working agreement evolves; date the
"Last updated" line every time.*
