// functions/api/projects/[id]/conversations/[conversationId]/index.js
//
// Block 13.5 — v1.4 conversation management.
//
// Routes:
//   PATCH  /api/projects/:projectId/conversations/:conversationId
//          body: { title?: string, restore?: true }
//          — Rename a conversation (set title) and/or restore a soft-
//            deleted one (clear deleted_at). Both fields optional;
//            at least one required.
//   DELETE /api/projects/:projectId/conversations/:conversationId
//          — Soft-delete a conversation (set deleted_at = NOW()).
//            ON-DELETE CASCADE on messages is NOT used here — messages
//            stay attached, just hidden via the conversations.deleted_at
//            filter in the list/read paths. This matches the existing
//            "hybrid soft-delete" pattern (schema-postgres.sql header).
//
// Auth: same shape as the rest of the project routes — workspace-scope
// on the project + per-conversation ownership (c.user_id = session
// user) collapsed into a single SELECT guard (matches messages.js
// pattern at lines 188-197).
//
// v1.4 SPEC §4.4: rename + delete + undo. The "undo toast" UI in the
// sidebar calls PATCH with { restore: true } within the toast window;
// after the toast expires the soft-delete is just a regular soft-
// delete and the row stays out of the list view.

import postgres from 'postgres';
import {
  error,
  json,
  requireWorkspaceScope,
} from '../../../../../_lib/auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(s) { return typeof s === 'string' && UUID_RE.test(s); }

// Title shape: trimmed, 1–120 chars. Mirrors the auto-title length the
// LLM produces, generous enough for free-form user edits.
function isValidTitle(s) {
  return typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= 120;
}

export async function onRequestPatch({ request, env, params }) {
  const { error: errResp, user } = await requireWorkspaceScope(
    request,
    env,
    params.id
  );
  if (errResp) return errResp;

  if (!isValidUuid(params.conversationId)) return error('Invalid conversation id', 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
  const hasRestore = Object.prototype.hasOwnProperty.call(body, 'restore') && body.restore === true;

  if (!hasTitle && !hasRestore) {
    return error('Provide at least one of: title, restore', 400);
  }

  let nextTitle = null;
  if (hasTitle) {
    const t = (body.title || '').trim();
    if (!isValidTitle(t)) return error('Title must be 1–120 characters', 400);
    nextTitle = t;
  }

  const userIdText = String(user.id);
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  try {
    // Conversation guard: must belong to this project AND this user.
    // When restoring, include soft-deleted rows in the guard SELECT
    // (otherwise the row to restore is invisible and we'd 403). When
    // renaming, restrict to live rows — renaming a deleted thread is
    // not a v1.4 use case.
    const guard = hasRestore
      ? sql`
          SELECT id, deleted_at
            FROM conversations
           WHERE id          = ${params.conversationId}
             AND project_id  = ${params.id}
             AND user_id     = ${userIdText}
           LIMIT 1
        `
      : sql`
          SELECT id, deleted_at
            FROM conversations
           WHERE id          = ${params.conversationId}
             AND project_id  = ${params.id}
             AND user_id     = ${userIdText}
             AND deleted_at IS NULL
           LIMIT 1
        `;
    const [conv] = await guard;
    if (!conv) return error('Forbidden', 403);

    // Build SET clauses dynamically (mirrors functions/api/admin/users/[id].js
    // PATCH pattern). Always bump updated_at.
    const sets = [];
    if (nextTitle !== null) sets.push(sql`title = ${nextTitle}`);
    if (hasRestore) sets.push(sql`deleted_at = NULL`);
    sets.push(sql`updated_at = NOW()`);

    // postgres-js `sql.unsafe` + dynamic SET via array spreading is
    // unergonomic; use a join with sql.unsafe-safe tagged segments.
    // The cleanest pattern in this codebase: separate per-field PATCH
    // queries when sets are small. Two fields max → unroll.
    if (nextTitle !== null && hasRestore) {
      await sql`
        UPDATE conversations
           SET title       = ${nextTitle},
               deleted_at  = NULL,
               updated_at  = NOW()
         WHERE id = ${params.conversationId}
      `;
    } else if (nextTitle !== null) {
      await sql`
        UPDATE conversations
           SET title       = ${nextTitle},
               updated_at  = NOW()
         WHERE id = ${params.conversationId}
      `;
    } else {
      // restore only
      await sql`
        UPDATE conversations
           SET deleted_at  = NULL,
               updated_at  = NOW()
         WHERE id = ${params.conversationId}
      `;
    }

    const [updated] = await sql`
      SELECT id, project_id, user_id, title, created_at, updated_at
        FROM conversations
       WHERE id = ${params.conversationId}
       LIMIT 1
    `;
    return json({ ok: true, conversation: updated });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* best-effort */ }
  }
}

export async function onRequestDelete({ request, env, params }) {
  const { error: errResp, user } = await requireWorkspaceScope(
    request,
    env,
    params.id
  );
  if (errResp) return errResp;

  if (!isValidUuid(params.conversationId)) return error('Invalid conversation id', 400);

  const userIdText = String(user.id);
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  try {
    // Guard: must belong to this project + user, and be currently
    // alive. A second DELETE on an already-deleted row is a no-op
    // (returns ok:true) — idempotent from the UI's perspective.
    const [conv] = await sql`
      SELECT id, deleted_at
        FROM conversations
       WHERE id          = ${params.conversationId}
         AND project_id  = ${params.id}
         AND user_id     = ${userIdText}
       LIMIT 1
    `;
    if (!conv) return error('Forbidden', 403);

    if (conv.deleted_at) {
      // Already deleted — treat as idempotent success.
      return json({ ok: true, conversation_id: params.conversationId, deleted_at: conv.deleted_at });
    }

    const [updated] = await sql`
      UPDATE conversations
         SET deleted_at = NOW(),
             updated_at = NOW()
       WHERE id = ${params.conversationId}
       RETURNING id, deleted_at
    `;
    return json({ ok: true, conversation_id: updated.id, deleted_at: updated.deleted_at });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* best-effort */ }
  }
}
