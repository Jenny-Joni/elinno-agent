// functions/api/connectors/jira/auth/save.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Bespoke Jira credential save endpoint per BLOCK_6_PLAN.md decision N.
//
// Why a separate endpoint
// -----------------------
// Block 4's POST /api/projects/:id/connections is OAuth-shaped — it
// returns { authUrl } and the connector's startAuth produces a redirect.
// Jira has no consent flow (decision A: API token auth), so it has no
// authUrl to return. Routing both modes through one endpoint with a
// branch-on-source switch invites the "wrong mode dispatched on missing
// field" bug class. Bespoke endpoint keeps the carve-out tight.
//
// FLOW
// ----
// POST /api/connectors/jira/auth/save
//   body: { project_id, site_url, account_email, api_token }
//
//   1. Parse body. Reject malformed JSON / missing project_id with 400.
//   2. requireWorkspaceScope on project_id (v1.3 successor to
//      requireProjectRole) + requireWorkspaceAdmin gate. Failures
//      bubble up from the helpers (401 / 403 / 400).
//   3. F: enforce single Jira connection per (project_id, source='jira')
//      — return 409 already_connected if a non-deleted Jira connection
//      already exists for this project.
//   4. Generate connectionId = crypto.randomUUID(). Build aadFor
//      ({id: connectionId, project_id, source: 'jira'}) BEFORE calling
//      completeAuth so the AAD shape is locked at the start.
//   5. jira.completeAuth({...ctx}, body) — validates inputs, calls
//      Atlassian /myself, returns { credentials, accountInfo }. Maps
//      Atlassian 401/403 to thrown Error('invalid_credentials'); other
//      errors propagate (collapsed to internal_error here).
//   6. Encrypt the credentials JSON via Block 3's envelope helper, AAD
//      from step 4. Single INSERT with status='active' and all
//      encryption columns populated — no two-step pending → active
//      flow because there's no OAuth race window to defend against.
//   7. Respond { ok: true, connection_id }.
//
// SECURITY
// --------
// - Plaintext credentials never hit a log line. The catch block
//   collapses to 'internal_error' without _err.message to keep
//   Postgres detail (constraint names) and any incidental token
//   bytes off the response.
// - All distinguishable failure modes (malformed body, missing
//   project_id, validation errors, Atlassian 401/403) collapse to
//   400 with one of a small set of error tokens; admin-side telemetry
//   that surfaces these values is OK because they don't leak the
//   token. The 500 path is opaque.
// - F's pre-flight SELECT is the application-layer single-connection-
//   per-Jira-instance gate (decision F). The schema permits multi-row
//   for v1.2; v1.1 closes it here.
// =========================================================================

import postgres from 'postgres';
import {
  error,
  requireWorkspaceScope,
  requireWorkspaceAdmin,
  json,
} from '../../../../_lib/auth.js';
import { aadFor, encrypt } from '../../../../_lib/crypto.js';
import { jira } from '../../../../_lib/connectors/jira.js';

const VALIDATION_ERROR_PREFIXES = [
  'site_url',
  'account_email',
  'api_token',
];

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  // 1. Parse body.
  let body;
  try {
    body = await request.json();
  } catch {
    return error('Malformed body', 400);
  }
  if (typeof body !== 'object' || body === null) {
    return error('Malformed body', 400);
  }

  const projectId = body.project_id;
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return error('project_id required', 400);
  }

  // 2. Auth: project belongs to workspace + user is workspace admin.
  // v1.3 swap (Block 12.1): requireProjectRole(admin) → workspace-scope
  // (project belongs to session user's workspace) + workspace-admin
  // (D1 is_admin=1) gates layered.
  const scopeResult = await requireWorkspaceScope(request, env, projectId);
  if (scopeResult.error) return scopeResult.error;
  const adminResult = await requireWorkspaceAdmin(request, env);
  if (adminResult.error) return adminResult.error;
  const { user } = scopeResult;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // 3. F: single Jira connection per project (v1.1 lock).
    const existing = await sql`
      SELECT id
        FROM connections
       WHERE project_id = ${projectId}
         AND source     = 'jira'
         AND status    != 'pending'
         AND deleted_at IS NULL
       LIMIT 1
    `;
    if (existing.length > 0) {
      return json(
        { error: 'already_connected', connection_id: existing[0].id },
        { status: 409 }
      );
    }

    // 4. Generate connectionId. Build AAD from (connectionId, projectId,
    // 'jira') — locked before completeAuth so the AAD shape we'll
    // INSERT under matches what we encrypt under in step 6.
    const connectionId = crypto.randomUUID();
    const aad = aadFor({
      id: connectionId,
      project_id: projectId,
      source: 'jira',
    });

    // 5. Validate + verify with Atlassian.
    let completeResult;
    try {
      completeResult = await jira.completeAuth(
        { env, request, sql, projectId, connectionId },
        {
          site_url: body.site_url,
          account_email: body.account_email,
          api_token: body.api_token,
        }
      );
    } catch (err) {
      const msg = err?.message || '';
      if (msg === 'invalid_credentials') {
        return error('invalid_credentials', 400);
      }
      if (VALIDATION_ERROR_PREFIXES.some((p) => msg.startsWith(p))) {
        // Validation errors are credential-free per jira.js; safe to
        // pass through as the response message for admin-side debug.
        return error(msg, 400);
      }
      // Other errors (Atlassian 5xx, network, etc.) collapse to internal.
      return error('Internal error', 500);
    }

    const { credentials, accountInfo } = completeResult;
    if (
      typeof accountInfo?.id !== 'string' ||
      accountInfo.id.length === 0
    ) {
      return error('Internal error', 500);
    }

    // 6. Encrypt credentials JSON. credential_metadata is the non-secret
    // mirror — admins can see site_url / account_email / atlassian_account_id
    // for debugging; api_token is NEVER in credential_metadata (verified
    // by S21).
    const encrypted = await encrypt(env, JSON.stringify(credentials), aad);
    const credentialMetadata = {
      site_url: accountInfo.site_url,
      account_email: accountInfo.account_email,
      atlassian_account_id: accountInfo.atlassian_account_id ?? null,
      // selected_project_key + selected_project_name written by L's
      // PATCH endpoint after the project picker modal in commit 9.
    };

    // Single INSERT — no two-step pending → active flow needed because
    // there's no OAuth race to defend against (decision N).
    const [inserted] = await sql`
      INSERT INTO connections (
        id, project_id, source, status, display_name,
        external_account_id,
        wrapped_data_key, iv, ciphertext_credentials, encryption_algorithm,
        credential_metadata,
        initiated_by_user_id
      ) VALUES (
        ${connectionId}, ${projectId}, 'jira', 'active', 'Jira',
        ${accountInfo.id},
        ${encrypted.wrapped_data_key}, ${encrypted.iv},
        ${encrypted.ciphertext}, ${encrypted.algorithm},
        ${credentialMetadata},
        ${String(user.id)}
      )
      RETURNING id
    `;
    if (!inserted) return error('Internal error', 500);

    return json({ ok: true, connection_id: inserted.id });
  } catch (_err) {
    // SECURITY: never leak _err.message. Could contain Postgres detail
    // or, in a worst case, bytes from credentials that ended up in a
    // stack trace via the encrypt path.
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
