// functions/cross-project/[combo]/[chat].js
//
// CF Pages route for /cross-project/<combo-slug>/<chat-uuid>. The
// 2-segment form is what sidebar clicks rewrite to so a refresh
// stays on the same chat (and so URLs are shareable).
//
// Same slug→uuid resolution as the sibling [combo].js, but with the
// chat-uuid taken from the URL instead of being auto-picked. We still
// verify the chat exists, belongs to the signed-in user, and matches
// the requested combo — guards against mismatched share links.

import postgres from 'postgres';
import { getWorkspaceUserId } from '../../_lib/workspace.js';
import { validateSlugFormat } from '../../_lib/slug.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env, params }) {
  const combo = params.combo;
  const chat = params.chat;

  if (!combo || !chat || !UUID_RE.test(chat)) {
    return Response.redirect(new URL('/cross-project/', request.url).toString(), 302);
  }
  const slugs = combo.split('+').filter(Boolean);
  if (slugs.length < 2 || !slugs.every(s => validateSlugFormat(s).ok)) {
    return Response.redirect(new URL('/cross-project/', request.url).toString(), 302);
  }

  const userId = await getWorkspaceUserId(request, env);
  if (!userId) {
    const next = new URL(request.url).pathname;
    const login = new URL('/login.html', request.url);
    login.searchParams.set('next', next);
    return Response.redirect(login.toString(), 302);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  let projectIds = null;
  try {
    const rows = await sql`
      SELECT id::text AS id, slug
        FROM projects
       WHERE owner_user_id = ${userId}
         AND slug          = ANY(${slugs})
         AND deleted_at IS NULL
    `;
    if (rows.length !== slugs.length) {
      return Response.redirect(new URL('/cross-project/', request.url).toString(), 302);
    }
    projectIds = rows.map(r => r.id).sort();

    // Verify the chat exists, belongs to this user, and its project_ids
    // exactly matches the combo. uuid[] set-equality via @>/<@ + length
    // (see [combo].js for the same pattern + the postgres-js gotcha note).
    const projectIdsLiteral = '{' + projectIds.join(',') + '}';
    const convs = await sql`
      SELECT id::text AS id
        FROM conversations
       WHERE id         = ${chat}::uuid
         AND user_id    = ${userId}
         AND deleted_at IS NULL
         AND project_ids IS NOT NULL
         AND array_length(project_ids, 1) = ${projectIds.length}
         AND project_ids @> ${projectIdsLiteral}::uuid[]
         AND project_ids <@ ${projectIdsLiteral}::uuid[]
       LIMIT 1
    `;
    if (convs.length === 0) {
      return Response.redirect(
        new URL('/cross-project/' + combo, request.url).toString(),
        302,
      );
    }
  } catch (_err) {
    return Response.redirect(new URL('/cross-project/', request.url).toString(), 302);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }

  return serveChatHtml(request, env, chat, projectIds);
}

async function serveChatHtml(request, env, activeChatId, projectIds) {
  const assetUrl = new URL('/cross-project/chat.html', request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), {
    headers: request.headers,
  }));

  const metaHtml =
    '<meta name="x-active-chat-id" content="' + activeChatId + '">' +
    '<meta name="x-combo-ids" content="' + projectIds.join(',') + '">';

  const transformed = new HTMLRewriter()
    .on('head', {
      element(el) { el.append(metaHtml, { html: true }); },
    })
    .transform(assetResponse);

  const headers = new Headers(transformed.headers);
  headers.set('cache-control', 'private, no-store');
  return new Response(transformed.body, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers,
  });
}
