// functions/api/projects/[id]/conversations/index.js
//
// Block 2 Sub-task 2.4 — conversations API.
//
// Routes (this file):
//   POST /api/projects/:projectId/conversations
//        → create a conversation in this project, owned by the session
//          user (member-level access). Returns the row + message_count:0
//          (decision AB: same shape as GET).
//   GET  /api/projects/:projectId/conversations
//        → list THIS USER's conversations in this project, with
//          message_count via LEFT JOIN messages (decision AB). Ordered
//          by updated_at DESC, id DESC.
//
// Per PRD §3 and the db/schema-postgres.sql comment on `conversations`,
// conversations are PRIVATE to their owner (decision AC) — other project
// members do not see each other's conversations. The schema enforces this
// with `user_id TEXT NOT NULL` plus a hot-path index on
// (user_id, project_id, last_message_at) WHERE deleted_at IS NULL.
// Both endpoints scope to the session user's id; member-level access
// on the PROJECT is the gate on existence (cross-project leakage is
// prevented one layer up by requireProjectRole's 403-collapse).
//
// Cross-DB seam: D1 users.id (INTEGER) → Postgres TEXT.
// Pattern documented canonically in db/schema-postgres.sql header.

import postgres from 'postgres';
import { error, json, requireProjectRole } from '../../../../_lib/auth.js';

export async function onRequestPost({ request, env, params }) {
  const { error: errResp, user } = await requireProjectRole(
    request,
    env,
    params.id,
    'member'
  );
  if (errResp) return errResp;

  const userIdText = String(user.id);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Decision G: every brand-new conversation gets a default title.
    // Decision H's auto-title replaces this on the user's first message
    // (handled in the messages POST handler — Diff #2).
    const [conversation] = await sql`
      INSERT INTO conversations (project_id, user_id, title)
      VALUES (${params.id}, ${userIdText}, 'New conversation')
      RETURNING id, project_id, user_id, title, created_at, updated_at
    `;

    return json(
      { ok: true, conversation: { ...conversation, message_count: 0 } },
      { status: 201 }
    );
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

export async function onRequestGet({ request, env, params }) {
  const { error: errResp, user } = await requireProjectRole(
    request,
    env,
    params.id,
    'member'
  );
  if (errResp) return errResp;

  const userIdText = String(user.id);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Decision AB: each row carries message_count via LEFT JOIN messages.
    //
    // CORRECTNESS: `m.deleted_at IS NULL` MUST live in the JOIN ON
    // clause, not in WHERE. If it lived in WHERE, a conversation whose
    // messages are all soft-deleted would have only deleted-message
    // rows after the LEFT JOIN, the WHERE would reject them, and the
    // conversation would vanish from the sidebar entirely instead of
    // appearing as message_count: 0. JOIN-side filtering preserves
    // LEFT JOIN semantics: the conversation row is kept regardless,
    // and only non-deleted messages contribute to COUNT.
    //
    // CAST: Postgres COUNT(*) is bigint; the `postgres` driver
    // serializes bigint as a string by default. ::int keeps the JSON
    // shape numeric for the UI's "N message(s)" rendering.
    //
    // ORDER: tie-break on c.id matches the precedent from
    // functions/api/projects/index.js — protects sidebar stability
    // when two conversations share an updated_at (e.g., both
    // freshly-created in the same millisecond).
    const conversations = await sql`
      SELECT
        c.id,
        c.project_id,
        c.user_id,
        c.title,
        c.created_at,
        c.updated_at,
        COUNT(m.id)::int AS message_count
      FROM conversations c
      LEFT JOIN messages m
        ON m.conversation_id = c.id
       AND m.deleted_at IS NULL
      WHERE c.project_id = ${params.id}
        AND c.user_id    = ${userIdText}
        AND c.deleted_at IS NULL
      GROUP BY c.id
      ORDER BY c.updated_at DESC, c.id DESC
    `;

    return json({ ok: true, conversations });
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
