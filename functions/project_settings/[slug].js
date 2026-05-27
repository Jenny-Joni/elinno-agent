// functions/project_settings/[slug].js
//
// Cloudflare Pages dynamic route for /project_settings/<slug>. Resolves
// a workspace-scoped slug to a project uuid and serves the static
// /project_settings.html directly under the slug URL — no 302 — so the
// URL bar stays /project_settings/<slug>?tab=... the whole time. Same
// HTMLRewriter approach as functions/project/[slug].js (no URL flicker).
//
// Route shape:
//   /project_settings/<slug>?tab=connections
//     → serves /project_settings.html, URL bar stays as-is
//
// Query string: not touched. The page JS reads ?tab= and ?just_connected=
// directly from location.search; since we no longer redirect, those
// params stay in the URL bar exactly as the user arrived with.
//
// IMPORTANT — why this is `[slug].js` and NOT `[[path]].js`:
//   A `[[catchall]]` route under functions/project_settings/ would ALSO
//   match `/project_settings` (zero segments), which CF Pages produces
//   internally when it strips the `.html` suffix from
//   `/project_settings.html?id=...`. The single-segment `[slug]` form
//   matches `/project_settings/<one>` only — `/project_settings` (zero)
//   and `/project_settings/a/b` (more) correctly fall through to static.
//
// Auth: requires a workspace session. Unauthenticated requests redirect
// to /login.html?next=<original-url+search> so the user lands back here
// after sign-in.
//
// Slug-not-found behavior: 302 → /projects.html.
//
// Caching: `cache-control: private, no-store` — the meta-injected uuid
// is workspace-scoped and must not be served from a shared cache.

import postgres from 'postgres';
import { getWorkspaceUserId } from '../_lib/workspace.js';
import { validateSlugFormat } from '../_lib/slug.js';

export async function onRequestGet({ request, env, params }) {
  const slug = params.slug;
  const incoming = new URL(request.url);

  if (!slug || !validateSlugFormat(slug).ok) {
    return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
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

  const assetUrl = new URL('/project_settings.html', request.url);
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
