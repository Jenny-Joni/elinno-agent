// functions/api/projects/[id]/index.js
//
// Block 2 Sub-task 2.1 — projects API (read-one), extended in 12.4
// with PATCH (rename + description) and DELETE (soft-delete).
//
// Routes (this file):
//   GET    /api/projects/:id  → read one project in the workspace
//   PATCH  /api/projects/:id  → workspace-admin: update name and/or
//                               description
//   DELETE /api/projects/:id  → workspace-admin: soft-delete
//
// Workspace-scope is the gate (v1.3 successor to v1.1/v1.2's
// requireProjectRole). Edit-side handlers also require workspace-admin
// (D1 users.is_admin = 1).
//
// The response from GET includes ai_monthly_cap_usd, daily_message_limit
// (v1.3 Block 12.4), and ai_spend_period_to_date_usd computed inline.
// The project-settings General tab reads from this response.
import postgres from 'postgres';
import {
  error,
  json,
  requireWorkspaceScope,
  requireWorkspaceAdmin,
} from '../../../_lib/auth.js';
import { isReservedSlug, validateSlugFormat } from '../../../_lib/slug.js';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 1000;

export async function onRequestGet({ request, env, params }) {
  const { error: errResp, user } = await requireWorkspaceScope(
    request,
    env,
    params.id
  );
  if (errResp) return errResp;

  // v1.3: workspace admin is the sole role concept. Preserves the
  // v1.2 response field shape.
  const role = user.is_admin ? 'admin' : 'member';

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Defensive `deleted_at IS NULL` filter — the helper already
    // verified this, but two layers protect against future helper
    // refactors that might drop the check.
    const [project] = await sql`
      SELECT
        id,
        name,
        description,
        owner_user_id,
        slug,
        created_at,
        updated_at,
        ai_monthly_cap_usd::float        AS ai_monthly_cap_usd,
        daily_message_limit,
        (SELECT COALESCE(SUM(cost_usd), 0)::float
           FROM messages m
          WHERE m.project_id = projects.id
            AND m.created_at >= DATE_TRUNC('month', NOW())
            AND m.deleted_at IS NULL
        )                                 AS ai_spend_period_to_date_usd
        FROM projects
       WHERE id          = ${params.id}
         AND deleted_at  IS NULL
       LIMIT 1
    `;

    if (!project) {
      // Race: project was soft-deleted between requireWorkspaceScope's
      // check and this SELECT.
      return error('Not found', 404);
    }

    return json({ ok: true, project: { ...project, role } });
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

// PATCH — update name and/or description (12.4 settings General tab).
export async function onRequestPatch({ request, env, params }) {
  const scopeResult = await requireWorkspaceScope(request, env, params.id);
  if (scopeResult.error) return scopeResult.error;
  const adminResult = await requireWorkspaceAdmin(request, env);
  if (adminResult.error) return adminResult.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }
  if (!body || typeof body !== 'object') {
    return error('Body must be a JSON object', 400);
  }

  const updates = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return error('name must be a string', 400);
    }
    const trimmed = body.name.trim();
    if (trimmed.length === 0) {
      return error('Project name is required', 400);
    }
    if (trimmed.length > NAME_MAX) {
      return error(`Project name must be ${NAME_MAX} characters or fewer`, 400);
    }
    updates.name = trimmed;
  }

  if (body.description !== undefined) {
    if (body.description === null) {
      updates.description = null;
    } else if (typeof body.description !== 'string') {
      return error('description must be a string or null', 400);
    } else {
      const trimmed = body.description.trim();
      if (trimmed.length > DESCRIPTION_MAX) {
        return error(
          `Project description must be ${DESCRIPTION_MAX} characters or fewer`,
          400
        );
      }
      updates.description = trimmed.length > 0 ? trimmed : null;
    }
  }

  // Block 13.8d: slug acceptance + validation on PATCH. Only acted on when
  // body.slug is present (so callers that only update name/description don't
  // need to round-trip the slug). The partial unique index
  // projects_owner_slug_active_idx enforces workspace-uniqueness; UPDATE
  // collisions are caught below and surfaced as slug_taken.
  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string') {
      return error('slug must be a string', 400);
    }
    const trimmed = body.slug.trim();
    const fmt = validateSlugFormat(trimmed);
    if (!fmt.ok) {
      return error('Slug format is invalid', 400, { code: 'slug_invalid_format' });
    }
    if (isReservedSlug(trimmed)) {
      return error('Slug is reserved', 400, { code: 'slug_reserved' });
    }
    updates.slug = trimmed;
  }

  if (Object.keys(updates).length === 0) {
    return error('Nothing to update', 400);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Build the SET clause from the validated `updates` object. Each
    // field is bound via postgres-js tagged-template — no string
    // interpolation, safe from injection. Always bump updated_at.
    const nameSql = updates.name !== undefined
      ? sql`name = ${updates.name},`
      : sql``;
    const descSql = updates.description !== undefined
      ? sql`description = ${updates.description},`
      : sql``;
    const slugSql = updates.slug !== undefined
      ? sql`slug = ${updates.slug},`
      : sql``;

    let project;
    try {
      [project] = await sql`
        UPDATE projects
           SET ${nameSql} ${descSql} ${slugSql} updated_at = NOW()
         WHERE id          = ${params.id}
           AND deleted_at  IS NULL
        RETURNING id, name, description, owner_user_id, slug,
                  created_at, updated_at,
                  ai_monthly_cap_usd::float AS ai_monthly_cap_usd,
                  daily_message_limit
      `;
    } catch (updateErr) {
      // PG 23505 = unique_violation on projects_owner_slug_active_idx.
      if (updateErr && updateErr.code === '23505') {
        return error('Slug already taken in this workspace', 400, { code: 'slug_taken' });
      }
      throw updateErr;
    }

    if (!project) {
      return error('Not found', 404);
    }
    return json({ ok: true, project });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}

// DELETE — soft-delete the project (12.4 settings General tab Danger zone).
export async function onRequestDelete({ request, env, params }) {
  const scopeResult = await requireWorkspaceScope(request, env, params.id);
  if (scopeResult.error) return scopeResult.error;
  const adminResult = await requireWorkspaceAdmin(request, env);
  if (adminResult.error) return adminResult.error;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const result = await sql`
      UPDATE projects
         SET deleted_at = NOW(),
             updated_at = NOW()
       WHERE id          = ${params.id}
         AND deleted_at  IS NULL
      RETURNING id
    `;
    if (result.length === 0) {
      return error('Not found', 404);
    }
    return json({ ok: true });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}
