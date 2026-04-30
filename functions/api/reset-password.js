// functions/api/reset-password.js
import {
  error,
  hashPassword,
  isValidPassword,
  json,
} from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const token = body.token || '';
  const newPassword = body.password || '';

  if (!token || !isValidPassword(newPassword)) {
    return error('Invalid token or password (min 8 characters)', 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const reset = await env.DB
    .prepare(
      `SELECT token, user_id, expires_at, used_at
         FROM password_resets
        WHERE token = ?1`
    )
    .bind(token)
    .first();

  if (!reset || reset.used_at || reset.expires_at <= now) {
    return error('This reset link is invalid or has expired.', 400);
  }

  const hash = await hashPassword(newPassword);

  // Update password, mark token used, invalidate all other sessions for this user.
  await env.DB.batch([
    env.DB
      .prepare(`UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3`)
      .bind(hash, now, reset.user_id),
    env.DB
      .prepare(`UPDATE password_resets SET used_at = ?1 WHERE token = ?2`)
      .bind(now, token),
    env.DB
      .prepare(`DELETE FROM sessions WHERE user_id = ?1`)
      .bind(reset.user_id),
  ]);

  return json({ ok: true });
}
