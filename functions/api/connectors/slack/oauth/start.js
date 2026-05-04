// functions/api/connectors/slack/oauth/start.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Slack OAuth start endpoint — Block 4 commit 3.
//
// Implements decisions K (full-page redirect from UI; redirect destination
// hardcoded server-side, no redirect_to query param accepted), C1 (allows
// NULL encryption columns at status='pending'), and C3
// (initiated_by_user_id binding for OAuth-completion CSRF mitigation).
// Decisions C2 (single-use callback) and the actual token exchange land
// in commit 4 (callback endpoint).
//
// FLOW
// ----
// GET /api/connectors/slack/oauth/start?project_id=<uuid>
//
//   1. requireProjectRole(admin) on project_id — 401/403 collapse on
//      failure (Block 2 decision Q).
//   2. slack.startAuth(ctx) → { authUrl, state }. State doubles as the
//      future connection.id (commit 2's slack.js generates state via
//      crypto.randomUUID()).
//   3. INSERT pending row using state as connection.id. Encryption
//      columns are NULL at this stage (C1's migration permits it; the
//      CHECK constraint requires status='pending' OR encryption columns
//      populated, so this row is legal at status='pending' but cannot
//      drift to 'active' without encryption columns being filled — the
//      callback's UPDATE handles that). external_account_id is empty
//      string at INSERT (it's NOT in C1's NULL-allow list because it
//      isn't credential-bearing); the callback's UPDATE fills it with
//      team.id from oauth.v2.access response.
//   4. 302 redirect to authUrl. Destination comes from
//      slack.startAuth's URL output, NEVER from any callback or query
//      parameter — closes the open-redirect class per K.
//
// FAILURE BEHAVIOR
// ----------------
// - No session / not admin / unknown project / soft-deleted project →
//   403-collapse from requireProjectRole (no information leak between
//   distinct authorization-failure modes).
// - INSERT failure (duplicate state — astronomically unlikely with
//   randomUUID v4, but the schema's UNIQUE constraint on
//   (project_id, source, external_account_id, deleted_at) NULLS NOT
//   DISTINCT *would* fire if a previous start with empty
//   external_account_id is still pending in the same project) → 500.
//   Soft cleanup of stuck pending rows is Block 9 polish.
// - slack.startAuth throw (e.g., env.SLACK_CLIENT_ID misconfigured at
//   the value level — the empty placeholder from commit 2's wrangler.toml
//   is what's deployed until Phase A, but startAuth still returns a URL
//   for that case; no throw expected) → 500.
//
// MIGRATION DEPENDENCY
// --------------------
// This handler INSERTs into the initiated_by_user_id column, which is
// added by db/migrations/2026-05-04-pending-oauth-state.sql. That
// migration MUST be applied to the production Neon branch before this
// handler is exercised, otherwise the INSERT throws ("column ... does
// not exist") and the endpoint 500s. Per WORKFLOW.md Hard Limits, the
// migration application is Jenny's hands.
// =========================================================================

import postgres from 'postgres';
import { error, requireProjectRole } from '../../../../_lib/auth.js';
import { getConnector } from '../../../../_lib/connectors/registry.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id') || '';

  // requireProjectRole validates UUID shape, session, and project
  // membership/role. 401 (no session) and 403 (not admin / unknown
  // project / soft-deleted) collapse identically per Block 2 decision Q.
  const { error: errResp, user: session } = await requireProjectRole(
    request,
    env,
    projectId,
    'admin'
  );
  if (errResp) return errResp;

  const connector = getConnector('slack');
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const ctx = { env, request, sql, projectId };

    const startResult = await connector.startAuth(ctx);
    if (!startResult.authUrl || !startResult.state) {
      // Defensive: slack.startAuth returns both fields per its locked
      // shape. If either is missing, something has drifted in slack.js.
      return error('Internal error', 500);
    }

    // INSERT pending row. State IS the future connection.id (C2 + C3).
    // C1's migration permits NULL on encryption columns at this stage;
    // the callback's UPDATE fills them. external_account_id is empty
    // string at INSERT (NOT NULL on the schema; not in C1's NULL-allow
    // list); callback fills with team.id per C2.
    await sql`
      INSERT INTO connections (
        id, project_id, source, status,
        display_name, external_account_id, initiated_by_user_id
      ) VALUES (
        ${startResult.state}, ${projectId}, 'slack', 'pending',
        'Slack', '', ${String(session.id)}
      )
    `;

    // 302 redirect to Slack consent. Destination is from slack.startAuth's
    // output — hardcoded by the connector module from env.SLACK_CLIENT_ID,
    // env.SITE_URL, and the locked scope set. Decision K: never accept a
    // redirect_to query param; never use any input from this request to
    // construct the redirect destination.
    return Response.redirect(startResult.authUrl, 302);
  } catch (_err) {
    // SECURITY: do NOT leak _err.message to the response. It could
    // contain Postgres error detail (column names, constraint names)
    // that helps an attacker probe the schema. Block 3's connections
    // POST handler follows the same pattern.
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
