// functions/api/projects/[id]/index.js
//
// Block 2 Sub-task 2.1 — projects API (read-one).
//
// Routes (this file):
//   GET /api/projects/:id  → read one project the session user is a
//                            'member' (or 'admin') of
//
// First consumer of requireProjectRole. The helper is responsible for
// the four auth layers (session valid, projectId is UUID, user is an
// active member, project not soft-deleted) and for the role check
// (admin satisfies 'member'-level, per the helper's hierarchy).
//
// The endpoint owns only the data fetch and the response shape. We
// keep auth and data fetching separate to avoid coupling the helper
// to per-endpoint data needs.
import postgres from 'postgres';
import { error, json, requireProjectRole } from '../../../_lib/auth.js';

export async function onRequestGet({ request, env, params }) {
  const { error: errResp, role } = await requireProjectRole(
    request,
    env,
    params.id,
    'member'
  );
  if (errResp) return errResp;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Defensive `deleted_at IS NULL` filter — the helper already
    // verified this, but two layers protect against future helper
    // refactors that might drop the check. Costs nothing (PK lookup,
    // row likely cached by Hyperdrive from the helper's join).
    const [project] = await sql`
      SELECT
        id,
        name,
        description,
        owner_user_id,
        created_at,
        updated_at
        FROM projects
       WHERE id          = ${params.id}
         AND deleted_at  IS NULL
       LIMIT 1
    `;

    if (!project) {
      // Race: project was soft-deleted between requireProjectRole's
      // check and this SELECT. The user had confirmed access moments
      // ago, so 404 (not 403) is correct here — no leakage, since the
      // requester is a verified active member of a now-deleted project.
      return error('Not found', 404);
    }

    return json({ ok: true, project: { ...project, role } });
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
