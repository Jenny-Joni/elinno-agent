// functions/_lib/connectors/slack.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Slack connector. Implements decisions A, B-revised, C2, C3, D, D1-D4,
// E, E2, E3, F, F1, F2, G (listChannels helper), H (entity mapping),
// I (edits/deletes via webhook), K, L (inert sync signal), O, P from
// BLOCK_4_PLAN.md. All Block 4 connector-side decisions are now
// implemented; remaining Block 4 work lives in commit 8 (UI + PATCH
// endpoint) and commit 10 (closeout).
//
// AUTH MODEL (A, B-revised, P, O)
// -------------------------------
// authKind = 'oauth'. Single-workspace install for v1.1 (A); Distribution
// disabled in Slack app settings. Bot scopes: channels:read,
// channels:history, users:read (B-revised — users:read added as a
// Block 5 prerequisite for human-readable citations). User scopes:
// NONE; user_scope param omitted entirely from the install URL (P).
// Token Rotation OFF in Slack app settings; refreshAuth is a no-op
// (O — long-lived xoxb- bot token).
//
// COMMIT 6 ADDITIONS (E2, E3, H, L)
// ---------------------------------
// fullSync, incrementalSync — backfill / catch-up of Slack messages
// from the connection's selected channel. Read
// credential_metadata.selected_channel_id (set by L's PATCH endpoint
// in commit 8); inert if absent. Call team.info once per sync to
// obtain team_domain for source_url construction (oauth.v2.access
// response doesn't include domain). Commit 7's webhook handler will
// share the team.info pattern with a module-scope cache for hot-
// isolate efficiency.
//
// fullSync's oldest = now - 30 days; incrementalSync's oldest =
// connection.last_sync_cursor (parsed) || now - 30 days. Both share
// _doSync as the implementation core.
//
// E3 backfill cap: 5 paginated calls × 200 messages = 1000-message
// ceiling. Stops when 5-page count is hit OR when a page returns
// <200 records (last page) OR when cursor is empty. On 5-page-cap-hit
// AND remaining cursor: result.detail = { cap_hit: true, cap_pages,
// cap_records, oldest_synced_ts } so sync.js writes it to
// sync_runs.detail (E3 cap-hit signal — Block 5's freshness layer
// reads this).
//
// E2 rate-limit handling: on 429 response from conversations.history,
// read Retry-After header. If retry-after fits within remaining CPU
// budget (25s threshold under Workers' 30s wall, 5s margin for Neon
// round-trip + cleanup, deliberately not optimized — abort-path
// correctness > abort-path latency), sleep + retry. Else, abort:
// SELECT own running sync_run id, UPDATE row with records counts +
// detail (E2's locked detail shape), then throw rate_limited string
// — sync.js's catch path UPDATEs status='failed' + error +
// finished_at, preserving the records counts and detail we set.
//
// L inert-sync signal: when credential_metadata.selected_channel_id is
// absent, _doSync returns SyncResult with detail.inert=true and zero
// counts. sync.js (commit 6 modification) detects detail.inert and
// skips the connections.last_sync_at bump — preserves freshness
// signal honesty per L's locked rule.
//
// H entity mapping: source_id = `${channel_id}:${ts}`; source_type =
// 'slack_message'; metadata = { channel_id, channel_name, thread_ts,
// team_id, user, subtype, edited_ts }; source_url constructed from
// team_domain + channel_id + ts. thread_broadcast collapses to single
// entity via the UPSERT key — both events would arrive at the same
// (connection_id, source_type, source_id) and the second UPDATEs the
// first, effectively one row per logical message. users.info called
// per first-sighting of each Slack user during a sync; cached
// in-memory for sync lifetime. Block 9 polish: cross-sync cache.
//
// THREAD REPLY BACKFILL SCOPE (v1.1 deferral, locked sub-decision f)
// ------------------------------------------------------------------
// fullSync calls only conversations.history — captures top-level
// messages, thread roots, thread_broadcast. It does NOT call
// conversations.replies; thread reply messages are NOT backfilled in
// v1.1. Webhooks (commit 7) ingest new replies going forward. Block 9
// polish adds conversations.replies traversal to fullSync. Per H's
// locked text the entity-mapping rules cover thread replies if they
// arrive; v1.1 simply doesn't fetch them during backfill.
//
// SECURITY (echoes dummy.js's pattern)
// ------------------------------------
// Error strings MUST NOT include any byte of the plaintext bot token,
// not even truncated. The token is `xoxb-…` long-lived per O; any log
// entry containing a prefix is a credential leak that survives until
// admin-driven disconnect+reconnect (no auto-revocation per O).
// Slack's `error` field on !ok responses is a short error code (safe
// to include verbatim). NEVER concatenate creds.access_token into any
// error or log line. The catch blocks in upstream handlers (sync.js,
// channels.js, callback.js) collapse internal errors to "Internal
// error" without leaking _err.message; do not rely on that — every
// throw in this module must already be credential-free.
//
// COMMIT 7 ADDITIONS (D, D1-D4, F, F1, F2, I)
// -------------------------------------------
// handleWebhook — Slack Events API entry, called by
// functions/api/connectors/slack/events.js. Implements the locked
// signature-verify + dispatch spec in full:
//   D1: HMAC verify via crypto.subtle.verify (no === on hex digests;
//       constant-time by contract).
//   D2: Symmetric ±5min timestamp window; stale and future-dated reject
//       with byte-identical responses (S15 paired-assertion in the
//       verification matrix asserts on byte equality, not just status).
//   D3: read text → verify → JSON.parse on the SAME bytes; post-verify
//       parse failure logs rawBody marker + 403 (preserves D4's single-
//       canonical-observable while routing the anomaly to ops via logs).
//   D4: One canonical forbidden() 403 for every rejection path —
//       missing/malformed headers, signature failure, unknown envelope
//       type, missing team_id, etc.
//   F:  Single connection per Slack team_id (v1.1 lock); 0-row → 200
//       ack-only (Slack stops retrying); >1-row → 500 with
//       console.error for ops alerting (schema-permitted but v1.2-only
//       state).
//   F1: url_verification challenge as the FIRST code path post-verify;
//       returns application/json with { challenge: "..." }.
//   F2: Dispatch on body.event.type (not body.type — body.type is
//       always 'event_callback' for events); subtype switch handles
//       plain new messages + thread_broadcast (single-entity collapse
//       per H) + message_changed (UPSERT) + message_deleted (hard
//       DELETE per I + entities' hard-delete-on-FK-cascade schema
//       policy). Unhandled subtypes return 200 ack-only — Slack
//       expects 200 even for events we don't process; non-200
//       triggers Slack's 3-retry-then-fail loop.
//
// V1.1 CHANNEL-SCOPE FILTER
// -------------------------
// Webhook events are filtered to credential_metadata.selected_channel_id
// only — keeping the entity store consistent with backfill scope (L's
// single-channel selection). Events for other channels the bot sees
// are 200-acked but not written. Block 9 polish: relax this when
// multi-channel selection ships.
//
// MODULE-SCOPE WEBHOOK CACHES
// ---------------------------
// Hot-isolate caches for team_domain (per connection_id) and user
// display names (per connection_id, then per user_id). Per-isolate;
// cleared on cycling. Block 9 polish: cross-isolate persistence
// (likely a slack_users cache table; see Open follow-ups in
// BLOCK_4_PLAN.md). Keying by connection_id makes multi-connection
// cleanup mechanical when v1.2 reopens multi-project-per-workspace.
// =========================================================================

import { aadFor, decrypt } from '../crypto.js';
import { EMBEDDING_MODEL_ID } from '../ai/embeddings.js';
import { embedEntityRow, writeEntityWithEmbedding } from './_shared/entity_writer.js';

const SLACK_API_BASE = 'https://slack.com/api';
const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const BOT_SCOPES = 'channels:read,channels:history,users:read';

// Decision K (revised in Block 4 mid-flight 2026-05-06): per-environment
// redirect_uri derivation via request.url.host + allowlist, replacing
// ctx.env.SITE_URL for OAuth (the wrangler.toml [env.preview.vars] approach
// broke the preview deploy at runtime — Cloudflare Worker exception 1101,
// likely because Pages env overrides drop top-level bindings/compat at
// runtime).
//
// Slack OAuth requires redirect_uri at startAuth + completeAuth to match
// BYTE-EXACTLY. Both endpoints run on the SAME Workers env that received
// the request, so deriving SITE_URL from request.url.host yields matching
// values on each env automatically — preview deploys derive the preview
// alias, production derives elinnoagent.com, no env-config plumbing.
//
// Allowlist closes the open-redirect class K targets. Cloudflare's edge
// sets request.url.host from TLS SNI + verified Host header, but defense-
// in-depth is cheap. Adding a new preview branch alias requires (a)
// registering the redirect URI with Slack at api.slack.com/apps, AND (b)
// adding the host here. Block 6 (Jira) + Block 8 (Drive) connectors should
// mirror this pattern.
//
// SITE_URL stays in wrangler.toml [vars] for the password-reset email flow
// (which doesn't have request.url to derive from — it constructs links from
// the env). Only the OAuth flow switches to runtime derivation.
const ALLOWED_OAUTH_HOSTS = new Set([
  'elinnoagent.com',
  'block-4-slack-connector.elinno-agent.pages.dev',
]);

function deriveSiteUrl(request) {
  const u = new URL(request.url);
  if (!ALLOWED_OAUTH_HOSTS.has(u.host)) {
    throw new Error(`unrecognized OAuth host: ${u.host}`);
  }
  return `${u.protocol}//${u.host}`;
}

// E3 backfill cap (BLOCK_4_PLAN.md decision E3)
const PAGE_LIMIT = 200;
const MAX_PAGES = 5;
const BACKFILL_WINDOW_DAYS = 30;

// E2 CPU budget (BLOCK_4_PLAN.md decision E2). 25s threshold under
// Workers' 30s wall; 5s margin for Neon round-trip + closing logic +
// response serialization. Generous, deliberately not optimized.
const CPU_BUDGET_SECONDS = 25;

// Linear backoff between paginated calls when no rate-limit hits
// (BLOCK_4_PLAN.md decision E2). Keeps Slack's Tier 3 limit out of
// reach during normal backfills. Tightening this is exactly the kind
// of "small efficiency" that creates new failure modes — leave alone.
const PAGE_BACKOFF_MS = 250;

// D2: timestamp window (BLOCK_4_PLAN.md decision D2). Symmetric ±300s.
const WEBHOOK_TIMESTAMP_WINDOW_SECONDS = 300;

// Module-scope caches for the webhook handler. Per-isolate; cleared on
// isolate cycling. Block 9 polish: cross-isolate persistence.
//
// teamDomainCache: connection_id → team_domain. Avoids repeat
// team.info calls per webhook event in a hot isolate.
//
// webhookUserCache: connection_id → Map<user_id, displayName|null>.
// Avoids repeat users.info calls. Same null-on-error fallback as
// resolveUserDisplayName's sync-local cache pattern.
/** @type {Map<string, string>} */
const teamDomainCache = new Map();
/** @type {Map<string, Map<string, string|null>>} */
const webhookUserCache = new Map();

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
 *
 * Throws on HTTP non-2xx EXCEPT 429, which is structured into a
 * ratelimited response shape so callers can read Retry-After. (E2's
 * rate-limit handling needs the header value to make the
 * sleep-vs-abort decision; throwing on 429 would lose it.) Existing
 * non-fullSync callers' `if (!response.ok)` checks still catch the
 * 429-shaped response.
 *
 * Slack-level errors `{ ok: false, error: 'x' }` flow through unchanged
 * so each call site can include its own context in the thrown error.
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

  // E2 rate-limit handling: surface 429 as a structured response
  // (preserving Retry-After) instead of throwing. Callers' !response.ok
  // checks still match.
  if (response.status === 429) {
    const retryAfterStr = response.headers.get('retry-after') || '1';
    const retryAfterSeconds = parseInt(retryAfterStr, 10) || 1;
    return {
      ok: false,
      error: 'ratelimited',
      retry_after_seconds: retryAfterSeconds,
    };
  }

  if (!response.ok) {
    throw new Error(`slack api http ${response.status} on ${method}`);
  }
  return await response.json();
}

// --- Sync helpers (E2 / E3 / H) ------------------------------------------

/**
 * Find the running sync_run row for this connection. Used on
 * rate-limit abort + cap-hit paths to UPDATE detail/records counts
 * directly from inside _doSync (sync.js's success/failure UPDATEs
 * preserve fields they don't set, so writing here is durable).
 *
 * @param {object} sql
 * @param {string} connectionId
 * @returns {Promise<string|null>}
 */
async function fetchRunningSyncRunId(sql, connectionId) {
  const [row] = await sql`
    SELECT id FROM sync_runs
     WHERE connection_id = ${connectionId}
       AND status = 'running'
     ORDER BY started_at DESC
     LIMIT 1
  `;
  return row ? row.id : null;
}

/**
 * Resolve the workspace's domain. Cached for the sync lifetime in the
 * caller's local variable. Webhooks (commit 7) cache at module scope
 * per connection_id for hot-isolate efficiency.
 *
 * Implementation note (Block 4 mid-flight 2026-05-06): the original
 * `team.info` call required `team:read` scope, which is NOT in the
 * locked BOT_SCOPES per decision B (only channels:read + channels:history
 * + users:read). Slack returned `missing_scope` and the first fullSync
 * after channel-pick failed. Switched to `auth.test`, which requires NO
 * scope and returns `url` shaped `https://<team-domain>.slack.com/`.
 * Parse the subdomain to get team_domain — same value team.info would
 * have returned.
 */
async function resolveTeamDomain(token) {
  const response = await slackApiPost('auth.test', {}, token);
  if (!response.ok || !response.url) {
    throw new Error(
      `slack auth.test failed: ${response.error || 'unknown'}`
    );
  }
  // url shape: "https://<domain>.slack.com/" (trailing slash) or without.
  // Be strict — any deviation indicates a Slack API contract change worth
  // a hard fail rather than a malformed permalink downstream.
  const match = response.url.match(/^https?:\/\/([^.]+)\.slack\.com\/?$/);
  if (!match) {
    throw new Error(
      `slack auth.test returned unparseable url: ${response.url}`
    );
  }
  return match[1];
}

/**
 * Resolve a Slack user's display name. Cache hits return immediately;
 * misses call users.info and cache. On 404 / non-ok response /
 * unexpected throw: cache null and return null (graceful degradation
 * per H — never 500 a sync over a name lookup).
 *
 * Display name preference: profile.display_name → profile.real_name →
 * user.real_name → null.
 */
async function resolveUserDisplayName(token, userId, cache) {
  if (cache.has(userId)) return cache.get(userId);
  let value = null;
  try {
    const response = await slackApiPost(
      'users.info',
      { user: userId },
      token
    );
    if (response.ok && response.user) {
      const profile = response.user.profile || {};
      const candidate =
        (profile.display_name && profile.display_name.trim()) ||
        (profile.real_name && profile.real_name.trim()) ||
        (response.user.real_name && response.user.real_name.trim()) ||
        null;
      if (candidate) value = candidate;
    }
  } catch {
    // Network blip or unexpected response shape — fall back to null
    // (no-throw on lookup failure, mirroring auth.js's session-lookup
    // pattern).
  }
  cache.set(userId, value);
  return value;
}

/** Build a Slack permalink URL per H's locked construction. */
function slackPermalinkUrl(teamDomain, channelId, ts) {
  return `https://${teamDomain}.slack.com/archives/${channelId}/p${ts.replace('.', '')}`;
}

/** Slack ts is "1706140800.000100" (seconds.microseconds). Convert to
 *  ISO 8601 for Postgres TIMESTAMPTZ. */
function tsToTimestamptz(ts) {
  if (typeof ts !== 'string') return null;
  const seconds = parseFloat(ts);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Map a Slack message payload to an entity row shape per H's locked
 * mapping. Resolves author display name via users.info cache.
 */
async function mapMessageToEntity(message, channelMeta, teamDomain, userCache, token) {
  const ts = message.ts;
  const userId = message.user || null;
  const sourceCreatedAt = tsToTimestamptz(ts);
  const sourceUpdatedAt = message.edited?.ts
    ? tsToTimestamptz(message.edited.ts)
    : sourceCreatedAt;
  const sourceUrl = slackPermalinkUrl(teamDomain, channelMeta.id, ts);

  let displayName = null;
  if (userId) {
    displayName = await resolveUserDisplayName(token, userId, userCache);
  }

  return {
    source: 'slack',
    source_type: 'slack_message',
    source_id: `${channelMeta.id}:${ts}`,
    title: null,
    content_text: message.text || null,
    author_external_id: userId,
    author_display_name: displayName,
    source_created_at: sourceCreatedAt,
    source_updated_at: sourceUpdatedAt,
    metadata: {
      channel_id: channelMeta.id,
      channel_name: channelMeta.name || null,
      thread_ts: message.thread_ts || null,
      team_id: channelMeta.team_id || null,
      user: userId,
      subtype: message.subtype || null,
      edited_ts: message.edited?.ts || null,
    },
    raw: message,
    source_url: sourceUrl,
  };
}

/**
 * Shared core for fullSync and incrementalSync. options.oldest is the
 * Slack ts (or Unix integer) cutoff for conversations.history.
 *
 * Returns SyncResult: { records_inserted, records_updated,
 * records_skipped, cursor_after?, detail? }. detail.inert when no
 * channel is selected; detail.cap_hit/etc when E3's 5-page cap fires
 * before the time window closes.
 *
 * Throws on rate-limit-abort (after writing partial state to
 * sync_runs) and on unrecoverable Slack errors. sync.js's catch path
 * captures the throw and writes status='failed' + error + finished_at;
 * fields written here (records counts + detail) persist.
 */
async function _doSync(ctx, connection, options) {
  const sql = ctx.sql;

  // 1. Inert detection (L). selected_channel_id absent → return zero
  //    counts + detail.inert. sync.js skips last_sync_at on this signal.
  const meta = connection.credential_metadata || {};
  const channelId = meta.selected_channel_id;
  if (typeof channelId !== 'string' || channelId.length === 0) {
    return {
      records_inserted: 0,
      records_updated: 0,
      records_skipped: 0,
      detail: { inert: true, reason: 'no channel selected' },
    };
  }
  const channelName = meta.selected_channel_name || null;

  // 2. Decrypt the bot token. Block 3 decision L: connectors decrypt
  //    internally. SECURITY: plaintext credentials live only on the
  //    call stack from here through the API loop.
  const aad = aadFor(connection);
  const credsJson = await decrypt(ctx.env, connection, aad);
  const creds = JSON.parse(credsJson);
  const token = creds.access_token;
  const teamId = creds.team_id || null;

  // 3. team.info once per sync — gives team_domain for source_url
  //    construction. Per locked sub-decision (b): no
  //    credential_metadata UPDATE; one call per sync acceptable for
  //    v1.1 scale (Slack team.info is Tier 4, low rate-limit risk).
  const teamDomain = await resolveTeamDomain(token);
  const channelMeta = { id: channelId, name: channelName, team_id: teamId };
  const userCache = new Map();

  // 4. Page through conversations.history with E3 cap mechanics.
  const startedAt = performance.now();
  let inserted = 0;
  let updated = 0;
  const skipped = 0;
  let cursor;
  let pages = 0;
  let oldestTsSeen = null;
  let latestTsSeen = null;

  // E3 stop conditions:
  //   - pages >= MAX_PAGES (5-page cap fires)
  //   - response page returns < PAGE_LIMIT messages (Slack last-page convention)
  //   - cursor is empty
  while (pages < MAX_PAGES) {
    const params = {
      channel: channelId,
      limit: String(PAGE_LIMIT),
      oldest: String(options.oldest),
      inclusive: 'false',
    };
    if (cursor) params.cursor = cursor;

    // E2 rate-limit retry loop. Each attempt either completes, retries
    // after a sleep that fits the budget, or aborts.
    let response;
    for (;;) {
      response = await slackApiPost('conversations.history', params, token);
      if (response.ok) break;

      if (response.error === 'ratelimited') {
        const retryAfter = response.retry_after_seconds || 1;
        const elapsed = (performance.now() - startedAt) / 1000;
        if (elapsed + retryAfter <= CPU_BUDGET_SECONDS) {
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
        // Budget exceeded — abort with structured detail. SELECT own
        // sync_run id and UPDATE records counts + detail BEFORE
        // throwing; sync.js's catch only sets status/error/
        // finished_at, preserving these fields.
        const syncRunId = await fetchRunningSyncRunId(sql, connection.id);
        if (syncRunId) {
          const detail = {
            reason: 'rate_limited',
            retry_after_seconds: retryAfter,
            records_so_far: inserted + updated,
            recommendation:
              'Re-run sync after Retry-After elapses; cursor resumes from the last paginated page.',
          };
          await sql`
            UPDATE sync_runs
               SET records_inserted = ${inserted},
                   records_updated  = ${updated},
                   records_skipped  = ${skipped},
                   detail           = ${detail}
             WHERE id = ${syncRunId}
          `;
        }
        throw new Error(`rate_limited: Retry-After=${retryAfter}s`);
      }

      // Non-rate-limit Slack error — bubble up.
      throw new Error(
        `slack conversations.history failed: ${response.error}`
      );
    }

    pages++;
    const messages = response.messages || [];

    for (const message of messages) {
      // Track ts extremes for cursor + cap-hit oldest_synced_ts signal
      if (message.ts) {
        if (
          oldestTsSeen === null ||
          parseFloat(message.ts) < parseFloat(oldestTsSeen)
        ) {
          oldestTsSeen = message.ts;
        }
        if (
          latestTsSeen === null ||
          parseFloat(message.ts) > parseFloat(latestTsSeen)
        ) {
          latestTsSeen = message.ts;
        }
      }

      const entity = await mapMessageToEntity(
        message,
        channelMeta,
        teamDomain,
        userCache,
        token
      );
      const upsertResult = await writeEntityWithEmbedding(
        ctx.env,
        sql,
        connection.project_id,
        connection.id,
        entity
      );
      if (upsertResult.inserted) inserted++;
      else updated++;
    }

    cursor = response.response_metadata?.next_cursor || null;
    if (!cursor || messages.length < PAGE_LIMIT) {
      break;
    }

    if (PAGE_BACKOFF_MS > 0) {
      await new Promise((r) => setTimeout(r, PAGE_BACKOFF_MS));
    }
  }

  // E3 cap-hit: 5-page count fired AND we still have a cursor (more
  // messages exist beyond the cap). The plain "5 pages, last page
  // <200 records" case is normal completion, not a cap-hit.
  const capHit = pages >= MAX_PAGES && !!cursor;

  /** @type {import('./types.js').SyncResult} */
  const result = {
    records_inserted: inserted,
    records_updated: updated,
    records_skipped: skipped,
    cursor_after: latestTsSeen || null,
  };

  if (capHit) {
    result.detail = {
      cap_hit: true,
      cap_pages: MAX_PAGES,
      cap_records: PAGE_LIMIT * MAX_PAGES,
      oldest_synced_ts: oldestTsSeen,
    };
  }

  try {
    await sweepMissingEmbeddings(ctx.env, sql, connection);
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'embedding_sweep_failed',
      connection_id: connection.id,
      error: err && err.message ? String(err.message).slice(0, 200) : 'unknown',
    }));
  }

  return result;
}

/**
 * Post-sync sweep: find entities for this connection that lack an
 * embedding row at our model and embed them, up to 50 per call.
 * Idempotent — re-running on a fully-embedded connection is a no-op.
 *
 * Catches three classes of gap:
 *   - Block 4 entities synced before commit 3 existed (S6).
 *   - Retryable on-write failures from a prior sync (S22's
 *     OpenAI-429-during-sync case).
 *   - Webhook entities whose inline embed failed.
 *
 * Per-row failures are logged and skipped; one bad row does not
 * abort the sweep.
 *
 * @param {object} env
 * @param {object} sql
 * @param {object} connection - SELECTed connection row
 */
async function sweepMissingEmbeddings(env, sql, connection) {
  const rows = await sql`
    SELECT e.id, e.content_text, e.metadata
      FROM entities e
      LEFT JOIN entity_embeddings ee
        ON ee.entity_id = e.id
       AND ee.model = ${EMBEDDING_MODEL_ID}
       AND ee.chunk_index = 0
     WHERE e.connection_id = ${connection.id}
       AND ee.id IS NULL
       AND e.content_text IS NOT NULL
       AND length(trim(e.content_text)) > 0
     ORDER BY e.created_at DESC
     LIMIT 50
  `;

  for (const row of rows) {
    try {
      await embedEntityRow(
        env,
        sql,
        connection.project_id,
        connection.id,
        row.id,
        { content_text: row.content_text, metadata: row.metadata }
      );
    } catch (err) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'embedding_sweep_row_failed',
        connection_id: connection.id,
        entity_id: row.id,
        error: err && err.message ? String(err.message).slice(0, 200) : 'unknown',
      }));
    }
  }
}

// --- Webhook helpers (D, D1-D4, F, F1, F2, I) -----------------------------

/** Canonical 403 response for webhook rejection paths (D4). */
function forbidden() {
  return new Response(
    JSON.stringify({ error: 'Forbidden' }),
    { status: 403, headers: { 'content-type': 'application/json' } }
  );
}

/**
 * Hex-decode a string into a Uint8Array. Throws on invalid hex.
 * Slack's signature header is "v0=<hex>"; the caller strips the prefix
 * before calling.
 */
function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0) {
    throw new Error('hexToBytes: invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new Error('hexToBytes: invalid hex digit');
    out[i] = byte;
  }
  return out;
}

/**
 * Process a single Slack message event (new / changed / thread_broadcast).
 * Decrypts the bot token (per Block 3 decision L); resolves team_domain
 * and the user display name via module-scope caches; UPSERTs the entity.
 *
 * Caller (handleWebhook's switch) is responsible for selecting the
 * correct message payload per subtype: plain new and thread_broadcast
 * receive body.event directly; message_changed receives body.event.message
 * (the full updated message).
 *
 * @param {object} env - Pages Function env (HYPERDRIVE, MASTER_ENCRYPTION_KEY)
 * @param {object} sql - postgres tagged-template client opened by events.js
 * @param {object} connection - SELECTed connection row
 * @param {object} message - Slack message payload
 */
async function processMessageEvent(env, sql, connection, message) {
  // SECURITY: plaintext credentials live only on the call stack here
  // through the API call below. Never cached at module scope, never
  // logged. (Same SECURITY discipline as testConnection / _doSync.)
  const aad = aadFor(connection);
  const credsJson = await decrypt(env, connection, aad);
  const creds = JSON.parse(credsJson);
  const token = creds.access_token;
  const teamId = creds.team_id || null;

  // Resolve team_domain (cache hit avoids API call). Per locked
  // sub-decision (b), webhook caches keyed by connection_id.
  let teamDomain = teamDomainCache.get(connection.id);
  if (!teamDomain) {
    teamDomain = await resolveTeamDomain(token);
    teamDomainCache.set(connection.id, teamDomain);
  }

  // Per-connection user cache (lazy init).
  let userCache = webhookUserCache.get(connection.id);
  if (!userCache) {
    userCache = new Map();
    webhookUserCache.set(connection.id, userCache);
  }

  // Channel metadata from event payload + credential_metadata for name.
  // Selected channel name comes from credential_metadata (set by L's
  // PATCH endpoint in commit 8); for events on a non-selected channel
  // we'd return null name (but the v1.1 channel-scope filter in
  // handleWebhook prevents non-selected events from reaching here).
  const meta = connection.credential_metadata || {};
  const channelMeta = {
    id: message.channel || null,
    name: meta.selected_channel_name || null,
    team_id: teamId,
  };
  if (!channelMeta.id) {
    // Defensive: some non-message subtypes might omit channel; this
    // function is only called from the message-handling switch arms,
    // but better to skip silently than throw.
    return;
  }

  const entity = await mapMessageToEntity(
    message,
    channelMeta,
    teamDomain,
    userCache,
    token
  );
  await writeEntityWithEmbedding(
    env,
    sql,
    connection.project_id,
    connection.id,
    entity
  );
}

// --- Connector export -----------------------------------------------------

/** @type {import('./types.js').Connector} */
export const slack = {
  getMetadata() {
    return METADATA;
  },

  // Decision P: scope param populated; user_scope param omitted entirely.
  // Decision A: single-workspace install — doesn't affect URL construction.
  // Decision K (revised v1.1.1): redirect_uri derived from request.url.host
  // via deriveSiteUrl() with allowlist. See ALLOWED_OAUTH_HOSTS comment.
  // State doubles as the future connection.id (commit 3 INSERT).
  async startAuth(ctx) {
    const state = crypto.randomUUID();
    const url = new URL(SLACK_AUTHORIZE_URL);
    url.searchParams.set('client_id', ctx.env.SLACK_CLIENT_ID);
    url.searchParams.set('scope', BOT_SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set(
      'redirect_uri',
      `${deriveSiteUrl(ctx.request)}/api/connectors/slack/oauth/callback`
    );
    return { authUrl: url.toString(), state };
  },

  // Exchange authorization code for the bot token. Returns plaintext
  // credentials; handler encrypts via Block 3 envelope helper before
  // INSERT/UPDATE. params shape: { code, state } from the callback URL.
  async completeAuth(ctx, params) {
    const tokenResponse = await slackApiPost(
      'oauth.v2.access',
      {
        code: params.code,
        client_id: ctx.env.SLACK_CLIENT_ID,
        client_secret: ctx.env.SLACK_CLIENT_SECRET,
        // Must match the redirect_uri sent at startAuth byte-for-byte
        // (Slack OAuth requirement). deriveSiteUrl() yields the same
        // value here as at startAuth because both endpoints run on the
        // same Workers env that received the request.
        redirect_uri: `${deriveSiteUrl(ctx.request)}/api/connectors/slack/oauth/callback`,
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

  /**
   * Backfill: pulls Slack messages from the connection's selected
   * channel into entities. E3 cap (1000 messages or 30 days, whichever
   * comes first). E2 rate-limit handling. L inert-sync detection.
   */
  async fullSync(ctx, connection) {
    const oldest =
      Math.floor(Date.now() / 1000) - BACKFILL_WINDOW_DAYS * 86400;
    return _doSync(ctx, connection, { oldest });
  },

  /**
   * Cursor-based catch-up. oldest = connection.last_sync_cursor (Slack
   * ts string parsed to Unix seconds), falling back to the same 30-day
   * window as fullSync if no cursor is set.
   */
  async incrementalSync(ctx, connection) {
    const cursorTs = connection.last_sync_cursor;
    let oldest = null;
    if (typeof cursorTs === 'string' && cursorTs.length > 0) {
      const parsed = parseFloat(cursorTs);
      if (Number.isFinite(parsed) && parsed > 0) {
        oldest = Math.floor(parsed);
      }
    }
    if (!oldest) {
      oldest =
        Math.floor(Date.now() / 1000) - BACKFILL_WINDOW_DAYS * 86400;
    }
    return _doSync(ctx, connection, { oldest });
  },

  /**
   * Slack Events API webhook handler. Implements D1-D4 (verify spec),
   * F1 (url_verification first), F2 (event_callback dispatch), I
   * (edits/deletes), F (single-connection-per-team_id v1.1 lock).
   *
   * Called by functions/api/connectors/slack/events.js. ctx.projectId
   * arrives as '' placeholder per locked sub-decision (a); we resolve
   * the real project_id via the team_id-based connection lookup below.
   *
   * @param {import('./types.js').ConnectorCtx} ctx
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async handleWebhook(ctx, request) {
    // === D3: read bytes ONCE for verify + parse ===
    const rawBody = await request.text();

    // === D2: timestamp window — symmetric ±5 min ===
    const tsHeader = request.headers.get('X-Slack-Request-Timestamp');
    const ts = parseInt(tsHeader || '', 10);
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isFinite(ts) ||
      Math.abs(now - ts) > WEBHOOK_TIMESTAMP_WINDOW_SECONDS
    ) {
      return forbidden();
    }

    // === D1: HMAC verify via crypto.subtle.verify (constant-time) ===
    const sigHeader = request.headers.get('X-Slack-Signature') || '';
    if (!sigHeader.startsWith('v0=')) return forbidden();
    let sigBytes;
    try {
      sigBytes = hexToBytes(sigHeader.slice(3));
    } catch {
      return forbidden();
    }
    const baseString = `v0:${tsHeader}:${rawBody}`;
    const signingKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(ctx.env.SLACK_SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const verified = await crypto.subtle.verify(
      'HMAC',
      signingKey,
      sigBytes,
      new TextEncoder().encode(baseString)
    );
    if (!verified) return forbidden();

    // === D3 (continued): parse AFTER verify; post-verify parse failure
    //     logs rawBody marker + 403 (preserves D4's single-canonical-
    //     observable contract while routing the anomaly to ops via logs). ===
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (parseErr) {
      console.error(
        'slack:post_verify_parse_failure',
        { rawBody, error: parseErr?.message }
      );
      return forbidden();
    }

    // === F1: url_verification challenge — FIRST code path post-verify ===
    if (body.type === 'url_verification') {
      return new Response(
        JSON.stringify({ challenge: body.challenge }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    }

    // Unknown envelope type → 403-collapse (D4).
    if (body.type !== 'event_callback') {
      return forbidden();
    }

    // === F: single-connection-per-team_id (v1.1 lock) ===
    const teamId = body.team_id;
    if (typeof teamId !== 'string' || teamId.length === 0) {
      return forbidden();
    }

    const sql = ctx.sql;
    const connections = await sql`
      SELECT id, project_id, source,
             wrapped_data_key, iv, ciphertext_credentials,
             encryption_algorithm, credential_metadata
        FROM connections
       WHERE source             = 'slack'
         AND external_account_id = ${teamId}
         AND status              = 'active'
         AND deleted_at         IS NULL
    `;
    if (connections.length === 0) {
      // No active connection for this team. 200 ack-only — Slack
      // stops retrying. The event arrived for a workspace that has
      // no v1.1 active connection in our system (all soft-deleted,
      // never connected, etc.).
      return new Response(null, { status: 200 });
    }
    if (connections.length > 1) {
      // Schema permits multi-row for v1.2 (multi-project-per-workspace);
      // v1.1 doesn't ship the project-grouping machinery to make this
      // useful. 500 with ops alerting per F's lock.
      console.error(
        'slack:multi_connection_for_team',
        { team_id: teamId, count: connections.length }
      );
      return new Response(
        JSON.stringify({ error: 'Internal error' }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }
    const connection = connections[0];

    // === F2: dispatch on body.event.type (NOT body.type — that's
    //     always 'event_callback' for events) ===
    if (body.event?.type !== 'message') {
      // Unknown / unhandled event kind — 200 ack-only. Slack expects
      // 200 even for events we don't process; non-200 triggers
      // Slack's 3-retry-then-fail loop.
      return new Response(null, { status: 200 });
    }

    // V1.1 channel-scope filter: only process events for the selected
    // channel (L's single-channel-selection lock). Events for other
    // channels the bot can see are 200-acked but not written —
    // keeping the entity store consistent with backfill scope. Block
    // 9 polish: relax when multi-channel selection ships.
    const selectedChannelId =
      connection.credential_metadata?.selected_channel_id;
    const eventChannel =
      body.event.channel ||
      body.event.message?.channel ||
      body.event.previous_message?.channel ||
      null;
    if (
      selectedChannelId &&
      eventChannel &&
      eventChannel !== selectedChannelId
    ) {
      return new Response(null, { status: 200 });
    }

    // === Subtype switch (F2 + H thread_broadcast + I edits/deletes) ===
    switch (body.event.subtype) {
      case undefined:           // plain new message
      case 'thread_broadcast':  // H: collapses to one entity via UPSERT key
        await processMessageEvent(ctx.env, sql, connection, body.event);
        break;
      case 'message_changed':
        // Edits carry .message child = the full updated message. Slack
        // puts the channel at body.event.channel for changed events;
        // stamp it onto the inner message so processMessageEvent finds it.
        if (body.event.message) {
          await processMessageEvent(
            ctx.env,
            sql,
            connection,
            { ...body.event.message, channel: body.event.channel }
          );
        }
        break;
      case 'message_deleted': {
        // I: hard-DELETE by source_id. (Schema's hard-delete-on-
        // FK-cascade policy applies to entities; entity_embeddings
        // cascade-delete via FK.)
        const channelId =
          body.event.channel || body.event.previous_message?.channel;
        const deletedTs =
          body.event.deleted_ts || body.event.previous_message?.ts;
        if (channelId && deletedTs) {
          await sql`
            DELETE FROM entities
             WHERE connection_id = ${connection.id}
               AND source_type   = 'slack_message'
               AND source_id     = ${`${channelId}:${deletedTs}`}
          `;
        }
        break;
      }
      default:
        // bot_message, channel_join, file_share, etc. — ack-only.
        break;
    }

    return new Response(null, { status: 200 });
  },
};

// --- Channel listing helper (commit 5 endpoint consumes this) -------------

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
