// functions/project_settings/[slug].js
//
// Cloudflare Pages dynamic route for /project_settings/<slug>.
// Mirrors functions/project/[slug].js: resolves a workspace-scoped slug
// to a project uuid and 302-redirects to the existing
// /project_settings.html?id=<uuid> static page, preserving any extra
// query params (tab, just_connected, just_created).
//
// Route shape:
//   /project_settings/<slug>?tab=connections
//     → 302 /project_settings.html?id=<uuid>&tab=connections
//
// IMPORTANT — why this is `[slug].js` and NOT `[[path]].js`:
//   A `[[catchall]]` route under functions/project_settings/ would ALSO
//   match `/project_settings` (zero segments), which CF Pages produces
//   internally when it strips the `.html` suffix from
//   `/project_settings.html?id=...`. The single-segment `[slug]` form
//   matches `/project_settings/<one>` only — `/project_settings` (zero)
//   and `/project_settings/a/b` (more) correctly fall through to static.
//   Same lesson as /project (see that file's header).
//
// Auth: requires a workspace session. Unauthenticated requests redirect
// to /login.html?next=<original-url+search> so the user lands back here
// after sign-in.
//
// Slug-not-found behavior: 302 → /projects.html (soft 404; matches the
// /project/<slug> contract).

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
    const dest = new URL('/project_settings.html', request.url);
    dest.searchParams.set('id', rows[0].id);
    // Preserve every other incoming query param verbatim (tab,
    // just_connected, just_created, anything future).
    for (const [k, v] of incoming.searchParams) {
      if (k === 'id') continue;
      dest.searchParams.set(k, v);
    }
    return Response.redirect(dest.toString(), 302);
  } catch (_err) {
    return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}
