// functions/api/projects/[id]/connections/[connId]/index.js
// =========================================================================
// Connection lifecycle — DELETE (soft-delete) + PATCH (allowlisted
// credential_metadata writes for connector configuration).
//
// Block 3 commit 4 added DELETE; Block 4 commit 8 adds PATCH per
// BLOCK_4_PLAN.md decision L (channel-picker writes
// selected_channel_id and selected_channel_name to credential_metadata
// before sync). PATCH is NOT a security carve-out — no credential
// touching, no encryption changes; just merges allowlisted non-secret
// JSONB keys into credential_metadata.
//
// Routes:
//   DELETE /api/projects/:id/connections/:connId
//     — admin only; soft-delete (sets deleted_at = NOW()). Schema's
//       UNIQUE NULLS NOT DISTINCT on
//       (project_id, source, external_account_id, deleted_at) lets a
//       future connect with the same external account succeed (the
//       soft-deleted row's deleted_at is non-NULL and doesn't conflict
//       with a new active row).
//   PATCH /api/projects/:id/connections/:connId
//     — admin only; merges allowlisted credential_metadata keys via
//       JSONB || (atomic; preserves keys not in the request body).
//       Allowlist for v1.1: selected_channel_id, selected_channel_name.
//       Future fields added explicitly to ALLOWED_METADATA_KEYS.
//
//   404 on either route collapses three cases — connection doesn't
//   exist, isn't in this project, already deleted — to avoid leaking
//   existence. Consistent with requireProjectRole's 403-collapse
//   discipline.
// =========================================================================

import postgres from 'postgres';
import { error, json, requireProjectRole } from '../../../../../_lib/auth.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// L allowlist: keys that PATCH may merge into credential_metadata.
// Per Block 4 locked sub-decision (a) for commit 8: only channel-
// selection keys for Slack. Block 6 commit 6a adds the Jira-equivalent
// project-selection keys per BLOCK_6_PLAN.md decision D + L (single
// project picker post-connect). Future connectors with other config
// fields require explicit additions here (e.g., a Drive connector
// might add 'selected_root_folder_id'). DO NOT widen casually — keys
// merged here are visible to every project member via the
// CONNECTION_PUBLIC_COLUMNS extension in connections/index.js.
const ALLOWED_METADATA_KEYS = [
  'selected_channel_id',
  'selected_channel_name',
  'selected_project_key',
  'selected_project_name',
];

export async function onRequestDelete({ request, env, params }) {
  const projectId = params.id;
  const connId = params.connId;

  if (typeof connId !== 'string' || !UUID_RE.test(connId)) {
    return error('Invalid connection id', 400);
  }

  const { error: errResp } = await requireProjectRole(
    request,
    env,
    projectId,
    'admin'
  );
  if (errResp) return errResp;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const result = await sql`
      UPDATE connections
         SET deleted_at = NOW(),
             updated_at = NOW()
       WHERE id = ${connId}
         AND project_id = ${projectId}
         AND deleted_at IS NULL
      RETURNING id
    `;

    if (result.length === 0) {
      return error('Not Found', 404);
    }

    return json({ ok: true });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// PATCH — update allowlisted credential_metadata keys (admin only)
// ---------------------------------------------------------------------------

export async function onRequestPatch({ request, env, params }) {
  const projectId = params.id;
  const connId = params.connId;

  if (typeof connId !== 'string' || !UUID_RE.test(connId)) {
    return error('Invalid connection id', 400);
  }

  const { error: errResp } = await requireProjectRole(
    request,
    env,
    projectId,
    'admin'
  );
  if (errResp) return errResp;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !body.credential_metadata ||
    typeof body.credential_metadata !== 'object'
  ) {
    return error('credential_metadata is required', 400);
  }

  // Validate every key in the request against the allowlist; reject the
  // entire request on any unknown key (loud, per Block 2 decision N's
  // verbatim-error pattern). Type-check each value as string|null.
  /** @type {Record<string, string|null>} */
  const partial = {};
  for (const key of Object.keys(body.credential_metadata)) {
    if (!ALLOWED_METADATA_KEYS.includes(key)) {
      return error(
        `credential_metadata key '${key}' is not allowed`,
        400
      );
    }
    const value = body.credential_metadata[key];
    if (value !== null && typeof value !== 'string') {
      return error(
        `credential_metadata.${key} must be a string or null`,
        400
      );
    }
    if (typeof value === 'string' && value.length > 1024) {
      return error(
        `credential_metadata.${key} must be 1024 characters or fewer`,
        400
      );
    }
    partial[key] = value;
  }

  if (Object.keys(partial).length === 0) {
    return error('No allowed credential_metadata keys provided', 400);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Atomic JSONB merge via the `||` operator. Right-hand value
    // overrides matching keys on the left; non-matching left keys are
    // preserved. Avoids the read-modify-write TOCTOU race that would
    // surface under concurrent PATCH requests.
    const [row] = await sql`
      UPDATE connections
         SET credential_metadata = credential_metadata || ${partial}::jsonb,
             updated_at          = NOW()
       WHERE id          = ${connId}
         AND project_id  = ${projectId}
         AND deleted_at IS NULL
      RETURNING id, project_id, source, display_name, external_account_id,
                status, status_reason, last_sync_at, created_at, updated_at,
                credential_metadata->>'selected_channel_id'   AS selected_channel_id,
                credential_metadata->>'selected_channel_name' AS selected_channel_name
    `;

    if (!row) {
      // 404-collapse: connection doesn't exist / wrong project / soft-
      // deleted. Same shape as DELETE's 404.
      return error('Not Found', 404);
    }

    return json({ ok: true, connection: row });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
