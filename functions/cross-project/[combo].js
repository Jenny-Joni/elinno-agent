// functions/cross-project/[combo].js
//
// CF Pages route for /cross-project/<combo-slug>. <combo-slug> is a
// '+'-joined list of project slugs sorted alphabetically (e.g.
// "joni+rain", "gems-launchpad+gems-trade"). Project slugs match the
// existing regex `[a-z][a-z0-9-]*`, so the '+' separator is
// unambiguous — slugs themselves never contain '+'.
//
// Resolves each slug to a uuid (workspace-scoped), picks the most
// recent conversation in the combo, and serves /cross-project/chat.html
// directly under the slug URL with HTMLRewriter-injected meta tags:
//   <meta name="x-active-chat-id" content="<conv-uuid>">
//   <meta name="x-combo-ids" content="<sorted-uuid-list>">
// so the page boots into the right chat with the sidebar already
// filtered to the combo.
//
// Reserved-segment passthrough: this single-segment route also matches
// '/cross-project/chat' and '/cross-project/new' because CF Pages strips
// '.html'. When the segment is a known static page name (or doesn't
// look like a combo at all), we env.ASSETS.fetch(request) so the static
// file serves unchanged — legacy ?id=/?ids= URLs keep working.

import postgres from 'postgres';
import { getWorkspaceUserId } from '../_lib/workspace.js';
import { validateSlugFormat } from '../_lib/slug.js';

// Static file names that share the /cross-project/<segment> URL shape
// (CF Pages strips '.html'). When the combo segment matches one of
// these, we hand the request back to ASSETS.
const RESERVED_SEGMENTS = new Set(['chat', 'new', 'index']);

export async function onRequestGet({ request, env, params }) {
  const combo = params.combo;

  if (!combo || RESERVED_SEGMENTS.has(combo)) {
    return env.ASSETS.fetch(request);
  }

  const slugs = combo.split('+').filter(Boolean);
  // Must be at least 2 slugs (cross-project implies multiple projects)
  // and every slug must look like a valid slug. Bail to static for any
  // shape we can't recognize so we don't intercept future URL patterns.
  if (slugs.length < 2 || !slugs.every(s => validateSlugFormat(s).ok)) {
    return env.ASSETS.fetch(request);
  }

  const userId = await getWorkspaceUserId(request, env);
  if (!userId) {
    const next = new URL(request.url).pathname;
    const login = new URL('/login.html', request.url);
    login.searchParams.set('next', next);
    return Response.redirect(login.toString(), 302);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  let projectIds = null;
  let activeChatId = null;
  try {
    // Resolve every slug to a uuid in one query.
    // 2026-05-27 (shared-workspace-visibility): slug lookup is global —
    // any authenticated user can resolve any combo. If any slug doesn't
    // resolve (typo, deleted project) we soft-fail back to /cross-project/.
    // Uses the codebase's `IN ${sql(arr)}` pattern (see
    // functions/_lib/ai/authorize.js) — `= ANY(${arr})` trips postgres-js.
    const rows = await sql`
      SELECT id::text AS id, slug
        FROM projects
       WHERE slug          IN ${sql(slugs)}
         AND deleted_at IS NULL
    `;
    if (rows.length !== slugs.length) {
      return Response.redirect(new URL('/cross-project/', request.url).toString(), 302);
    }
    projectIds = rows.map(r => r.id).sort();

    // Find the most recent conversation whose project_ids exactly
    // matches the combo (same set, same length) AND belongs to this
    // user. 2026-05-27 (shared-workspace-visibility): projects are
    // shared but chats remain per-creator — each user has their own
    // combinations and history. project_ids is uuid[]; set-equality
    // via @>/<@ + length check so order in the stored array doesn't
    // matter. Array literal built manually because postgres-js's
    // `${jsArr}` serializes as CSV which fails to parse as uuid[].
    const projectIdsLiteral = '{' + projectIds.join(',') + '}';
    const convs = await sql`
      SELECT id::text AS id
        FROM conversations
       WHERE user_id    = ${userId}
         AND deleted_at IS NULL
         AND project_ids IS NOT NULL
         AND array_length(project_ids, 1) = ${projectIds.length}
         AND project_ids @> ${projectIdsLiteral}::uuid[]
         AND project_ids <@ ${projectIdsLiteral}::uuid[]
       ORDER BY last_message_at DESC NULLS LAST, created_at DESC
       LIMIT 1
    `;
    if (convs.length === 0) {
      // Empty combo — bounce to the combo grid so the user can
      // pick a different combo or start a new chat.
      return Response.redirect(new URL('/cross-project/', request.url).toString(), 302);
    }
    activeChatId = convs[0].id;
  } catch (_err) {
    return Response.redirect(new URL('/cross-project/', request.url).toString(), 302);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }

  return serveChatHtml(request, env, activeChatId, projectIds);
}

async function serveChatHtml(request, env, activeChatId, projectIds) {
  const assetUrl = new URL('/cross-project/chat.html', request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), {
    headers: request.headers,
  }));

  const metaHtml =
    '<meta name="x-active-chat-id" content="' + activeChatId + '">' +
    '<meta name="x-combo-ids" content="' + projectIds.join(',') + '">';

  const transformed = new HTMLRewriter()
    .on('head', {
      element(el) { el.append(metaHtml, { html: true }); },
    })
    .transform(assetResponse);

  const headers = new Headers(transformed.headers);
  headers.set('cache-control', 'private, no-store');
  return new Response(transformed.body, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers,
  });
}
