// functions/api/projects/index.js
//
// Block 2 Sub-task 2.1 — projects API.
//
// Routes (this file):
//   POST /api/projects  → create a project (workspace-admin only)
//   GET  /api/projects  → list projects in the session user's workspace
//
// v1.3 (Block 12.1, BLOCK_12_PLAN.md decision I): per-project membership
// collapsed. Project creation is a single INSERT into `projects`; the
// previous v1.2 second INSERT into `project_members` is gone (the table
// is dropped). GET filters by `projects.owner_user_id = $sessionUser.id`
// (workspace scope) instead of joining the dropped membership table.
import postgres from 'postgres';
import { error, getSessionUser, json, requireWorkspaceAdmin } from '../../_lib/auth.js';
import { deriveSlugFromName, isReservedSlug, validateSlugFormat } from '../../_lib/slug.js';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 1000;

export async function onRequestPost({ request, env }) {
  const { error: errResp, user } = await requireWorkspaceAdmin(request, env);
  if (errResp) return errResp;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
  if (rawName.length === 0) {
    return error('Project name is required', 400);
  }
  if (rawName.length > NAME_MAX) {
    return error(`Project name must be ${NAME_MAX} characters or fewer`, 400);
  }

  // description: optional. Omitted, explicit-null, and empty-after-trim
  // all map to NULL — semantically "no description" — so downstream
  // `WHERE description IS NULL` queries work uniformly.
  let description = null;
  if (body?.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') {
      return error('Project description must be a string', 400);
    }
    const trimmed = body.description.trim();
    if (trimmed.length > DESCRIPTION_MAX) {
      return error(`Project description must be ${DESCRIPTION_MAX} characters or fewer`, 400);
    }
    description = trimmed.length > 0 ? trimmed : null;
  }

  // Block 13.8d: slug acceptance + validation.
  //   - If body.slug is a non-empty string, validate format + reserved-word;
  //     reject with machine-readable codes on failure. INSERT uses the user's
  //     slug; collisions hit the partial unique index and return 'slug_taken'.
  //   - If body.slug is absent / null / empty, auto-derive from name and
  //     auto-suffix on workspace collision (matches the SQL-backfill behavior
  //     in 2026-05-23-block-13-8-projects-slug.sql). This keeps the
  //     "I just want to create a project named Rain" path frictionless.
  const userIdText = String(user.id);
  const userProvidedSlug =
    typeof body?.slug === 'string' && body.slug.trim().length > 0;
  let slug = null;
  if (userProvidedSlug) {
    slug = body.slug.trim();
    const fmt = validateSlugFormat(slug);
    if (!fmt.ok) {
      return error('Slug format is invalid', 400, { code: 'slug_invalid_format' });
    }
    if (isReservedSlug(slug)) {
      return error('Slug is reserved', 400, { code: 'slug_reserved' });
    }
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Auto-derive + auto-suffix when the caller didn't provide a slug.
    if (!userProvidedSlug) {
      let base = deriveSlugFromName(rawName);
      if (base === '') base = 'project';  // shouldn't happen — name is required
      // Cap to leave room for a "-NN" suffix.
      if (base.length > 60) base = base.slice(0, 60).replace(/-+$/g, '');
      // Avoid colliding with the reserved-word list by prefixing 'p-'.
      if (isReservedSlug(base)) base = 'p-' + base;
      // Find the first free suffix in the (shared) workspace.
      const existing = await sql`
        SELECT slug FROM projects
         WHERE deleted_at IS NULL
           AND (slug = ${base} OR slug LIKE ${base + '-%'})
      `;
      const taken = new Set(existing.map((r) => r.slug));
      if (!taken.has(base)) {
        slug = base;
      } else {
        let n = 2;
        while (taken.has(base + '-' + n)) n++;
        slug = base + '-' + n;
      }
    }

    let project;
    try {
      [project] = await sql`
        INSERT INTO projects (name, description, owner_user_id, slug)
        VALUES (${rawName}, ${description}, ${userIdText}, ${slug})
        RETURNING *
      `;
    } catch (insertErr) {
      // PG 23505 = unique_violation on projects_owner_slug_active_idx.
      // Only reachable when the caller passed an explicit slug that
      // races against a concurrent creator; auto-derive computes a free
      // suffix above and shouldn't hit this branch.
      if (insertErr && insertErr.code === '23505') {
        return error('Slug already taken in this workspace', 400, { code: 'slug_taken' });
      }
      throw insertErr;
    }

    return json({ ok: true, project }, { status: 201 });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup; never masks the return value
    }
  }
}

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env.DB);
  if (!user) return error('Not authenticated', 401);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // 2026-05-27 (shared-workspace-visibility): list all live projects
    // in the shared workspace. Originally filtered by owner_user_id
    // (v1.3 Block 12.1 decision I); that predicate is gone. `role` is
    // derived from D1 user.is_admin to preserve the v1.2 response shape
    // for the projects-list UI.
    const role = user.is_admin ? 'admin' : 'member';
    const projects = await sql`
      SELECT
        p.id,
        p.name,
        p.description,
        p.owner_user_id,
        p.slug,
        p.logo_r2_key,
        p.created_at,
        p.updated_at
        FROM projects p
       WHERE p.deleted_at IS NULL
       ORDER BY p.updated_at DESC, p.id DESC
    `;

    return json({
      ok: true,
      // Block 15.1 — augment each row with the public CDN URL for the
      // logo, computed from logo_r2_key. NULL key → null URL → callers
      // fall back to the initial-letter placeholder.
      projects: projects.map((p) => ({
        ...p,
        role,
        logo_url: p.logo_r2_key
          ? `https://logos.elinnoagent.com/${p.logo_r2_key}`
          : null,
      })),
    });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup; never masks the return value
    }
  }
}
