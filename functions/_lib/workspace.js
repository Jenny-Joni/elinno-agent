// functions/_lib/workspace.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// The sole sanctioned entry point for the workspace handle in v1.3.
// Every callsite that needs to identify "which workspace is this user
// in" goes through this helper — no inline `getSessionUser().id`
// substitutions anywhere else. When v2.0 introduces real workspaces
// (PRD v1.3 §6 cut #12), this is the one file that changes; everything
// else (auth gates, authorize step, cap-charging, route handlers)
// continues to work without edits.
//
// Per BLOCK_12_PLAN.md decision U.
// =========================================================================

import { getSessionUser } from './auth.js';

/**
 * Resolve the workspace handle for the current session, or null if
 * not authenticated.
 *
 * v1.3 model: workspace_id = session user's id. One user, one
 * workspace. Returned as a string for consistent comparison against
 * Postgres TEXT columns (e.g., projects.owner_user_id is TEXT per
 * the cross-DB seam — D1 users.id is INTEGER, but every Postgres
 * cross-reference uses String(user.id)).
 *
 * v2.0 model (future): this helper resolves a real workspaces.id
 * after looking up the user's active workspace membership. Every
 * existing caller continues to work because the return type
 * (string | null) is preserved.
 *
 * @param {Request} request - Pages Function request (cookies live here)
 * @param {object} env - Pages Function env (env.DB)
 * @returns {Promise<string | null>}
 */
export async function getWorkspaceUserId(request, env) {
  const user = await getSessionUser(request, env.DB);
  if (!user) return null;
  return String(user.id);
}
