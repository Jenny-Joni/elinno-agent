// functions/project_settings/[slug]/[tab].js
//
// CF Pages route for /project_settings/<slug>/<tab>. Mirrors the
// sibling [slug].js (general tab) but also injects an <meta
// name="x-active-tab"> tag so the page boots into the named tab
// without needing ?tab= in the URL.
//
// Motivation: ?tab=connections looks like a UTM tracking param; the
// user wants tab state in the path (same pattern as commit 8802d4b's
// removal of ?c=<conv-uuid>).
//
// Allowed tabs are validated against a fixed allowlist; anything else
// 302s to /project_settings/<slug> (general tab default).

import postgres from 'postgres';
import { getWorkspaceUserId } from '../../_lib/workspace.js';
import { validateSlugFormat } from '../../_lib/slug.js';

const VALID_TABS = new Set(['general', 'connections']);

export async function onRequestGet({ request, env, params }) {
  const slug = params.slug;
  const tab = params.tab;
  const incoming = new URL(request.url);

  if (!slug || !validateSlugFormat(slug).ok) {
    return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
  }
  if (!VALID_TABS.has(tab)) {
    // Unknown tab → drop back to the slug-only URL (general tab).
    const fallback = new URL('/project_settings/' + slug, request.url);
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
    const rows = await sql`
      SELECT id::text AS id
        FROM projects
       WHERE owner_user_id = ${userId}
         AND slug          = ${slug}
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

  const assetUrl = new URL('/project_settings.html', request.url);
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
