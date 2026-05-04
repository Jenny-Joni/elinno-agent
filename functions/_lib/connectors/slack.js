// functions/_lib/connectors/slack.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Slack connector — Block 4 commit 2. Implements decisions A, B, C2, C3,
// G (listChannels helper), K, O, P from BLOCK_4_PLAN.md. Decisions D/D1-D4
// (webhook signature verify), E/E2/E3 (sync execution + cap + rate-limits),
// F/F1/F2 (webhook ingestion + url_verification + dispatch), H (entity
// mapping), and I (edits/deletes) land in commits 6 and 7.
//
// AUTH MODEL (decisions A, B-revised, P, O)
// -----------------------------------------
// authKind = 'oauth'. Single-workspace install for v1.1 (decision A);
// Distribution disabled in Slack app settings. Bot scopes: channels:read,
// channels:history, users:read (decision B-revised — users:read added as
// a Block 5 prerequisite for human-readable citations). User scopes:
// NONE; user_scope param omitted entirely from the install URL
// (decision P). Token Rotation OFF in Slack app settings; refreshAuth is
// a no-op (decision O — long-lived xoxb- bot token).
//
// FLOW (this commit)
// ------------------
// startAuth(ctx) generates state = crypto.randomUUID() and returns
// { authUrl, state }. State doubles as the future connection.id (commit 3's
// functions/api/connectors/slack/oauth/start.js handler INSERTs the
// pending row using this state as the row id, plus the C3
// initiated_by_user_id column). Connector knows its OAuth URL format
// and scopes; handler manages DB writes.
//
// completeAuth(ctx, params) exchanges (code, state) at oauth.v2.access.
// Returns plaintext credentials and accountInfo; the handler encrypts
// the credentials via Block 3's envelope helper (functions/_lib/crypto.js
// — encrypt/aadFor) before INSERT/UPDATE on the pending row (decision C2).
//
// refreshAuth(ctx, credentials) is a no-op (decision O).
//
// testConnection(ctx, connection) decrypts the bot token internally per
// Block 3 decision L ("CONNECTORS DECRYPT INTERNALLY"), calls auth.test,
// returns { ok: true, accountInfo: { id, displayName } } on success.
//
// listChannels(ctx, connection) is a non-interface helper called by
// commit 5's bespoke endpoint at GET
// /api/projects/:id/connections/:connId/slack/channels (decision G).
// Decrypts internally, paginates conversations.list, returns
// { id, name, is_member } per public channel.
//
// SECURITY (echoes dummy.js's pattern)
// ------------------------------------
// Error strings MUST NOT include any byte of the plaintext bot token,
// not even truncated. The token is `xoxb-…` long-lived per O; any log
// entry containing a prefix is a credential leak that survives until
// admin-driven disconnect+reconnect (no auto-revocation per O).
// Slack's `error` field on !ok responses is a short error code
// ('invalid_auth', 'token_revoked', 'invalid_code', etc.) — safe to
// include verbatim. NEVER concatenate creds.access_token into any
// error or log line.
//
// fullSync, incrementalSync, handleWebhook NOT in this commit; stubs
// throw to fail-fast if the connections sync endpoint somehow dispatches
// a Slack connection before commit 6 lands the real implementations.
// =========================================================================

import { aadFor, decrypt } from '../crypto.js';

const SLACK_API_BASE = 'https://slack.com/api';
const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const BOT_SCOPES = 'channels:read,channels:history,users:read';

/** @type {import('./types.js').ConnectorMetadata} */
const METADATA = {
  source: 'slack',
  displayName: 'Slack',
  authKind: 'oauth',
  description:
    'Public-channel message ingestion from a Slack workspace. v1.1 reads channels:read + channels:history + users:read; no DMs, no private channels, no message-write.',
};

/**
 * POST to a Slack API method. Returns the parsed JSON body on HTTP 2xx.
 * Throws on HTTP non-2xx; callers handle Slack-level `{ ok: false, error }`
 * shapes themselves so each call site can include its own context in
 * the thrown error.
 *
 * @param {string} method - e.g., 'oauth.v2.access', 'auth.test'
 * @param {Record<string, string>} params - form-encoded body params
 * @param {string} [token] - bot token; omitted for token-exchange calls
 * @returns {Promise<object>}
 */
async function slackApiPost(method, params, token) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const body = new URLSearchParams(params).toString();
  const response = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: 'POST',
    headers,
    body,
  });
  if (!response.ok) {
    throw new Error(`slack api http ${response.status} on ${method}`);
  }
  return await response.json();
}

/** @type {import('./types.js').Connector} */
export const slack = {
  getMetadata() {
    return METADATA;
  },

  // Decision P: scope param populated; user_scope param omitted entirely.
  // Decision A: single-workspace install — doesn't affect URL construction.
  // Decision K: redirect_uri uses env.SITE_URL (already in wrangler.toml).
  // State doubles as the future connection.id (commit 3 INSERT).
  async startAuth(ctx) {
    const state = crypto.randomUUID();
    const url = new URL(SLACK_AUTHORIZE_URL);
    url.searchParams.set('client_id', ctx.env.SLACK_CLIENT_ID);
    url.searchParams.set('scope', BOT_SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set(
      'redirect_uri',
      `${ctx.env.SITE_URL}/api/connectors/slack/oauth/callback`
    );
    return { authUrl: url.toString(), state };
  },

  // Exchange authorization code for the bot token. Returns plaintext
  // credentials; handler encrypts via Block 3 envelope helper before
  // INSERT/UPDATE.
  // params shape: { code, state } from the callback URL.
  async completeAuth(ctx, params) {
    const tokenResponse = await slackApiPost(
      'oauth.v2.access',
      {
        code: params.code,
        client_id: ctx.env.SLACK_CLIENT_ID,
        client_secret: ctx.env.SLACK_CLIENT_SECRET,
        redirect_uri: `${ctx.env.SITE_URL}/api/connectors/slack/oauth/callback`,
      }
      // no Authorization header — token exchange is unauthenticated
    );
    if (!tokenResponse.ok) {
      // SECURITY: tokenResponse.error is a Slack error code (e.g.,
      // 'invalid_code', 'bad_redirect_uri'). The access_token field is
      // absent on !ok responses, so there's no token to leak here.
      throw new Error(
        `slack oauth.v2.access failed: ${tokenResponse.error}`
      );
    }
    return {
      credentials: {
        access_token: tokenResponse.access_token,
        scope: tokenResponse.scope,
        bot_user_id: tokenResponse.bot_user_id,
        team_id: tokenResponse.team.id,
      },
      accountInfo: {
        id: tokenResponse.team.id,
        displayName: tokenResponse.team.name,
        scopes: tokenResponse.scope,
      },
    };
  },

  // No-op for v1.1 (decision O — long-lived xoxb- tokens; token rotation
  // NOT enabled in Slack app settings).
  async refreshAuth(_ctx, credentials) {
    return credentials;
  },

  // Verify stored connection's credentials by calling auth.test.
  // Decrypts internally per Block 3 decision L.
  async testConnection(ctx, connection) {
    const aad = aadFor(connection);
    const credsJson = await decrypt(ctx.env, connection, aad);
    const creds = JSON.parse(credsJson);

    const response = await slackApiPost(
      'auth.test',
      {},
      creds.access_token
    );
    if (!response.ok) {
      // SECURITY: response.error is a Slack error code. NEVER add
      // creds.access_token (or any prefix of it) to this string.
      throw new Error(`slack auth.test failed: ${response.error}`);
    }
    return {
      ok: true,
      accountInfo: {
        id: response.team_id,
        displayName: response.team,
      },
    };
  },

  // Sync methods land in commit 6. Stubs fail-fast so a misconfigured
  // dispatch (e.g., a Slack connection somehow reaching the sync endpoint
  // before commit 6 ships) surfaces a meaningful error instead of a
  // confusing TypeError on undefined.
  async fullSync(_ctx, _connection) {
    throw new Error(
      'slack.fullSync not implemented in commit 2; lands in Block 4 commit 6'
    );
  },

  async incrementalSync(_ctx, _connection) {
    throw new Error(
      'slack.incrementalSync not implemented in commit 2; lands in Block 4 commit 6'
    );
  },

  // handleWebhook lands in commit 7. Optional in the Connector typedef;
  // omission here is consistent with dummy.js (which never has webhooks).
};

/**
 * List public channels visible to the bot. Paginates internally; returns
 * the full list. Called by commit 5's bespoke endpoint at GET
 * /api/projects/:id/connections/:connId/slack/channels (decision G).
 *
 * Helper, NOT a Connector interface method (per decision G — generalizing
 * channel listing into the framework would force every future connector
 * to implement an awkward "list things this source has" method).
 *
 * Decrypts internally per Block 3 decision L. Paginates via Slack's
 * cursor-based response_metadata.next_cursor convention.
 *
 * @param {import('./types.js').ConnectorCtx} ctx
 * @param {import('./types.js').ConnectionRow} connection
 * @returns {Promise<Array<{ id: string, name: string, is_member: boolean }>>}
 */
export async function listChannels(ctx, connection) {
  const aad = aadFor(connection);
  const credsJson = await decrypt(ctx.env, connection, aad);
  const creds = JSON.parse(credsJson);

  /** @type {Array<{ id: string, name: string, is_member: boolean }>} */
  const channels = [];
  let cursor;
  do {
    /** @type {Record<string, string>} */
    const params = {
      exclude_archived: 'true',
      types: 'public_channel',
      limit: '200',
    };
    if (cursor) params.cursor = cursor;

    const response = await slackApiPost(
      'conversations.list',
      params,
      creds.access_token
    );
    if (!response.ok) {
      // SECURITY: response.error is a Slack error code. NEVER add
      // creds.access_token to this string.
      throw new Error(`slack conversations.list failed: ${response.error}`);
    }
    for (const c of response.channels) {
      channels.push({ id: c.id, name: c.name, is_member: !!c.is_member });
    }
    cursor = response.response_metadata?.next_cursor || null;
  } while (cursor);

  return channels;
}
