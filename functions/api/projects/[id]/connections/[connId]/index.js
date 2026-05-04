// functions/api/projects/[id]/connections/[connId]/index.js
// =========================================================================
// Connection lifecycle — DELETE (soft-delete).
//
// Block 3 commit 4. Implements decision O (URL shapes), Q (error
// contract).
//
// Route:
//   DELETE /api/projects/:id/connections/:connId
//     — admin only; soft-delete (sets deleted_at = NOW()). The schema
//       UNIQUE NULLS NOT DISTINCT on
//       (project_id, source, external_account_id, deleted_at) lets
//       a future connect with the same external account succeed
//       (the soft-deleted row's deleted_at column is non-NULL, so it
//       doesn't conflict with a new active row).
//
//   404 collapses three cases — connection doesn't exist, isn't in
//   this project, already deleted — to avoid leaking existence.
//   This is consistent with requireProjectRole's 403-collapse
//   discipline.
// =========================================================================

import postgres from 'postgres';
import { error, json, requireProjectRole } from '../../../../../_lib/auth.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestDelete({ request, env, params }) {
  const projectId = params.id;
  const connId = params.connId;

  if (typeof connId !== 'string' || !UUID_RE.test(connId)) {
    return error('Invalid connection id', 400);
  }

  const { error: errResp } = await requireProjectRole(
    request,
    env,
    projectId,
    'admin'
  );
  if (errResp) return errResp;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const result = await sql`
      UPDATE connections
         SET deleted_at = NOW(),
             updated_at = NOW()
       WHERE id = ${connId}
         AND project_id = ${projectId}
         AND deleted_at IS NULL
      RETURNING id
    `;

    if (result.length === 0) {
      return error('Not Found', 404);
    }

    return json({ ok: true });
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
