// functions/project/[[path]].js
//
// Block 13.8c (v1.4 Phase 8) — Cloudflare Pages catch-all for /project/<slug>.
// Resolves workspace-scoped slug → uuid and 302-redirects to the existing
// /project.html?id=<uuid> static page so the rest of the app keeps working
// unchanged.
//
// URL shapes handled:
//   /project/<slug>          → lookup, 302 to /project.html?id=<uuid> or /projects.html
//   /project/<slug>/<extra>  → ignored (multi-segment paths fall through to /projects.html)
//
// The literal /project.html static file is served by Cloudflare Pages's
// static asset layer at the unrelated path `/project.html` and is NOT
// affected by this catch-all (the catch-all is registered under /project/,
// not /project.html).
//
// Auth: requires a workspace session. Unauthenticated requests redirect to
// /login.html?next=<original-url> so the user lands back here after sign-in.
//
// Slug-not-found behavior: 302 → /projects.html (per the Phase 8 plan, soft
// 404 so broken bookmarks land on a useful list).

import postgres from 'postgres';
import { getWorkspaceUserId } from '../_lib/workspace.js';
import { validateSlugFormat } from '../_lib/slug.js';

export async function onRequestGet({ request, env, params }) {
  // params.path is an array of path segments after /project/. Only the
  // single-segment form /project/<slug> is supported.
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  if (segments.length !== 1) {
    return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
  }
  const slug = segments[0];

  // Format-check first. If the URL contains characters that can't be a
  // valid slug, send the user to /projects.html without a DB hop.
  if (!validateSlugFormat(slug).ok) {
    return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
  }

  // Auth: workspace session required.
  const userId = await getWorkspaceUserId(request, env);
  if (!userId) {
    const next = new URL(request.url).pathname;
    const login = new URL('/login.html', request.url);
    login.searchParams.set('next', next);
    return Response.redirect(login.toString(), 302);
  }

  // Workspace-scoped lookup. The partial unique index
  // projects_owner_slug_active_idx makes this an index-only seek.
  const debug = new URL(request.url).searchParams.get('debug') === '1';

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
    if (debug) {
      // TEMP: diagnostic — remove before 13.8 ff-merges. Returns the
      // workspace user id, parsed slug, and the DB lookup result so we
      // can see why /project/<slug> isn't resolving as expected.
      return new Response(
        JSON.stringify({ slug, userId, rowCount: rows.length, rows }, null, 2),
        { headers: { 'content-type': 'application/json' } }
      );
    }
    if (rows.length === 0) {
      return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
    }
    const dest = new URL('/project.html', request.url);
    dest.searchParams.set('id', rows[0].id);
    return Response.redirect(dest.toString(), 302);
  } catch (err) {
    if (debug) {
      return new Response(
        JSON.stringify({ slug, userId, error: String(err && err.message || err) }, null, 2),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }
    // Fall back to the projects list on any DB error rather than 500;
    // the user can still navigate from there.
    return Response.redirect(new URL('/projects.html', request.url).toString(), 302);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}
