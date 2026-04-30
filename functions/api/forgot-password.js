// functions/api/forgot-password.js
import {
  RESET_TTL_SECONDS,
  error,
  isValidEmail,
  json,
  randomToken,
} from '../_lib/auth.js';
import { sendPasswordResetEmail } from '../_lib/email.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return error('Invalid email', 400);
  }

  const user = await env.DB
    .prepare(`SELECT id FROM users WHERE email = ?1`)
    .bind(email)
    .first();

  // Don't leak whether the email exists — always return ok.
  if (user) {
    const token = randomToken(32);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + RESET_TTL_SECONDS;

    await env.DB
      .prepare(
        `INSERT INTO password_resets (token, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`
      )
      .bind(token, user.id, now, expiresAt)
      .run();

    const siteUrl = env.SITE_URL || new URL(request.url).origin;
    const resetUrl = `${siteUrl}/reset-password.html?token=${encodeURIComponent(token)}`;

    // Fire-and-forget; we still return ok even if send fails so we don't leak.
    await sendPasswordResetEmail(env, email, resetUrl);
  }

  return json({ ok: true });
}
