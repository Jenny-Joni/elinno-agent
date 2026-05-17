// functions/_lib/admins.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Cross-DB admin-email lookup helper introduced for Block 10.2's
// cost-cap admin notifications. The seam crosses Postgres (Hyperdrive)
// to D1: project membership (incl. role) lives in Postgres
// (project_members), but user identity (email) lives in Cloudflare D1
// (users). This is the first call site that walks the seam — single
// helper keeps the join shape in one place.
//
// Per BLOCK_10_PLAN.md uncertainty #3: D1 lookups have non-zero
// latency; this helper is intentionally called only at cap-warning /
// cap-paused boundaries (idempotent via projects.ai_cap_warned_at),
// NOT on every message POST. The pre-check pre-pays exactly one
// admin-lookup per project per month per threshold crossing.
// =========================================================================

/**
 * Return the email addresses of all admins for a given project.
 *
 * Walk:
 *   1. Postgres: SELECT user_id FROM project_members
 *                 WHERE project_id = $1 AND role = 'admin'
 *                   AND joined_at IS NOT NULL
 *   2. D1:       SELECT email FROM users WHERE id IN (?, ?, ?, ...)
 *
 * Returns an array (possibly empty). Empty array means either no
 * admins for that project OR D1 lookup failed for all admins; the
 * caller should treat empty as "no one to notify."
 *
 * @param {object} env  - Pages env: env.DB (D1)
 * @param {object} sql  - postgres tagged-template client
 * @param {string} projectId
 * @returns {Promise<string[]>}
 */
export async function getAdminEmailsForProject(env, sql, projectId) {
  // Step 1: which user_ids are admins on this project?
  const adminRows = await sql`
    SELECT user_id FROM project_members
     WHERE project_id = ${projectId}
       AND role = 'admin'
       AND joined_at IS NOT NULL
  `;
  if (adminRows.length === 0) return [];

  const userIds = adminRows.map((r) => r.user_id);

  // Step 2: D1 IN-list. D1 doesn't have native array binding; build
  // placeholders dynamically and bind each id separately. Same pattern
  // would work in postgres-js too but we already have the explicit
  // sql(array) helper there — this is the D1-flavored version.
  const placeholders = userIds.map(() => '?').join(',');
  const result = await env.DB
    .prepare(`SELECT email FROM users WHERE id IN (${placeholders})`)
    .bind(...userIds)
    .all();

  if (!result || !Array.isArray(result.results)) return [];
  return result.results
    .map((r) => r.email)
    .filter((e) => typeof e === 'string' && e.length > 0);
}
