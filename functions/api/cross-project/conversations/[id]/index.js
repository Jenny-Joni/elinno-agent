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
import { error, json } from '../../../../_lib/auth.js';
import { getWorkspaceUserId } from '../../../../_lib/workspace.js';
import { authorizeProjectSet } from '../../../../_lib/ai/authorize.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

// postgres-js returns UUID[] as Postgres array literal string '{a,b,c}'
// in this configuration; normalize to string[]. v1.3.1 will extract to a
// shared lib (already inlined in messages.js + conversations.js).
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

// 2026-05-27 (shared-workspace-visibility): cross-project chats are
// shared across all authenticated users in the workspace. The legacy
// `userId` parameter is kept for callsite stability and stays in the
// row payload (it's the creator), but is no longer used as a filter.
async function loadOwned(sql, convId, _userId) {
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
    return json({
      ok: true,
      conversation: { ...conv, project_ids: parseProjectIds(conv.project_ids) },
    });
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

  // v1.4 (Block 13.5): rename support. PATCH now accepts:
  //   - project_ids — re-scope (existing v1.3 behavior; re-authorizes)
  //   - title       — rename
  //   - restore: true — clear deleted_at (undo)
  // At least one of the three is required.
  const hasProjectIds = 'project_ids' in body;
  const hasTitle = 'title' in body;
  const hasRestore = body.restore === true;
  if (!hasProjectIds && !hasTitle && !hasRestore) {
    return error('Provide at least one of: project_ids, title, restore', 400);
  }

  let nextTitle = null;
  if (hasTitle) {
    const t = (body.title || '').trim();
    if (typeof body.title !== 'string' || t.length < 1 || t.length > 120) {
      return error('Title must be 1–120 characters', 400);
    }
    nextTitle = t;
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });
  try {
    // 2026-05-27 (shared-workspace-visibility): existence check no longer
    // filters by user_id — any authenticated user can rename/re-scope/
    // restore any cross-project chat in the workspace. For restore,
    // allow soft-deleted rows; for rename/re-scope, restrict to live.
    const owned = hasRestore
      ? await sql`
          SELECT id::text AS id, user_id, deleted_at
            FROM conversations
           WHERE id = ${params.id}
           LIMIT 1
        `.then(rows => rows[0])
      : await loadOwned(sql, params.id, userId);
    if (!owned) return error('Not found', 404);

    let projectIdsLiteral = null;
    if (hasProjectIds) {
      // Re-authorize the new project set. Same gate as create — server
      // never trusts the LLM-supplied set even on edit.
      const auth = await authorizeProjectSet(sql, userId, body.project_ids);
      if (!auth.ok) return json(auth, { status: 400 });
      // Build Postgres array literal manually (same lesson as
      // conversations.js POST — `${jsArr}` in a tagged template serializes
      // as CSV which fails to parse as uuid[]).
      projectIdsLiteral = '{' + auth.projectIds.join(',') + '}';
    }

    // Unroll the dynamic UPDATE — three fields, eight combinations is
    // unwieldy. Build SET clauses incrementally with three sql`` fragments
    // joined manually. postgres-js supports sql.unsafe for raw fragments
    // but the unroll keeps each binding in a tagged-template segment
    // where it belongs (no SQL-injection foot-gun).
    let updated;
    if (hasProjectIds && hasTitle && hasRestore) {
      [updated] = await sql`
        UPDATE conversations
           SET project_ids = ${projectIdsLiteral}::uuid[],
               title       = ${nextTitle},
               deleted_at  = NULL,
               updated_at  = NOW()
         WHERE id = ${params.id}
        RETURNING id::text AS id, project_id, project_ids, label, user_id, title, last_message_at, created_at, updated_at
      `;
    } else if (hasProjectIds && hasTitle) {
      [updated] = await sql`
        UPDATE conversations
           SET project_ids = ${projectIdsLiteral}::uuid[],
               title       = ${nextTitle},
               updated_at  = NOW()
         WHERE id = ${params.id}
        RETURNING id::text AS id, project_id, project_ids, label, user_id, title, last_message_at, created_at, updated_at
      `;
    } else if (hasProjectIds && hasRestore) {
      [updated] = await sql`
        UPDATE conversations
           SET project_ids = ${projectIdsLiteral}::uuid[],
               deleted_at  = NULL,
               updated_at  = NOW()
         WHERE id = ${params.id}
        RETURNING id::text AS id, project_id, project_ids, label, user_id, title, last_message_at, created_at, updated_at
      `;
    } else if (hasTitle && hasRestore) {
      [updated] = await sql`
        UPDATE conversations
           SET title       = ${nextTitle},
               deleted_at  = NULL,
               updated_at  = NOW()
         WHERE id = ${params.id}
        RETURNING id::text AS id, project_id, project_ids, label, user_id, title, last_message_at, created_at, updated_at
      `;
    } else if (hasProjectIds) {
      [updated] = await sql`
        UPDATE conversations
           SET project_ids = ${projectIdsLiteral}::uuid[],
               updated_at  = NOW()
         WHERE id = ${params.id}
        RETURNING id::text AS id, project_id, project_ids, label, user_id, title, last_message_at, created_at, updated_at
      `;
    } else if (hasTitle) {
      [updated] = await sql`
        UPDATE conversations
           SET title       = ${nextTitle},
               updated_at  = NOW()
         WHERE id = ${params.id}
        RETURNING id::text AS id, project_id, project_ids, label, user_id, title, last_message_at, created_at, updated_at
      `;
    } else {
      // restore only
      [updated] = await sql`
        UPDATE conversations
           SET deleted_at = NULL,
               updated_at = NOW()
         WHERE id = ${params.id}
        RETURNING id::text AS id, project_id, project_ids, label, user_id, title, last_message_at, created_at, updated_at
      `;
    }

    return json({
      ok: true,
      conversation: { ...updated, project_ids: parseProjectIds(updated.project_ids) },
    });
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
