// functions/api/workspace.js
//
// Block 12.6 — GET /api/workspace
//
// Returns workspace metadata + cross-project AI cap state for the
// workspace-settings page (mockup f). v1.3 workspace model is solo:
// workspace = D1 user (per BLOCK_12_PLAN decision E). When a real
// `workspaces` table lands in v2.0, this endpoint is the natural seam
// to migrate.
//
// Response shape (success):
//   {
//     ok: true,
//     workspace: {
//       id: <user.id as text>,
//       name: <derived from email domain stem>,
//       plan: 'solo',
//       user_count: 1,
//       project_count: <count from Postgres>,
//       created_at: <user.created_at>,
//     },
//     cross_project_ai: {
//       cap_usd: <D1 users.cross_project_ai_monthly_cap_usd>,
//       spend_usd: <SUM cost_usd FROM messages WHERE project_id IS NULL
//                  scoped to this user>,
//       period_start: <D1 users.cross_project_ai_spend_period_start>,
//       resets_at: <first of next month, ISO>,
//     },
//   }

import postgres from 'postgres';
import { error, getSessionUser, json } from '../_lib/auth.js';

// Derive a display name from the email domain stem.
// "jenny@elinnovation.net" → "Elinnovation"
// Fallback: capitalized email local-part.
function deriveWorkspaceName(email) {
  if (!email || typeof email !== 'string') return 'Workspace';
  const at = email.indexOf('@');
  if (at === -1) return 'Workspace';
  const domain = email.slice(at + 1);
  const stem = (domain.split('.')[0] || '').trim();
  if (stem.length === 0) return 'Workspace';
  return stem.charAt(0).toUpperCase() + stem.slice(1).toLowerCase();
}

function firstOfNextMonthIso() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString();
}

function periodStartIsoFromD1(periodStartUnix) {
  // D1 stores cross_project_ai_spend_period_start as INTEGER (unix epoch
  // seconds, per 12.1 migration §12 fallback). Convert to ISO for the
  // SUM query.
  const n = Number(periodStartUnix);
  if (!Number.isFinite(n) || n <= 0) {
    // Default: start of current month
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  }
  return new Date(n * 1000).toISOString();
}

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env.DB);
  if (!user) return error('Not authenticated', 401);
  const userIdText = String(user.id);

  // D1 lookup: cap + period_start.
  const userRow = await env.DB
    .prepare(
      `SELECT cross_project_ai_monthly_cap_usd, cross_project_ai_spend_period_start, created_at
         FROM users WHERE id = ?1`
    )
    .bind(user.id)
    .first();
  const capUsd = Number(userRow?.cross_project_ai_monthly_cap_usd) || 0;
  const periodStartIso = periodStartIsoFromD1(userRow?.cross_project_ai_spend_period_start);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // 2026-05-27 (shared-workspace-visibility): project count is the
    // shared workspace's count, not per-user. Cross-project spend MTD
    // is similarly summed across all users' cross-project conversations
    // so the cap-check matches messages.js post-flight semantics.
    const [projectCountRow] = await sql`
      SELECT COUNT(*)::int AS n
        FROM projects
       WHERE deleted_at    IS NULL
    `;
    const [spendRow] = await sql`
      SELECT COALESCE(SUM(m.cost_usd), 0)::float AS spend_usd
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
       WHERE m.project_id  IS NULL
         AND m.created_at  >= ${periodStartIso}::timestamptz
         AND m.deleted_at  IS NULL
         AND c.deleted_at  IS NULL
    `;

    return json({
      ok: true,
      workspace: {
        id: userIdText,
        name: deriveWorkspaceName(user.email),
        plan: 'solo',
        user_count: 1,
        project_count: Number(projectCountRow?.n) || 0,
        created_at: userRow?.created_at || null,
      },
      cross_project_ai: {
        cap_usd: capUsd,
        spend_usd: Number(spendRow?.spend_usd) || 0,
        period_start: periodStartIso,
        resets_at: firstOfNextMonthIso(),
      },
    });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}
