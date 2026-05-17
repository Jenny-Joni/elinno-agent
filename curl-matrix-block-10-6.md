# Block 10.6 — Curl Verification Matrix

Verification record for Block 10 sub-task 10.6 (tool-call trace
viewer). Branch `block-10-6-tool-trace` at `986e3bc`, awaiting
ff-merge to `main`. Preview at
`https://block-10-6-tool-trace.elinno-agent.pages.dev`.

Code surface: **3 files, 144 insertions, 5 deletions** (two commits
per per-commit classification):

- `functions/api/projects/[id]/conversations/[conversationId]/messages.js`
  — `+25/-3` (DEFAULT mode). GET handler destructures `role` from
  `requireProjectRole`, adds `tool_calls` + `tool_result` to SELECT,
  trims response for non-admin members (drops role='tool' rows, nulls
  `tool_calls` on assistant rows). Server is the load-bearing gate.
- `public/project.html` — `+66/-2` (AUTO mode). `renderMessages()`
  passes the full message array (incl. role='tool') into
  `renderMessageHtml()`. New `renderToolTraceHtml(toolCalls, allMsgs)`
  builds collapsed `<details>` between message text and citation rail.
  Failure parsing via try/catch on `JSON.parse(result[0].text)`.
- `public/auth.css` — `+53` (AUTO mode). `.tool-trace*` classes:
  pill-styled clickable summary, soft-bg ul, ✓ success / italic-red
  ⚠️ error, mono font for tool names.

No schema change. No DDL. Reads existing persisted `tool_calls` +
`tool_result` JSONB columns that Block 5 + commit `f7fc540` (Block 6)
have been populating.

## Verification posture at ff-merge

| Cell | Status | Notes |
|---|---|---|
| **V6.1** | **DEFERRED-runtime / PASS-by-inspection** | Admin sees trace on assistant messages with tool_calls. UI gate is `m.tool_calls?.length > 0`; server returns full `tool_calls` for project admins. Easy one-click verification on production post-merge: Jenny opens RAIN as her admin self, scrolls to any recent assistant message — the `<details>` renders. |
| **V6.2** | **DEFERRED-runtime / PASS-by-inspection** | Member does NOT see trace. Server filter in messages.js: `isProjectAdmin ? enrichedMessages : enrichedMessages.filter(m => m.role !== 'tool').map(m => m.role === 'assistant' ? { ...m, tool_calls: null } : m)`. Non-admin members never receive role='tool' rows AND see `tool_calls: null` on assistants → UI's `m.tool_calls?.length > 0` gate naturally renders nothing. Runtime verification requires a member account (Jenny is the only user); skipped — code path is short and the server gate is the load-bearing one. |
| **V6.3** | **DEFERRED-runtime, code-path verified** | Failed tool renders error. The render path: parse `JSON.parse(match.tool_result.result[0].text)` inside try/catch; if `parsed.error === 'tool_execution_failed'`, extract `parsed.error_message` (truncated to 200 chars) and render `⚠️ <error>`. Matches `f7fc540`'s persisted payload shape exactly (`tools.js:298-302`: `{ error, tool_name, error_message }`). Runtime verification needs a recent failed tool call in RAIN's history — opportunistic post-merge probe (SELECT WHERE tool_result->>'tool_use_id' IS NOT NULL → manually inspect for the failure payload). |
| **V6.4** | **DEFERRED-runtime / PASS-by-inspection** | Successful tool renders ✓. Default branch in the failure-detection try/catch — anything that's not `parsed.error === 'tool_execution_failed'` falls through to `<span class="tool-trace-result ok">✓</span>`. Summary line reads "🔧 N tool calls" with no "(M failed)" suffix when failedCount is 0. Easy verification post-merge: open any recent assistant message in RAIN that called Jira tools. |

## Preview smoke verification

| Check | Method | Result |
|---|---|---|
| Branch alias resolves | `block-10-6-tool-trace.elinno-agent.pages.dev` (21 chars, well under cap) | Resolves. Preview UP at 12:07:09Z. |
| Preview deploy succeeds | `curl /api/db-health` | **HTTP 200**. Build clean (no import errors). |
| Static syntax | `node --check messages.js` | parse OK (checked post-edit) |
| No existing render path regressed | Code review: filter at line 663 unchanged; renderMessageHtml signature gained a second arg with a safe `|| []` fallback at the only existing call site. Citation rail render order preserved (trace appears BEFORE citations per decision P "between the message text and the citation rail"). | PASS-by-inspection |
| Server admin gate ordering | Read response handling: `isProjectAdmin = role === 'admin'` then `responseMessages = isProjectAdmin ? enriched : enriched.filter(...).map(...)`. No path that emits `tool_calls` or `role='tool'` without crossing the gate. | PASS-by-inspection |

## Mid-flight fixes

None. The three-file change set landed first-try. Two design touches
folded into the implementation pre-write rather than as hotfixes:

- **Server-side gate is load-bearing**, client-side render gate is
  natural emptiness. No `isAdmin` check duplicated in JS — the data
  is simply absent for non-admins. Cleaner than dual-gate and dodges
  the workspace-admin (`me.is_admin`, D1) vs. project-admin
  (`role === 'admin'`, Postgres) confusion that the BLOCK_10_PLAN.md
  decision O text glossed past (it cited the workspace-admin pattern
  from project.html:1607, but project-admin is the correct gate for
  project-scoped trace data).
- **Failure detection wrapped in try/catch** so malformed
  `tool_result.result` payloads don't crash the renderer. Falls
  back to success render rather than throwing — defensive against
  any future tool that returns non-stringified JSON in
  `result[0].text`.

## Behavior preservation

- Existing `renderMessages()` filter still drops role='tool' from the
  visible chat list. Only the `renderMessageHtml` call now receives
  the full `allMsgs` array as a second arg for the trace lookup. No
  visible behavior change for the existing 9.2 citation rail.
- Citation rail render comes AFTER the trace per decision P
  ("between the message text and the citation rail"). Order: text →
  trace (admin only) → citations.
- `escapeHtml` used on every string interpolated into the trace
  HTML (tool name, error message, summary) — no XSS regression vs.
  the existing renderCitationRailHtml.

## Carry-forward

- **PROD V6.1 + V6.4 one-click verification.** Open RAIN as Jenny
  (workspace admin AND project admin) → scroll to any recent
  assistant message with a tool call → the `<details>` element
  renders with tool names + ✓. If RAIN has a recent failed tool
  in history, V6.3 confirms at the same time.
- **PROD V6.2** requires a second user (member, not admin). Skip
  until v1.1 actually has members. Server gate is the
  load-bearing check; if a future member's GET on `/messages` ever
  shows tool_calls, that's a regression to investigate.
- **Args expand toggle (Block 11+).** Decision P explicitly defers
  args rendering. If forensic value materializes (e.g., debugging
  why the LLM picked specific JQL), add an expand toggle that shows
  `tc.input` as a `<code>` block.
