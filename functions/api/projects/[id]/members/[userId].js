// functions/api/projects/[id]/members/[userId].js
//
// Block 2 Sub-task 2.2 — project members API (remove).
//
// Routes (this file):
//   DELETE /api/projects/:id/members/:userId
//     → remove a project member (project-admin only)
//
// The project's creator (projects.owner_user_id) cannot be removed —
// returns 403 with an explicit message per BLOCK_2_PLAN sub-task 2.2.
import postgres from 'postgres';
import { error, json, requireProjectRole } from '../../../../_lib/auth.js';

const D1_USER_ID_RE = /^[1-9]\d*$/;

export async function onRequestDelete({ request, env, params }) {
  const { error: errResp } = await requireProjectRole(
    request,
    env,
    params.id,
    'admin'
  );
  if (errResp) return errResp;

  if (typeof params.userId !== 'string' || !D1_USER_ID_RE.test(params.userId)) {
    return error('Invalid user id', 400);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Defensive deleted_at filter; same belt-and-suspenders rationale
    // as GET /api/projects/:id.
    const [project] = await sql`
      SELECT owner_user_id
        FROM projects
       WHERE id          = ${params.id}
         AND deleted_at  IS NULL
       LIMIT 1
    `;

    if (!project) {
      // Race-deletion case (helper succeeded, project gone). Same 404
      // rationale as GET /api/projects/:id.
      return error('Not found', 404);
    }

    if (project.owner_user_id === params.userId) {
      return error('The project creator cannot be removed', 403);
    }

    const removed = await sql`
      DELETE FROM project_members
       WHERE project_id = ${params.id}
         AND user_id    = ${params.userId}
      RETURNING user_id, role
    `;

    if (removed.length === 0) {
      return error('Member not found', 404);
    }

    return json({ ok: true, removed: removed[0] });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup; never masks the return value
    }
  }
}
