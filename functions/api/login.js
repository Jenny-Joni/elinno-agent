// functions/api/login.js
import {
  buildSessionCookie,
  createSession,
  error,
  isValidEmail,
  json,
  verifyPassword,
} from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!isValidEmail(email) || !password) {
    return error('Invalid email or password', 400);
  }

  const user = await env.DB
    .prepare(`SELECT id, email, password_hash, is_admin FROM users WHERE email = ?1`)
    .bind(email)
    .first();

  // Always run verifyPassword to mitigate timing leaks of which emails exist.
  // Use a dummy hash if the user doesn't exist.
  const dummy = 'pbkdf2$310000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const ok = await verifyPassword(password, user ? user.password_hash : dummy);

  if (!user || !ok) {
    return error('Invalid email or password', 401);
  }

  const token = await createSession(env.DB, user.id);

  return json(
    { ok: true, user: { id: user.id, email: user.email, is_admin: !!user.is_admin } },
    { headers: { 'Set-Cookie': buildSessionCookie(token) } }
  );
}
