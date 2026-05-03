// functions/api/projects/[id]/conversations/[conversationId]/messages.js
//
// Block 2 Sub-task 2.4 — messages API.
//
// Routes (this file):
//   GET  /api/projects/:projectId/conversations/:conversationId/messages
//        → fetch all messages in the conversation, ordered created_at ASC.
//          Member-level access on the PROJECT, plus per-user scoping
//          (decision AC) on the conversation. Verifies conversation
//          belongs to the project AND to the session user before reading.
//
//   POST /api/projects/:projectId/conversations/:conversationId/messages
//        → send a message. Single round-trip per decision I:
//            1. validate content
//            2. verify conversation belongs to project + session user
//            3. insert messages row (role='user')
//            4. if first user message in conversation, update
//               conversations.title from truncated content (decision H)
//            5. generate echo (decision I exact format)
//            6. insert second messages row (role='assistant')
//            7. update conversations.updated_at
//            8. return user_message + assistant_message + the
//               (possibly updated) conversation title (decision X)
//
// Two security guards apply on every request:
//   - requireProjectRole: 403-collapse on cross-project leakage
//     (handled one layer up by the helper)
//   - conversation-belongs-to-project AND conversation-belongs-to-user:
//     in-handler check via the SELECT at the top of each method;
//     403 on either failure (matches requireProjectRole's pattern of
//     collapsing all access-denied paths to 403, per PRD §10).
//
// SCHEMA NOTE — `messages.project_id` is denormalized:
//   The `messages` table has a NOT NULL `project_id` uuid column with no
//   default. It's redundant with `conversations.project_id` (every message
//   belongs to a conversation, every conversation belongs to a project),
//   but the schema (db/schema-postgres.sql, Block 1 Task 3) denormalizes
//   it onto `messages` so future query patterns — Block 5+ analytics over
//   "messages in this project," cross-conversation searches scoped to a
//   project, vector queries that join messages → entity_embeddings without
//   needing a 3-way join through conversations — can hit one index on
//   messages alone.
//
//   Both INSERTs below MUST populate project_id from `params.id`. Removing
//   it (e.g. as part of a "simplification" that just inserts the obvious
//   conversation-id-and-content tuple) reproduces the Block 2 Session 3
//   500-on-every-send bug. The Decision-H/I/X happy paths (matrix scenarios
//   2, 3, 4 of the trimmed verification) all break without it.

import postgres from 'postgres';
import { error, json, requireProjectRole } from '../../../../../_lib/auth.js';

// Decision H: first ~50 chars, truncate at word boundary, append "…" if truncated.
function deriveTitleFromMessage(content) {
  const trimmed = content.trim();
  if (trimmed.length <= 50) return trimmed;
  const window = trimmed.slice(0, 50);
  const lastSpace = window.lastIndexOf(' ');
  // If no space in the first 50 chars, hard-cut at 50.
  // If a space exists, cut at the last word boundary inside the window.
  const cutPoint = lastSpace > 0 ? lastSpace : 50;
  return trimmed.slice(0, cutPoint) + '…';
}

// Decision I exact format. Block 5 will replace with real generation;
// schema and API contract stay identical.
function generateEcho(userContent) {
  return `You said: "${userContent}" — Real AI coming in Block 5.`;
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
    // Conversation guard: must belong to this project AND this user.
    // Single SELECT collapses both checks; either failure → 403.
    const [conv] = await sql`
      SELECT id
      FROM conversations
      WHERE id          = ${params.conversationId}
        AND project_id  = ${params.id}
        AND user_id     = ${userIdText}
        AND deleted_at IS NULL
      LIMIT 1
    `;
    if (!conv) return error('Forbidden', 403);

    // Decision: messages ordered created_at ASC (oldest first; chat scroll
    // top-down). Soft-deleted filtered out, matching the LEFT JOIN's
    // m.deleted_at IS NULL filter from the conversations list endpoint.
    const messages = await sql`
      SELECT id, conversation_id, role, content, created_at
      FROM messages
      WHERE conversation_id = ${params.conversationId}
        AND deleted_at IS NULL
      ORDER BY created_at ASC, id ASC
    `;

    return json({ ok: true, messages });
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

export async function onRequestPost({ request, env, params }) {
  const { error: errResp, user } = await requireProjectRole(
    request,
    env,
    params.id,
    'member'
  );
  if (errResp) return errResp;

  const userIdText = String(user.id);

  // Validate body shape early (decision N: validation strings render verbatim).
  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const rawContent = typeof body?.content === 'string' ? body.content : '';
  const content = rawContent.trim();
  if (content.length === 0) {
    return error('Message content is required', 400);
  }
  // Soft cap to keep accidental payload bombs out (no PRD-mandated length yet;
  // tighter limits come with the real AI in Block 5).
  if (content.length > 10000) {
    return error('Message must be 10000 characters or fewer', 400);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // Conversation guard (same as GET): belongs to this project AND user.
    // Includes current title so we can decide whether to auto-title.
    const [conv] = await sql`
      SELECT id, title
      FROM conversations
      WHERE id          = ${params.conversationId}
        AND project_id  = ${params.id}
        AND user_id     = ${userIdText}
        AND deleted_at IS NULL
      LIMIT 1
    `;
    if (!conv) return error('Forbidden', 403);

    // Decision H trigger: auto-title fires only on the first USER message.
    // Implementation: count existing user-role messages in this conversation
    // BEFORE we insert the new one. Zero existing → this is the first → set title.
    // The default title 'New conversation' set by the conversations POST
    // handler is what gets replaced.
    const [{ count: existingUserCount }] = await sql`
      SELECT COUNT(*)::int AS count
      FROM messages
      WHERE conversation_id = ${params.conversationId}
        AND role            = 'user'
        AND deleted_at IS NULL
    `;
    const isFirstUserMessage = existingUserCount === 0;
    const newTitle = isFirstUserMessage ? deriveTitleFromMessage(content) : conv.title;

    // Insert user message. project_id required (see SCHEMA NOTE in header).
    const [userMessage] = await sql`
      INSERT INTO messages (project_id, conversation_id, role, content)
      VALUES (${params.id}, ${params.conversationId}, 'user', ${content})
      RETURNING id, conversation_id, role, content, created_at
    `;

    // Generate echo placeholder (decision I).
    const echo = generateEcho(content);

    // Insert assistant message. project_id required (see SCHEMA NOTE in header).
    const [assistantMessage] = await sql`
      INSERT INTO messages (project_id, conversation_id, role, content)
      VALUES (${params.id}, ${params.conversationId}, 'assistant', ${echo})
      RETURNING id, conversation_id, role, content, created_at
    `;

    // Update conversation: title (if this was the first user message) AND
    // updated_at (always). One UPDATE for both; updated_at = NOW() ensures
    // the sidebar's updated_at-DESC sort surfaces the active conversation
    // to the top after every send.
    await sql`
      UPDATE conversations
      SET title       = ${newTitle},
          updated_at  = NOW()
      WHERE id = ${params.conversationId}
    `;

    // Decision X: response always includes the (possibly updated) title.
    // Client renders directly from this — sidebar row + chat-conv-title
    // heading both update without a refetch.
    return json({
      ok: true,
      user_message: userMessage,
      assistant_message: assistantMessage,
      conversation: {
        id: conv.id,
        title: newTitle,
      },
    });
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
