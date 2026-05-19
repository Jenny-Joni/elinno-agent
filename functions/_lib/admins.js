// functions/_lib/admins.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Cross-DB admin-email lookup helper for cost-cap notifications. The
// seam crosses Postgres (Hyperdrive) to D1: project ownership lives in
// Postgres (`projects.owner_user_id`), but user identity (email) lives
// in Cloudflare D1 (users).
//
// v1.3 (Block 12.1, BLOCK_12_PLAN.md decision I): membership collapsed.
// The previous v1.2 lookup walked `project_members WHERE role = 'admin'`;
// in v1.3 the project's `owner_user_id` IS the workspace handle and the
// workspace admin to notify. The function signature is unchanged so
// existing callers (cost-cap warning paths in messages.js) continue to
// work; only the SQL shape moves.
//
// Per BLOCK_10_PLAN.md uncertainty #3: D1 lookups have non-zero latency;
// this helper is intentionally called only at cap-warning / cap-paused
// boundaries (idempotent via projects.ai_cap_warned_at), NOT on every
// message POST. The pre-check pre-pays exactly one owner-lookup per
// project per month per threshold crossing.
// =========================================================================

/**
 * Return the email addresses of the workspace admin(s) to notify for
 * a given project. v1.3: this is the project's owner (1 row in the
 * solo-workspace model). Return type stays array-of-strings so the
 * callers don't need to change shape; v2.0 multi-admin workspaces
 * may return multiple emails.
 *
 * Walk:
 *   1. Postgres: SELECT owner_user_id FROM projects WHERE id = $1
 *                  AND deleted_at IS NULL
 *   2. D1:       SELECT email FROM users WHERE id = ?
 *
 * Returns an array (possibly empty). Empty array means either the
 * project doesn't exist / is soft-deleted, OR the D1 lookup failed;
 * the caller should treat empty as "no one to notify."
 *
 * @param {object} env  - Pages env: env.DB (D1)
 * @param {object} sql  - postgres tagged-template client
 * @param {string} projectId
 * @returns {Promise<string[]>}
 */
export async function getAdminEmailsForProject(env, sql, projectId) {
  // Step 1: who owns this project? (v1.3: workspace handle.)
  const ownerRows = await sql`
    SELECT owner_user_id
      FROM projects
     WHERE id = ${projectId}
       AND deleted_at IS NULL
     LIMIT 1
  `;
  if (ownerRows.length === 0) return [];

  const ownerUserId = ownerRows[0].owner_user_id;

  // Step 2: D1 lookup. owner_user_id is stored as TEXT (cross-DB seam);
  // D1 users.id is INTEGER. SQLite's type-affinity coerces the bind
  // value, but parsing explicitly here keeps the intent unambiguous.
  const ownerIdInt = parseInt(ownerUserId, 10);
  if (!Number.isFinite(ownerIdInt)) return [];

  const result = await env.DB
    .prepare(`SELECT email FROM users WHERE id = ?1`)
    .bind(ownerIdInt)
    .first();

  if (!result || typeof result.email !== 'string' || result.email.length === 0) {
    return [];
  }
  return [result.email];
}
