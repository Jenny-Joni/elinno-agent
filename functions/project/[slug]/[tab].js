// functions/project/[slug]/[tab].js
//
// CF Pages route for /project/<slug>/<tab>. Mirrors the sibling
// ../[slug].js (chat/default) but also injects a
// <meta name="x-active-tab" content="<tab>"> tag so the page boots
// into the named tab WITHOUT needing ?tab= in the URL.
//
// Motivation: ?tab=sprint looks like a UTM tracking param; tab state
// belongs in the path — same pattern as
// functions/project_settings/[slug]/[tab].js and commit 8802d4b's
// removal of ?c=<conv-uuid>.
//
// Route shape (two segments) only matches /project/<slug>/<tab>; the
// zero-segment /project and single-segment /project/<slug> still fall
// to static / ../[slug].js respectively (see that file's [[path]] note).
//
// Allowed tabs are validated against a fixed allowlist; 'chat' is the
// default and has no path segment, so it (and anything unknown) 302s
// to the slug-only /project/<slug> URL.

import postgres from 'postgres';
import { getWorkspaceUserId } from '../../_lib/workspace.js';
import { validateSlugFormat } from '../../_lib/slug.js';

// chat = slug-only default (no segment). members kept for legacy URL
// compatibility; sprint is the Block 16 Sprint View tab.
const VALID_TABS = new Set(['sprint', 'members']);

export async function onRequestGet({ request, env, params }) {
  const slug = params.slug;
  const tab = params.tab;
  const incoming = new URL(request.url);

  if (!slug || !validateSlugFormat(slug).ok) {
    return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
  }
  if (!VALID_TABS.has(tab)) {
    // Unknown tab (incl. 'chat') → drop back to the slug-only URL.
    const fallback = new URL('/project/' + slug, request.url);
    for (const [k, v] of incoming.searchParams) fallback.searchParams.set(k, v);
    return Response.redirect(fallback.toString(), 302);
  }

  const userId = await getWorkspaceUserId(request, env);
  if (!userId) {
    const next = incoming.pathname + incoming.search;
    const login = new URL('/login.html', request.url);
    login.searchParams.set('next', next);
    return Response.redirect(login.toString(), 302);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });
  let projectId = null;
  try {
    // 2026-05-27 (shared-workspace-visibility): slug lookup is global.
    const rows = await sql`
      SELECT id::text AS id
        FROM projects
       WHERE slug          = ${slug}
         AND deleted_at IS NULL
       LIMIT 1
    `;
    if (rows.length === 0) {
      return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
    }
    projectId = rows[0].id;
  } catch (_err) {
    return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }

  const assetUrl = new URL('/project.html', request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), {
    headers: request.headers,
  }));

  const transformed = new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(
          '<meta name="x-project-id" content="' + projectId + '">'
          + '<meta name="x-active-tab" content="' + tab + '">',
          { html: true }
        );
      },
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
