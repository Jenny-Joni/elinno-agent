// TEMPORARY diagnostic endpoint. Remove after debugging the login issue.
// Hits the same code path as /api/login but returns verbose diagnostics.

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  const user = await env.DB
    .prepare(`SELECT id, email, password_hash FROM users WHERE email = ?1`)
    .bind(email)
    .first();

  if (!user) {
    return new Response(JSON.stringify({ step: 'lookup', found: false }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stored = user.password_hash;
  const parts = stored.split('$');
  const [scheme, itersStr, saltB64, hashB64] = parts;

  let salt, expected, actual, match;
  let saltDecoded = null, expectedDecoded = null, actualComputed = null;

  try {
    salt = base64Decode(saltB64);
    saltDecoded = Array.from(salt).slice(0, 4);
  } catch (e) {
    return jsonResp({ step: 'salt-decode', error: String(e) });
  }

  try {
    expected = base64Decode(hashB64);
    expectedDecoded = Array.from(expected).slice(0, 4);
  } catch (e) {
    return jsonResp({ step: 'hash-decode', error: String(e) });
  }

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: parseInt(itersStr, 10), hash: 'SHA-256' },
      key,
      expected.length * 8
    );
    actual = new Uint8Array(bits);
    actualComputed = Array.from(actual).slice(0, 4);
  } catch (e) {
    return jsonResp({ step: 'pbkdf2', error: String(e) });
  }

  match = actual.length === expected.length;
  if (match) {
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) { match = false; break; }
    }
  }

  return jsonResp({
    step: 'compare',
    parts_count: parts.length,
    scheme,
    iters: itersStr,
    saltB64_len: saltB64?.length,
    hashB64_len: hashB64?.length,
    salt_byte_len: salt.length,
    expected_byte_len: expected.length,
    actual_byte_len: actual.length,
    salt_first_4: saltDecoded,
    expected_first_4: expectedDecoded,
    actual_first_4: actualComputed,
    match,
  });
}

function jsonResp(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function base64Decode(str) {
  const s = atob(str);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
