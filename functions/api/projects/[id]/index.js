// functions/api/projects/[id]/index.js
//
// Block 2 Sub-task 2.1 — projects API (read-one).
//
// Routes (this file):
//   GET /api/projects/:id  → read one project in the session user's
//                            workspace (v1.3: per-project membership
//                            collapsed; workspace scope is the gate)
//
// First consumer of requireWorkspaceScope (v1.3 successor to v1.1/v1.2's
// requireProjectRole). The helper is responsible for the three auth
// layers (session valid, projectId is UUID, project belongs to the
// workspace AND is not soft-deleted) per BLOCK_12_PLAN.md decision I.
//
// The endpoint owns only the data fetch and the response shape. Role is
// derived from D1 `user.is_admin` since workspace-admin is the only role
// concept in v1.3.
import postgres from 'postgres';
import { error, json, requireWorkspaceScope } from '../../../_lib/auth.js';

export async function onRequestGet({ request, env, params }) {
  const { error: errResp, user } = await requireWorkspaceScope(
    request,
    env,
    params.id
  );
  if (errResp) return errResp;

  // v1.3: workspace admin is the sole role concept. Preserves the
  // v1.2 response field shape so the project-settings UI in 12.4 can
  // continue to read project.role without a frontend change yet.
  const role = user.is_admin ? 'admin' : 'member';

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
      // Race: project was soft-deleted between requireWorkspaceScope's
      // check and this SELECT. The user had confirmed access moments
      // ago, so 404 (not 403) is correct here — no leakage, since the
      // requester is a verified workspace user of a now-deleted project.
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
