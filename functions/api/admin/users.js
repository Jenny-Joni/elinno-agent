// functions/api/admin/users.js
import {
  error,
  getSessionUser,
  hashPassword,
  isValidEmail,
  isValidPassword,
  json,
} from '../../_lib/auth.js';
import { sendWelcomeEmail } from '../../_lib/email.js';

async function requireAdmin(request, env) {
  const user = await getSessionUser(request, env.DB);
  if (!user) return { error: error('Not authenticated', 401) };
  if (!user.is_admin) return { error: error('Forbidden', 403) };
  return { user };
}

// Display name shape (Block 13.2): trimmed string, 1–80 chars. Block 13.2
// requires display_name on create + edit; an empty string is the column-
// default sentinel for the migration backfill, not a user-supplied value.
function isValidDisplayName(s) {
  return typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= 80;
}

// GET /api/admin/users — list all users
export async function onRequestGet({ request, env }) {
  const { error: errResp } = await requireAdmin(request, env);
  if (errResp) return errResp;

  const result = await env.DB
    .prepare(
      `SELECT id, email, display_name, is_admin, created_at
         FROM users
        ORDER BY created_at DESC`
    )
    .all();

  return json({
    users: (result.results || []).map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name || '',
      is_admin: !!u.is_admin,
      created_at: u.created_at,
    })),
  });
}

// POST /api/admin/users — create a new user
//   body: { display_name, email, password, is_admin? }
export async function onRequestPost({ request, env }) {
  const { error: errResp } = await requireAdmin(request, env);
  if (errResp) return errResp;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const displayName = (body.display_name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const isAdmin = body.is_admin ? 1 : 0;

  if (!isValidDisplayName(displayName)) return error('Display name is required (1–80 chars)', 400);
  if (!isValidEmail(email)) return error('Invalid email', 400);
  if (!isValidPassword(password)) return error('Password must be at least 8 characters', 400);

  const existing = await env.DB
    .prepare(`SELECT id FROM users WHERE email = ?1`)
    .bind(email)
    .first();
  if (existing) return error('A user with this email already exists', 409);

  const hash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);

  const result = await env.DB
    .prepare(
      `INSERT INTO users (email, password_hash, is_admin, display_name, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`
    )
    .bind(email, hash, isAdmin, displayName, now)
    .run();

  // Welcome email with the admin-set credentials + login link. Failures
  // are logged inside email.js; we surface the result on the response so
  // the admin UI can warn if delivery didn't go out, but a send failure
  // does NOT roll back the user create.
  const mail = await sendWelcomeEmail(env, email, displayName, password);

  return json({
    ok: true,
    user: {
      id: result.meta.last_row_id,
      email,
      display_name: displayName,
      is_admin: !!isAdmin,
      created_at: now,
    },
    email_sent: mail.ok,
  });
}
