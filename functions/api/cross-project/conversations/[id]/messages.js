// functions/api/cross-project/conversations/[id]/messages.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Block 12.5a — GET / POST  /api/cross-project/conversations/:id/messages
//
// GET  — load message history (workspace-scoped to the user's
//        conversation).
// POST — send a new user message. Runs the agent loop with cross-project
//        urlContext (crossProjectIds + crossProjects + workspaceUserId),
//        charges against D1 users.cross_project_ai_monthly_cap_usd.
//
// CAP-CHARGING (decision G)
// - Pre-flight: SUM(cost_usd) from messages.project_id IS NULL scoped to
//   this user's conversations since users.cross_project_ai_spend_period_start.
//   If ≥ cap, return paused envelope; do NOT call the agent.
// - Post-flight: persist each message with project_id = NULL and the
//   cost_usd populated from computeCostUsd — same pricing function as v1.2.
//
// No daily-message-limit on cross-project chats — only the monthly cap.
// =========================================================================

import postgres from 'postgres';
import { error, json } from '../../../../_lib/auth.js';
import { getWorkspaceUserId } from '../../../../_lib/workspace.js';
import { runAgent } from '../../../../_lib/ai/loop.js';
import { computeCostUsd } from '../../../../_lib/ai/pricing.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s) { return typeof s === 'string' && UUID_RE.test(s); }

// postgres-js returns UUID[] columns as a Postgres array literal STRING
// in some configurations ('{a,b,c}') rather than a JS array. Normalize.
function parseProjectIds(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.startsWith('{') && v.endsWith('}')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

const DEFAULT_TITLE = 'New cross-project chat';
const MESSAGE_MAX = 8000;

function firstOfNextMonthIso() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString();
}

function deriveTitleFromMessage(content) {
  const t = content.trim();
  if (t.length <= 50) return t;
  const w = t.slice(0, 50);
  const sp = w.lastIndexOf(' ');
  const cut = sp > 0 ? sp : 50;
  return t.slice(0, cut) + '…';
}

// ─── GET: load conversation history ─────────────────────────────────────

export async function onRequestGet({ request, env, params }) {
  const userId = await getWorkspaceUserId(request, env);
  if (!userId) return error('Not authenticated', 401);
  if (!isUuid(params.id)) return error('Invalid conversation id', 400);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const [conv] = await sql`
      SELECT id::text AS id, project_ids, label, user_id, title
        FROM conversations
       WHERE id           = ${params.id}
         AND user_id      = ${userId}
         AND project_ids IS NOT NULL
         AND deleted_at   IS NULL
       LIMIT 1
    `;
    if (!conv) return error('Not found', 404);

    const messages = await sql`
      SELECT id::text AS id, conversation_id::text AS conversation_id,
             role, content, tool_calls, tool_result, citations,
             input_tokens, output_tokens, model, cost_usd, iteration,
             created_at
        FROM messages
       WHERE conversation_id = ${params.id}
         AND deleted_at      IS NULL
       ORDER BY created_at ASC, id ASC
    `;

    return json({ ok: true, conversation: conv, messages });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}

// ─── POST: send a new user message ──────────────────────────────────────

export async function onRequestPost({ request, env, params }) {
  const userId = await getWorkspaceUserId(request, env);
  if (!userId) return error('Not authenticated', 401);
  if (!isUuid(params.id)) return error('Invalid conversation id', 400);

  let body;
  try { body = await request.json(); } catch { return error('Invalid JSON', 400); }
  const content = (typeof body?.content === 'string' ? body.content : '').trim();
  if (content.length === 0) return error('Message content is required', 400);
  if (content.length > MESSAGE_MAX) {
    return error(`Message must be ${MESSAGE_MAX} characters or fewer`, 400);
  }

  // D1: workspace user cap + period_start.
  const userRow = await env.DB
    .prepare(`SELECT cross_project_ai_monthly_cap_usd, cross_project_ai_spend_period_start FROM users WHERE id = ?1`)
    .bind(Number(userId))
    .first();
  if (!userRow) return error('Internal error', 500);
  const capUsd = Number(userRow.cross_project_ai_monthly_cap_usd) || 0;
  const periodStartUnix = userRow.cross_project_ai_spend_period_start ?? Math.floor(Date.now() / 1000);
  const periodStartIso = new Date(periodStartUnix * 1000).toISOString();

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Load + ownership check.
    const [conv] = await sql`
      SELECT id::text AS id, project_ids, label, user_id, title
        FROM conversations
       WHERE id           = ${params.id}
         AND user_id      = ${userId}
         AND project_ids IS NOT NULL
         AND deleted_at   IS NULL
       LIMIT 1
    `;
    if (!conv) return error('Not found', 404);

    // Pre-flight cap check. SUM cost_usd from this user's cross-project
    // messages since period_start.
    const [spendRow] = await sql`
      SELECT COALESCE(SUM(m.cost_usd), 0)::float AS spend_usd
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
       WHERE m.project_id  IS NULL
         AND m.created_at  >= ${periodStartIso}::timestamptz
         AND m.deleted_at  IS NULL
         AND c.user_id     = ${userId}
         AND c.deleted_at  IS NULL
    `;
    const currentSpend = Number(spendRow.spend_usd) || 0;
    if (capUsd > 0 && currentSpend >= capUsd) {
      return json({
        ok: false,
        paused: true,
        code: 'cross_project_cap_reached',
        cap_usd: capUsd,
        spend_usd: currentSpend,
        resets_at: firstOfNextMonthIso(),
        error: `Cross-project AI is paused — workspace cap of $${capUsd.toFixed(2)} reached for this month.`,
      }, { status: 402 });
    }

    // Resolve project identity for the system prompt + citation chip
    // prefixes. Already authorized at conversation create (and
    // re-authorized on edit-scope), but defensive: re-fetch live projects
    // so any soft-deleted-since-create drop out.
    const crossProjectIds = parseProjectIds(conv.project_ids);
    if (crossProjectIds.length === 0) {
      return error('Conversation has no projects in scope', 400);
    }
    const projects = await sql`
      SELECT id::text AS id, name
        FROM projects
       WHERE id IN ${sql(crossProjectIds)}
         AND deleted_at    IS NULL
    `;
    if (projects.length === 0) {
      return error('All projects in scope have been removed from the workspace', 400);
    }
    const authorizedIds = projects.map((p) => p.id);
    const projectsById = new Map(projects.map((p) => [p.id, p.name]));

    // Title auto-derive on first user message.
    const isFirstUserMsg = conv.title === DEFAULT_TITLE;
    const newTitle = isFirstUserMsg ? deriveTitleFromMessage(content) : conv.title;

    // Persist user message (project_id = NULL — cross-project sentinel).
    const [userMsg] = await sql`
      INSERT INTO messages (project_id, conversation_id, role, content, iteration)
      VALUES (NULL, ${params.id}, 'user', ${content}, 0)
      RETURNING id::text AS id, role, content, created_at
    `;

    // Prior text-only messages for the agent loop (matches v1.2 shape).
    const priorRows = await sql`
      SELECT role, content
        FROM messages
       WHERE conversation_id = ${params.id}
         AND role IN ('user','assistant')
         AND deleted_at      IS NULL
       ORDER BY created_at ASC, id ASC
    `;
    const priorMessages = priorRows
      .filter((r) => typeof r.content === 'string' && r.content.length > 0)
      .map((r) => ({ role: r.role, content: r.content }));

    // Run the agent loop with cross-project urlContext.
    const urlContext = {
      // Project-scoped fields stay populated with sentinels so existing
      // log-builders (e.g., tool_input_project_id_mismatch) don't NPE.
      projectId: '',
      projectName: 'cross-project',
      conversationId: params.id,
      userMessage: content,
      // v1.3 cross-project additions.
      workspaceUserId: String(userId),
      crossProjectIds: authorizedIds,
      crossProjects: authorizedIds.map((id) => ({
        id,
        name: projectsById.get(id) || 'Project',
      })),
    };

    let agentResult;
    try {
      agentResult = await runAgent(env, sql, urlContext, priorMessages);
    } catch (err) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'cross_project_agent_loop_failed',
        conversation_id: params.id,
        error_message: err && err.message ? String(err.message).slice(0, 300) : 'unknown',
      }));
      const fallback = "I hit a temporary issue answering your question. Please try again in a moment.";
      const [assistantMsg] = await sql`
        INSERT INTO messages (project_id, conversation_id, role, content, iteration, model, cost_usd)
        VALUES (NULL, ${params.id}, 'assistant', ${fallback}, 1, NULL, 0)
        RETURNING id::text AS id, role, content, created_at
      `;
      await sql`UPDATE conversations SET last_message_at = NOW(), updated_at = NOW(), title = ${newTitle} WHERE id = ${params.id}`;
      return json({ ok: true, user_message: userMsg, assistant_message: assistantMsg });
    }

    // Enrich citations with project_id + project_name so the frontend can
    // render the [Project Name] chip prefix in cross-project mode
    // (PRD §3.8 + BLOCK_12_PLAN decision H).
    const enrichedCitations = await (async () => {
      const c = Array.isArray(agentResult.citations) ? agentResult.citations : [];
      if (c.length === 0) return null;
      const entityIds = [...new Set(c.map((x) => x.entity_id).filter(Boolean))];
      if (entityIds.length === 0) return c;
      const entRows = await sql`
        SELECT id::text AS entity_id, project_id::text AS project_id
          FROM entities
         WHERE id IN ${sql(entityIds)}
      `;
      const projByEntity = new Map(entRows.map((r) => [r.entity_id, r.project_id]));
      return c.map((cite) => {
        const pid = projByEntity.get(cite.entity_id);
        return {
          ...cite,
          project_id: pid || null,
          project_name: pid ? (projectsById.get(pid) || null) : null,
        };
      });
    })();

    // Persist agent turns. project_id stays NULL for all (decision F).
    for (let i = 0; i < agentResult.db_turns.length; i++) {
      const turn = agentResult.db_turns[i];
      const turnCitations = i === agentResult.db_turns.length - 1 ? enrichedCitations : null;
      await sql`
        INSERT INTO messages (
          project_id, conversation_id, role, content, tool_calls, tool_result,
          citations, input_tokens, output_tokens, model, cost_usd, iteration
        ) VALUES (
          NULL, ${params.id}, ${turn.role}, ${turn.content},
          ${turn.tool_calls}, ${turn.tool_result},
          ${turnCitations}, ${turn.input_tokens}, ${turn.output_tokens},
          ${turn.model}, ${turn.cost_usd}, ${turn.iteration}
        )
      `;
    }

    await sql`
      UPDATE conversations
         SET title           = ${newTitle},
             last_message_at = NOW(),
             updated_at      = NOW()
       WHERE id = ${params.id}
    `;

    // Final assistant payload for the client.
    const lastTurn = agentResult.db_turns[agentResult.db_turns.length - 1];
    return json({
      ok: true,
      user_message: userMsg,
      assistant_message: {
        role: 'assistant',
        content: lastTurn ? lastTurn.content : agentResult.text,
        citations: enrichedCitations,
        model: lastTurn ? lastTurn.model : null,
        iteration: lastTurn ? lastTurn.iteration : 1,
      },
      conversation: { ...conv, title: newTitle },
    });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}
