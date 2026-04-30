// functions/_lib/auth.js
// Shared helpers for the Elinno Agent auth system.
// Uses only Web Crypto APIs available in Cloudflare Workers / Pages Functions.

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
      `SELECT u.id, u.email, u.is_admin, s.expires_at
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
