// functions/api/projects/slug-available.js
//
// Block 13.8b (v1.4 Phase 8) — GET /api/projects/slug-available?slug=<x>
// Returns workspace-scoped availability of a candidate slug.
//
// Response shape:
//   200 { available: true }
//   200 { available: false, reason: 'reserved' | 'taken' }
//   400 { available: false, reason: 'invalid_format' }
//   401 (no session) — handled by getWorkspaceUserId returning null
//
// 2026-05-27 (shared-workspace-visibility): slug uniqueness is now
// global within the shared workspace — a slug is "taken" if any ACTIVE
// project anywhere has it. Soft-deleted projects don't participate
// (matches the schema migration that swapped the partial unique index
// from (owner_user_id, slug) to (slug) WHERE deleted_at IS NULL).

import postgres from 'postgres';
import { error, json } from '../../_lib/auth.js';
import { getWorkspaceUserId } from '../../_lib/workspace.js';
import { isReservedSlug, validateSlugFormat } from '../../_lib/slug.js';

export async function onRequestGet({ request, env }) {
  const userId = await getWorkspaceUserId(request, env);
  if (!userId) return error('Not authenticated', 401);

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  // Format check first — cheapest filter.
  const formatCheck = validateSlugFormat(slug);
  if (!formatCheck.ok) {
    return json(
      { available: false, reason: 'invalid_format' },
      { status: 400 }
    );
  }

  // Reserved-word check next — second-cheapest filter.
  if (isReservedSlug(slug)) {
    return json({ available: false, reason: 'reserved' });
  }

  // Shared-workspace DB check (no owner predicate; slug uniqueness is
  // global within active projects per the 2026-05-27 schema migration).
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });
  try {
    const rows = await sql`
      SELECT 1
        FROM projects
       WHERE slug          = ${slug}
         AND deleted_at IS NULL
       LIMIT 1
    `;
    if (rows.length > 0) {
      return json({ available: false, reason: 'taken' });
    }
    return json({ available: true });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}
