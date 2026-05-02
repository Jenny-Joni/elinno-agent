// functions/api/projects/[id]/members/index.js
//
// Block 2 Sub-task 2.2 — project members API.
//
// Routes (this file):
//   POST /api/projects/:id/members  → invite an existing user to a project
//                                      (project-admin only)
//   GET  /api/projects/:id/members  → list members of a project
//                                      (project-member-or-admin)
//
// Cross-DB seam: project_members lives in Postgres; user identity lives
// in D1. Invites resolve email → D1 user_id, then write the membership
// row in Postgres. Existing-users-only per BLOCK_2_PLAN decision D —
// non-existent emails return a friendly 404, no pending-invite state.
import postgres from 'postgres';
import {
  error,
  isValidEmail,
  json,
  requireProjectRole,
} from '../../../../_lib/auth.js';

export async function onRequestPost({ request, env, params }) {
  const { error: errResp, user } = await requireProjectRole(
    request,
    env,
    params.id,
    'admin'
  );
  if (errResp) return errResp;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isValidEmail(rawEmail)) {
    return error('Invalid email', 400);
  }

  // D1 lookup (existing-users-only per decision D). The friendly error
  // message is the exact wording from the plan — surfaces to the UI.
  const targetUser = await env.DB
    .prepare(`SELECT id, email FROM users WHERE email = ?1`)
    .bind(rawEmail)
    .first();

  if (!targetUser) {
    return error(
      'No Elinno account with this email. Ask your admin to create the account first.',
      404
    );
  }

  const targetUserIdText = String(targetUser.id);
  const inviterUserIdText = String(user.id);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const [member] = await sql`
      INSERT INTO project_members
        (project_id, user_id, role, invited_by, invited_at, joined_at)
      VALUES
        (${params.id}, ${targetUserIdText}, 'member', ${inviterUserIdText}, NOW(), NOW())
      RETURNING user_id, role, invited_by, invited_at, joined_at
    `;

    return json(
      {
        ok: true,
        member: {
          ...member,
          email: targetUser.email,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    // Postgres unique-violation on (project_id, user_id) PK — user is
    // already a member of this project (active or pending — but pending
    // doesn't happen in v1.1). 409 is the canonical conflict response.
    if (err?.code === '23505') {
      return error('User is already a member of this project', 409);
    }
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup; never masks the return value
    }
  }
}
