// functions/api/projects/[id]/connections/index.js
// =========================================================================
// Connections API — POST (create) + GET (list).
//
// Block 3 commit 4. Implements decisions O (URL shapes), Q (error
// contract + response whitelist), M (dummy connection metadata
// defaults), C (app-generated UUID for AAD construction at encrypt
// time).
//
// Routes (this file):
//   POST /api/projects/:id/connections   — admin only; create a
//                                          connection by running the
//                                          connector's startAuth +
//                                          completeAuth, encrypting
//                                          the returned credentials,
//                                          and persisting the row
//   GET  /api/projects/:id/connections   — project member; list
//                                          active connections
//
// SECURITY — response column whitelist (decision Q)
// -------------------------------------------------
// API responses NEVER include any of the following columns:
//   - wrapped_data_key, iv, ciphertext_credentials
//       (the encrypted credential bytes — directly attackable
//        offline if exposed)
//   - encryption_algorithm
//       (information leak about security posture; "transparency"
//        is not a user benefit, only an attacker benefit)
//   - credential_metadata
//       (may contain non-secret OAuth scopes / refresh-expiry
//        hints that aid reconnaissance)
//
// The CONNECTION_PUBLIC_COLUMNS list below is the ONLY set of columns
// that flow out to API consumers. Do NOT use SELECT * here, do NOT
// pass a row directly to JSON.stringify on the response.
// =========================================================================

import postgres from 'postgres';
import {
  error,
  json,
  requireProjectRole,
} from '../../../../_lib/auth.js';
import { aadFor, encrypt } from '../../../../_lib/crypto.js';
import {
  getConnector,
  isKnownSource,
} from '../../../../_lib/connectors/registry.js';

// Whitelist for API responses. See SECURITY note above.
//
// Block 4 commit 8 plan amendment: extend the response shape with two
// non-secret JSONB-extracted fields from credential_metadata —
// selected_channel_id and selected_channel_name. These are user-config
// (the admin's chosen Slack channel for backfill, set via L's PATCH
// endpoint), NOT credential bytes or scope-disclosure surface. The
// rest of credential_metadata stays out of the response per Q's
// locked deny-list (OAuth scopes / refresh-expiry / bot_user_id are
// reconnaissance surface; do NOT add to this list without re-locking
// Q's rationale). Projections are done via JSONB `->>` in the SELECT.
const CONNECTION_PUBLIC_COLUMNS = [
  'id',
  'project_id',
  'source',
  'display_name',
  'external_account_id',
  'status',
  'status_reason',
  'last_sync_at',
  'created_at',
  'updated_at',
  'selected_channel_id',     // from credential_metadata->>'selected_channel_id'
  'selected_channel_name',   // from credential_metadata->>'selected_channel_name'
];

const DISPLAY_NAME_MAX = 100;

// ---------------------------------------------------------------------------
// POST — create a connection (admin only)
// ---------------------------------------------------------------------------

export async function onRequestPost({ request, env, params }) {
  const projectId = params.id;

  const { error: errResp } = await requireProjectRole(
    request,
    env,
    projectId,
    'admin'
  );
  if (errResp) return errResp;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const source =
    typeof body?.source === 'string' ? body.source.trim() : '';
  if (source.length === 0) {
    return error('source is required', 400);
  }
  if (!isKnownSource(source)) {
    return error(`Unknown connector source: ${source}`, 400);
  }

  // display_name is optional — falls back to the connector's metadata
  // displayName (decision M) when omitted, null, or empty-after-trim.
  let displayName = null;
  if (body?.display_name !== undefined && body.display_name !== null) {
    if (typeof body.display_name !== 'string') {
      return error('display_name must be a string', 400);
    }
    const trimmed = body.display_name.trim();
    if (trimmed.length > DISPLAY_NAME_MAX) {
      return error(
        `display_name must be ${DISPLAY_NAME_MAX} characters or fewer`,
        400
      );
    }
    displayName = trimmed.length > 0 ? trimmed : null;
  }

  const connector = getConnector(source);
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const ctx = { env, request, sql, projectId };

    // For zero-auth and token connectors, startAuth returns credentials
    // immediately. For OAuth connectors it returns { authUrl, state };
    // OAuth flows are initiated via the dedicated start endpoint, not
    // through this POST. Per BLOCK_4_PLAN.md decision K (full-page
    // redirect from UI) the only OAuth entry path is GET
    // /api/connectors/<source>/oauth/start?project_id=<uuid>; this 400
    // routes API callers there with a verbatim guidance string.
    const startResult = await connector.startAuth(ctx);
    if (startResult.authUrl) {
      return error(
        `OAuth connectors must use the dedicated start endpoint (GET /api/connectors/${source}/oauth/start?project_id=${projectId})`,
        400
      );
    }

    const completeResult = await connector.completeAuth(ctx, body);
    const credentials = completeResult.credentials || {};
    const accountInfo = completeResult.accountInfo || {};
    if (
      typeof accountInfo.id !== 'string' ||
      accountInfo.id.length === 0
    ) {
      return error('Connector did not return accountInfo.id', 500);
    }

    if (displayName === null) {
      displayName = connector.getMetadata().displayName || source;
    }

    // Decision C: app generates the connection UUID before INSERT so
    // the AAD can be constructed at encrypt time, before the row
    // exists in the database. Postgres gen_random_uuid() default is
    // bypassed in favor of crypto.randomUUID() at the application
    // layer.
    const connectionId = crypto.randomUUID();

    const aad = aadFor({
      id: connectionId,
      project_id: projectId,
      source,
    });

    const encrypted = await encrypt(env, JSON.stringify(credentials), aad);

    // Status flips pending → active immediately for non-OAuth
    // connectors (decision M). OAuth status stays 'pending' until the
    // callback succeeds; Block 3 doesn't ship OAuth, so this is the
    // only branch active today.
    const status =
      connector.getMetadata().authKind === 'oauth' ? 'pending' : 'active';

    // credential_metadata, status_reason, last_sync_at,
    // last_sync_cursor, next_sync_at, created_at, updated_at,
    // deleted_at are all schema-defaulted — omitted from INSERT so
    // the schema's defaults apply.
    let row;
    try {
      [row] = await sql`
        INSERT INTO connections (
          id, project_id, source, display_name, external_account_id,
          wrapped_data_key, iv, ciphertext_credentials,
          encryption_algorithm, status
        ) VALUES (
          ${connectionId}, ${projectId}, ${source},
          ${displayName}, ${accountInfo.id},
          ${encrypted.wrapped_data_key}, ${encrypted.iv},
          ${encrypted.ciphertext}, ${encrypted.algorithm}, ${status}
        )
        RETURNING
          id, project_id, source, display_name, external_account_id,
          status, status_reason, last_sync_at, created_at, updated_at,
          credential_metadata->>'selected_channel_id'   AS selected_channel_id,
          credential_metadata->>'selected_channel_name' AS selected_channel_name
      `;
    } catch (insertErr) {
      // PG 23505 — unique_violation. The connections UNIQUE NULLS NOT
      // DISTINCT clause covers (project_id, source, external_account_id,
      // deleted_at), so reconnecting the same external account while a
      // previous connection is still active hits this. For the dummy
      // connector this is unreachable in practice (random
      // external_account_id) but real connectors with deterministic
      // account IDs (Slack team_id, Jira cloudid) will hit it on
      // duplicate connect attempts.
      if (insertErr && insertErr.code === '23505') {
        return error(
          'A connection for this account already exists in this project',
          409
        );
      }
      throw insertErr;
    }

    return json({ ok: true, connection: row }, { status: 201 });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// GET — list active connections in the project (member access)
// ---------------------------------------------------------------------------

export async function onRequestGet({ request, env, params }) {
  const projectId = params.id;

  const { error: errResp } = await requireProjectRole(
    request,
    env,
    projectId,
    'member'
  );
  if (errResp) return errResp;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Index path: connections_project_active_idx on (project_id)
    // WHERE deleted_at IS NULL.
    const connections = await sql`
      SELECT id, project_id, source, display_name, external_account_id,
             status, status_reason, last_sync_at, created_at, updated_at,
             credential_metadata->>'selected_channel_id'   AS selected_channel_id,
             credential_metadata->>'selected_channel_name' AS selected_channel_name
        FROM connections
       WHERE project_id = ${projectId}
         AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
    `;

    return json({ ok: true, connections });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
