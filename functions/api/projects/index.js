// functions/api/projects/index.js
//
// Block 2 Sub-task 2.1 — projects API.
//
// Routes (this file):
//   POST /api/projects  → create a project (workspace-admin only)
//   GET  /api/projects  → list projects in the session user's workspace
//
// v1.3 (Block 12.1, BLOCK_12_PLAN.md decision I): per-project membership
// collapsed. Project creation is a single INSERT into `projects`; the
// previous v1.2 second INSERT into `project_members` is gone (the table
// is dropped). GET filters by `projects.owner_user_id = $sessionUser.id`
// (workspace scope) instead of joining the dropped membership table.
import postgres from 'postgres';
import { error, getSessionUser, json, requireWorkspaceAdmin } from '../../_lib/auth.js';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 1000;

export async function onRequestPost({ request, env }) {
  const { error: errResp, user } = await requireWorkspaceAdmin(request, env);
  if (errResp) return errResp;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
  if (rawName.length === 0) {
    return error('Project name is required', 400);
  }
  if (rawName.length > NAME_MAX) {
    return error(`Project name must be ${NAME_MAX} characters or fewer`, 400);
  }

  // description: optional. Omitted, explicit-null, and empty-after-trim
  // all map to NULL — semantically "no description" — so downstream
  // `WHERE description IS NULL` queries work uniformly.
  let description = null;
  if (body?.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') {
      return error('Project description must be a string', 400);
    }
    const trimmed = body.description.trim();
    if (trimmed.length > DESCRIPTION_MAX) {
      return error(`Project description must be ${DESCRIPTION_MAX} characters or fewer`, 400);
    }
    description = trimmed.length > 0 ? trimmed : null;
  }

  // Cross-DB seam: D1 users.id (INTEGER) → Postgres TEXT.
  // Pattern documented canonically in db/schema-postgres.sql header.
  const userIdText = String(user.id);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // v1.3 (Block 12.1): single INSERT. The v1.2 paired INSERT into
    // project_members is gone — workspace-scope (projects.owner_user_id
    // = session user's id) is the security predicate. The transaction
    // wrapper from v1.2 is no longer needed but kept for forward
    // compatibility if additional project-creation side effects land.
    const [project] = await sql`
      INSERT INTO projects (name, description, owner_user_id)
      VALUES (${rawName}, ${description}, ${userIdText})
      RETURNING *
    `;

    return json({ ok: true, project }, { status: 201 });
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

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env.DB);
  if (!user) return error('Not authenticated', 401);

  // Cross-DB seam: D1 users.id (INTEGER) → Postgres TEXT.
  // Pattern documented canonically in db/schema-postgres.sql header.
  const userIdText = String(user.id);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // v1.3 (Block 12.1, decision I): list projects in the session user's
    // workspace. The v1.2 JOIN project_members is gone — workspace scope
    // is the single predicate. Index path:
    // projects_owner_active_idx ON (owner_user_id) WHERE deleted_at IS NULL.
    // Tiebreaker on p.id keeps ordering stable when two projects share
    // an updated_at (e.g., both freshly created). `role` is derived from
    // D1 user.is_admin (workspace-admin is the only role concept in v1.3)
    // to preserve the v1.2 response shape for the projects-list UI.
    const role = user.is_admin ? 'admin' : 'member';
    const projects = await sql`
      SELECT
        p.id,
        p.name,
        p.description,
        p.owner_user_id,
        p.created_at,
        p.updated_at
        FROM projects p
       WHERE p.owner_user_id = ${userIdText}
         AND p.deleted_at IS NULL
       ORDER BY p.updated_at DESC, p.id DESC
    `;

    return json({
      ok: true,
      projects: projects.map((p) => ({ ...p, role })),
    });
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
