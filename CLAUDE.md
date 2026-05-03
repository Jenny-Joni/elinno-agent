# Elinno Agent

Multi-tenant project intelligence platform. Solo build by Jenny on Cloudflare Pages + D1 + Hyperdrive + Neon Postgres + pgvector. Production at https://elinnoagent.com.

## Read first

Before suggesting changes, read these in order:

1. **HANDOFF.md** — current project state. The last section is "what's actually done as of the most recent session." Always check this first.
2. **WORKFLOW.md** — binding working agreement. Roles, gating rules, security carve-outs, stopping rules. Non-negotiable.
3. **BLOCK_N_PLAN.md** for the current block — locked design decisions. Block 2 in progress.
4. **PROJECT.md** — stack, repo layout, IDs (Cloudflare account, D1 db, Neon project, Hyperdrive config), conventions.

PRD.md and BUILD_PLAN.md are reference docs; read them when scope or block ordering is in question.

## Hard rules (do not break without an explicit re-lock from Jenny)

- **Show `git diff --staged` before every commit.** Wait for Jenny's approval of both diff and commit message before running `git commit`.
- **Per-push approval to any remote.** Each `git push` (including each push to `main`) is a separate explicit "approve push to <branch>" — never standing.
- **No PRs.** Fast-forward merges only: branch → preview → verification → ff-merge to main → push.
- **No `--amend`, no force-push** without per-action approval. If a commit hook fails, create a new commit (the failed one didn't actually happen).
- **No commit-message trailers** beyond what Jenny approves. No auto-`Co-authored-by:`.
- **No production DDL, no credential generation, no secrets to disk.** See WORKFLOW.md "Hard limits" for full list.
- **Stop after two consecutive failed diagnoses of the same bug.** Run a deterministic diagnostic before writing a third fix.

## Conflicts between docs

- PRD is source of truth for *what* to build.
- BUILD_PLAN for *order*.
- The latest HANDOFF section for *what's actually done*.
- WORKFLOW for *how Jenny and Claude Code work together*.

## Worktree caveat

Claude Code may auto-create a worktree under `.claude/worktrees/`. The worktree branch can lag the actual session branch. When in doubt, read docs from the parent repo path (`/Users/jennyshane/elinno-agent/`) which is on Jenny's working branch.
