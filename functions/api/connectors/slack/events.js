// functions/api/connectors/slack/events.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Slack Events API webhook entry point — Block 4 commit 7. Thin Pages
// Function delegating to slack.handleWebhook (BLOCK_4_PLAN.md decision
// D's "inline in slack.js's handleWebhook" lock — Slack-specific HMAC
// verify + body parse + dispatch all live in the connector module).
//
// CONTRACT-PINNING (BLOCK_4_PLAN.md decision F1)
// ----------------------------------------------
// Slack's url_verification handshake response shape has changed
// historically (text/plain vs application/json; periods where docs
// and API disagreed). slack.handleWebhook returns application/json
// with { challenge: "..." } — the safer subset that's worked in every
// documented version.
//
// Slack docs URL as of 2026-05-04 (commit 7 commit-day):
//   https://api.slack.com/events/url_verification
//
// If Slack tightens or changes the contract later, this dated comment
// is the audit trail for what spec was current when the handler was
// written.
//
// FLOW
// ----
// POST /api/connectors/slack/events
//
//   1. Open Hyperdrive sql client.
//   2. Build ctx with empty projectId placeholder. handleWebhook fills
//      projectId after the team_id-based connection lookup; per locked
//      sub-decision (a) — types.js typedef refinement deferred. Empty
//      string instead of null so any code path that accidentally reads
//      it as a UUID surfaces a "not a valid UUID" error rather than a
//      "cannot read property of null" stack trace.
//   3. Delegate to slack.handleWebhook(ctx, request).
//   4. Close sql client in finally.
//
// All rejection paths (signature failure, missing headers, post-verify
// parse failure, unknown envelope type, missing team_id, no-such-
// connection 0-row, multi-row 500) collapse to canonical observables
// inside slack.handleWebhook per D4. This delegating handler's catch
// only fires on infrastructure-level errors (sql open/close, etc.) and
// returns a generic 500 without leaking _err.message.
// =========================================================================

import postgres from 'postgres';
import { getConnector } from '../../../../_lib/connectors/registry.js';

export async function onRequestPost({ request, env }) {
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });
  try {
    const slack = getConnector('slack');
    const ctx = {
      env,
      request,
      sql,
      // projectId placeholder — handleWebhook fills the real value
      // after the team_id-based connection lookup.
      projectId: '',
    };
    return await slack.handleWebhook(ctx, request);
  } catch (_err) {
    // SECURITY: do NOT leak _err.message — could contain Postgres
    // detail or, in a worst case, bytes from a credential that
    // surfaced via slack.js's throw paths.
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
