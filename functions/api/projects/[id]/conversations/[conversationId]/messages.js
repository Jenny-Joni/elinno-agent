// functions/api/projects/[id]/conversations/[conversationId]/messages.js
//
// Block 2 Sub-task 2.4 — messages API.
//
// Routes (this file):
//   GET  /api/projects/:projectId/conversations/:conversationId/messages
//        → fetch all messages in the conversation, ordered created_at ASC.
//          Member-level access on the PROJECT, plus per-user scoping
//          (decision AC) on the conversation. Verifies conversation
//          belongs to the project AND to the session user before reading.
//
//   POST /api/projects/:projectId/conversations/:conversationId/messages
//        → send a message. Single round-trip per decision I:
//            1. validate content
//            2. verify conversation belongs to project + session user
//               (and capture current title for decision H)
//            3. if conversation title is still the default 'New conversation',
//               derive new title from content (decision H — see DECISION H
//               IMPLEMENTATION NOTE below)
//            4. insert messages row (role='user')
//            5. generate echo (decision I exact format)
//            6. insert second messages row (role='assistant')
//            7. update conversations.title + updated_at
//            8. return user_message + assistant_message + the
//               (possibly updated) conversation title (decision X)
//
// Two security guards apply on every request:
//   - requireProjectRole: 403-collapse on cross-project leakage
//     (handled one layer up by the helper)
//   - conversation-belongs-to-project AND conversation-belongs-to-user:
//     in-handler check via the SELECT at the top of each method;
//     403 on either failure (matches requireProjectRole's pattern of
//     collapsing all access-denied paths to 403, per PRD §10).
//
// SCHEMA NOTE — `messages.project_id` is denormalized:
//   The `messages` table has a NOT NULL `project_id` uuid column with no
//   default. It's redundant with `conversations.project_id` (every message
//   belongs to a conversation, every conversation belongs to a project),
//   but the schema (db/schema-postgres.sql, Block 1 Task 3) denormalizes
//   it onto `messages` so future query patterns — Block 5+ analytics over
//   "messages in this project," cross-conversation searches scoped to a
//   project, vector queries that join messages → entity_embeddings without
//   needing a 3-way join through conversations — can hit one index on
//   messages alone.
//
//   Both INSERTs below MUST populate project_id from `params.id`. Removing
//   it (e.g. as part of a "simplification" that just inserts the obvious
//   conversation-id-and-content tuple) reproduces the Block 2 Session 3
//   500-on-every-send bug. The Decision-H/I/X happy paths (matrix scenarios
//   2, 3, 4 of the trimmed verification) all break without it.
//
// DECISION H IMPLEMENTATION NOTE — title-state trigger, not message-count:
//   Decision H says auto-title fires "from first user message." The natural
//   reading is "count existing user messages, fire if zero." We tried that
//   first; it failed in production verification because Hyperdrive's query
//   result cache returns stale COUNT data. Replaced with a title-state check
//   (if title equals the default literal 'New conversation', this is the
//   first user-message-driven title-set; replace it). Sidesteps the COUNT
//   round-trip entirely.
//
//   Trade-off vs the count-based reading: in v1.1 the only thing that
//   mutates `conversations.title` is this auto-title logic, so "title is
//   default" and "no user messages yet" are equivalent. If a future Block
//   adds user-renameable conversations (Block 9 polish bucket), the
//   semantics shift slightly: a user who renames a conversation back to
//   the literal string 'New conversation' would re-trigger auto-title on
//   their next send. That's a stretch case the PRD doesn't address; Block 9
//   to revisit if it surfaces.
//
// HYPERDRIVE CACHING NOTE — disabled at the binding level for v1.1:
//   Hyperdrive's default-on query cache (60s TTL) plus unreliable
//   write-invalidation produced silent staleness on read-after-write —
//   the conv-guard SELECT below would return the pre-UPDATE `title`
//   on the second send, re-firing decision H's auto-title.
//
//   Resolved 2026-05-03 by disabling caching on the elinno-agent-
//   hyperdrive binding:
//     npx wrangler hyperdrive update 78af00bbf464468cb902e35099aa0dfe \
//                                    --caching-disabled true
//   Cost: ~10–50ms per query (every read round-trips to Neon Frankfurt).
//   Acceptable for v1.1 chat scale.
//
//   We initially tried a comment-form bypass marker
//   (`-- bypass Hyperdrive cache: NOW()`) on the affected SELECTs.
//   It didn't work — Hyperdrive's STABLE-function pattern detector
//   appears not to match function references inside SQL comments,
//   despite the docs reading as if it should. If a future block
//   re-enables caching for hot-path latency, use a *real* `NOW()`
//   reference inside the WHERE clause (e.g. `AND NOW() IS NOT NULL`)
//   on every read-after-write SELECT, not a commented marker.
//
//   Revisit before Block 5 when AI tool calls multiply read-after-
//   write volume.

import postgres from 'postgres';
import { error, json, requireProjectRole } from '../../../../../_lib/auth.js';
import { runAgent } from '../../../../../_lib/ai/loop.js';
import { computeCostUsd } from '../../../../../_lib/ai/pricing.js';
import { getAdminEmailsForProject } from '../../../../../_lib/admins.js';
import { sendCostCapEmail } from '../../../../../_lib/email.js';

// Decision G: literal default title set by the conversations POST handler
// at conversation creation. Decision H replaces this on the first user
// message — see DECISION H IMPLEMENTATION NOTE in the file header.
const DEFAULT_CONVERSATION_TITLE = 'New conversation';

// BLOCK_10_PLAN.md decision J: per-project daily user-message cap. Rolling
// 24-hour window (not calendar-day) to match Block 9.1's rate-limit shape
// and avoid a midnight-UTC reset cliff. Hardcoded per decision J — PRD
// §8.1 names "100" without marking it configurable. Promote to a column
// on projects only if v1.2 introduces per-project tuning.
const DAILY_MSG_CAP = 100;

// BLOCK_10_PLAN.md decision F: 80% threshold triggers the warning email.
// 100% triggers the pause email AND blocks the message POST with a 429.
const COST_WARNING_THRESHOLD = 0.80;

// First-of-next-month ISO string, used in the 429 resets_at field so the
// client UI can render a human countdown. UTC boundary by design (see
// BLOCK_10_PLAN.md uncertainty #2 — month is UTC-anchored).
function firstOfNextMonthIso() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed
  const next = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return next.toISOString();
}

// Decision H: first ~50 chars, truncate at word boundary, append "…" if truncated.
function deriveTitleFromMessage(content) {
  const trimmed = content.trim();
  if (trimmed.length <= 50) return trimmed;
  const window = trimmed.slice(0, 50);
  const lastSpace = window.lastIndexOf(' ');
  // If no space in the first 50 chars, hard-cut at 50.
  // If a space exists, cut at the last word boundary inside the window.
  const cutPoint = lastSpace > 0 ? lastSpace : 50;
  return trimmed.slice(0, cutPoint) + '…';
}

// S21 fallback when the agent loop throws (e.g., AnthropicError 429,
// 5xx after retry). Stored as a normal assistant row with model=null
// so the UI can render the failure state without a hung send.
const AGENT_FAILURE_TEXT =
  "I hit a temporary issue answering your question. Please try again in a moment.";

export async function onRequestGet({ request, env, params }) {
  const { error: errResp, user, role } = await requireProjectRole(
    request,
    env,
    params.id,
    'member'
  );
  if (errResp) return errResp;

  const userIdText = String(user.id);
  // BLOCK_10_PLAN.md decision O: tool-call trace viewer is admin-only.
  // Server-side filter is the load-bearing gate — UI render is naturally
  // empty for non-admins because the role='tool' rows + tool_calls JSONB
  // never reach the response.
  const isProjectAdmin = role === 'admin';

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Conversation guard: must belong to this project AND this user.
    // Single SELECT collapses both checks; either failure → 403.
    const [conv] = await sql`
      SELECT id
      FROM conversations
      WHERE id          = ${params.conversationId}
        AND project_id  = ${params.id}
        AND user_id     = ${userIdText}
        AND deleted_at IS NULL
      LIMIT 1
    `;
    if (!conv) return error('Forbidden', 403);

    // Decision: messages ordered created_at ASC (oldest first; chat scroll
    // top-down). Soft-deleted filtered out, matching the LEFT JOIN's
    // m.deleted_at IS NULL filter from the conversations list endpoint.
    //
    // BLOCK_10_PLAN.md decision O (10.6): tool_calls + tool_result added to
    // the SELECT for the admin-only trace viewer. SQL query stays uniform
    // across callers; the per-role filter happens in JS below so non-admin
    // members get the same query shape but a trimmed response. Stable
    // query plan, simple gate.
    const messages = await sql`
      SELECT id, conversation_id, role, content, created_at,
             citations, model, input_tokens, output_tokens, iteration,
             tool_calls, tool_result
        FROM messages
       WHERE conversation_id = ${params.conversationId}
         AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC
    `;

    // Block 9.2 decision G: enrich citations with connection_last_sync_at so
    // the UI freshness chip can fall back to it when source_updated_at is
    // null (decision F: source_updated_at → connection_last_sync_at →
    // "as of unknown"). Read-time JOIN — no backfill needed; historical
    // messages benefit on next render.
    //
    // CROSS-PROJECT ISOLATION (V2-6): e.project_id = params.id clamps the
    // JOIN to entities in the authorized project. Any citation referencing
    // an entity outside this project (which shouldn't happen, but defense
    // in depth) is filtered out — Map.get() returns undefined → null →
    // UI falls back to "as of unknown".
    const entityIds = new Set();
    for (const m of messages) {
      if (Array.isArray(m.citations)) {
        for (const c of m.citations) {
          if (c && c.entity_id) entityIds.add(c.entity_id);
        }
      }
    }
    const lastSyncByEntity = new Map();
    if (entityIds.size > 0) {
      const ids = [...entityIds];
      // postgres-js IN-list helper: sql(array) expands to ($1, $2, ...) with
      // each id sent as its own parameter. Avoids the array-binding ambiguity
      // that ANY(${arr}::uuid[]) tripped on first deploy (see HANDOFF 9.2
      // hotfix note). project_id clamp on the next line is the cross-project
      // isolation guard documented above.
      const enrichmentRows = await sql`
        SELECT e.id AS entity_id, c.last_sync_at AS connection_last_sync_at
          FROM entities e
          JOIN connections c ON c.id = e.connection_id
         WHERE e.id IN ${sql(ids)}
           AND e.project_id = ${params.id}
      `;
      for (const r of enrichmentRows) {
        lastSyncByEntity.set(r.entity_id, r.connection_last_sync_at);
      }
    }
    const enrichedMessages = messages.map((m) => {
      if (!Array.isArray(m.citations)) return m;
      return {
        ...m,
        citations: m.citations.map((c) => ({
          ...c,
          connection_last_sync_at:
            c && c.entity_id ? lastSyncByEntity.get(c.entity_id) ?? null : null,
        })),
      };
    });

    // BLOCK_10_PLAN.md decision O: trim the response for non-admin members.
    // Drop role='tool' rows entirely (no tool intermediates leak); null
    // tool_calls on assistant rows so the UI's `m.tool_calls?.length > 0`
    // gate naturally renders nothing. Project admins see the full shape.
    const responseMessages = isProjectAdmin
      ? enrichedMessages
      : enrichedMessages
          .filter((m) => m.role !== 'tool')
          .map((m) => (m.role === 'assistant' ? { ...m, tool_calls: null } : m));

    return json({ ok: true, messages: responseMessages });
  } catch (err) {
    // Block 9.2 hotfix: log the error so future regressions in the
    // citation-enrichment JOIN surface in Pages logs rather than as
    // a silent 'Internal error'. Original GET handler swallowed err
    // entirely; we keep the 500 response shape unchanged for callers.
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'messages_get_failed',
      project_id: params.id,
      conversation_id: params.conversationId,
      error: err && err.message ? String(err.message).slice(0, 300) : 'unknown',
    }));
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}

export async function onRequestPost({ request, env, params }) {
  const { error: errResp, user } = await requireProjectRole(
    request,
    env,
    params.id,
    'member'
  );
  if (errResp) return errResp;

  const userIdText = String(user.id);

  // Validate body shape early (decision N: validation strings render verbatim).
  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const rawContent = typeof body?.content === 'string' ? body.content : '';
  const content = rawContent.trim();
  if (content.length === 0) {
    return error('Message content is required', 400);
  }
  // Soft cap to keep accidental payload bombs out (no PRD-mandated length yet;
  // tighter limits come with the real AI in Block 5).
  if (content.length > 10000) {
    return error('Message must be 10000 characters or fewer', 400);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Conversation guard (same as GET): belongs to this project AND user.
    // Includes current title for decision H's auto-title trigger and the
    // project name for the D11 system prompt's {{PROJECT_NAME}} substitution.
    // c.project_id = URL-bound projectId stays the authorization clamp;
    // the JOIN to projects only reads name from the already-scoped project.
    const [conv] = await sql`
      SELECT c.id, c.title, p.name AS project_name
        FROM conversations c
        JOIN projects p ON p.id = c.project_id
       WHERE c.id          = ${params.conversationId}
         AND c.project_id  = ${params.id}
         AND c.user_id     = ${userIdText}
         AND c.deleted_at IS NULL
       LIMIT 1
    `;
    if (!conv) return error('Forbidden', 403);

    // BLOCK_10_PLAN.md decisions E + F + H + I (10.2): per-project monthly
    // AI cost cap. Pre-check runs BEFORE the daily-message-limit check
    // and BEFORE runAgent. SUM(cost_usd) over the current UTC month
    // compared to the project's cap (default 50.00 per decision E).
    //
    // Three branches:
    //   1. month_cost >= cap         → fire pause email (idempotent),
    //                                   return 429 with cap details.
    //   2. month_cost >= 0.8 * cap   → fire warning email (idempotent),
    //                                   continue to runAgent normally.
    //   3. month_cost <  0.8 * cap   → no email, continue.
    //
    // Cost-affecting + admin-notification surface — DEFAULT mode per
    // per-commit classification.
    const [usage] = await sql`
      SELECT COALESCE(SUM(cost_usd), 0)::float AS month_cost_usd
        FROM messages
       WHERE project_id   = ${params.id}
         AND created_at  >= DATE_TRUNC('month', NOW())
         AND deleted_at  IS NULL
    `;
    const [proj] = await sql`
      SELECT name, ai_monthly_cap_usd, ai_cap_warned_at
        FROM projects
       WHERE id = ${params.id}
       LIMIT 1
    `;
    const monthCostUsd = Number(usage.month_cost_usd) || 0;
    const capUsd = Number(proj.ai_monthly_cap_usd) || 0;
    const thresholdAlreadyFiredThisMonth = proj.ai_cap_warned_at
      ? new Date(proj.ai_cap_warned_at).getTime() >= Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth(),
          1, 0, 0, 0, 0
        )
      : false;

    if (capUsd > 0 && monthCostUsd >= capUsd) {
      // 100% pause. Fire admin email once per month — guarded by
      // ai_cap_warned_at (decision H idempotency). Email failure does
      // NOT block the 429 response; we still need to refuse the message.
      if (!thresholdAlreadyFiredThisMonth) {
        try {
          const adminEmails = await getAdminEmailsForProject(env, sql, params.id);
          await sendCostCapEmail(env, proj.name, capUsd, monthCostUsd, 'paused', adminEmails);
          await sql`UPDATE projects SET ai_cap_warned_at = NOW() WHERE id = ${params.id}`;
        } catch (notifyErr) {
          console.warn(JSON.stringify({
            level: 'warn',
            event: 'cost_cap_notify_failed',
            project_id: params.id,
            kind: 'paused',
            error: notifyErr && notifyErr.message ? String(notifyErr.message).slice(0, 200) : 'unknown',
          }));
        }
      }
      return json({
        ok: false,
        error: 'AI is paused for this project — monthly budget reached.',
        cap_usd: capUsd,
        used_usd: Number(monthCostUsd.toFixed(2)),
        resets_at: firstOfNextMonthIso(),
      }, { status: 429 });
    } else if (capUsd > 0 && monthCostUsd >= COST_WARNING_THRESHOLD * capUsd) {
      // 80% warning. Same idempotency gate; warning fires once per
      // month per project. Continue past this branch to the rest of
      // the request — the message is allowed, the admin is just notified.
      if (!thresholdAlreadyFiredThisMonth) {
        try {
          const adminEmails = await getAdminEmailsForProject(env, sql, params.id);
          await sendCostCapEmail(env, proj.name, capUsd, monthCostUsd, 'warning', adminEmails);
          await sql`UPDATE projects SET ai_cap_warned_at = NOW() WHERE id = ${params.id}`;
        } catch (notifyErr) {
          console.warn(JSON.stringify({
            level: 'warn',
            event: 'cost_cap_notify_failed',
            project_id: params.id,
            kind: 'warning',
            error: notifyErr && notifyErr.message ? String(notifyErr.message).slice(0, 200) : 'unknown',
          }));
        }
      }
    }

    // BLOCK_10_PLAN.md decisions J + K: per-project daily message limit.
    // Counts user messages (role='user') in the past 24h across the whole
    // project — one cap shared across all members. Fires BEFORE the user
    // message INSERT so a 429 doesn't dirty the conversation history.
    //
    // Defense in depth: project_id filter is the load-bearing scope here
    // (one tenant's cap shouldn't be visible to another). Matches Block 9.1
    // sync.js:115-119 belt-and-suspenders posture.
    //
    // MIN(created_at) is computed in the same query so retry_after_seconds
    // is honest — time until the OLDEST qualifying user message ages past
    // the 24h boundary. Cost: one COUNT + one MIN over the
    // messages_project_recency_idx index range.
    const [todayStats] = await sql`
      SELECT COUNT(*)::int   AS today_user_msgs,
             MIN(created_at) AS oldest_user_msg
        FROM messages
       WHERE project_id   = ${params.id}
         AND role         = 'user'
         AND created_at   > NOW() - INTERVAL '24 hours'
         AND deleted_at  IS NULL
    `;
    if (todayStats.today_user_msgs >= DAILY_MSG_CAP) {
      const oldestMs = new Date(todayStats.oldest_user_msg).getTime();
      const retryAfterMs = (oldestMs + 24 * 60 * 60 * 1000) - Date.now();
      return json({
        ok: false,
        error: `You've reached the daily message limit for this project (${DAILY_MSG_CAP} per 24 hours).`,
        retry_after_seconds: Math.max(0, Math.ceil(retryAfterMs / 1000)),
      }, { status: 429 });
    }

    // Decision H: auto-title fires once, when the title is still the default.
    // No COUNT(*) round-trip — see DECISION H IMPLEMENTATION NOTE in header.
    const isFirstTitleSet = conv.title === DEFAULT_CONVERSATION_TITLE;
    const newTitle = isFirstTitleSet ? deriveTitleFromMessage(content) : conv.title;

    // Insert user message. project_id required (see SCHEMA NOTE in header).
    // iteration=0 per schema convention (user input is the zeroth turn).
    const [userMessage] = await sql`
      INSERT INTO messages (project_id, conversation_id, role, content, iteration)
      VALUES (${params.id}, ${params.conversationId}, 'user', ${content}, 0)
      RETURNING id, conversation_id, role, content, created_at
    `;

    // Build priorMessages context for the agent loop. Text-only role IN
    // ('user','assistant') turns from this conversation, including the
    // user message just inserted. v1.1 simplification: skip role='tool'
    // history rows (Anthropic shape requires reconstructing tool_use_id
    // pairings; deferred to a future block if context-loss surfaces).
    const priorRows = await sql`
      SELECT role, content
        FROM messages
       WHERE conversation_id = ${params.conversationId}
         AND deleted_at IS NULL
         AND role IN ('user','assistant')
         AND content IS NOT NULL
       ORDER BY created_at ASC, id ASC
    `;
    const priorMessages = priorRows.map((r) => ({
      role: r.role,
      content: r.content,
    }));

    const urlContext = {
      projectId: params.id,
      projectName: conv.project_name,
      conversationId: params.conversationId,
      userMessage: content,
    };

    let agentResult;
    try {
      agentResult = await runAgent(env, sql, urlContext, priorMessages);
    } catch (err) {
      // S21: AnthropicError after retries (or any other agent-loop
      // failure). Log + substitute a single canned assistant turn so the
      // chat row exists with model=null. UI renders failure state.
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'agent_loop_failed',
        conversation_id: params.conversationId,
        error: err && err.message ? String(err.message).slice(0, 200) : 'unknown',
      }));
      agentResult = {
        text: AGENT_FAILURE_TEXT,
        citations: [],
        model: null,
        input_tokens: 0,
        output_tokens: 0,
        iterations: 0,
        db_turns: [{
          role: 'assistant',
          content: AGENT_FAILURE_TEXT,
          tool_calls: null,
          tool_result: null,
          citations: null,
          model: null,
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          iteration: 1,
        }],
      };
    }

    // Persist each turn from the agent loop. The last role='assistant'
    // turn carrying content is the user-visible answer; we keep the
    // RETURNING'd row for the response payload.
    //
    // Block 10.2 decision I: cost_usd written at persist time. Loop.js
    // populates the value on each db_turn from computeCostUsd(model,
    // input_tokens, output_tokens). NULL is acceptable for unknown
    // models (defensive — pricing.js returns null then); the cap
    // pre-check COALESCEs NULL to 0 so unknown-model rows don't
    // accidentally burst the cap.
    let assistantMessage = null;
    for (const turn of agentResult.db_turns) {
      const [row] = await sql`
        INSERT INTO messages (
          project_id, conversation_id, role, content,
          tool_calls, tool_result, citations,
          input_tokens, output_tokens, model, cost_usd, iteration
        ) VALUES (
          ${params.id}, ${params.conversationId}, ${turn.role}, ${turn.content},
          ${turn.tool_calls}, ${turn.tool_result}, ${turn.citations},
          ${turn.input_tokens}, ${turn.output_tokens}, ${turn.model}, ${turn.cost_usd ?? null}, ${turn.iteration}
        )
        RETURNING id, conversation_id, role, content, created_at,
                  citations, model, input_tokens, output_tokens, iteration
      `;
      if (turn.role === 'assistant' && turn.content) {
        assistantMessage = row;
      }
    }

    // Update conversation: title (if this was the first user message) AND
    // updated_at (always). One UPDATE for both; updated_at = NOW() ensures
    // the sidebar's updated_at-DESC sort surfaces the active conversation
    // to the top after every send.
    await sql`
      UPDATE conversations
         SET title       = ${newTitle},
             updated_at  = NOW()
       WHERE id = ${params.conversationId}
    `;

    return json({
      ok: true,
      user_message: userMessage,
      assistant_message: assistantMessage,
      conversation: {
        id: conv.id,
        title: newTitle,
      },
    });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
