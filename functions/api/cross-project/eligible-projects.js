// functions/api/cross-project/eligible-projects.js
//
// Block 12.5a — GET /api/cross-project/eligible-projects
// Returns the workspace user's projects that have an active Jira
// connection, for the cross-project chat creation picker (mockup c).
//
// v1.3 picker shows every project with Jira connected. Slack-only
// projects aren't shown — the live cross-project label is "Product"
// which is Jira-typed (Finance/Monday is v2.0-locked).

import postgres from 'postgres';
import { error, json } from '../../_lib/auth.js';
import { getWorkspaceUserId } from '../../_lib/workspace.js';

export async function onRequestGet({ request, env }) {
  const userId = await getWorkspaceUserId(request, env);
  if (!userId) return error('Not authenticated', 401);

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // For each project in the workspace that's not soft-deleted and
    // has at least one active Jira connection, return identity + the
    // most-recent active Jira sprint summary (so the picker rows can
    // render the sprint metadata the mockup shows).
    const projects = await sql`
      SELECT p.id::text       AS id,
             p.name,
             p.description,
             p.created_at,
             p.updated_at,
             p.owner_user_id
        FROM projects p
       WHERE p.owner_user_id = ${userId}
         AND p.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM connections c
            WHERE c.project_id = p.id
              AND c.source = 'jira'
              AND c.status = 'active'
              AND c.deleted_at IS NULL
         )
       ORDER BY p.updated_at DESC, p.id DESC
    `;

    if (projects.length === 0) {
      return json({ ok: true, projects: [] });
    }

    // Sprint summary per project: pick the most recently updated active
    // sprint (matches dashboard.js / runListJiraSprints behavior).
    const projectIds = projects.map((p) => p.id);
    const sprintRows = await sql`
      SELECT project_id::text                       AS project_id,
             metadata->>'sprint_name'               AS sprint_name,
             metadata->>'sprint_id'                 AS sprint_id_text,
             metadata->>'start_date'                AS start_date,
             metadata->>'end_date'                  AS end_date,
             source_updated_at
        FROM entities
       WHERE project_id IN ${sql(projectIds)}
         AND source = 'jira'
         AND source_type = 'jira_sprint'
         AND metadata->>'state' = 'active'
       ORDER BY project_id, source_updated_at DESC NULLS LAST
    `;
    const sprintByProject = new Map();
    for (const s of sprintRows) {
      if (sprintByProject.has(s.project_id)) continue;
      sprintByProject.set(s.project_id, s);
    }

    // Ticket counts per project (for the picker right-column stats).
    const ticketCounts = new Map();
    if (sprintByProject.size > 0) {
      const sprintIdList = [];
      const sprintProjectIds = [];
      for (const [pid, s] of sprintByProject.entries()) {
        const sid = Number(s.sprint_id_text);
        if (Number.isFinite(sid)) {
          sprintIdList.push(sid);
          sprintProjectIds.push(pid);
        }
      }
      if (sprintIdList.length > 0) {
        const countRows = await sql`
          SELECT project_id::text                AS project_id,
                 (metadata->>'sprint_id')::int   AS sprint_id,
                 metadata->>'status_category'    AS status_category,
                 count(*)::int                   AS count
            FROM entities
           WHERE project_id IN ${sql(sprintProjectIds)}
             AND source = 'jira'
             AND source_type = 'jira_issue'
             AND (metadata->>'sprint_id')::int IN ${sql(sprintIdList)}
           GROUP BY project_id, sprint_id, status_category
        `;
        for (const r of countRows) {
          const s = sprintByProject.get(r.project_id);
          if (!s || Number(s.sprint_id_text) !== r.sprint_id) continue;
          const existing = ticketCounts.get(r.project_id) || { total: 0, open: 0, done: 0 };
          existing.total += r.count;
          if (r.status_category === 'done') existing.done += r.count;
          else existing.open += r.count;
          ticketCounts.set(r.project_id, existing);
        }
      }
    }

    const now = Date.now();
    const out = projects.map((p) => {
      const s = sprintByProject.get(p.id);
      const counts = ticketCounts.get(p.id) || null;
      let activeSprint = null;
      if (s) {
        const startMs = s.start_date ? Date.parse(s.start_date) : null;
        const endMs = s.end_date ? Date.parse(s.end_date) : null;
        let daysLeft = null;
        let pct = null;
        if (Number.isFinite(endMs)) {
          daysLeft = Math.max(0, Math.ceil((endMs - now) / (1000 * 60 * 60 * 24)));
        }
        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
          pct = Math.round(Math.max(0, Math.min(100, ((now - startMs) / (endMs - startMs)) * 100)));
        }
        activeSprint = {
          sprint_id: Number(s.sprint_id_text) || null,
          sprint_name: s.sprint_name,
          start_date: s.start_date,
          end_date: s.end_date,
          days_left: daysLeft,
          percent_complete: pct,
          ticket_counts: counts || { total: 0, open: 0, done: 0 },
        };
      }
      return { ...p, jira_active_sprint: activeSprint };
    });

    return json({ ok: true, projects: out });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}
