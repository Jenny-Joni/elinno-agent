// functions/_lib/cron_auth.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
// HMAC-SHA256 verification for cron-Worker -> Pages-endpoint traffic.
// This is the trust boundary for /api/cron/*. Per WORKFLOW.md any change
// to the constant-time comparison, replay window, or hash composition
// is a re-lock trigger.
// =========================================================================
//
// Per BLOCK_9_PLAN.md §9.4 decision R:
//   - Header:    X-Cron-Auth: t=<unix>,v1=<hex>
//   - Body hash: sha256(body) hex
//   - Signature: HMAC-SHA256 over `${t}:${sha256(body)}` using env.CRON_SECRET
//   - Replay:    |now - t| <= 300 seconds (5 min)
//   - Compare:   constant-time (XOR-accumulate hex string compare —
//                Workers' Web Crypto has no timingSafeEqual; this is
//                the canonical pattern, cf. NaCl crypto_bytes_compare)
//
// JSON.stringify MUST be called with NO second arg on both sender and
// verifier (canonical compact form) so the hashed body bytes match.
//
// Returns:
//   { ok: true }                         on valid signature within window
//   { ok: false, reason: <short_token> } otherwise (caller maps -> 401)
// =========================================================================

const REPLAY_WINDOW_SECONDS = 300;

/**
 * Constant-time hex string compare. Equal-length precheck, then XOR-
 * accumulate over every byte. No early-exit, no length-conditional return
 * past the length check itself (a length mismatch is not a secret).
 * cf. NaCl crypto_bytes_compare.
 */
function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(keyText, dataText) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyText),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(dataText));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Parses `X-Cron-Auth: t=<unix>,v1=<hex>` into { t, v1 }.
 * Returns null on shape mismatch.
 */
function parseAuthHeader(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const parts = headerValue.split(',').map((s) => s.trim());
  let t = null;
  let v1 = null;
  for (const part of parts) {
    if (part.startsWith('t=')) t = part.slice(2);
    else if (part.startsWith('v1=')) v1 = part.slice(3);
  }
  if (!t || !v1) return null;
  const tNum = parseInt(t, 10);
  if (!Number.isFinite(tNum) || tNum <= 0) return null;
  return { t: tNum, v1 };
}

/**
 * Verify the X-Cron-Auth header against the given body text.
 *
 * Caller contract:
 *   1. Read body once as text BEFORE calling: const body = await request.text()
 *   2. Pass the same text in. The body bytes must match what the cron
 *      Worker signed — re-parsing/re-stringifying changes whitespace
 *      and breaks the hash. Use JSON.stringify(obj) with NO second arg
 *      on the sender.
 */
export async function verifyCronAuth(request, bodyText, env) {
  if (!env || typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length === 0) {
    return { ok: false, reason: 'cron_secret_missing' };
  }
  const headerValue = request.headers.get('X-Cron-Auth');
  const parsed = parseAuthHeader(headerValue);
  if (!parsed) return { ok: false, reason: 'header_malformed' };

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsed.t) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const enc = new TextEncoder();
  const bodyBytes = enc.encode(bodyText || '');
  const bodyHashHex = await sha256Hex(bodyBytes);
  const payload = `${parsed.t}:${bodyHashHex}`;
  const expectedSig = await hmacSha256Hex(env.CRON_SECRET, payload);

  if (!constantTimeEqualHex(expectedSig, parsed.v1)) {
    return { ok: false, reason: 'signature_invalid' };
  }
  return { ok: true };
}
