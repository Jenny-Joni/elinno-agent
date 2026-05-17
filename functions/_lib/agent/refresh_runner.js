// functions/_lib/agent/refresh_runner.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Shared orchestrator for the "refresh and ask again" member action
// per BLOCK_10_PLAN.md decisions A + B + C + D (Block 10.1). Extracted
// from the endpoint so a future v1.2 cron-driven auto-refresh path can
// reuse the same flow.
//
// Inputs:
//   - env, sql                 — Pages env + open postgres client
//   - projectId, userId        — URL-derived, never trusted from LLM
//   - sourceMessage            — the assistant message being refreshed
//                                ({ id, citations, created_at, ... } row)
//   - request                  — original Pages Function request, threaded
//                                into the connector ctx
//
// Output: { ok, assistant_message?, refresh_action_id, triggered_sync_run_ids,
//           connection_summary: { ran, succeeded, failed }, error? }
//
// Flow (decisions A + B + C + D + 9.4 decision U for per-connection isolation):
//   1. Derive distinct cited connection_ids via project-scoped JOIN
//      through entities → connections.
//   2. INSERT refresh_actions row, status='running'.
//   3. Per cited connection: insert sync_runs row 'running', call
//      connector.incrementalSync(ctx, connection) inside try/catch,
//      UPDATE the sync_runs row to succeeded/failed, bump
//      connections.last_sync_at on non-inert success. Mirrors the
//      cron-incremental.js shape (functions/api/cron/incremental-sync.js
//      lines 121-205).
//   4. Recover the original user message — the most recent role='user'
//      row in this conversation with created_at < sourceMessage.created_at.
//   5. Reconstruct priorMessages from conversation history up to and
//      including that user message (role IN ('user','assistant'),
//      content NOT NULL).
//   6. Call runAgent — produces a fresh assistant turn against the
//      just-refreshed data.
//   7. Persist db_turns via the same INSERT shape as messages.js POST
//      (functions/api/projects/[id]/conversations/[conversationId]/messages.js:428-444).
//   8. UPDATE refresh_actions to succeeded/failed with new_message_id +
//      triggered_sync_run_ids.
// =========================================================================

import { runAgent } from '../ai/loop.js';
import { getConnector, isKnownSource } from '../connectors/registry.js';

/**
 * @typedef {Object} RefreshRunnerInput
 * @property {object} env
 * @property {object} sql
 * @property {Request} request
 * @property {string} projectId
 * @property {string} userId
 * @property {object} sourceMessage  - { id, conversation_id, created_at, citations }
 * @property {string} projectName    - for runAgent's system prompt {{PROJECT_NAME}}
 */

/**
 * @param {RefreshRunnerInput} args
 * @returns {Promise<{
 *   ok: boolean,
 *   assistant_message?: object,
 *   refresh_action_id: string,
 *   triggered_sync_run_ids: string[],
 *   connection_summary: { ran: number, succeeded: number, failed: number },
 *   error?: string
 * }>}
 */
export async function runRefreshAction({ env, sql, request, projectId, userId, sourceMessage, projectName }) {
  const conversationId = sourceMessage.conversation_id;
  const citations = Array.isArray(sourceMessage.citations) ? sourceMessage.citations : [];

  // Step 1: derive distinct cited connection_ids. Project-scoped JOIN —
  // an entity from another project (which shouldn't happen, but defense
  // in depth) is filtered out by the e.project_id = projectId clamp.
  // Same pattern as Block 9.2's citation enrichment JOIN at
  // messages.js GET lines 199-204.
  const entityIds = [...new Set(
    citations.filter((c) => c && c.entity_id).map((c) => c.entity_id)
  )];
  /** @type {Array<object>} */
  let citedConnections = [];
  if (entityIds.length > 0) {
    citedConnections = await sql`
      SELECT DISTINCT
             c.id, c.project_id, c.source, c.display_name, c.external_account_id,
             c.wrapped_data_key, c.iv, c.ciphertext_credentials,
             c.encryption_algorithm, c.credential_metadata,
             c.status, c.status_reason, c.last_sync_at, c.last_sync_cursor,
             c.next_sync_at, c.created_at, c.updated_at, c.deleted_at,
             c.selected_channel_id, c.selected_channel_name,
             c.selected_project_key, c.selected_project_name
        FROM entities e
        JOIN connections c ON c.id = e.connection_id
       WHERE e.id IN ${sql(entityIds)}
         AND e.project_id = ${projectId}
         AND c.deleted_at IS NULL
         AND c.status = 'active'
    `;
  }

  // Step 2: refresh_actions row in 'running' state.
  const [refreshActionRow] = await sql`
    INSERT INTO refresh_actions (
      project_id, user_id, conversation_id, source_message_id, status
    ) VALUES (
      ${projectId}, ${userId}, ${conversationId}, ${sourceMessage.id}, 'running'
    )
    RETURNING id
  `;
  const refreshActionId = refreshActionRow.id;

  // Step 3: per-connection incrementalSync with failure isolation.
  // Pattern mirrors cron-incremental.js: insert sync_runs 'running',
  // try/catch around the sync call, UPDATE on either branch, bump
  // connections.last_sync_at only on non-inert success.
  const triggeredSyncRunIds = [];
  let succeededConnections = 0;
  let failedConnections = 0;
  for (const connection of citedConnections) {
    if (!isKnownSource(connection.source)) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'refresh_unknown_source',
        refresh_action_id: refreshActionId,
        connection_id: connection.id,
        source: connection.source,
      }));
      continue;
    }
    const connector = getConnector(connection.source);

    const [syncRun] = await sql`
      INSERT INTO sync_runs (
        connection_id, project_id, status, sync_mode
      ) VALUES (
        ${connection.id}, ${connection.project_id}, 'running', 'incremental'
      )
      RETURNING id
    `;
    triggeredSyncRunIds.push(syncRun.id);

    const ctx = {
      env,
      request,
      sql,
      projectId: connection.project_id,
      connectionId: connection.id,
    };

    let result = null;
    try {
      result = await connector.incrementalSync(ctx, connection);
    } catch (syncErr) {
      const msg = String(syncErr && syncErr.message ? syncErr.message : syncErr);
      await sql`
        UPDATE sync_runs
           SET status      = 'failed',
               finished_at = NOW(),
               error       = ${msg}
         WHERE id = ${syncRun.id}
      `;
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'refresh_connection_sync_failed',
        refresh_action_id: refreshActionId,
        connection_id: connection.id,
        source: connection.source,
        error: msg.slice(0, 200),
      }));
      failedConnections++;
      continue;
    }

    if (!result) {
      await sql`
        UPDATE sync_runs
           SET status      = 'failed',
               finished_at = NOW(),
               error       = ${'incrementalSync returned undefined'}
         WHERE id = ${syncRun.id}
      `;
      failedConnections++;
      continue;
    }

    await sql`
      UPDATE sync_runs
         SET status           = 'succeeded',
             finished_at      = NOW(),
             records_inserted = ${result.records_inserted || 0},
             records_updated  = ${result.records_updated || 0},
             records_skipped  = ${result.records_skipped || 0},
             cursor_after     = ${result.cursor_after || null},
             detail           = ${result.detail || null}
       WHERE id = ${syncRun.id}
    `;

    if (!result.detail?.inert) {
      await sql`
        UPDATE connections
           SET last_sync_at     = NOW(),
               last_sync_cursor = ${result.cursor_after || null},
               updated_at       = NOW()
         WHERE id = ${connection.id}
      `;
    }
    succeededConnections++;
  }

  const connectionSummary = {
    ran: citedConnections.length,
    succeeded: succeededConnections,
    failed: failedConnections,
  };

  // Step 4: recover the original user message. The "user message that
  // prompted this assistant response" is the most recent role='user'
  // row in this conversation with created_at < sourceMessage.created_at.
  // iteration=0 on user messages per messages.js POST line 297-301
  // convention.
  const [originalUserMessage] = await sql`
    SELECT id, content, created_at
      FROM messages
     WHERE conversation_id = ${conversationId}
       AND role = 'user'
       AND deleted_at IS NULL
       AND created_at < ${sourceMessage.created_at}
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `;
  if (!originalUserMessage) {
    const errMsg = 'Could not find original user message to refresh.';
    await sql`
      UPDATE refresh_actions
         SET status      = 'failed',
             finished_at = NOW(),
             error       = ${errMsg},
             triggered_sync_run_ids = ${triggeredSyncRunIds}
       WHERE id = ${refreshActionId}
    `;
    return {
      ok: false,
      refresh_action_id: refreshActionId,
      triggered_sync_run_ids: triggeredSyncRunIds,
      connection_summary: connectionSummary,
      error: errMsg,
    };
  }

  // Step 5: reconstruct priorMessages from conversation history up to
  // AND INCLUDING the original user message. content_text-only turns
  // (role IN user/assistant); tool turns excluded (same convention as
  // messages.js POST priorMessages construction, line 308-316).
  const priorRows = await sql`
    SELECT role, content
      FROM messages
     WHERE conversation_id = ${conversationId}
       AND deleted_at IS NULL
       AND role IN ('user','assistant')
       AND content IS NOT NULL
       AND created_at <= ${originalUserMessage.created_at}
     ORDER BY created_at ASC, id ASC
  `;
  const priorMessages = priorRows.map((r) => ({ role: r.role, content: r.content }));

  const urlContext = {
    projectId,
    projectName,
    conversationId,
    userMessage: originalUserMessage.content,
  };

  // Step 6: re-run the agent loop. Same try/catch fallback shape as
  // messages.js POST line 330-422 — a loop failure stores a canned
  // assistant turn with model=null so the UI renders the failure state.
  let agentResult;
  try {
    agentResult = await runAgent(env, sql, urlContext, priorMessages);
  } catch (err) {
    const errMsg = err && err.message ? String(err.message).slice(0, 200) : 'unknown';
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'refresh_agent_loop_failed',
      refresh_action_id: refreshActionId,
      conversation_id: conversationId,
      error: errMsg,
    }));
    const failureText = "I hit a temporary issue answering your question. Please try again in a moment.";
    agentResult = {
      text: failureText,
      citations: [],
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      iterations: 0,
      db_turns: [{
        role: 'assistant',
        content: failureText,
        tool_calls: null,
        tool_result: null,
        citations: null,
        model: null,
        input_tokens: 0,
        output_tokens: 0,
        iteration: 1,
      }],
    };
  }

  // Step 7: persist db_turns. Same INSERT shape as messages.js POST
  // line 428-444. Keep the RETURNING'd assistant message for the
  // response payload.
  let assistantMessage = null;
  for (const turn of agentResult.db_turns) {
    const [row] = await sql`
      INSERT INTO messages (
        project_id, conversation_id, role, content,
        tool_calls, tool_result, citations,
        input_tokens, output_tokens, model, iteration
      ) VALUES (
        ${projectId}, ${conversationId}, ${turn.role}, ${turn.content},
        ${turn.tool_calls}, ${turn.tool_result}, ${turn.citations},
        ${turn.input_tokens}, ${turn.output_tokens}, ${turn.model}, ${turn.iteration}
      )
      RETURNING id, conversation_id, role, content, created_at,
                citations, model, input_tokens, output_tokens, iteration
    `;
    if (turn.role === 'assistant' && turn.content) {
      assistantMessage = row;
    }
  }

  // Bump the conversation's updated_at so the sidebar's recency sort
  // surfaces the refreshed conversation. Title is not changed (only
  // the first send sets the title per decision H).
  await sql`
    UPDATE conversations
       SET updated_at = NOW()
     WHERE id = ${conversationId}
  `;

  // Step 8: close out the refresh_actions row.
  await sql`
    UPDATE refresh_actions
       SET status      = 'succeeded',
           finished_at = NOW(),
           new_message_id = ${assistantMessage ? assistantMessage.id : null},
           triggered_sync_run_ids = ${triggeredSyncRunIds}
     WHERE id = ${refreshActionId}
  `;

  return {
    ok: true,
    assistant_message: assistantMessage,
    refresh_action_id: refreshActionId,
    triggered_sync_run_ids: triggeredSyncRunIds,
    connection_summary: connectionSummary,
  };
}
