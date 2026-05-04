// functions/_lib/connectors/types.js
// =========================================================================
// Connector interface contract (Block 3, decisions G–J).
//
// JSDoc-typed; repo is .js-only by deliberate decision G. @typedef
// blocks here give editor autocomplete and cross-file references via
// `import('./types.js').Connector` without introducing a build step.
//
// Every connector implements the Connector interface. Block 3 only
// ships the dummy connector (functions/_lib/connectors/dummy.js);
// Slack/Jira/Monday/Drive land in their own blocks.
//
// CONNECTORS DECRYPT INTERNALLY (decision L + Block 3 authoring guidance)
// ----------------------------------------------------------------------
// testConnection, fullSync, incrementalSync, and refreshAuth receive
// the FULL connection row (the SELECTed row from the connections
// table, including wrapped_data_key/iv/ciphertext_credentials/
// encryption_algorithm) as their second argument and decrypt the
// credentials INTERNALLY by calling decrypt(env, connection,
// aadFor(connection)). They do NOT receive plaintext credentials
// from the API handler. The handler's job ends at SELECTing the row
// and gating auth via requireProjectRole; from there, the connector
// owns the credential lifecycle. This keeps decryption surface area
// tightly localized — no plaintext credentials flow across module
// boundaries.
//
// CTX IS IDS-ONLY (decision I)
// ----------------------------
// Connectors do NOT receive user objects, project objects, or role
// info. Auth is settled in the API handler before the connector is
// invoked (HANDOFF principle #3). If a future connector legitimately
// needs project name or user email, add the specific field then with
// a clear reason. Default to less.
//
// CTX-FIRST SIGNATURE (decision H, with one exception)
// ----------------------------------------------------
// Every connector method that touches env, sql, request, or the
// source system takes ctx as its first arg.
//
// EXCEPTION: getMetadata returns a static constant per connector and
// does NOT take ctx. Decision H originally locked it as ctx-first too,
// for signature consistency; the Block 3 commit-3 review reversed
// that — YAGNI on the speculative future-proofing. No live caller
// has a ctx to thread through (listConnectors is the canonical caller
// and runs without one). If a future connector needs context-
// dependent metadata (e.g., region-specific OAuth scopes), widen the
// typedef and update listConnectors at that point — the divergence
// from decision H is reviewable in this commit's diff.
// =========================================================================

/**
 * Per-call context passed to every connector method.
 *
 * @typedef {Object} ConnectorCtx
 * @property {object}  env          - Pages Function env (env.HYPERDRIVE,
 *                                    env.MASTER_ENCRYPTION_KEY, ...)
 * @property {Request} request      - The original Pages Function request
 * @property {object}  sql          - postgres tagged-template client
 *                                    (opened by the handler, closed by
 *                                    the handler — connector must NOT
 *                                    call sql.end())
 * @property {string}  projectId    - The project UUID (URL-derived)
 * @property {string} [connectionId] - The connection UUID, when applicable
 */

/**
 * The shape of a connection row as SELECTed from the connections table.
 * Whitelisted columns plus the encrypted-credential triple needed for
 * decrypt; matches db/schema-postgres.sql. Connectors receive this row
 * and can call decrypt(env, row, aadFor(row)) to get plaintext.
 *
 * @typedef {Object} ConnectionRow
 * @property {string}      id
 * @property {string}      project_id
 * @property {'dummy'|'slack'|'jira'|'monday'|'drive'} source
 * @property {string}      display_name
 * @property {string}      external_account_id
 * @property {Uint8Array}  wrapped_data_key
 * @property {Uint8Array}  iv
 * @property {Uint8Array}  ciphertext_credentials
 * @property {string}      encryption_algorithm
 * @property {object}      credential_metadata
 * @property {'pending'|'active'|'degraded'|'revoked'} status
 * @property {string|null} status_reason
 * @property {string|null} last_sync_at
 * @property {string|null} last_sync_cursor
 * @property {string|null} next_sync_at
 * @property {string}      created_at
 * @property {string}      updated_at
 * @property {string|null} deleted_at
 */

/**
 * Static metadata declared by each connector (decision J).
 * Used by the registry → API → eventually the Block 4+ Connections UI
 * for icon and button copy.
 *
 * @typedef {Object} ConnectorMetadata
 * @property {'dummy'|'slack'|'jira'|'monday'|'drive'} source
 *   - Schema-bound enum value; matches connections.source CHECK.
 * @property {string} displayName - Human-readable label
 * @property {'none'|'token'|'oauth'} authKind
 * @property {string} [description]
 */

/**
 * Result of starting an auth flow.
 *
 * For OAuth connectors: `authUrl` redirects the admin to the source's
 * consent screen; `state` is anti-CSRF, persisted by the handler and
 * verified on the OAuth callback.
 *
 * For non-OAuth connectors (token, none): `credentials` is returned
 * immediately with whatever's known up front. The handler then calls
 * completeAuth(ctx, params) — for non-OAuth connectors `params` may
 * be empty.
 *
 * @typedef {Object} StartAuthResult
 * @property {string}  [authUrl]
 * @property {string}  [state]
 * @property {object}  [credentials]
 */

/**
 * Result of completing an auth flow. The handler encrypts `credentials`
 * (via crypto.encrypt) and persists the row.
 *
 * @typedef {Object} CompleteAuthResult
 * @property {object} credentials
 *   - The credentials to encrypt and store. Plaintext shape is
 *     connector-defined (token strings, refresh_token + access_token
 *     pairs, etc.) — only the connector knows how to interpret them.
 * @property {object} accountInfo
 *   - Identity info from the source. `accountInfo.id` becomes
 *     connections.external_account_id; the handler uses it for the
 *     UNIQUE-constraint slot. Optional fields (displayName, scopes)
 *     may be stored in connections.credential_metadata.
 */

/**
 * Result of testing a stored connection (decision L exercises crypto
 * round-trip; real connectors call the source API to verify token).
 *
 * @typedef {Object} TestConnectionResult
 * @property {boolean} ok
 * @property {object}  [accountInfo]
 * @property {string}  [error]
 */

/**
 * Result of a sync run. Drives the sync_runs row's records_*
 * counters; cursor_after lets the next incremental sync resume.
 *
 * @typedef {Object} SyncResult
 * @property {number} records_inserted
 * @property {number} records_updated
 * @property {number} records_skipped
 * @property {string} [cursor_after]
 * @property {object} [detail]
 */

/**
 * The Connector contract.
 *
 * @typedef {Object} Connector
 * @property {() => ConnectorMetadata} getMetadata
 * @property {(ctx: ConnectorCtx) => Promise<StartAuthResult>} startAuth
 * @property {(ctx: ConnectorCtx, params: object) => Promise<CompleteAuthResult>} completeAuth
 * @property {(ctx: ConnectorCtx, credentials: object) => Promise<object>} refreshAuth
 * @property {(ctx: ConnectorCtx, connection: ConnectionRow) => Promise<TestConnectionResult>} testConnection
 * @property {(ctx: ConnectorCtx, connection: ConnectionRow) => Promise<SyncResult>} fullSync
 * @property {(ctx: ConnectorCtx, connection: ConnectionRow) => Promise<SyncResult>} incrementalSync
 * @property {(ctx: ConnectorCtx, request: Request) => Promise<Response>} [handleWebhook]
 */

// This file declares types via JSDoc only; no runtime exports.
// `export {}` makes it an ES module so other files can reference
// these typedefs via `import('./types.js').Connector`.
export {};
