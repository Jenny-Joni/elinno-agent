// functions/api/admin/users/[id].js
import { error, getSessionUser, hashPassword, isValidPassword, json } from '../../../_lib/auth.js';

function isValidDisplayName(s) {
  return typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= 80;
}

async function requireAdminAndTarget(request, env, params) {
  const sessionUser = await getSessionUser(request, env.DB);
  if (!sessionUser) return { errResp: error('Not authenticated', 401) };
  if (!sessionUser.is_admin) return { errResp: error('Forbidden', 403) };

  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return { errResp: error('Invalid user id', 400) };

  const target = await env.DB
    .prepare(`SELECT id, is_admin FROM users WHERE id = ?1`)
    .bind(id)
    .first();
  if (!target) return { errResp: error('User not found', 404) };

  return { sessionUser, id, target };
}

async function countAdmins(env) {
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE is_admin = 1`)
    .first();
  return row?.c || 0;
}

export async function onRequestDelete({ request, env, params }) {
  const { errResp, sessionUser, id, target } = await requireAdminAndTarget(request, env, params);
  if (errResp) return errResp;

  // Block deleting yourself — admins should not be able to lock themselves out.
  if (id === sessionUser.id) {
    return error('You cannot delete your own account', 400);
  }

  // Block deleting the last admin.
  if (target.is_admin) {
    if ((await countAdmins(env)) <= 1) {
      return error('Cannot delete the last admin', 400);
    }
  }

  // ON DELETE CASCADE on sessions/password_resets will handle cleanup.
  await env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(id).run();
  return json({ ok: true });
}

// PATCH /api/admin/users/[id]
//   body: { display_name?, is_admin?, password? }   // each field optional, at least one required
//
// - display_name : free-text rename (1–80 chars post-trim).
// - is_admin     : role flip. Demoting an admin while they're the only one
//                  in the workspace is rejected (last-admin guard). Both
//                  promote-self and demote-self are allowed unless the
//                  demote would empty the admin set.
// - password     : admin sets a new password on the target user. Crypto
//                  path is the existing PBKDF2-100k via hashPassword — no
//                  new primitive introduced (matches POST /api/admin/users
//                  and reset-password.js).
//
// Returns the updated row (id, email, display_name, is_admin, created_at).
export async function onRequestPatch({ request, env, params }) {
  const { errResp, sessionUser, id, target } = await requireAdminAndTarget(request, env, params);
  if (errResp) return errResp;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  // Build SET clauses dynamically — each field is optional.
  const sets = [];
  const binds = [];

  if (Object.prototype.hasOwnProperty.call(body, 'display_name')) {
    const dn = (body.display_name || '').trim();
    if (!isValidDisplayName(dn)) return error('Display name must be 1–80 characters', 400);
    sets.push(`display_name = ?${sets.length + 1}`);
    binds.push(dn);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'is_admin')) {
    const next = body.is_admin ? 1 : 0;
    const cur = target.is_admin ? 1 : 0;
    if (next !== cur) {
      // Demote: enforce last-admin guard. Promote: no guard.
      if (cur === 1 && next === 0) {
        if ((await countAdmins(env)) <= 1) {
          return error('Cannot demote the last admin', 400);
        }
      }
      sets.push(`is_admin = ?${sets.length + 1}`);
      binds.push(next);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'password')) {
    const pw = body.password || '';
    if (!isValidPassword(pw)) return error('Password must be at least 8 characters', 400);
    // CRYPTO CARVE-OUT: admin sets a new password on another user. Same
    // PBKDF2-SHA256 100k path as POST /api/admin/users and reset-password.js.
    // No new primitives, no plaintext persistence (only the hash is stored).
    const hash = await hashPassword(pw);
    sets.push(`password_hash = ?${sets.length + 1}`);
    binds.push(hash);
  }

  if (sets.length === 0) {
    return error('Provide at least one of: display_name, is_admin, password', 400);
  }

  const now = Math.floor(Date.now() / 1000);
  sets.push(`updated_at = ?${sets.length + 1}`);
  binds.push(now);

  binds.push(id);
  const sql = `UPDATE users SET ${sets.join(', ')} WHERE id = ?${binds.length}`;
  await env.DB.prepare(sql).bind(...binds).run();

  // Return the updated row.
  const updated = await env.DB
    .prepare(
      `SELECT id, email, display_name, is_admin, created_at
         FROM users
        WHERE id = ?1`
    )
    .bind(id)
    .first();

  return json({
    ok: true,
    user: {
      id: updated.id,
      email: updated.email,
      display_name: updated.display_name || '',
      is_admin: !!updated.is_admin,
      created_at: updated.created_at,
    },
  });
}
