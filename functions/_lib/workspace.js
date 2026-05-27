// functions/_lib/workspace.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Workspace-handle helper. Originally (BLOCK_12_PLAN decision U) this
// was the sole entry point for "which workspace is the current user in",
// where workspace = session user id (one user, one workspace).
//
// 2026-05-27 (shared-workspace-visibility): the workspace boundary is
// now a single shared workspace across all authenticated users. This
// helper still returns String(user.id), but callers must NOT use the
// return value as a filter predicate on `projects.owner_user_id` or
// `conversations.user_id` — those columns are now interpreted as the
// row's CREATOR record, not the visibility scope.
//
// Surviving uses:
//   - `getAdminEmailsForProject` (cost-cap notifications) — looks up the
//     creator's email via projects.owner_user_id.
//   - INSERT trails (e.g., conversations.user_id on POST cross-project)
//     so the creator is recorded.
//
// When v2.0 introduces real workspaces (PRD v1.3 §6 cut #12), this is
// the one file that changes to resolve a real workspaces.id from
// membership.
// =========================================================================

import { getSessionUser } from './auth.js';

/**
 * Resolve the current session user's id (as TEXT, for Postgres
 * comparison) or null if not authenticated.
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
