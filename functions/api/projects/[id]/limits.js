// functions/api/projects/[id]/limits.js
//
// Block 12.4 — per-project cost + message-rate limits editor.
//
// Route:
//   PATCH /api/projects/:id/limits
//     body: { ai_monthly_cap_usd?: number, daily_message_limit?: number }
//
// Workspace-scope + workspace-admin gates. Updates the columns the
// project-settings General tab Limits section writes to:
//   - projects.ai_monthly_cap_usd (DECIMAL, default 50.00) — v1.2
//   - projects.daily_message_limit (INTEGER, default 100)  — v1.3
//     (Block 12.4 migration; replaces hardcoded DAILY_MSG_CAP=100
//     constant in messages.js)
//
// VALIDATION
// - ai_monthly_cap_usd: positive number, ≤ 10,000 (anything higher is
//   suspicious; DECIMAL(10,2) capacity is 10^8 but a $10k/month per-
//   project cap is already enormous).
// - daily_message_limit: positive integer, ≤ 10,000 (1k+ msg/day is
//   already power-user territory; 10k is the soft ceiling).
// - Reject empty bodies (no fields to update).
//
// At least one field must be provided; the rest are preserved.

import postgres from 'postgres';
import {
  error,
  json,
  requireWorkspaceScope,
  requireWorkspaceAdmin,
} from '../../../_lib/auth.js';

const CAP_MIN = 0.01;
const CAP_MAX = 10000;
const MSG_LIMIT_MIN = 1;
const MSG_LIMIT_MAX = 10000;

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

  if (body.ai_monthly_cap_usd !== undefined) {
    const v = Number(body.ai_monthly_cap_usd);
    if (!Number.isFinite(v) || v < CAP_MIN || v > CAP_MAX) {
      return error(
        `ai_monthly_cap_usd must be a number between ${CAP_MIN} and ${CAP_MAX}`,
        400
      );
    }
    // Round to 2 decimals — DECIMAL(10,2) column. Avoids fractional-cent
    // round-trip drift.
    updates.ai_monthly_cap_usd = Math.round(v * 100) / 100;
  }

  if (body.daily_message_limit !== undefined) {
    const v = Number(body.daily_message_limit);
    if (
      !Number.isFinite(v)
      || v < MSG_LIMIT_MIN
      || v > MSG_LIMIT_MAX
      || !Number.isInteger(v)
    ) {
      return error(
        `daily_message_limit must be an integer between ${MSG_LIMIT_MIN} and ${MSG_LIMIT_MAX}`,
        400
      );
    }
    updates.daily_message_limit = v;
  }

  if (Object.keys(updates).length === 0) {
    return error('Nothing to update', 400);
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    const capSql = updates.ai_monthly_cap_usd !== undefined
      ? sql`ai_monthly_cap_usd = ${updates.ai_monthly_cap_usd},`
      : sql``;
    const msgSql = updates.daily_message_limit !== undefined
      ? sql`daily_message_limit = ${updates.daily_message_limit},`
      : sql``;

    const [project] = await sql`
      UPDATE projects
         SET ${capSql} ${msgSql} updated_at = NOW()
       WHERE id          = ${params.id}
         AND deleted_at  IS NULL
      RETURNING id,
                ai_monthly_cap_usd::float AS ai_monthly_cap_usd,
                daily_message_limit,
                updated_at
    `;

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
