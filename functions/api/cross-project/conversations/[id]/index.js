// functions/api/cross-project/conversations/[id]/index.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Block 12.5a — GET / PATCH / DELETE  /api/cross-project/conversations/:id
//
// GET    — read one cross-project conversation (workspace-scoped).
// PATCH  — edit scope; body { project_ids: [...] }. Re-runs authorize.
// DELETE — soft-delete.
// =========================================================================

import postgres from 'postgres';
import { error, json } from '../../../_lib/auth.js';
import { getWorkspaceUserId } from '../../../_lib/workspace.js';
import { authorizeProjectSet } from '../../../_lib/ai/authorize.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

async function loadOwned(sql, convId, userId) {
  const [row] = await sql`
    SELECT id::text         AS id,
           project_id,
           project_ids,
           label,
           user_id,
           title,
           last_message_at,
           created_at,
           updated_at
      FROM conversations
     WHERE id           = ${convId}
       AND user_id      = ${userId}
       AND project_ids IS NOT NULL
       AND deleted_at   IS NULL
     LIMIT 1
  `;
  return row || null;
}

// GET — read one cross-project conversation.
export async function onRequestGet({ request, env, params }) {
  const userId = await getWorkspaceUserId(request, env);
  if (!userId) return error('Not authenticated', 401);
  if (!isUuid(params.id)) return error('Invalid conversation id', 400);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });
  try {
    const conv = await loadOwned(sql, params.id, userId);
    if (!conv) return error('Not found', 404);
    return json({ ok: true, conversation: conv });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}

// PATCH — edit scope (project_ids). Re-runs authorize.
export async function onRequestPatch({ request, env, params }) {
  const userId = await getWorkspaceUserId(request, env);
  if (!userId) return error('Not authenticated', 401);
  if (!isUuid(params.id)) return error('Invalid conversation id', 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }
  if (!body || typeof body !== 'object') {
    return error('Body must be a JSON object', 400);
  }
  if (!('project_ids' in body)) {
    return error('Nothing to update — project_ids is the only editable field on a cross-project conversation', 400);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });
  try {
    // Workspace ownership check first — 404 on cross-tenant attempts so
    // we never leak existence to a non-owner.
    const owned = await loadOwned(sql, params.id, userId);
    if (!owned) return error('Not found', 404);

    // Re-authorize the new project set. Same gate as create — server
    // never trusts the LLM-supplied set even on edit.
    const auth = await authorizeProjectSet(sql, userId, body.project_ids);
    if (!auth.ok) return json(auth, { status: 400 });

    const [updated] = await sql`
      UPDATE conversations
         SET project_ids = ${auth.projectIds},
             updated_at  = NOW()
       WHERE id      = ${params.id}
         AND user_id = ${userId}
      RETURNING id::text     AS id,
                project_id,
                project_ids,
                label,
                user_id,
                title,
                last_message_at,
                created_at,
                updated_at
    `;
    return json({ ok: true, conversation: updated });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}

// DELETE — soft-delete.
export async function onRequestDelete({ request, env, params }) {
  const userId = await getWorkspaceUserId(request, env);
  if (!userId) return error('Not authenticated', 401);
  if (!isUuid(params.id)) return error('Invalid conversation id', 400);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });
  try {
    const result = await sql`
      UPDATE conversations
         SET deleted_at = NOW(),
             updated_at = NOW()
       WHERE id           = ${params.id}
         AND user_id      = ${userId}
         AND project_ids IS NOT NULL
         AND deleted_at   IS NULL
      RETURNING id
    `;
    if (result.length === 0) return error('Not found', 404);
    return json({ ok: true });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}
