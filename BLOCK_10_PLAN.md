# BLOCK 10 PLAN — Polish: nice-to-have

> Drafted 2026-05-17 in plan mode. Single artifact covering six sub-tasks
> (10.1–10.6) per BUILD_PLAN v1.2 §Block 10. Companion to PRD v1.2
> §5.6/§7/§8.1/§8.2 and the BLOCK_9_PLAN.md shape. Same Phase A–E
> verification posture as `curl-matrix-block-9-*.md`.

| Field | Value |
|---|---|
| Block | 10 — Polish: nice-to-have |
| Branch shape | One branch per sub-task: `block-10-5-sweep-batching`, `block-10-4-connector-guide`, `block-10-3-daily-msg-limit`, `block-10-6-tool-trace`, `block-10-1-refresh-reask`, `block-10-2-ai-cost-cap` (all ≤28 chars per Block 9 carry-forward convention) |
| Base | `main` at `26c50eb` (post Block 9 close + HANDOFF closeout commit on 2026-05-17) |
| Sub-task count | 6 |
| Decisions | A–Q (17 locked decisions) |
| Verification cells | 32 (across 6 matrices) |
| Carve-out posture | DEFAULT for all server/schema/pricing commits; AUTO for UI-only commits |

**Phase 0 prerequisite:** `origin/main` at `26c50eb`. Local main matches.
Working tree clean except untracked `scripts/delete-all-projects.sql`
(Jenny's working file). No state contradiction surfaced.

---

## Context

Block 9 ff-merged on 2026-05-17 with five launch-blocking polish items
(connection management UI, "data as of" citation freshness, suggested
example questions, nightly cron, content-hash redesign for accurate
records_skipped accounting). Production is at `f4c06f4` (code); main is
at `26c50eb` (post-closeout HANDOFF); nightly cron fires at 08:00 UTC.

Block 10 is the **last block before v1.1 ships.** Per BUILD_PLAN.md:161
it holds the six **nice-to-have** polish items — features that improve
the product but are not load-bearing for a non-Jenny user to onboard.
Monday + Drive connectors and cross-project mode remain deferred to v1.2
per PRD §11.

The six sub-tasks address the polish layer above "non-Jenny user can
onboard": cost discipline (10.2 + 10.3), action affordances on AI
answers (10.1 + 10.6), infra robustness (10.5), and the v1.2 onboarding
substrate (10.4).

## Goal

Ship the six nice-to-have polish items so v1.1 ships with cost
discipline guaranteed (per-project monthly cap + daily message limit),
debuggable AI answers (admin-only trace viewer + refresh-and-re-ask
member action), embed-sweep that doesn't trip the Workers subrequest
cap, and a connector-onboarding guide that doubles as the v1.2
scaffold prompt.

**Done when:** Per-project monthly AI cost is bounded (default $50 cap,
configurable per project, admin emailed at 80% + 100%); daily message
limit (100/day) returns a friendly message instead of running up the
bill; admins can see which tools fired on each answer; members can
refresh-and-re-ask with a 5/hour-per-project guard; the embed sweep
processes 50 entities per Workers subrequest instead of 50; and a
`docs/CONNECTORS.md` exists that's good enough to drive the v1.2 Monday
+ Drive Cursor sessions.

---

## Sub-task scope

| Sub-task | One-liner | Surface |
|---|---|---|
| **10.5** | Sweep-path batching: 50 OpenAI subrequests per sweep → 1 | `_shared/entity_writer.js` + new `_shared/sweep_missing_embeddings.js` + `slack.js` + `jira.js` |
| **10.4** | "How to add a new connector" guide | New `docs/CONNECTORS.md` |
| **10.3** | Daily message limit: 100/24h per project | `functions/api/projects/[id]/conversations/[conversationId]/messages.js` + 429 handler in `public/project.html` |
| **10.6** | Admin-only tool-call trace viewer | `messages.js` GET response + UI render in `public/project.html` + CSS |
| **10.1** | Member "refresh and ask again" action | New endpoint at `messages/[msgId]/refresh-and-ask-again` + new shared runner + new `refresh_actions` table + UI in `public/project.html` |
| **10.2** | Per-project AI cost cap with admin notification | New `projects.ai_monthly_cap_usd` + `messages.cost_usd` columns + new `functions/_lib/ai/pricing.js` + new `functions/_lib/admins.js` + `email.js` template + pre-check in `messages.js` + paused UI |

---

## Locked decisions

Letters A–Q; cite in commit messages as `feat(block-10-N): … per decision <letter>`.

### 10.1 — Refresh-and-ask-again

**A. Refresh granularity: full `incrementalSync()` on each cited connection.** Per Explore Agent A findings: connectors expose only `incrementalSync(ctx, connection)` and `fullSync()` (per `functions/_lib/connectors/types.js:150-180`). There is no per-entity refetch method on any connector. "Targeted refresh of cited sources" must therefore mean `incrementalSync()` on each cited connection. The cited entities will be in the new data, and others will too — harmless because Block 9.5's content-hash gate skips no-op writes. Per-entity refresh is a Block 11+ feature (would require new connector methods + JQL `issuekey IN(...)` + Slack `conversations.history` with `oldest=ts` per-message lookups). Documented in `Risks` below.

**B. Rate-limit storage: new `refresh_actions` table.** Tracks the user action, distinct from the connector-level `sync_runs` rows it triggers. Schema:

```sql
CREATE TABLE refresh_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  new_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  error TEXT,
  triggered_sync_run_ids UUID[] NOT NULL DEFAULT '{}'
);
CREATE INDEX refresh_actions_user_project_recency_idx
  ON refresh_actions (user_id, project_id, started_at DESC);
```

Clean separation from `sync_runs` (which would otherwise need a NULLable `user_id` only set for one mode). The triggered sync_runs are still recorded normally; we link via `triggered_sync_run_ids` for forensics. **DDL applied by Jenny in Neon SQL Editor before code deploys (no production DDL by Claude — WORKFLOW §Hard limits).**

**C. UI placement: button in citation rail, admin+member.** Per PRD §5.6 ("Members can use a 'refresh and ask again' action"); placement matches the spec ("on any AI response"). Rendered by extending `renderCitationRailHtml()` at `public/project.html:711-729`. Label: `↻ Refresh & re-ask`. In-flight disabled state with label `Refreshing…`. Toast on 429 (reuses 9.1's container).

**D. Rate limit scope: per (user, project) pair, 5/hour.** PRD §5.6 says "5 per user per hour"; the (user, project) scope matches the projects-as-tenants model. Rate-limit query:
```sql
SELECT COUNT(*) AS recent FROM refresh_actions
 WHERE user_id = ${userId} AND project_id = ${projectId}
   AND started_at > NOW() - INTERVAL '1 hour'
   AND status IN ('running','succeeded','failed')
```
If `recent >= 5`, return 429 with the same shape as Block 9.1's sync.js rate-limit response (`ok:false`, `error`, `retry_after_seconds`, `next_available_at`). **Defense in depth — keep both `user_id` AND `project_id` in the WHERE clause** per Block 9.1's belt-and-suspenders precedent at `sync.js:117-123`.

**Endpoint flow:** `POST /api/projects/:id/conversations/:convId/messages/:msgId/refresh-and-ask-again`. (1) `requireProjectRole` (member or admin); (2) load source message — reject if not role='assistant' or no citations; (3) derive distinct cited connection_ids via project-scoped JOIN through entities → connections; (4) rate-limit check per D; (5) insert `refresh_actions` row, status='running'; (6) for each cited connection, run `incrementalSync()` via connector registry with isolated try/catch (same per-connection-failure-isolation contract as 9.4 decision U); (7) recover original user message via `iteration = N-1` on same conversation; (8) reconstruct `priorMessages` from conversation history up to and including that user message; (9) call `runAgent()`; (10) persist via existing `db_turns` path; (11) UPDATE `refresh_actions` to succeeded/failed with new_message_id + triggered_sync_run_ids; (12) return new message in standard POST `/messages` shape.

### 10.2 — Per-project AI cost cap

**E. Default cap: $50 USD/project/month, configurable per-project via `projects.ai_monthly_cap_usd DECIMAL(10,2) DEFAULT 50.00`.** Sonnet 4.5 at ~$3 input / $15 output per million tokens. A heavy project hitting 100 msgs/day with ~5K input + 1K output per message ≈ $3/day ≈ $90/month. $50 is a real cap that bites; v1.1 ships the value as default and the column as the configuration surface. Admin UI for setting per-project cap is a Block 11+ item (v1.1 admins change via Neon SQL Editor, Jenny-mediated).

**F. Over-cap behavior: refuse + auto-resume at month boundary.** PRD §8.2 says "queues for next cycle" but a true queue (queue table, scheduled drain, charge-replay discipline) is heavy v1.2-territory work. Refusing with 429 carrying a clear `resets_at` ISO timestamp satisfies PRD §8.1's "friendly cap message" alternative wording without the queue mechanics. Auto-resume happens implicitly via the `DATE_TRUNC('month', NOW())` boundary in the SUM query — month rollover makes the cap counter snap to $0.

```json
{
  "ok": false,
  "error": "AI is paused for this project — monthly budget reached.",
  "cap_usd": 50.00, "used_usd": 50.04,
  "resets_at": "2026-06-01T00:00:00Z"
}
```

**G. Cost backfill: backfill `cost_usd` from existing `input_tokens / output_tokens / model` on existing message rows.** Token counts are already persisted on `messages` (per Explore Agent B findings: `messages.input_tokens` + `messages.output_tokens` + `messages.model` populated by `loop.js:235-236` and persisted by `messages.js:367-384`). One UPDATE statement after the column is added:

```sql
UPDATE messages
   SET cost_usd = (
     CASE model
       WHEN 'anthropic/claude-sonnet-4-5' THEN (input_tokens * 3.00 + output_tokens * 15.00) / 1000000.0
       WHEN 'anthropic/claude-haiku-4-5'  THEN (input_tokens * 0.25 + output_tokens * 1.25) / 1000000.0
       WHEN 'openai/text-embedding-3-small' THEN (input_tokens * 0.02) / 1000000.0
       ELSE NULL
     END
   )
 WHERE cost_usd IS NULL AND model IS NOT NULL;
```

Honest accounting from day one; the May 2026 cap counter starts at the real month-to-date cost, not $0. Jenny runs this in Neon SQL Editor as part of the same DDL apply.

**H. Admin notification: 80% warning + 100% pause emails via Resend, idempotent per month.** Reuse `functions/_lib/email.js` shape. New template `sendCostCapEmail(env, projectName, capUsd, usedUsd, kind: 'warning'|'paused', adminEmails: string[])`. Idempotency via `projects.ai_cap_warned_at` column (set after first warning email each month; cleared at month boundary by being older than `DATE_TRUNC('month', NOW())`). Pause email sent once when first crossing $cap; same idempotency key. Admin emails resolved via new `functions/_lib/admins.js` helper that crosses the Postgres ↔ D1 seam (project_members → user_id → D1 users → email).

**I. Pricing constants: new `functions/_lib/ai/pricing.js` with SECURITY-CARVE-OUT header.** Single source of truth for token rates per model:

```js
// SECURITY-CARVE-OUT: cost-cap-affecting constants
// Changes here directly affect every project's monthly cap math.
// Source: Anthropic + OpenAI public pricing pages. Verify before
// changing — a typo here misrepresents every project's spend.

export const TOKEN_PRICES_USD_PER_MILLION = {
  'anthropic/claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'anthropic/claude-haiku-4-5':  { input: 0.25, output: 1.25  },
  'openai/text-embedding-3-small': { input: 0.02, output: 0 },
};

export function computeCostUsd(model, inputTokens, outputTokens) {
  const p = TOKEN_PRICES_USD_PER_MILLION[model];
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
```

**Pre-check flow** (in `messages.js` immediately before `runAgent` call at line ~330):
```js
const [usage] = await sql`SELECT COALESCE(SUM(cost_usd), 0) AS month_cost_usd FROM messages WHERE project_id = ${projectId} AND created_at >= DATE_TRUNC('month', NOW()) AND deleted_at IS NULL`;
const [proj] = await sql`SELECT ai_monthly_cap_usd, ai_cap_warned_at FROM projects WHERE id = ${projectId}`;
if (usage.month_cost_usd >= proj.ai_monthly_cap_usd) {
  // 100% pause email (idempotent via ai_cap_warned_at < first of month)
  await maybeNotifyAdminsCostCap(env, sql, projectId, 'paused', proj.ai_monthly_cap_usd, usage.month_cost_usd);
  return json({ ok: false, error: 'AI is paused for this project — monthly budget reached.', cap_usd: proj.ai_monthly_cap_usd, used_usd: usage.month_cost_usd, resets_at: firstOfNextMonthIso() }, { status: 429 });
}
if (usage.month_cost_usd >= 0.8 * proj.ai_monthly_cap_usd) {
  await maybeNotifyAdminsCostCap(env, sql, projectId, 'warning', proj.ai_monthly_cap_usd, usage.month_cost_usd);
}
```

**Persist-cost flow** in `messages.js:367-384`: extend the INSERT to include `cost_usd = computeCostUsd(model, input_tokens, output_tokens)`. Loop.js's `db_turns` array already carries `model` + tokens per turn.

### 10.3 — Daily message limits

**J. Default cap: 100/day per project, hardcoded.** PRD §8.1 explicitly states "100" and does not mark it "configurable." Adding a `projects.daily_msg_cap` column is Block 11+ if needed. Constant lives in `messages.js` as `const DAILY_MSG_CAP = 100;`.

**K. Over-cap behavior: refuse with friendly 429.** PRD §8.1 explicitly offers "queue or return a friendly cap message" — the friendly-message path is on-spec.

Pre-check (in `messages.js` immediately after the 10.2 cost-cap check, before `runAgent`):
```sql
SELECT COUNT(*) AS today_user_msgs FROM messages
 WHERE project_id = ${projectId}
   AND role = 'user'
   AND created_at > NOW() - INTERVAL '24 hours'
   AND deleted_at IS NULL
```
If `today_user_msgs >= 100`, return 429:
```json
{
  "ok": false,
  "error": "You've reached the daily message limit for this project (100 per 24 hours).",
  "retry_after_seconds": <until oldest qualifying message ages out>
}
```

Existing index `messages_project_recency_idx` at schema:556 supports this query.

### 10.4 — Connector guide

**L. Doc location: new `docs/CONNECTORS.md` at repo root.** `docs/` directory doesn't exist yet — first file there. Audience: future Jenny + Claude in v1.2 Monday + Drive sessions; secondary: any future contributor.

**Outline (locked, ~12 sections):**
1. Connector interface contract — reference `functions/_lib/connectors/types.js`
2. OAuth callback pattern (Slack + Jira flows)
3. Webhook handler pattern (Slack Events API)
4. fullSync vs incrementalSync conventions; cursor-based state on `connection.last_sync_cursor`
5. Credential encryption/decryption helper (Block 3 `crypto.js`)
6. Entity upsert + embedding flow — when to use `writeEntityWithEmbedding` vs `writeEntitiesWithEmbeddingsBatch` vs the new `embedEntitiesBatch` (from 10.5)
7. Content-hash gate in `entity_writer.js` (Block 9.5 redesign) — canonical fields + what to exclude (`raw`)
8. Sweep path expectations (post-10.5: shared `sweep_missing_embeddings.js` helper)
9. SQL view pattern (`jira_issues`, `slack_messages` as references)
10. AI tool registration pattern (`tools.js` registry, schemas, `project_id` enforcement)
11. sync_runs contract (what the orchestrator writes vs what the connector returns)
12. Test posture (curl matrix shape, content-hash determinism V5-7 precedent)
13. Connector checklist — runnable "did I do all 12?" list

### 10.5 — Sweep-path batching

**M. New helper `embedEntitiesBatch(env, sql, entities)` in `_shared/entity_writer.js`.** Extracts steps 3 + 4 of `writeEntitiesWithEmbeddingsBatch` (the embedding compute + UPSERT) without the entity-write half (which sweep doesn't need since entities already exist):

```js
export async function embedEntitiesBatch(env, sql, entities) {
  const toEmbed = entities.filter(e => e.content_text);
  if (toEmbed.length === 0) return { embedded: 0, skipped: 0 };
  const texts = toEmbed.map(e => e.content_text);
  const vectors = await embedTextsBatch(env, texts);
  const rows = toEmbed.map((e, i) => ({
    entity_id: e.id, model: EMBED_MODEL, chunk_index: 0, embedding: vectors[i]
  }));
  await sql`INSERT INTO entity_embeddings ${sql(rows)}
            ON CONFLICT (entity_id, model, chunk_index)
            DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = NOW()`;
  return { embedded: toEmbed.length, skipped: entities.length - toEmbed.length };
}
```

One OpenAI subrequest per sweep invocation (was 50). Free-tier subrequest cap (50/invocation per `entity_writer.js:253` comment) is no longer a sweep concern.

**N. Refactor: extract duplicated sweep to `_shared/sweep_missing_embeddings.js`.** Per Explore Agent C: `slack.js:646-682` and `jira.js:438-474` are byte-identical except for the `connection.source` filter (which the SQL already filters by `connection_id`). Extracting removes ~80 lines of duplication and means future v1.2 connectors (Monday + Drive) get the sweep for free. Signature:

```js
export async function sweepMissingEmbeddings(env, sql, connection) {
  const rows = await sql`
    SELECT e.id, e.content_text FROM entities e
    LEFT JOIN entity_embeddings ee ON ee.entity_id = e.id
      AND ee.model = ${EMBED_MODEL} AND ee.chunk_index = 0
    WHERE e.connection_id = ${connection.id}
      AND ee.id IS NULL
      AND e.content_text IS NOT NULL
      AND e.content_text != ''
    ORDER BY e.created_at DESC LIMIT 50
  `;
  if (rows.length === 0) return { embedded: 0, skipped: 0 };
  return await embedEntitiesBatch(env, sql, rows);
}
```

Slack + Jira call sites (`slack.js:615`, `jira.js:689`) swap their inline definition + invocation for the shared import.

### 10.6 — Tool-call trace viewer

**O. Visibility: admin-only.** Gate via existing `const isAdmin = !!(me && me.is_admin);` pattern at `project.html:1607`. Members see clean answers; admins see the diagnostic trace. Matches Block 9.1's admin-only "Sync now" / "View activity" pattern. Server-side: `messages.js` GET filters `role='tool'` and `tool_calls`-bearing assistant rows out of the response when the requester is non-admin (project-isolation neighborhood adjacent — extra payload, extra defense).

**P. Render shape: compact tool name + result status + truncated error.** For each assistant message with `tool_calls?.length > 0`, render a collapsed `<details>` between the message text and citation rail:

```html
<details class="tool-trace">
  <summary>🔧 3 tool calls (1 failed)</summary>
  <ul>
    <li><span class="tool-trace-name">query_jira_issues</span> <span class="tool-trace-result ok">✓</span></li>
    <li><span class="tool-trace-name">search_project_data</span> <span class="tool-trace-result ok">✓</span></li>
    <li><span class="tool-trace-name">aggregate_jira</span> <span class="tool-trace-result err">⚠️ tool_execution_failed: <truncated to 200 chars></span></li>
  </ul>
</details>
```

Tool result matched to its tool_use by `tool_use_id` (already in the persisted shape per `f7fc540`). Tool result lookup needs both the assistant message and the corresponding `role='tool'` row — the GET endpoint must include role='tool' rows in its response (currently filtered) when caller is admin.

Args are hidden in v1.1 (kept compact + dodges revealing internal query construction patterns to admins who shouldn't need them at a glance). Block 11+ can add an "expand args" toggle if forensic value materializes.

### Sub-task sequencing

**Q. Sequence: 10.5 → 10.4 → 10.3 → 10.6 → 10.1 → 10.2.**

| Order | Branch | Why this slot |
|---|---|---|
| 1 | `block-10-5-sweep-batching` | Smallest, well-scoped, Block 6 carry-forward. Fixes a latent prod issue (subrequest cap on large recoveries) without surface changes. Good warm-up to re-engage with `_shared/entity_writer.js` post-9.5. |
| 2 | `block-10-4-connector-guide` | Pure docs, AUTO mode, no code risk. Drafting after 10.5 means the guide can reference the new `embedEntitiesBatch` + `sweepMissingEmbeddings` helpers as canonical. |
| 3 | `block-10-3-daily-msg-limit` | Establishes the 429-on-message-POST pattern that 10.2 will extend with cost-cap 429s. Smaller of the two gating sub-tasks. |
| 4 | `block-10-6-tool-trace` | UI-only on existing persisted data. Independent of all other sub-tasks. Lands here so the chat UI is stable for 10.1's button changes. |
| 5 | `block-10-1-refresh-reask` | Larger surface (new endpoint + new schema + new UI). Lands after the chat UI hardens via 10.6. Reuses 10.3's 429 handler pattern. |
| 6 | `block-10-2-ai-cost-cap` | Largest, most novel surface (pricing constants, admin email path, cross-DB stitch, schema, pre-check, paused UI). Lands last so the rest of Block 10's polish is already in production for cost-cap testing under real load. Also: shipping 10.2 last means the 80%-warning email's "you're 80% of your $50/mo cap" message is honest from day one (10.2's cost backfill per G ensures the May-2026 month is accurate). |

All six branches base off main, ff-merged in order. Branches do NOT rebase onto each other — each is a standalone fast-forward from the post-merge tip of the previous one. Standard WORKFLOW shape per branch (branch → preview → verification matrix → ff-merge to local main → push approval).

---

## File-level change list

The scope contract per WORKFLOW.md §"Scope expansion during execute" —
any file edit outside this list stops execute and surfaces.

### Branch `block-10-5-sweep-batching`

- **`functions/_lib/connectors/_shared/entity_writer.js`** *(modified, DEFAULT)*
  - Add `embedEntitiesBatch(env, sql, entities)` helper per decision M. Reuses existing `embedTextsBatch` from the file.
- **`functions/_lib/connectors/_shared/sweep_missing_embeddings.js`** *(new, DEFAULT)*
  - Per decision N. SECURITY-CARVE-OUT header (embed-on-write neighborhood by inception). Exports `sweepMissingEmbeddings(env, sql, connection)`.
- **`functions/_lib/connectors/slack.js`** *(modified, DEFAULT)*
  - Remove inline `sweepMissingEmbeddings` definition (lines 646-682). Replace call at line 615 with `await sweepMissingEmbeddings(env, sql, connection)`.
- **`functions/_lib/connectors/jira.js`** *(modified, DEFAULT)*
  - Same as Slack. Remove lines 438-474; replace call at line 689.

### Branch `block-10-4-connector-guide`

- **`docs/CONNECTORS.md`** *(new, AUTO)*
  - Per decision L outline. ~400-600 lines markdown. Cites file paths + line numbers throughout.
- **`docs/`** directory created implicitly via the file write.

### Branch `block-10-3-daily-msg-limit`

- **`functions/api/projects/[id]/conversations/[conversationId]/messages.js`** *(modified, DEFAULT)*
  - Add `DAILY_MSG_CAP = 100` constant + pre-check before `runAgent` per decisions J + K. Returns 429 with `retry_after_seconds`.
- **`public/project.html`** *(modified, AUTO)*
  - 429 error rendering on message POST — render `error` field into existing `#chatError` div with auto-dismiss after the retry window.

### Branch `block-10-6-tool-trace`

- **`functions/api/projects/[id]/conversations/[conversationId]/messages.js`** *(modified, DEFAULT)*
  - Modify GET handler: when caller `me.is_admin`, include role='tool' rows in response AND include `tool_calls` JSONB field on assistant messages. Filter both out for non-admin per decision O.
- **`public/project.html`** *(modified, AUTO)*
  - New `renderToolTraceHtml(assistantMsg, toolMsgs)` per decision P. Modify `renderMessages()` at line 656-666 to NOT filter role='tool' when admin (keep in cache for matchup); modify `renderMessageHtml()` at line 681-709 to invoke tool-trace render between text and citation rail.
- **`public/auth.css`** *(modified, AUTO)*
  - `.tool-trace`, `.tool-trace > summary`, `.tool-trace-name`, `.tool-trace-result.ok`, `.tool-trace-result.err` styles.

### Branch `block-10-1-refresh-reask`

- **`db/schema-postgres.sql`** *(modified, DEFAULT)*
  - Add `refresh_actions` table + `refresh_actions_user_project_recency_idx` per decision B. **Jenny applies DDL via Neon SQL Editor before preview deploy** (no production DDL by Claude per WORKFLOW Hard limits).
- **`functions/api/projects/[id]/conversations/[convId]/messages/[msgId]/refresh-and-ask-again.js`** *(new, DEFAULT)*
  - New endpoint per decisions A + B + C + D. Imports `runAgent` from `_lib/ai/loop.js` and `getConnector` from `_lib/connectors/registry.js`. Wraps per-connection sync in try/catch (decision A failure isolation).
- **`functions/_lib/agent/refresh_runner.js`** *(new, DEFAULT)*
  - Shared utility extracted from the endpoint for future reuse (e.g., cron-driven refresh in v1.2). `runRefreshAction({env, sql, projectId, userId, sourceMessage}) → { newMessage, syncRunIds, error }`.
- **`public/project.html`** *(modified, AUTO)*
  - Modify `renderCitationRailHtml()` at lines 711-729 per decision C: append `↻ Refresh & re-ask` button on assistant messages with citations. Add `handleRefreshAndReask(messageId)` handler. Toast on 429.
- **`public/auth.css`** *(modified, AUTO)*
  - `.refresh-reask-button`, `.refresh-reask-button[disabled]`, `.refresh-reask-button.in-flight` styles.

### Branch `block-10-2-ai-cost-cap`

- **`db/schema-postgres.sql`** *(modified, DEFAULT)*
  - Add `projects.ai_monthly_cap_usd DECIMAL(10,2) NOT NULL DEFAULT 50.00` per decision E.
  - Add `projects.ai_cap_warned_at TIMESTAMPTZ` per decision H.
  - Add `messages.cost_usd DECIMAL(10,6)` per decision G.
  - **Jenny applies DDL + backfill UPDATE in Neon SQL Editor** before preview deploy.
- **`functions/_lib/ai/pricing.js`** *(new, DEFAULT)*
  - Per decision I. SECURITY-CARVE-OUT header. Exports `TOKEN_PRICES_USD_PER_MILLION` + `computeCostUsd(model, inputTokens, outputTokens)`.
- **`functions/_lib/admins.js`** *(new, DEFAULT)*
  - Cross-DB admin email lookup helper. `getAdminEmailsForProject(env, sql, projectId) → string[]`. Queries Postgres for admin user_ids, then D1 `users` table for emails. Single seam for the cross-DB stitch.
- **`functions/_lib/email.js`** *(modified, DEFAULT)*
  - Add `sendCostCapEmail(env, projectName, capUsd, usedUsd, kind: 'warning'|'paused', adminEmails: string[])`. Reuses existing Resend-call shape from `sendPasswordResetEmail`.
- **`functions/api/projects/[id]/conversations/[conversationId]/messages.js`** *(modified, DEFAULT)*
  - Add cost-cap pre-check per decision F + admin-notification trigger per decision H, immediately before `runAgent`. Order: cost-cap check → daily-msg-limit check (from 10.3) → `runAgent`. Modify INSERT in db_turns persistence (line 367-384) to include `cost_usd = computeCostUsd(model, input_tokens, output_tokens)`.
- **`functions/_lib/ai/loop.js`** *(modified, DEFAULT)*
  - Add `cost_usd` to the per-turn db_turns shape (computed via `computeCostUsd`). Adds the field at the loop level so messages.js INSERT is straightforward.
- **`public/project.html`** *(modified, AUTO)*
  - Render "AI paused" empty-state on chat input when latest POST returned 429 with `error.includes('budget reached')`. Disabled send button + helpful message with `resets_at` rendered relative.

---

## Verification matrix

32 cells total, 6 sub-matrices. Per WORKFLOW §"Mockup and preview
review": Claude runs the matrix automatically AND surfaces the preview
URL for Jenny's manual eyeball before each push-to-main request.

### 10.5 verification (4 cells)

| # | Cell | Expect |
|---|---|---|
| V5.1 | Sweep one connection with 50+ NULL-embedding entities | One sweep invocation: subrequest count = 1 (was up to 50). Add temporary `console.log` counter in `embedTextsBatch` to confirm. |
| V5.2 | Sweep produces same embedded rows as pre-10.5 path | Pre-10.5 sweep: insert 50 entity_embeddings rows. Post-10.5 sweep over same input: insert 50 entity_embeddings rows with same `embedding` vectors (deterministic for same `text-embedding-3-small` input). |
| V5.3 | Sweep skips entities with empty `content_text` | Insert 5 entities, 2 with empty `content_text`. Sweep returns `{embedded: 3, skipped: 2}`; only 3 entity_embeddings rows created. |
| V5.4 | Sweep idempotent on re-run | Run sweep twice back-to-back; second run returns `{embedded: 0, skipped: 0}` (LEFT JOIN filter excludes already-embedded rows). |

### 10.4 verification (2 cells)

| # | Cell | Expect |
|---|---|---|
| V4.1 | `docs/CONNECTORS.md` renders cleanly | Cat the file; markdown linter (`mdl` or `markdownlint`) clean; opens in GitHub-style markdown without broken structure. |
| V4.2 | Every code reference link resolves | Grep the markdown for `functions/`, `public/`, `db/` paths + line numbers; each path exists at HEAD; each named function exists at the referenced line ±10 (line drift tolerance). |

### 10.3 verification (5 cells)

| # | Cell | Expect |
|---|---|---|
| V3.1 | 100th user message succeeds | Send 100 user messages in 24h window; 100th returns 200 normally. |
| V3.2 | 101st user message returns 429 | 101st send returns 429 with `error` containing "100 per 24 hours" and `retry_after_seconds > 0`. |
| V3.3 | retry_after_seconds matches oldest qualifying message | At cap, `retry_after_seconds ≈ (24h - age_of_oldest_user_msg)`. Within ±60s tolerance. |
| V3.4 | 24h boundary auto-resume | Synthetic test on Neon scratch: insert 100 user msgs dated `NOW() - 25 hours`; send 1 new msg → 200 (none of the historical msgs count). |
| V3.5 | UI renders friendly 429 message | Trigger 429 on preview; chat-error div shows the friendly message; chat input not permanently disabled (just blocked until window passes). |

### 10.6 verification (4 cells)

| # | Cell | Expect |
|---|---|---|
| V6.1 | Admin sees trace on assistant messages with tool_calls | Open project as admin; assistant messages with `tool_calls?.length > 0` render `<details>` element with tool list. |
| V6.2 | Member does NOT see trace | Open same project as member; assistant messages render without the `<details>` element. GET response from server does NOT include role='tool' rows or `tool_calls` JSONB. |
| V6.3 | Failed tool renders error correctly | Trigger a tool failure (e.g., revoke Jira token mid-conversation); next message's trace shows `⚠️ tool_execution_failed: <error_message>` with the error from `f7fc540`'s persisted payload. |
| V6.4 | Successful tool renders ✓ | Normal assistant response: each tool entry shows `✓`. Summary line shows "N tool calls (0 failed)". |

### 10.1 verification (8 cells)

| # | Cell | Expect |
|---|---|---|
| V1.1 | Button renders on assistant messages with citations | Refresh button visible in citation rail of every assistant message with `citations.length > 0`. NOT visible on messages with empty citations or role='user'. |
| V1.2 | Click triggers POST to refresh endpoint | Click button → POST `/api/projects/:id/conversations/:convId/messages/:msgId/refresh-and-ask-again` with empty body. |
| V1.3 | Rate limit (5/hour per user+project) returns 429 | curl the endpoint 5 times back-to-back as same user/project → 5th succeeds (or fails depending on prior calls); 6th returns 429 with `retry_after_seconds`. |
| V1.4 | Cross-project deny | curl endpoint with message_id from project A while authed for project B → 403 or 404. |
| V1.5 | Original user message recovered | Insert refresh_actions row + trigger refresh; verify the new assistant message's `priorMessages` array contained the original user message text (via temporary log in `loop.js`). |
| V1.6 | Refresh runs incrementalSync per cited connection | Source message cites Slack + Jira; after refresh, 2 new sync_runs rows with `sync_mode='incremental'` and `started_at` within last minute. refresh_actions row's `triggered_sync_run_ids` contains both. |
| V1.7 | New assistant message persisted with citations | After refresh succeeds, new assistant message exists in conversation, citations populated, refresh_actions.new_message_id set. |
| V1.8 | Failure isolation: one bad connection doesn't block others | Revoke Slack token; trigger refresh on a Slack+Jira citation. Slack sync_run = failed; Jira sync_run = succeeded; refresh_actions.status = succeeded (refresh didn't block on Slack); new answer cites the Jira data only. |

### 10.2 verification (9 cells)

| # | Cell | Expect |
|---|---|---|
| V2.1 | cost_usd computed correctly on persist | Send a message; SELECT cost_usd FROM messages WHERE id=last; value matches `(input_tokens * 3 + output_tokens * 15) / 1M` for sonnet-4-5. |
| V2.2 | Backfill UPDATE populates existing messages | Run backfill SQL; verify all messages with `model IS NOT NULL` now have `cost_usd IS NOT NULL`. |
| V2.3 | Month-to-date SUM matches sum-of-cost | `SELECT SUM(cost_usd) FROM messages WHERE project_id=$1 AND created_at >= DATE_TRUNC('month', NOW())` matches manually computed sum from `(model, input_tokens, output_tokens)` of qualifying rows. |
| V2.4 | 80%-warning email fires once per month | Set test project's cap to $0.10; send messages until 80% ($0.08) → expect one Resend API call with `kind='warning'`. Continue past 80% on more sends → no additional warning emails. |
| V2.5 | 100%-pause email fires once per month + 429 returned | Continue past 100% in V2.4 → one Resend API call with `kind='paused'` + message POST returns 429 with `cap_usd`, `used_usd`, `resets_at`. |
| V2.6 | Month-boundary auto-resume | Synthetic test: set `ai_cap_warned_at` to last month; send message at $0 month-to-date → succeeds normally; `ai_cap_warned_at` updates fresh if next warning fires. |
| V2.7 | Cross-project cap leak (paranoid) | Project A at cap ($50/$50), project B at $0. POST message to project B → 200 (no cap leak from A). Verify via console.log of project_id in the SUM query. |
| V2.8 | Paused UI renders correctly | Push project past cap. Reload project page; chat input disabled with "AI paused — resets at <date>" message. |
| V2.9 | Per-project cap configurable | UPDATE projects SET ai_monthly_cap_usd = 10 WHERE id = test-project. Verify next message-POST uses $10 as the cap, not $50 default. |

---

## Per-commit mode classification

Per WORKFLOW.md §"Carve-out neighborhoods" — freshness-layer +
project-isolation + cost-affecting neighborhoods get **DEFAULT mode (no
auto)**.

| Branch | Lead commit | Mode | Why |
|---|---|---|---|
| `block-10-5-sweep-batching` | All entity_writer + sweep edits | **DEFAULT** | Embed-on-write neighborhood; SECURITY-CARVE-OUT files |
| `block-10-4-connector-guide` | `docs/CONNECTORS.md` write | AUTO | Doc-only |
| `block-10-3-daily-msg-limit` | messages.js pre-check + 429 | **DEFAULT** | Gating message POST; project-isolation adjacent |
| `block-10-3-daily-msg-limit` | UI 429 handler in project.html | AUTO | UI-only on existing payload shape |
| `block-10-6-tool-trace` | messages.js GET include role='tool' | **DEFAULT** | Project-isolation surface change (more data per response) |
| `block-10-6-tool-trace` | UI render + CSS | AUTO | UI-only, admin-gated, reads existing fields |
| `block-10-1-refresh-reask` | schema + endpoint + runner + connector orchestration | **DEFAULT** | New auth surface + new schema + cross-connector orchestration |
| `block-10-1-refresh-reask` | UI button + handler + CSS | AUTO | UI-only on existing render path |
| `block-10-2-ai-cost-cap` | All commits | **DEFAULT** | Cost-cap-affecting constants (pricing.js carve-out), cross-DB admin lookup, schema, pre-check, money in the loop |

Plan top-line per branch (per WORKFLOW.md §"Carve-out neighborhoods"):
- `block-10-5`: `Execute mode: DEFAULT (security carve-out — embed-on-write)`
- `block-10-4`: `Execute mode: AUTO (doc-only)`
- `block-10-3`: `Execute mode: MIXED — DEFAULT for messages.js, AUTO for UI`
- `block-10-6`: `Execute mode: MIXED — DEFAULT for messages.js GET shape, AUTO for UI`
- `block-10-1`: `Execute mode: DEFAULT (new auth surface + new schema)`
- `block-10-2`: `Execute mode: DEFAULT (security carve-out — cost-affecting constants + cross-DB admin lookup)`

---

## Out of scope

Belongs to Block 11+ or post-v1.1:

- **Real over-cap queue** (10.2/10.3). PRD §8.2 says "queues for next cycle"; v1.1 ships refuse + auto-resume at month/24h boundary per decision F + K. A true queue table + scheduled drain is v1.2+ work.
- **Configurable daily message cap** (10.3). PRD doesn't mark it configurable; ship hardcoded 100 per decision J.
- **Per-entity refresh** (10.1). Connectors expose only full `incrementalSync()` today (decision A). Per-entity refetch would need new connector methods + JQL `issuekey IN(...)` + Slack `conversations.history` with `oldest=ts` per-message lookups. Block 11+.
- **Cost-cap admin UI** (10.2). Setting `ai_monthly_cap_usd` per-project needs a settings panel; v1.1 admins change via Neon SQL Editor.
- **Tool-call replay** (10.6). Trace viewer is read-only forensics. Replay = 10.1 territory.
- **Audit log for cost-cap admin notifications** (10.2). Email-sent tracking is `ai_cap_warned_at` only (idempotency, not audit). Full audit = v1.2.
- **Tool-trace args + result body** (10.6). v1.1 ships compact form (name + status + error) per decision P. Args/body expand toggle = Block 11+ if needed.
- **15-min Jira incremental cron** (PRD §5.3). v1.1 ships nightly only (Block 9.4); 15-min is post-v1.1.

Carry-forward from Block 9 close (HANDOFF 2026-05-17) — NOT folded into Block 10:

- V4-4/V4-5/V4-6 cron-fire verification — between-blocks operational check.
- V1-1/V1-2/V1-3 rate-limit verification deferred from 9.1 — 10-min follow-on.
- V2-6 cross-project paranoid cell deferred from 9.2 — scratch exercise.
- Hook regex refinement on `deny-push-to-main.sh` — workflow infra.
- Branch-name ≤28-char convention — operational.
- WORKFLOW addendum candidates (4 items) — separate workflow rework session.

---

## Uncertainty list

Per WORKFLOW.md §Phase 1: "Explicit uncertainty list — 'I'm guessing at X, please confirm or correct in your review.'"

1. **Anthropic pricing accuracy (10.2 / decision I).** TOKEN_PRICES_USD_PER_MILLION values for Sonnet 4.5 ($3 input / $15 output per million) and Haiku 4.5 ($0.25 / $1.25 per million) are from public listings as of May 2026. Jenny should verify against her actual billing dashboard before committing the pricing.js file. If pricing changes mid-month, the constants are the only update needed — past `cost_usd` rows stay at the prior price (desirable for cap accuracy; new sends use the new price going forward).

2. **Month-boundary semantics (10.2 / decision F).** Using `DATE_TRUNC('month', NOW())` for SUM scope. Postgres uses session timezone for NOW(); Cloudflare Workers default to UTC. So "month" = UTC calendar month. A project hitting cap on May 31 UTC 23:59 auto-resumes at June 1 00:00 UTC. For PST admins (UTC-8), this is "May 31 4pm" their time — close enough for v1.1. If user feedback shows midnight-UTC reset cliff is jarring, Block 11 can switch to project-timezone-aware month boundaries.

3. **Cross-DB admin email stitch (10.2 / decision H).** Admins identified by `project_members.role='admin'` (Postgres); their emails live in D1 `users` table. The new `admins.js` helper crosses the seam. **No precedent for this stitch in the codebase yet.** D1 queries from Pages Functions are standard (`env.DB.prepare(...)`), but if D1 lookup latency spikes, cost-cap pre-check on every message POST would absorb it. **Mitigation:** admin lookup runs only AT cap-warning / cap-paused boundaries (idempotent via `ai_cap_warned_at`), not every send.

4. **`refresh_actions` cascade behavior (10.1 / decision B).** ON DELETE CASCADE from projects + conversations + source_message_id. If an admin hard-deletes a message that had refresh actions, the refresh_actions rows go away. Acceptable — forensic value of deleted-message refresh history is low for v1.1.

5. **Tool-trace performance (10.6 / decision O).** Including role='tool' rows in messages GET roughly 2-3× the payload size for tool-heavy conversations (one tool_use turn + one tool_result turn per iteration, up to 6 iterations × 2 = 12 extra rows per assistant response). Acceptable for v1.1 traffic (Jenny's project ≤100 messages); revisit if conversations grow much.

6. **`embedEntitiesBatch` partial-failure semantics (10.5 / decision M).** If `embedTextsBatch` returns N vectors but the batched INSERT fails (e.g., one malformed vector), the whole batch fails. Current per-row sweep would skip the bad one and continue. **Trade-off:** v1.1 favors the subrequest-budget fix over partial-failure resilience. Sweep runs again next sync; bad rows get retried then.

7. **`projects.ai_cap_warned_at` reset semantics (10.2 / decision H).** Reset to NULL at first of each month, OR check "older than DATE_TRUNC('month', NOW())" each time? **Proposed: check, not reset.** No background job needed; the column auto-becomes-stale at month boundary because the comparison `ai_cap_warned_at >= DATE_TRUNC('month', NOW())` flips to false. Means no scheduled-task dependency.

8. **D1 query mechanics from Pages Functions (10.2 / decision H).** Assume `env.DB.prepare(\`SELECT email FROM users WHERE id IN (?, ?, ...)\`).bind(...userIds).all()` works — verify the IN-list expansion pattern (D1's parameter binding may differ from Postgres). **Risk:** if D1 doesn't support IN-list expansion, fall back to per-user lookups (N queries) — still acceptable because admin lookup is rare.

---

## Risks

### 10.1

- **Targeted refresh runs full `incrementalSync()` on each cited connection.** A user-triggered refresh could re-pull many entities, not just the cited ones. **Mitigation:** Block 9.5's content-hash gate means re-sync is mostly skipped writes; OpenAI subrequest cost is ~0 because no new embeddings get computed for unchanged entities.
- **5-per-hour cap is per (user, project).** A user with 5 projects can refresh 25/hour total. Per decision D, this is acceptable — matches projects-as-tenants model.
- **Race between concurrent refreshes.** Two refreshes from same user on same project at `count = 4` could both pass the pre-check (each sees `4 < 5`) and together push to 6. Same overshoot pattern as Block 9.1's rate-limit. Accepted.

### 10.2

- **Mid-message cost-cap crossing.** A user request that costs $0.50 could push project from $49.80 to $50.30 — over cap. We only check pre-call. **Accepted** — cap is a budget guard, not a per-message budget.
- **Race between two simultaneous messages.** Two messages from different members at $49.80 could both pass pre-check (each sees $49.80) and together push to $51+. **Accepted** — rare; same overshoot pattern.
- **Admin email rotation.** If a project changes admins mid-month, the new admin won't receive a duplicate warning email (idempotent via `ai_cap_warned_at`). **Accepted** — new admin sees cap state via the paused UI.
- **Pricing constant drift after a model bump.** If Sonnet pricing changes silently, our cap math reflects old pricing until pricing.js is updated. **Mitigation:** documented in pricing.js SECURITY-CARVE-OUT header that pricing changes are the source of truth and need a PR.

### 10.3

- **24-hour rolling window vs calendar-day.** "Per day" in PRD interpreted as rolling 24h. Smoother UX (no midnight cliff) but slightly more cost than calendar-day. Accepted — matches Block 9.1's rate-limit shape.
- **No per-user message cap, only per-project.** One enthusiastic member can consume the entire project's daily budget. Accepted for v1.1; could add per-user-per-project layer in Block 11+.

### 10.4

- **Doc drift.** Code references can rot as the codebase evolves. **Mitigation:** guide cites file paths + line numbers explicitly so doc drift is visible during Block 11+ reviews. V4.2 verification cell catches the worst cases.

### 10.5

- **New helper introduces subtle bug.** Embedding INSERT shape changes from per-row to batched UPSERT with `entity_embeddings ON CONFLICT (entity_id, model, chunk_index)`. **Mitigation:** V5.1-V5.4 verification cells; preview-deploy smoke against real data before push.
- **`text-embedding-3-small` batch size cap.** OpenAI's API has a max-input-array limit (currently 2048). Sweep is capped at 50 by the existing query LIMIT — well under. Safe for v1.1.

### 10.6

- **Stale `messagesById` cache.** Client-side cache keyed by message ID; including tool rows now means cache size grows. **Accepted** — most conversations are small.
- **Admin gate bypass via direct API call.** A clever non-admin could curl the GET endpoint and parse the response. **Mitigation:** decision O explicitly puts the filter server-side too, not just client-side.

---

## Phase-1 exploration log (reference)

Three Explore agents (parallel) mapped:
- **Agent A:** Refresh-and-ask-again surface (10.1) — loop entry signature (`runAgent(env, sql, urlContext, priorMessages)` at `functions/_lib/ai/loop.js:181`), citation payload shape (post-9.2 enrichment: `entity_id, source, source_type, title, source_url, author, source_updated_at, connection_last_sync_at`), connector API (`incrementalSync(ctx, connection)` per `types.js:150-180` — no per-entity refetch), rate-limit pattern (`sync.js:108-139` at 9.1's 1/hour), UI render slot (`renderCitationRailHtml()` at `project.html:711-729`).
- **Agent B:** Cost cap + daily message limit surface (10.2 + 10.3) — token persistence (`messages.input_tokens/output_tokens/model` already populated by `loop.js:235-236`), Resend integration (`functions/_lib/email.js`), cross-DB stitch (project_members → user_id → D1 users → email), no existing cost schema or pricing constants, message POST endpoint at `messages.js:237-415` with `runAgent` call at line ~330.
- **Agent C:** Sweep batching + tool trace surface (10.5 + 10.6) — duplicated sweep code (`slack.js:646-682` ≡ `jira.js:438-474`), batched helper at `_shared/entity_writer.js:281-367`, `f7fc540` persists tool errors as `{ error: 'tool_execution_failed', tool_name, error_message }` in `tool_result` JSONB (500-char truncated), chat UI filters `role='tool'` at `project.html:663`, admin gate at `project.html:1607`.

Critical findings:
- Tool errors already persisted in `messages.tool_result` — 10.6 is surfacing only, not new persistence.
- Sweep code byte-duplicated — refactor opportunity per decision N.
- No usage/cost schema today — 10.2 is greenfield.
- Cross-DB admin email lookup is a new seam.
- Per-entity refresh in 10.1 not viable with current connector API (decision A locks the full-incremental fallback).

---

*End of BLOCK 10 plan draft.*
