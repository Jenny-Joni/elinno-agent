// functions/api/crypto-roundtrip.js
// =========================================================================
// Crypto smoke-test endpoint (Block 3).
//
// Exercises encrypt/decrypt + AAD binding end-to-end. Catches "encryption
// silently broken" failure modes (AAD not actually wired, master key
// missing or wrong length, importKey failing in this runtime, etc.)
// EARLIER in the verification chain than the connect-then-testConnection
// flow does.
//
// SECURITY GATE (locked per BLOCK_3_PLAN.md "Roundtrip endpoint gating"):
//
//   - Returns 404 in production.
//   - Returns the smoke result only when env.ALLOW_CRYPTO_SMOKE === 'true'.
//   - Set ALLOW_CRYPTO_SMOKE=true on the Preview environment ONLY (via
//     `npx wrangler pages secret put ALLOW_CRYPTO_SMOKE` for the Preview
//     env, or as a Preview-scoped `var` in wrangler.toml).
//   - The endpoint uses a hardcoded test plaintext and synthetic
//     connection IDs — never accepts user input that would touch the
//     master key or any real credential row.
//
// WHAT IT CHECKS
// --------------
//   1. encrypt() succeeds and returns the expected envelope shape.
//   2. decrypt() round-trips byte-identical to the original plaintext.
//   3. AAD binding: decrypt() with a TAMPERED AAD (different
//      project_id) MUST throw. If it succeeds, the AAD is not being
//      passed through SubtleCrypto's additionalData — a silent failure
//      mode that no functional test catches.
//   4. The algorithm tag matches the locked value.
// =========================================================================

import { aadFor, decrypt, encrypt } from '../_lib/crypto.js';

const TEST_PLAINTEXT = 'smoke-test-plaintext-do-not-use-as-real-credential';
const TEST_CONNECTION = {
  // Synthetic IDs — NOT real connection rows. Distinct, recognizable
  // sentinels so any production-row collision is obvious.
  id: '00000000-0000-0000-0000-00000000c01d',
  project_id: '00000000-0000-0000-0000-0000000050da',
  source: 'dummy',
};

export async function onRequestGet({ env }) {
  if (env.ALLOW_CRYPTO_SMOKE !== 'true') {
    return new Response('Not Found', { status: 404 });
  }

  const checks = {};

  try {
    const aad = aadFor(TEST_CONNECTION);

    const encrypted = await encrypt(env, TEST_PLAINTEXT, aad);
    checks.encrypt_returned_shape =
      encrypted.wrapped_data_key instanceof Uint8Array &&
      encrypted.iv instanceof Uint8Array &&
      encrypted.ciphertext instanceof Uint8Array &&
      typeof encrypted.algorithm === 'string';

    checks.algorithm_tag = encrypted.algorithm;
    checks.algorithm_tag_matches = encrypted.algorithm === 'aes-256-gcm-v1';

    checks.wrapped_data_key_length = encrypted.wrapped_data_key.length;
    checks.iv_length = encrypted.iv.length;
    checks.ciphertext_length = encrypted.ciphertext.length;

    // Plaintext-leak guard: the ciphertext must not be the UTF-8 bytes
    // of the plaintext. (Cheap sanity check; real check is byte-for-
    // byte inequality below.)
    const ptBytes = new TextEncoder().encode(TEST_PLAINTEXT);
    checks.ciphertext_is_not_plaintext =
      encrypted.ciphertext.length !== ptBytes.length ||
      !bytesEqual(encrypted.ciphertext, ptBytes);

    // Round-trip: decrypt should reproduce the original plaintext
    // exactly.
    const row = {
      wrapped_data_key: encrypted.wrapped_data_key,
      iv: encrypted.iv,
      ciphertext_credentials: encrypted.ciphertext,
      encryption_algorithm: encrypted.algorithm,
    };
    const decrypted = await decrypt(env, row, aad);
    checks.roundtrip_matches = decrypted === TEST_PLAINTEXT;

    // AAD-tampering detection: decrypting with the wrong AAD MUST
    // throw. If it doesn't, AAD isn't actually being passed through
    // additionalData — the binding exists in code but has no security
    // effect.
    const tamperedConnection = {
      ...TEST_CONNECTION,
      project_id: '00000000-0000-0000-0000-0000000fffff',
    };
    const tamperedAad = aadFor(tamperedConnection);
    let aadDetected = false;
    try {
      await decrypt(env, row, tamperedAad);
      aadDetected = false;
    } catch (_) {
      aadDetected = true;
    }
    checks.aad_tampering_detected = aadDetected;

    const allOk =
      checks.encrypt_returned_shape === true &&
      checks.algorithm_tag_matches === true &&
      checks.ciphertext_is_not_plaintext === true &&
      checks.roundtrip_matches === true &&
      checks.aad_tampering_detected === true;

    return json({ ok: allOk, checks }, allOk ? 200 : 500);
  } catch (err) {
    return json(
      {
        ok: false,
        error: String(err && err.message ? err.message : err),
        checks,
      },
      500
    );
  }
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
