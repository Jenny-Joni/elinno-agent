-- =============================================================================
-- Migration: 2026-05-04-encryption-algorithm-v1
-- =============================================================================
--
-- Update connections.encryption_algorithm default to the versioned envelope
-- scheme tag. -v1 names the envelope SCHEME, not the primitive — the suffix
-- preserves the option to define v2 later (different IV size, different AAD
-- shape, different cipher) without another schema migration at that point.
--
-- v1 envelope shape:
--   - AES-256-GCM via Web Crypto SubtleCrypto
--   - 12-byte random IV per credential ciphertext
--   - Per-credential DEK (32 bytes, generated fresh each encrypt call)
--     wrapped by a master key (Cloudflare Workers Secret MASTER_ENCRYPTION_KEY)
--   - AAD = length-prefixed bytes of (connection_id, project_id, source) as a
--     Uint8Array — 4-byte big-endian length prefix per component, ensuring
--     no two distinct triples can produce the same AAD bytes
--   - Stored layout:
--       wrapped_data_key       BYTEA = dek_iv (12 bytes) || wrapped_dek_with_tag
--       iv                     BYTEA = credential encryption IV (12 bytes)
--       ciphertext_credentials BYTEA = credential ciphertext + GCM auth tag
--       encryption_algorithm   TEXT  = 'aes-256-gcm-v1'
--
-- See functions/_lib/crypto.js header for full implementation notes.
--
-- IMPACT
-- ------
-- Zero existing rows affected: the connections table is empty as of this
-- migration (2026-05-04). The default applies to all new INSERTs that
-- omit the column — Block 3's connect endpoint sets the value explicitly,
-- but the column-level default is the safety net.
--
-- APPLY (Jenny, via Neon SQL Editor — per WORKFLOW Hard Limits):
--   1. Open Neon → Project "Elinno Agent" → branch "production"
--   2. Open SQL Editor against database elinno_agent_db
--   3. Paste this entire file, click Run
--   4. Verify with:
--        SELECT column_default
--          FROM information_schema.columns
--         WHERE table_name = 'connections'
--           AND column_name = 'encryption_algorithm';
--      Expected: 'aes-256-gcm-v1'::text
--
-- This migration MUST be applied before commit 4 (the connect endpoint
-- that writes connections rows). Until then, the file is committed for
-- reviewability and history but not applied to the database.
-- =============================================================================

ALTER TABLE connections
  ALTER COLUMN encryption_algorithm SET DEFAULT 'aes-256-gcm-v1';

COMMENT ON COLUMN connections.encryption_algorithm IS
  'Envelope scheme tag. v1 = AES-256-GCM + 12-byte random IV + per-credential DEK wrapped by master key + AAD = length-prefixed bytes of (connection_id, project_id, source) — 4-byte big-endian length prefix per component, ensuring no two distinct triples produce the same AAD bytes. See functions/_lib/crypto.js header for details.';
