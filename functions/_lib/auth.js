// functions/_lib/auth.js
// Shared helpers for the Elinno Agent auth system.
// Uses Web Crypto APIs (D1-side: sessions, password hashing) and the
// `postgres` client (Postgres-side: project liveness check). Both
// bindings — env.DB (D1) and env.HYPERDRIVE (Hyperdrive → Neon) — are
// declared in wrangler.toml.
//
// v1.3 (Block 12.1): per-project membership collapsed. `requireProjectRole`
// is replaced by `requireWorkspaceScope`, which originally enforced
// workspace = projects.owner_user_id = session user's id (BLOCK_12_PLAN
// decision E + I).
//
// 2026-05-27 (shared-workspace-visibility): PROJECT visibility is now a
// single shared workspace — any authenticated user can see/use any
// non-deleted project. `requireWorkspaceScope` no longer filters by
// owner_user_id; it only checks the project exists and isn't soft-deleted.
// `requireWorkspaceAdmin` (D1 users.is_admin = 1) is unchanged and
// continues to gate edit/create/delete operations. `owner_user_id` is
// preserved as the project's CREATOR record (used by
// `getAdminEmailsForProject` for cost-cap notifications).
//
// CONVERSATIONS remain per-user — `conversations.user_id` continues to
// scope cross-project and per-project chat history per creator. See
// functions/_lib/workspace.js for the canonical "current user" id
// used by those filters.

import postgres from 'postgres';

// ---------- Constants ---------------------------------------------------

export const SESSION_COOKIE = 'ea_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;   // 7 days
export const RESET_TTL_SECONDS = 60 * 60;              // 1 hour
// Cloudflare Workers' Web Crypto caps PBKDF2 iterations at 100,000.
// (Original target was 310k per OWASP 2023, but the runtime rejects values above 100k.
//  Document this in PRD.md if you ever consider raising it.)
export const PBKDF2_ITERATIONS = 100_000;

// ---------- Random tokens ----------------------------------------------

/** Cryptographically random URL-safe token. */
export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

// ---------- Password hashing (PBKDF2-SHA256) ---------------------------

/** Hash a password. Returns "pbkdf2$<iters>$<salt_b64>$<hash_b64>". */
export async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64Encode(salt)}$${base64Encode(hash)}`;
}

/** Verify a password against a stored hash. Constant-time compare. */
export async function verifyPassword(password, stored) {
  try {
    const [scheme, itersStr, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'pbkdf2') return false;
    const iters = parseInt(itersStr, 10);
    const salt = base64Decode(saltB64);
    const expected = base64Decode(hashB64);
    const actual = await pbkdf2(password, salt, iters, expected.length);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function pbkdf2(password, salt, iterations, byteLength = 32) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    byteLength * 8
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- Base64 helpers ---------------------------------------------

function base64Encode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function base64Decode(str) {
  const s = atob(str);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
function base64urlEncode(bytes) {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- Cookie helpers ---------------------------------------------

export function buildSessionCookie(token, maxAgeSeconds = SESSION_TTL_SECONDS) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join('; ');
}

export function buildClearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

// ---------- Session lookup ---------------------------------------------

/**
 * Look up the current user from the session cookie.
 * Returns the user row (with is_admin as 0/1) or null.
 */
export async function getSessionUser(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.is_admin, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ?1
          AND s.expires_at > ?2`
    )
    .bind(token, now)
    .first();

  return row || null;
}

export async function createSession(db, userId) {
  const token = randomToken(32);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;
  await db
    .prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(token, userId, now, expiresAt)
    .run();
  return token;
}

export async function deleteSession(db, token) {
  if (!token) return;
  await db.prepare(`DELETE FROM sessions WHERE token = ?1`).bind(token).run();
}

// ---------- JSON response helpers --------------------------------------

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, { status });
}

// ---------- Validation -------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 320 && EMAIL_RE.test(email);
}

export function isValidPassword(pw) {
  // Minimum: 8 chars. Keep loose; we leave complexity up to user.
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 256;
}

// ---------- Workspace-admin gating -------------------------------------

/**
 * Gate a handler on workspace-admin (D1 users.is_admin = 1).
 *
 * Distinct from requireProjectRole: workspace-admin operates at the
 * D1 user level (e.g., creating a brand-new project, managing global
 * users), while requireProjectRole operates at the Postgres
 * project_members level (e.g., reading or modifying an existing project).
 *
 * Returns `{ error: Response }` on failure for early-return, or
 * `{ user }` on success. Same shape as requireProjectRole's success
 * tuple minus role (workspace-admin doesn't have a role to report).
 */
export async function requireWorkspaceAdmin(request, env) {
  const user = await getSessionUser(request, env.DB);
  if (!user) return { error: error('Not authenticated', 401) };
  if (!user.is_admin) return { error: error('Forbidden', 403) };
  return { user };
}

// ---------- Workspace-scoped access ------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verify the requested project exists and is not soft-deleted. v1.3
 * replaced v1.1/v1.2 `requireProjectRole` with a workspace-scope check
 * (projects.owner_user_id = session user's id).
 *
 * 2026-05-27 (shared-workspace-visibility): the per-user workspace
 * predicate is gone. Any authenticated user can reach any live project.
 * The check is now: session valid + projectId is a UUID + project row
 * exists + project not soft-deleted.
 *
 * Returns `{ error: Response }` on failure for early-return, or
 * `{ user }` on success. Edit/create/delete operations layer
 * `requireWorkspaceAdmin` (D1 users.is_admin = 1) on top.
 *
 * @param {Request} request - Pages Function request (cookies live here)
 * @param {object} env - Pages Function env (env.DB + env.HYPERDRIVE)
 * @param {string} projectId - From URL path :id
 * @returns {Promise<{user: object} | {error: Response}>}
 */
export async function requireWorkspaceScope(request, env, projectId) {
  const user = await getSessionUser(request, env.DB);
  if (!user) return { error: error('Not authenticated', 401) };

  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
    return { error: error('Invalid project id', 400) };
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const rows = await sql`
      SELECT 1
        FROM projects
       WHERE id            = ${projectId}
         AND deleted_at    IS NULL
       LIMIT 1
    `;

    if (rows.length === 0) {
      return { error: error('Not found', 404) };
    }

    return { user };
  } catch (_err) {
    return { error: error('Internal error', 500) };
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup; never masks the return value
    }
  }
}
