// functions/api/connectors/slack/oauth/callback.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Slack OAuth callback endpoint — Block 4 commit 4. Carve-out
// concentration. Implements decisions C2 (single-use SELECT-then-UPDATE
// on status='pending'), C3 (initiated_by_user_id binding for OAuth-
// completion CSRF mitigation), and K (full-page redirect; destination
// hardcoded server-side from the pending row, no redirect_to query
// param accepted). Plus locked sub-decisions 4.A (403-collapse on Slack
// cancel / non-success), 4.B (credential_metadata = {team_name,
// bot_user_id, scopes, authed_user_id}), 4.C (AAD from {state,
// row.project_id, 'slack'}).
//
// FLOW
// ----
// GET /api/connectors/slack/oauth/callback?code=<...>&state=<...>
//
//   1. Parse query params; reject if code or state missing/empty.
//      Slack's cancel/error path sends ?error=access_denied&state=<state>
//      instead of ?code=...; the missing-code branch 403-collapses
//      identically per locked decision 4.A. Block 9 polish may layer a
//      friendlier UX with canned slack_error= on the redirect destination,
//      but v1.1 keeps the carve-out tight.
//
//   2. C2 SELECT (courtesy first-check, NOT the barrier):
//      WHERE id=state AND status='pending' AND deleted_at IS NULL.
//      Returns id, project_id, source, initiated_by_user_id. Not found
//      → 403-collapse. The actual single-use barrier is step 6's
//      UPDATE-filtered-on-status='pending'; this SELECT exists only
//      because steps 3 and 5 need columns from the row. A future
//      refactor that "tidies up" by removing the WHERE-pending filter
//      on UPDATE because "the SELECT already filters" would silently
//      break single-use — the SELECT-to-UPDATE gap is a TOCTOU window,
//      not a barrier.
//
//   3. C3 session-match: getSessionUser; verify
//      String(session.id) === row.initiated_by_user_id. Mismatch (or
//      no session) → 403-collapse, row stays pending so the original
//      initiator can retry the flow. Cross-DB seam: D1 user_id is
//      INTEGER, must be coerced to TEXT for comparison against the
//      Postgres column.
//
//   4. slack.completeAuth(ctx, {code, state}) — exchanges code at
//      Slack's oauth.v2.access; returns { credentials, accountInfo }.
//      Plaintext credentials live only on the call stack from here
//      until step 5's encrypt completes; never logged, never persisted
//      raw. completeAuth's SECURITY comment in slack.js covers this.
//
//   5. Encrypt the credentials JSON via Block 3's envelope helper.
//      AAD: aadFor({id: state, project_id: row.project_id, source:
//      'slack'}) — same triple commit 3's start.js used at INSERT, so
//      the AAD invariant matches what the row's encryption columns
//      will be bound to once step 6 lands.
//
//   6. C2 UPDATE — THE atomic single-use barrier:
//      SET status='active', encryption columns from step 5,
//      external_account_id = accountInfo.id (= team.id),
//      credential_metadata = {team_name, bot_user_id, scopes,
//      authed_user_id}
//      WHERE id=state AND status='pending'
//      RETURNING id.
//      Zero rows updated → 403-collapse (lost the race or replay).
//      The WHERE status='pending' filter is what makes a second-callback
//      hit match zero rows; do NOT remove it.
//
//   7. K redirect: 302 to /project.html?project_id=<row.project_id>
//      &tab=connections&just_connected=slack. Destination derived
//      ENTIRELY from server state (the SELECTed row's project_id);
//      NO callback query param contributes to the redirect URL. The
//      slack_error= path (4.A locked at "no") would have echoed a
//      canned string here; not in v1.1.
//
// SECURITY
// --------
// - Plaintext credentials NEVER hit a log line. The catch block
//   returns 'Internal error' without _err.message to keep Postgres
//   error detail (constraint names, column names) and any incidental
//   token bytes off the response.
// - All 403 paths (no code/state, SELECT-not-found, C3 mismatch,
//   UPDATE zero-row) return byte-identical {"error":"Forbidden"} so
//   distinct authorization-failure modes don't differentiate via
//   response shape, mirroring Block 2 decision Q's contract.
// - Migration dependency: this handler reads/writes the
//   initiated_by_user_id column AND relies on C1's NULL-allow on the
//   encryption columns. The C1+C3 migration at
//   db/migrations/2026-05-04-pending-oauth-state.sql MUST be applied
//   to production Neon before this handler is exercised; otherwise
//   the SELECT/UPDATE throws "column ... does not exist" or
//   "violates not-null" and the endpoint 500s.
// =========================================================================

import postgres from 'postgres';
import { error, getSessionUser } from '../../../../_lib/auth.js';
import { aadFor, encrypt } from '../../../../_lib/crypto.js';
import { getConnector } from '../../../../_lib/connectors/registry.js';

function forbidden() {
  return error('Forbidden', 403);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // 1. Param validation. Slack's cancel path sends ?error=access_denied
  // instead of ?code=...; the missing-code branch 403-collapses per
  // locked decision 4.A. (Defensive on state too — start.js generates
  // it via crypto.randomUUID() so a missing/empty state means the
  // caller didn't come through start.js or the param was stripped.)
  if (
    typeof code !== 'string' ||
    code.length === 0 ||
    typeof state !== 'string' ||
    state.length === 0
  ) {
    return forbidden();
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // 2. C2 SELECT — courtesy first-check, NOT the barrier. Step 6's
    // UPDATE WHERE status='pending' is THE single-use barrier.
    const [row] = await sql`
      SELECT id, project_id, source, initiated_by_user_id
        FROM connections
       WHERE id = ${state}
         AND status = 'pending'
         AND deleted_at IS NULL
    `;
    if (!row) return forbidden();

    // 3. C3 session-match. Cross-DB seam: String(session.id) coerces
    // D1 INTEGER user_id to TEXT for comparison against the Postgres
    // column. Mismatch / no session → 403-collapse, row stays pending
    // so the original initiator can retry the flow.
    const session = await getSessionUser(request, env.DB);
    if (!session || String(session.id) !== row.initiated_by_user_id) {
      return forbidden();
    }

    // 4. Token exchange via slack.completeAuth (commit 2). Calls Slack's
    // oauth.v2.access endpoint with code, client_id, client_secret,
    // redirect_uri. SECURITY comment in slack.js covers no-token-in-
    // error.
    const connector = getConnector('slack');
    const ctx = { env, request, sql, projectId: row.project_id };
    const completeResult = await connector.completeAuth(ctx, {
      code,
      state,
    });
    const credentials = completeResult.credentials || {};
    const accountInfo = completeResult.accountInfo || {};
    if (
      typeof accountInfo.id !== 'string' ||
      accountInfo.id.length === 0
    ) {
      // Defensive: slack.completeAuth always returns accountInfo.id =
      // team.id on the ok=true path. If we got here without it,
      // slack.js drifted.
      return error('Internal error', 500);
    }

    // 5. Encrypt the credentials JSON via Block 3's envelope helper.
    // AAD uses the SAME triple commit 3's start.js INSERTed under
    // (id=state, project_id=row.project_id, source='slack'). Bound at
    // encrypt time matches what'll be in effect when step 6's UPDATE
    // writes the encryption columns.
    const aad = aadFor({
      id: state,
      project_id: row.project_id,
      source: 'slack',
    });
    const encrypted = await encrypt(env, JSON.stringify(credentials), aad);

    // credential_metadata: non-secret OAuth metadata for admin-debug.
    // NOT in CONNECTION_PUBLIC_COLUMNS whitelist; never returned via
    // API. Per locked decision 4.B.
    const credentialMetadata = {
      team_name: accountInfo.displayName ?? null,
      bot_user_id: credentials.bot_user_id ?? null,
      scopes: accountInfo.scopes ?? null,
      // authed_user_id: in Slack's response but not currently passed
      // through slack.completeAuth's accountInfo. Skipping for v1.1;
      // add to slack.js's accountInfo + here if Block 5 needs it.
    };

    // 6. C2 UPDATE — THE atomic single-use barrier. WHERE status='pending'
    // is what makes a second-callback case match zero rows. Removing
    // it would silently break single-use; the SELECT in step 2 was
    // never the barrier (TOCTOU gap).
    const [updated] = await sql`
      UPDATE connections
         SET status                 = 'active',
             wrapped_data_key       = ${encrypted.wrapped_data_key},
             iv                     = ${encrypted.iv},
             ciphertext_credentials = ${encrypted.ciphertext},
             encryption_algorithm   = ${encrypted.algorithm},
             external_account_id    = ${accountInfo.id},
             credential_metadata    = ${credentialMetadata}
       WHERE id     = ${state}
         AND status = 'pending'
       RETURNING id
    `;
    if (!updated) return forbidden();

    // 7. K redirect. Destination derived from row.project_id; no
    // callback query param contributes. No redirect_to. No echo of
    // Slack's params. Decision K closes the open-redirect class.
    const dest = new URL('/project.html', new URL(request.url).origin);
    dest.searchParams.set('project_id', row.project_id);
    dest.searchParams.set('tab', 'connections');
    dest.searchParams.set('just_connected', 'slack');
    return Response.redirect(dest.toString(), 302);
  } catch (_err) {
    // SECURITY: never leak _err.message. Could contain Postgres detail
    // (constraint names, column names) or, in a worst case, bytes
    // from credentials that ended up in a stack trace via slack.js's
    // throw paths.
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
