# Elinno Agent

Multi-tenant project intelligence platform. Solo build by Jenny on Cloudflare Pages + D1 + Hyperdrive + Neon Postgres + pgvector. Production at https://elinnoagent.com.

## Read first

Before suggesting changes, read these in order:

1. **HANDOFF.md** — current project state. The last section is "what's actually done as of the most recent session." Always check this first.
2. **WORKFLOW.md** — binding working agreement. Three phases (Plan → Approval → Execute), Phase 0 session-start ritual, hard limits (enforced via `.claude/settings.json`), security carve-outs, scope-expansion and iteration-cap rules, rollback playbook. Non-negotiable.
3. **BLOCK_N_PLAN.md** for the current block — locked design decisions. Block 18 (chat suggested questions) shipped as v1.9 on 2026-08-10; `BLOCK_18_PLAN.md` is the most recent. No block is in progress — the next one gets its plan drafted in a fresh plan-mode session. Check the latest HANDOFF closeout for the open queue before assuming what's next.
4. **PROJECT.md** — stack, repo layout, IDs (Cloudflare account, D1 db, Neon project, Hyperdrive config), conventions.

PRD.md and BUILD_PLAN.md are reference docs; read them when scope or block ordering is in question.

## Phase 0 — session-start ritual (every session, before planning)

Per WORKFLOW.md, the first three things every new session does, in order:

1. **Read state.** `git status`, `git log main..HEAD --oneline` (if on a non-main branch), `git branch --show-current`, `git fetch origin --dry-run`. State the result back to Jenny in one or two sentences.
2. **Read recency.** Latest "Session N closeout" or "mid-state" in HANDOFF.md; current `BLOCK_N_PLAN.md` if mid-block. Flag anything that contradicts the working tree.
3. **Smoke-test the gates.** Once per non-doc-only session, before switching to auto mode, confirm the deny rules still fire — e.g., `git push origin main --dry-run` (the dry-run is safe regardless) should prompt under auto mode.

If any of the three turns up something unexpected, that's the conversation, not the planned work.

## Hard rules (do not break without an explicit re-lock from Jenny)

- **Plan approval is the load-bearing gate.** In auto mode, claude commits within the approved change-list without per-commit prompts. Any file edit outside the change-list stops execute and surfaces to Jenny.
- **Per-push approval to main.** Every push to `main` is a separate explicit "approve push to main" — never standing. Pushes to non-main branches (preview deploys) happen in auto mode under the approved plan. Enforced in `.claude/settings.json`.
- **No PRs.** Fast-forward merges only: branch → preview → verification → ff-merge to local main → push.
- **No `--amend`, no force-push, no rewriting merged history.** Hook fail = create a new commit; the prior commit didn't actually happen. Enforced in `.claude/settings.json`.
- **No commit-message trailers** beyond what Jenny approves. No auto-`Co-authored-by:`.
- **No production DDL, no credential generation, no secrets to disk.** Enforced in `.claude/settings.json` (no remote D1 execute, no `psql`, no writes to `.env*` / `secrets/` / `.claude/secrets*`). Drafting and reviewing SQL together is fine; running it is Jenny's.
- **No production deploy rollbacks via CLI.** Claude reads logs and surfaces the dashboard URL; Jenny clicks the button. See WORKFLOW.md "Rollback playbook."
- **One-fix rule.** In auto mode, try one fix for any failure; if it doesn't work, drop to default mode and report. Do not write a second fix commit in auto mode.
- **Iteration cap.** End execute phase after 10 tool calls on a single sub-task without a successful commit or new passing check. Switch to default mode and report.
- **Security carve-outs run in default mode**, never auto: crypto, OAuth callbacks, project-scoping enforcement, webhook handlers, schema migrations, rollback fixes when production is broken. See WORKFLOW.md for the full list.

## Conflicts between docs

- PRD is source of truth for *what* to build.
- BUILD_PLAN for *order*.
- The latest HANDOFF section for *what's actually done*.
- WORKFLOW for *how Jenny and Claude Code work together*.

## Worktree caveat

Claude Code may auto-create a worktree under `.claude/worktrees/`. The worktree branch can lag the actual session branch. When in doubt, read docs from the parent repo path (`/Users/jennyshane/elinno-agent/`) which is on Jenny's working branch.
