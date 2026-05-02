// functions/api/projects/index.js
//
// Block 2 Sub-task 2.1 — projects API.
//
// Routes (this file):
//   POST /api/projects  → create a project (workspace-admin only)
//   GET  /api/projects  → list projects the session user is a member of
//                         (added in a follow-up commit)
//
// Project creation writes two rows in one Postgres transaction:
//   1. INSERT INTO projects (...)         RETURNING *
//   2. INSERT INTO project_members (...)  for the creator as admin
// Both must commit together — a project without its creator's
// admin row would leave the creator unable to access the project
// they just created.
import postgres from 'postgres';
import { error, json, requireWorkspaceAdmin } from '../../_lib/auth.js';

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
    const project = await sql.begin(async (sql) => {
      const [row] = await sql`
        INSERT INTO projects (name, description, owner_user_id)
        VALUES (${rawName}, ${description}, ${userIdText})
        RETURNING *
      `;

      // Per BLOCK_2_PLAN decision C and db/schema-postgres.sql comment:
      // the project owner is auto-added as admin in project_members.
      //   invited_by = NULL — no inviter (it's the owner)
      //   invited_at = NOW() — explicit even though it defaults
      //   joined_at  = NOW() — no pending-invite UX in v1.1 (decision D)
      await sql`
        INSERT INTO project_members
          (project_id, user_id, role, invited_by, invited_at, joined_at)
        VALUES
          (${row.id}, ${userIdText}, 'admin', NULL, NOW(), NOW())
      `;

      return row;
    });

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
