// functions/_lib/workspace.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Workspace-handle helper. Originally (BLOCK_12_PLAN decision U) this
// was the sole entry point for "which workspace is the current user in",
// where workspace = session user id (one user, one workspace).
//
// 2026-05-27 (shared-workspace-visibility): PROJECT visibility is now a
// single shared workspace across all authenticated users. Callers must
// NOT use this helper's return value as a filter on
// `projects.owner_user_id` — that column is now interpreted as the
// project's CREATOR record, not the visibility scope.
//
// CONVERSATIONS remain per-user. `conversations.user_id` is still the
// row's owner AND visibility scope — each user has their own
// per-project and cross-project chat history. The helper is the
// canonical source of the "current user" id used for those filters.
//
// Surviving uses:
//   - `getAdminEmailsForProject` (cost-cap notifications) — looks up
//     the creator's email via projects.owner_user_id.
//   - INSERT trails (e.g., conversations.user_id on POST cross-project)
//     so the creator is recorded.
//   - Per-user filters on `conversations.user_id` (cross-project chat
//     list, dashboard chats list, route resolvers for combo + chat).
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
