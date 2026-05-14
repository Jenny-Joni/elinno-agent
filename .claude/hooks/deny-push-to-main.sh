#!/usr/bin/env bash
# PreToolUse hook: deny any Bash tool call that runs `git push` targeting `main`.
# Per CLAUDE.md: "Every push to main is a separate explicit 'approve push to main'
# — never standing." Glob deny patterns in settings.json proved unreliable in
# Phase 0 of the 2026-05-14 follow-on session; this hook is the actual gate.

set -euo pipefail

if ! command -v jq >/dev/null; then
  echo "PreToolUse hook ERROR: jq not installed; fail-closed deny." >&2
  exit 2
fi

input=$(cat)
tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')

[ "$tool_name" = "Bash" ] || exit 0

command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

if ! printf '%s' "$command" | grep -qE '(^|;|&&|\|\|)[[:space:]]*git[[:space:]]+push\b'; then
  exit 0
fi

if printf '%s' "$command" | grep -qE '\bmain\b'; then
  cat >&2 <<EOF
PreToolUse hook DENY: 'git push' command targets the 'main' branch.

Command: $command

Per CLAUDE.md: "Per-push approval to main. Every push to main is a separate
explicit 'approve push to main' — never standing." Run the push from the user
side, not via the Bash tool.
EOF
  exit 2
fi

exit 0
