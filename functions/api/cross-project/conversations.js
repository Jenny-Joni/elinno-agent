// functions/api/cross-project/conversations.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Block 12.5a — POST /api/cross-project/conversations (create) +
//               GET  /api/cross-project/conversations (list user's).
//
// Cross-project chat conversations are workspace-scoped (vs the v1.2
// per-project conversations which are URL-bound). Identity:
//   - conversations.project_id        = NULL (decision F)
//   - conversations.project_ids       = authorized UUID[] from
//                                       authorizeProjectSet
//   - conversations.label             = 'product' (decision D —
//                                       Finance/Monday v2.0-locked)
//   - conversations.user_id           = workspace user id
//
// Authorization re-runs on every CREATE (decision K). The LLM-submitted
// set is NEVER trusted past the authorize gate. v1.2 single-project
// chats (URL /api/projects/[id]/conversations) are not affected.
// =========================================================================

import postgres from 'postgres';
import { error, json } from '../../_lib/auth.js';
import { getWorkspaceUserId } from '../../_lib/workspace.js';
import { authorizeProjectSet } from '../../_lib/ai/authorize.js';

const ALLOWED_LABELS = new Set(['product']);

// POST — create cross-project conversation.
export async function onRequestPost({ request, env }) {
  const userId = await getWorkspaceUserId(request, env);
  if (!userId) return error('Not authenticated', 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }
  if (!body || typeof body !== 'object') {
    return error('Body must be a JSON object', 400);
  }

  const label = typeof body.label === 'string' ? body.label : 'product';
  if (!ALLOWED_LABELS.has(label)) {
    return error(`label must be one of: ${[...ALLOWED_LABELS].join(', ')}`, 400);
  }

  const projectIds = body.project_ids;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Authorize the project set upfront. Failure → 4xx + structured
    // envelope (per BLOCK_12_PLAN decision K + PRD §3.6.1).
    const auth = await authorizeProjectSet(sql, userId, projectIds);
    if (!auth.ok) {
      return json(auth, { status: 400 });
    }

    // Insert with project_id=NULL (cross-project sentinel), project_ids
    // = authorized array, label, workspace user id, default title.
    //
    // postgres-js array binding gotcha: `${jsArr}` in a tagged template
    // serializes as CSV ('a,b,c'), which then fails to parse as uuid[].
    // Build the Postgres array literal '{a,b,c}' manually and cast.
    // (Same lesson as dashboard.js 12.3 ANY() fix and refresh_runner's
    // `IN ${sql(arr)}` pattern — none of those apply here because this
    // is an INSERT into a UUID[] column, not an IN/ANY filter.)
    const projectIdsLiteral = '{' + auth.projectIds.join(',') + '}';
    const [conv] = await sql`
      INSERT INTO conversations (project_id, project_ids, label, user_id, title)
      VALUES (NULL, ${projectIdsLiteral}::uuid[], ${label}, ${userId}, 'New cross-project chat')
      RETURNING id::text     AS id,
                project_id,
                project_ids,
                label,
                user_id,
                title,
                created_at,
                updated_at
    `;

    return json(
      { ok: true, conversation: { ...conv, message_count: 0 } },
      { status: 201 }
    );
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}

// GET — list this workspace user's cross-project conversations.
export async function onRequestGet({ request, env }) {
  const userId = await getWorkspaceUserId(request, env);
  if (!userId) return error('Not authenticated', 401);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const rows = await sql`
      SELECT c.id::text                AS id,
             c.label,
             c.project_ids,
             c.title,
             c.last_message_at,
             c.created_at,
             c.updated_at,
             COUNT(m.id)::int          AS message_count
        FROM conversations c
   LEFT JOIN messages m
          ON m.conversation_id = c.id
         AND m.deleted_at IS NULL
       WHERE c.user_id     = ${userId}
         AND c.project_ids IS NOT NULL
         AND c.deleted_at  IS NULL
       GROUP BY c.id
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
       LIMIT 50
    `;
    return json({ ok: true, conversations: rows });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}
