// functions/api/workspace/limits.js
//
// Block 12.6 — PATCH /api/workspace/limits
//
// Workspace cross-project AI cap editor. Workspace-admin gated.
// Updates D1 users.cross_project_ai_monthly_cap_usd. v1.3 solo
// workspace model: cap is per-user (workspace = user). v2.0 will
// move this to a workspaces row.
//
// Body:
//   { cross_project_ai_monthly_cap_usd: number }
//
// Validation:
//   cross_project_ai_monthly_cap_usd: positive number, ≤ 10,000.
//   Lower bound 0.01 (same as per-project cap).

import { error, json, requireWorkspaceAdmin } from '../../_lib/auth.js';

const CAP_MIN = 0.01;
const CAP_MAX = 10000;

export async function onRequestPatch({ request, env }) {
  const adminResult = await requireWorkspaceAdmin(request, env);
  if (adminResult.error) return adminResult.error;
  const user = adminResult.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }
  if (!body || typeof body !== 'object') {
    return error('Body must be a JSON object', 400);
  }

  if (body.cross_project_ai_monthly_cap_usd === undefined) {
    return error(
      'Nothing to update — cross_project_ai_monthly_cap_usd is required',
      400
    );
  }
  const v = Number(body.cross_project_ai_monthly_cap_usd);
  if (!Number.isFinite(v) || v < CAP_MIN || v > CAP_MAX) {
    return error(
      `cross_project_ai_monthly_cap_usd must be a number between ${CAP_MIN} and ${CAP_MAX}`,
      400
    );
  }
  const capUsd = Math.round(v * 100) / 100;

  await env.DB
    .prepare(
      `UPDATE users
          SET cross_project_ai_monthly_cap_usd = ?1
        WHERE id = ?2`
    )
    .bind(capUsd, user.id)
    .run();

  return json({
    ok: true,
    workspace: {
      id: String(user.id),
      cross_project_ai_monthly_cap_usd: capUsd,
    },
  });
}
