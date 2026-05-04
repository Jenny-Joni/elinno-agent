-- =============================================================================
-- Migration: pending-oauth-state
-- Date: 2026-05-04
-- Block: Block 4 commit 3
-- =============================================================================
--
-- PURPOSE
-- -------
-- Prepares the connections table for OAuth's two-step flow (startAuth →
-- callback). Two changes, both per BLOCK_4_PLAN.md decisions C1 and C3:
--
--   C1 — Allow NULL on encryption columns at status='pending', plus a
--        CHECK constraint enforcing presence at non-pending status.
--
--   C3 — Add initiated_by_user_id column to bind an OAuth flow to the
--        session that initiated it (CSRF mitigation; the canonical
--        "OAuth login CSRF" defense).
--
-- WHY C1 IS CONSTRUCTED THIS WAY
-- ------------------------------
-- The naive alternative — write placeholder bytes into the encryption
-- columns at startAuth INSERT time and UPDATE them with real bytes on
-- callback — creates a write window where AAD attests "this placeholder
-- is bound to (id, project_id, source)". If between INSERT and UPDATE
-- an attacker (or a code bug) substitutes different real bytes, AAD
-- validation against the substituted bytes can succeed using the same
-- triple — because AAD attests the triple, not the credential identity.
-- The Block 3 envelope helper (functions/_lib/crypto.js) applies AAD to
-- BOTH the DEK wrap AND the credential ciphertext, which makes this
-- attack class detectable IF the encryption columns are NEVER populated
-- under invalid binding. NULL-allow + CHECK forces "no encrypted bytes
-- ever sit in the row under invalid binding"; the AAD invariant is
-- preserved end-to-end.
--
-- The CHECK constraint adds a second invariant: no row can ever drift
-- to status='active' (or any non-pending status) without all three
-- encryption columns populated.
--
-- WHY C3 IS NEEDED
-- ----------------
-- Without initiated_by_user_id, an attacker can mount the canonical
-- OAuth login CSRF: initiate an OAuth flow against their own
-- elinno-agent project on their own machine, then trick a victim
-- (phishing, malicious page, cross-site iframe) into completing the
-- callback from the victim's session. The callback has no way to
-- distinguish "the admin who initiated is completing" from "a different
-- admin is completing someone else's pending row" — token exchange
-- succeeds, attacker's project gets the victim's Slack workspace
-- connected.
--
-- With initiated_by_user_id set at startAuth INSERT and verified at
-- callback against the session user, mismatch is 403-collapse with the
-- row staying pending (the original initiator can still retry).
--
-- APPLICATION TIMING
-- ------------------
-- This file lands in the Block 4 branch as part of commit 3 BUT IS NOT
-- APPLIED at commit time. Per WORKFLOW.md Hard Limits ("No production
-- DDL"), DDL on the Neon production branch is Jenny's hands. Apply via
-- Neon SQL Editor against the production branch BEFORE commit 4 ships
-- (the callback endpoint depends on initiated_by_user_id and on C1's
-- NULL-allow being in effect).
--
-- IDEMPOTENT-ISH
-- --------------
-- ALTER COLUMN ... DROP NOT NULL is idempotent (no-op if already
-- nullable). ADD CONSTRAINT and ADD COLUMN are NOT idempotent — running
-- twice will fail. The natural application path is once, on the
-- production branch, before commit 4 ships. If a second run is needed
-- (e.g., a Neon branch dropped and recreated), the constraint and
-- column should be dropped first or wrapped in IF NOT EXISTS guards
-- (Postgres 9.6+).
-- =============================================================================


-- C1: allow NULL on encryption columns. Required for OAuth's pending
-- row to exist before credentials are available.
ALTER TABLE connections
  ALTER COLUMN wrapped_data_key       DROP NOT NULL,
  ALTER COLUMN iv                      DROP NOT NULL,
  ALTER COLUMN ciphertext_credentials  DROP NOT NULL;


-- C1: CHECK constraint enforcing presence when not pending. Closes the
-- "row drifts to active without encryption columns" failure mode.
ALTER TABLE connections
  ADD CONSTRAINT connections_encryption_present_when_active
  CHECK (
    status = 'pending'
    OR (wrapped_data_key IS NOT NULL
        AND iv IS NOT NULL
        AND ciphertext_credentials IS NOT NULL)
  );


-- C3: initiated_by_user_id column for OAuth-completion CSRF mitigation.
-- Cross-DB seam: TEXT, no FK to D1 (D1 lives in a separate engine).
-- Nullable: NULL for non-OAuth connectors (preserves backward
-- compatibility on existing dummy rows). Stays populated after row
-- flips to active — audit data. NOT a credential; not under the AAD
-- invariant. NOT in the CONNECTION_PUBLIC_COLUMNS whitelist for v1.1
-- API responses (admin-only if ever exposed in a future release).
ALTER TABLE connections
  ADD COLUMN initiated_by_user_id TEXT;

COMMENT ON COLUMN connections.initiated_by_user_id IS
  'D1 user_id (TEXT, no FK across DB engines) of the session that initiated the OAuth flow. Populated at startAuth INSERT; verified at callback (BLOCK_4_PLAN.md decision C3) — mismatch is 403-collapse, row stays pending. NULL for non-OAuth connectors. Not credential-bearing; not under the AAD invariant.';
