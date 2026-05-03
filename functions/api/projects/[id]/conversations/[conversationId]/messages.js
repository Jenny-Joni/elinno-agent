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
//               (and capture current title for decision H)
//            3. if conversation title is still the default 'New conversation',
//               derive new title from content (decision H — see DECISION H
//               IMPLEMENTATION NOTE below)
//            4. insert messages row (role='user')
//            5. generate echo (decision I exact format)
//            6. insert second messages row (role='assistant')
//            7. update conversations.title + updated_at
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
//
// DECISION H IMPLEMENTATION NOTE — title-state trigger, not message-count:
//   Decision H says auto-title fires "from first user message." The natural
//   reading is "count existing user messages, fire if zero." We tried that
//   first; it failed in production verification because Hyperdrive's query
//   result cache returns stale COUNT data. Replaced with a title-state check
//   (if title equals the default literal 'New conversation', this is the
//   first user-message-driven title-set; replace it). Sidesteps the COUNT
//   round-trip entirely.
//
//   Trade-off vs the count-based reading: in v1.1 the only thing that
//   mutates `conversations.title` is this auto-title logic, so "title is
//   default" and "no user messages yet" are equivalent. If a future Block
//   adds user-renameable conversations (Block 9 polish bucket), the
//   semantics shift slightly: a user who renames a conversation back to
//   the literal string 'New conversation' would re-trigger auto-title on
//   their next send. That's a stretch case the PRD doesn't address; Block 9
//   to revisit if it surfaces.
//
// HYPERDRIVE CACHING NOTE — disabled at the binding level for v1.1:
//   Hyperdrive's default-on query cache (60s TTL) plus unreliable
//   write-invalidation produced silent staleness on read-after-write —
//   the conv-guard SELECT below would return the pre-UPDATE `title`
//   on the second send, re-firing decision H's auto-title.
//
//   Resolved 2026-05-03 by disabling caching on the elinno-agent-
//   hyperdrive binding:
//     npx wrangler hyperdrive update 78af00bbf464468cb902e35099aa0dfe \
//                                    --caching-disabled true
//   Cost: ~10–50ms per query (every read round-trips to Neon Frankfurt).
//   Acceptable for v1.1 chat scale.
//
//   We initially tried a comment-form bypass marker
//   (`-- bypass Hyperdrive cache: NOW()`) on the affected SELECTs.
//   It didn't work — Hyperdrive's STABLE-function pattern detector
//   appears not to match function references inside SQL comments,
//   despite the docs reading as if it should. If a future block
//   re-enables caching for hot-path latency, use a *real* `NOW()`
//   reference inside the WHERE clause (e.g. `AND NOW() IS NOT NULL`)
//   on every read-after-write SELECT, not a commented marker.
//
//   Revisit before Block 5 when AI tool calls multiply read-after-
//   write volume.

import postgres from 'postgres';
import { error, json, requireProjectRole } from '../../../../../_lib/auth.js';

// Decision G: literal default title set by the conversations POST handler
// at conversation creation. Decision H replaces this on the first user
// message — see DECISION H IMPLEMENTATION NOTE in the file header.
const DEFAULT_CONVERSATION_TITLE = 'New conversation';

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
    // Includes current title — we use it for decision H's auto-title trigger
    // (see DECISION H IMPLEMENTATION NOTE in file header).
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

    // Decision H: auto-title fires once, when the title is still the default.
    // No COUNT(*) round-trip — see DECISION H IMPLEMENTATION NOTE in header.
    const isFirstTitleSet = conv.title === DEFAULT_CONVERSATION_TITLE;
    const newTitle = isFirstTitleSet ? deriveTitleFromMessage(content) : conv.title;

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
