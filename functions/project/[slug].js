// functions/project/[slug].js
//
// Cloudflare Pages dynamic route for /project/<slug>. Resolves a
// workspace-scoped slug to a project uuid and serves the static
// /project.html directly under the slug URL — no 302 — so the URL bar
// shows /project/<slug> the whole time. Eliminates the brief
// /project?id=<uuid> flash that the previous 302-based implementation
// produced.
//
// The page JS needs the uuid to call /api/projects/<uuid> at boot. We
// inject it as <meta name="x-project-id" content="<uuid>"> via
// HTMLRewriter; public/project.html reads the meta tag in preference
// to ?id= (legacy ?id= URLs still work, both at the page and via
// /project.html being served directly).
//
// Route shape:
//   /project/<slug>          → matched here; lookup, ASSETS.fetch /project.html, inject meta, return.
//
// IMPORTANT — why this is `[slug].js` and NOT `[[path]].js`:
//   A `[[catchall]]` route under functions/project/ ALSO matches
//   `/project` (zero segments), which Cloudflare Pages produces
//   internally when it strips the `.html` suffix from
//   `/project.html?id=...`. The single-segment `[slug]` form matches
//   `/project/<one>` only — `/project` (zero) and `/project/a/b`
//   (more) correctly fall through to static / 404.
//
// Auth: requires a workspace session. Unauthenticated requests redirect
// to /login.html?next=<original-url> so the user lands back here after
// sign-in.
//
// Slug-not-found behavior: 302 → /projects.html (soft 404 so broken
// bookmarks land on a useful list).
//
// Caching: the response carries a per-workspace uuid, so we explicitly
// set `cache-control: private, no-store` to prevent a shared cache from
// serving project A's uuid to a different workspace whose project also
// happens to be slugged "rain".

import postgres from 'postgres';
import { getWorkspaceUserId } from '../_lib/workspace.js';
import { validateSlugFormat } from '../_lib/slug.js';

export async function onRequestGet({ request, env, params }) {
  const slug = params.slug;

  if (!slug || !validateSlugFormat(slug).ok) {
    return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
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
  let projectId = null;
  try {
    // 2026-05-27 (shared-workspace-visibility): slug lookup is global
    // across the shared workspace (slug uniqueness is workspace-wide
    // per the matching schema migration).
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
          '<meta name="x-project-id" content="' + projectId + '">',
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
