// functions/api/admin/users/[id].js
import { error, getSessionUser, json } from '../../../_lib/auth.js';

export async function onRequestDelete({ request, env, params }) {
  const sessionUser = await getSessionUser(request, env.DB);
  if (!sessionUser) return error('Not authenticated', 401);
  if (!sessionUser.is_admin) return error('Forbidden', 403);

  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return error('Invalid user id', 400);

  // Block deleting yourself — admins should not be able to lock themselves out.
  if (id === sessionUser.id) {
    return error('You cannot delete your own account', 400);
  }

  // Block deleting the last admin.
  const target = await env.DB
    .prepare(`SELECT id, is_admin FROM users WHERE id = ?1`)
    .bind(id)
    .first();
  if (!target) return error('User not found', 404);

  if (target.is_admin) {
    const adminCount = await env.DB
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE is_admin = 1`)
      .first();
    if ((adminCount?.c || 0) <= 1) {
      return error('Cannot delete the last admin', 400);
    }
  }

  // ON DELETE CASCADE on sessions/password_resets will handle cleanup.
  await env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(id).run();
  return json({ ok: true });
}
