// functions/_lib/crypto.js
// =========================================================================
// Envelope encryption helper for connector credentials.
//
// Implements Block 3 decisions A–F (see BLOCK_3_PLAN.md):
//
//   A. AES-256-GCM via Web Crypto SubtleCrypto. No third-party crypto
//      library — Workers SubtleCrypto is sufficient and supply-chain
//      surface stays at zero.
//   B. Envelope: KEK (master key, in Workers Secret) wraps a fresh
//      per-call DEK (32 bytes); DEK encrypts the credential plaintext.
//      AAD is bound to BOTH the wrap (DEK ciphertext) and the
//      credential ciphertext.
//   C. AAD = length-prefixed Uint8Array of (connection_id, project_id,
//      source) — 4-byte big-endian length prefix per component.
//      Unambiguous by construction (no two distinct triples can
//      produce the same AAD bytes), safe regardless of component
//      contents.
//   D. Master key loaded once per Workers isolate via importKey,
//      cached in a Map<string, CryptoKey> keyed by secret name. The
//      cache shape supports a future rotation that holds both old and
//      new keys concurrently without name collision.
//   E. Algorithm-version rotation (v1 → v2) NOT implemented; design
//      supports it via the encryption_algorithm column tag. Master-key
//      VALUE rotation (separate from algorithm rotation) also deferred
//      but the cache shape supports it. See decision E in
//      BLOCK_3_PLAN.md for both upgrade mechanisms.
//   F. This file. Generic encrypt/decrypt names — Block 4+ OAuth state
//      tokens may use this primitive too; not credentials-specific.
//
// SECURITY NOTES
// --------------
//   - The DEK plaintext exists only on the call stack between
//     `crypto.getRandomValues` and the wrap+encrypt operations. Never
//     assigned to module-level state, never logged, never serialized.
//   - Every encrypt() call generates a fresh DEK. Re-encrypting an
//     unchanged credential yields DIFFERENT ciphertext. This is
//     INTENTIONAL — rotation-friendly and defends against ciphertext-
//     equality oracles. Do NOT "optimize" by reusing DEKs.
//   - AAD must match exactly between encrypt and decrypt calls.
//     `aadFor(connection)` is the canonical builder; encrypt and
//     decrypt callers must use it. Do NOT construct AAD inline at
//     call sites.
//   - The master key value NEVER appears in code, logs, or git. Its
//     generation, distribution, and rotation are operator-side; this
//     module only loads it from the Workers Secret named
//     MASTER_ENCRYPTION_KEY.
//
// ON-DISK LAYOUT (matches db/schema-postgres.sql connections columns)
// -------------------------------------------------------------------
//   wrapped_data_key (BYTEA): dek_iv (12 bytes) || wrapped_dek_with_tag
//   iv               (BYTEA): credential encryption IV (12 bytes)
//   ciphertext_credentials (BYTEA): credential ciphertext + GCM auth tag
//   encryption_algorithm   (TEXT): 'aes-256-gcm-v1' (see migration)
// =========================================================================

const ALGORITHM_TAG = 'aes-256-gcm-v1';
const KEK_SECRET_NAME = 'MASTER_ENCRYPTION_KEY';
const DEK_BYTES = 32;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

// Module-scope cache. Workers reuse module-level state across requests
// within an isolate; without caching, every encrypt/decrypt would
// re-import the master key (an async, non-trivial operation).
//
// Map<string, CryptoKey> — keyed by Workers Secret name (not just
// "the imported key"). A future master-key rotation can hold
// MASTER_ENCRYPTION_KEY and MASTER_ENCRYPTION_KEY_NEW concurrently
// in the same cache without conflict.
//
// IMPORTANT: do not rotate by overwriting MASTER_ENCRYPTION_KEY
// in place. Running isolates will continue using the cached old
// key until they die — different requests will hit different
// keys during the propagation window, which is a correctness
// bug in the presence of any concurrent encrypt/decrypt activity.
// Use the MASTER_ENCRYPTION_KEY_NEW pattern documented in
// decision E of BLOCK_3_PLAN.md instead.
const keyCache = new Map();

// =========================================================================
// AAD construction (decision C)
// =========================================================================

/**
 * Build the AAD (additional authenticated data) for a connection.
 *
 * Returns a Uint8Array shaped as:
 *
 *   [ 4-byte BE length of bytes(connection.id)         ][ bytes(connection.id)         ]
 *   [ 4-byte BE length of bytes(connection.project_id) ][ bytes(connection.project_id) ]
 *   [ 4-byte BE length of bytes(connection.source)     ][ bytes(connection.source)     ]
 *
 * Length-prefixing (rather than a delimiter) makes the AAD unambiguous
 * by construction: no two distinct (id, project_id, source) triples
 * can produce the same byte sequence, regardless of component contents.
 *
 * @param {{ id: string, project_id: string, source: string }} connection
 * @returns {Uint8Array}
 */
export function aadFor(connection) {
  if (!connection || typeof connection !== 'object') {
    throw new Error('aadFor: connection must be an object');
  }
  const enc = new TextEncoder();
  const parts = ['id', 'project_id', 'source'].map((field) => {
    const value = connection[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `aadFor: connection.${field} must be a non-empty string`
      );
    }
    return enc.encode(value);
  });

  const totalLen = parts.reduce((sum, p) => sum + 4 + p.length, 0);
  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);
  let off = 0;
  for (const p of parts) {
    view.setUint32(off, p.length, false); // big-endian
    off += 4;
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// =========================================================================
// Master key loading + caching (decision D)
// =========================================================================

async function loadMasterKey(env, secretName = KEK_SECRET_NAME) {
  const cached = keyCache.get(secretName);
  if (cached) return cached;

  const b64 = env[secretName];
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new Error(`Missing or empty Workers Secret: ${secretName}`);
  }

  const raw = base64ToBytes(b64);
  if (raw.length !== DEK_BYTES) {
    throw new Error(
      `${secretName} must decode to ${DEK_BYTES} bytes (got ${raw.length})`
    );
  }

  const key = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    /* extractable */ false,
    ['encrypt', 'decrypt']
  );

  keyCache.set(secretName, key);
  return key;
}

// =========================================================================
// Encrypt (decisions A, B, C)
// =========================================================================

/**
 * Encrypt a plaintext string under envelope encryption.
 *
 * @param {object} env - Pages Function env (must have MASTER_ENCRYPTION_KEY)
 * @param {string} plaintext - The credential payload to protect
 * @param {Uint8Array} aad - Additional authenticated data (use aadFor)
 * @returns {Promise<{
 *   wrapped_data_key: Uint8Array,
 *   iv: Uint8Array,
 *   ciphertext: Uint8Array,
 *   algorithm: string
 * }>}
 */
export async function encrypt(env, plaintext, aad) {
  if (typeof plaintext !== 'string') {
    throw new Error('encrypt: plaintext must be a string');
  }
  if (!(aad instanceof Uint8Array)) {
    throw new Error('encrypt: aad must be a Uint8Array (use aadFor)');
  }

  const masterKey = await loadMasterKey(env);

  // Fresh DEK per call (decision B). The DEK plaintext exists only
  // until this function returns; never persisted, never logged.
  const dekBytes = new Uint8Array(DEK_BYTES);
  crypto.getRandomValues(dekBytes);

  // Two independent random IVs — one for credential encryption (under
  // the DEK), one for wrapping the DEK (under the master key).
  const credIv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(credIv);
  const dekIv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(dekIv);

  // Import the DEK as a CryptoKey for credential encryption.
  const dekKey = await crypto.subtle.importKey(
    'raw',
    dekBytes,
    { name: 'AES-GCM' },
    /* extractable */ false,
    ['encrypt']
  );

  // Encrypt the credential under the DEK with AAD.
  const ptBytes = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: credIv, additionalData: aad },
      dekKey,
      ptBytes
    )
  );

  // Wrap the DEK under the master key with the same AAD.
  const wrappedDek = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: dekIv, additionalData: aad },
      masterKey,
      dekBytes
    )
  );

  // Pack dek_iv || wrapped_dek_with_tag into wrapped_data_key.
  const wrappedDataKey = new Uint8Array(IV_BYTES + wrappedDek.length);
  wrappedDataKey.set(dekIv, 0);
  wrappedDataKey.set(wrappedDek, IV_BYTES);

  return {
    wrapped_data_key: wrappedDataKey,
    iv: credIv,
    ciphertext,
    algorithm: ALGORITHM_TAG,
  };
}

// =========================================================================
// Decrypt (decisions A, B, C)
// =========================================================================

/**
 * Decrypt a stored credential row back to plaintext.
 *
 * @param {object} env - Pages Function env (must have MASTER_ENCRYPTION_KEY)
 * @param {{
 *   wrapped_data_key: Uint8Array,
 *   iv: Uint8Array,
 *   ciphertext_credentials: Uint8Array,
 *   encryption_algorithm: string
 * }} row - The row read from the connections table (snake_case columns)
 * @param {Uint8Array} aad - Additional authenticated data (must match
 *                           the aad used at encrypt time, via aadFor)
 * @returns {Promise<string>} The original plaintext
 */
export async function decrypt(env, row, aad) {
  if (!row || typeof row !== 'object') {
    throw new Error('decrypt: row must be an object');
  }
  if (!(aad instanceof Uint8Array)) {
    throw new Error('decrypt: aad must be a Uint8Array (use aadFor)');
  }

  const algo = row.encryption_algorithm;
  if (algo !== ALGORITHM_TAG) {
    throw new Error(
      `decrypt: unsupported encryption_algorithm '${algo}' (expected '${ALGORITHM_TAG}')`
    );
  }

  // Postgres BYTEA columns come back as Buffer/Uint8Array via the
  // `postgres` library + nodejs_compat. Buffer is a Uint8Array subclass,
  // so instanceof Uint8Array is true for both.
  const wrapped = toUint8Array(row.wrapped_data_key, 'wrapped_data_key');
  const iv = toUint8Array(row.iv, 'iv');
  const ciphertext = toUint8Array(
    row.ciphertext_credentials,
    'ciphertext_credentials'
  );

  // Minimum sizes: wrapped_data_key = IV (12) + wrapped DEK (32 + 16 tag) = 60.
  if (wrapped.length < IV_BYTES + DEK_BYTES + GCM_TAG_BYTES) {
    throw new Error(
      `decrypt: wrapped_data_key too short (${wrapped.length} bytes; min ${IV_BYTES + DEK_BYTES + GCM_TAG_BYTES})`
    );
  }
  if (iv.length !== IV_BYTES) {
    throw new Error(
      `decrypt: iv must be ${IV_BYTES} bytes (got ${iv.length})`
    );
  }
  if (ciphertext.length < GCM_TAG_BYTES) {
    throw new Error(
      `decrypt: ciphertext_credentials too short (${ciphertext.length} bytes; min ${GCM_TAG_BYTES})`
    );
  }

  const masterKey = await loadMasterKey(env);

  // Unpack dek_iv || wrapped_dek_with_tag.
  const dekIv = wrapped.subarray(0, IV_BYTES);
  const wrappedDek = wrapped.subarray(IV_BYTES);

  // Unwrap the DEK under the master key with AAD. If the row was
  // tampered with — connection_id swapped, project_id moved across
  // projects, source changed — the AAD here will not match what was
  // used at encrypt time and SubtleCrypto will throw an
  // OperationError. Do NOT catch and recover; the throw is the
  // tampering signal.
  const dekBytes = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: dekIv, additionalData: aad },
      masterKey,
      wrappedDek
    )
  );

  if (dekBytes.length !== DEK_BYTES) {
    throw new Error(
      `decrypt: unwrapped DEK has wrong length (${dekBytes.length})`
    );
  }

  const dekKey = await crypto.subtle.importKey(
    'raw',
    dekBytes,
    { name: 'AES-GCM' },
    /* extractable */ false,
    ['decrypt']
  );

  // Decrypt the credential payload under the DEK with the same AAD.
  const ptBytes = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      dekKey,
      ciphertext
    )
  );

  return new TextDecoder().decode(ptBytes);
}

// =========================================================================
// Internal helpers
// =========================================================================

function base64ToBytes(b64) {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toUint8Array(value, fieldName) {
  if (value instanceof Uint8Array) return value;
  if (value && typeof value === 'object' && 'buffer' in value) {
    // Handles Node Buffer (extends Uint8Array but instanceof check
    // can fail across realm boundaries) and ArrayBufferView shapes.
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(
    `decrypt: ${fieldName} must be Uint8Array/Buffer/ArrayBuffer (got ${typeof value})`
  );
}
