// functions/api/dashboard.js
//
// Block 12.3 — workspace dashboard summary endpoint.
// Returns everything public/dashboard.html needs for one render:
//   - session user identity (id, email, is_admin)
//   - workspace cross-project AI cap + MTD spend
//   - the workspace user's cross-project conversations (empty in 12.3
//     since the cross-project endpoint lands in 12.5a; the dashboard
//     handles empty state natively)
//   - per-project rows: identity + active-Jira-sprint summary
//     (sprint name, dates, days_left, percent_complete) + ticket
//     counts (total / open / done) within that sprint
//
// One Pages Function invocation runs at most 6 Hyperdrive queries:
//   (1) projects list, (2) active Jira connections, (3) active
//   sprints per project, (4) ticket counts per sprint, (5) cross-
//   project conversation list, (6) cross-project spend. Plus one
//   D1 lookup for the user's cap + period_start.

import postgres from 'postgres';
import { error, getSessionUser, json } from '../_lib/auth.js';

// postgres-js returns UUID[] as a Postgres array literal STRING in this
// configuration ('{a,b,c}'). Normalize for the cross-project chats list.
// (v1.3.1 cleanup will extract to a shared lib.)
function parseProjectIds(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.startsWith('{') && v.endsWith('}')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env.DB);
  if (!user) return error('Not authenticated', 401);
  const userIdText = String(user.id);

  // D1: workspace cap + spend period start. v1.3 (Block 12.1) added
  // these three columns. cross_project_ai_spend_period_start may be
  // NULL (D1 rejected the unixepoch DEFAULT; app layer enforces);
  // fall back to "now" if so.
  const workspaceUser = await env.DB
    .prepare(
      `SELECT cross_project_ai_monthly_cap_usd,
              cross_project_ai_spend_period_start
         FROM users
        WHERE id = ?1`
    )
    .bind(user.id)
    .first();
  const cap = Number(workspaceUser?.cross_project_ai_monthly_cap_usd ?? 20);
  const periodStartUnix =
    workspaceUser?.cross_project_ai_spend_period_start ??
    Math.floor(Date.now() / 1000);
  const periodStartIso = new Date(periodStartUnix * 1000).toISOString();

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // 1. List workspace projects (v1.3: workspace = owner_user_id).
    //    Index path: projects_owner_active_idx on (owner_user_id)
    //    WHERE deleted_at IS NULL.
    const projects = await sql`
      SELECT id::text AS id,
             name,
             slug,
             description,
             owner_user_id,
             created_at,
             updated_at
        FROM projects
       WHERE owner_user_id = ${userIdText}
         AND deleted_at IS NULL
       ORDER BY updated_at DESC, id DESC
    `;

    const projectIds = projects.map((p) => p.id);

    // Short-circuit empty workspace.
    if (projectIds.length === 0) {
      return json({
        ok: true,
        user: { id: user.id, email: user.email, display_name: user.display_name || '', is_admin: !!user.is_admin },
        workspace: {
          cross_project_spend_usd: 0,
          cross_project_cap_usd: cap,
          cross_project_period_start: periodStartIso,
        },
        cross_project_chats: [],
        projects: [],
      });
    }

    // 2. Active Jira connections per project (so the UI can render
    //    "no Jira" projects with a simplified card).
    //    postgres-js array binding: use `IN ${sql(arr)}` not
    //    `= ANY(${arr}::uuid[])` — the established pattern in this
    //    codebase (see messages.js:236 comment about prior fix).
    const jiraConnRows = await sql`
      SELECT DISTINCT project_id::text AS project_id
        FROM connections
       WHERE project_id IN ${sql(projectIds)}
         AND source = 'jira'
         AND status = 'active'
         AND deleted_at IS NULL
    `;
    const jiraProjectIds = new Set(jiraConnRows.map((r) => r.project_id));

    // 3. Active Jira sprints per project. Sprint rows live in entities
    //    with source_type='jira_sprint'; state is in metadata. There may
    //    be > 1 active sprint per project in pathological cases; pick
    //    the latest-start-date one per project (matches runListJiraSprints
    //    behavior of ordering by source_updated_at DESC).
    const activeSprints = await sql`
      SELECT id::text                                      AS entity_id,
             project_id::text                              AS project_id,
             title,
             metadata->>'sprint_name'                      AS sprint_name,
             metadata->>'sprint_id'                        AS sprint_id_text,
             metadata->>'start_date'                       AS start_date,
             metadata->>'end_date'                         AS end_date,
             metadata->>'jira_project_key'                 AS project_key,
             source_updated_at
        FROM entities
       WHERE project_id IN ${sql(projectIds)}
         AND source = 'jira'
         AND source_type = 'jira_sprint'
         AND metadata->>'state' = 'active'
       ORDER BY project_id, source_updated_at DESC NULLS LAST
    `;
    // De-dupe: first row per project.
    const sprintByProject = new Map();
    const sprintIdsByProject = new Map();
    for (const s of activeSprints) {
      if (sprintByProject.has(s.project_id)) continue;
      const sid = Number(s.sprint_id_text);
      if (!Number.isFinite(sid)) continue;
      sprintByProject.set(s.project_id, { ...s, sprint_id: sid });
      sprintIdsByProject.set(s.project_id, sid);
    }

    // 4. Ticket counts per (project, sprint) grouped by status_category.
    //    One query, all sprints. Filter to issues matching the
    //    project_id + active sprint_id pairs we identified in step 3.
    const ticketCounts = new Map(); // project_id -> { total, open, done }
    if (sprintByProject.size > 0) {
      const sprintIdList = [...sprintIdsByProject.values()];
      const projectIdList = [...sprintIdsByProject.keys()];
      const countRows = await sql`
        SELECT project_id::text                       AS project_id,
               (metadata->>'sprint_id')::int          AS sprint_id,
               metadata->>'status_category'           AS status_category,
               count(*)::int                          AS count
          FROM entities
         WHERE project_id IN ${sql(projectIdList)}
           AND source = 'jira'
           AND source_type = 'jira_issue'
           AND (metadata->>'sprint_id')::int IN ${sql(sprintIdList)}
         GROUP BY project_id, sprint_id, status_category
      `;
      for (const r of countRows) {
        // Filter to rows where this row's sprint_id is THIS project's
        // active sprint (otherwise we'd lump in past-sprint tickets if
        // a sprint_id collides across projects, which would be weird
        // but the safer guard).
        const activeForProject = sprintIdsByProject.get(r.project_id);
        if (activeForProject !== r.sprint_id) continue;
        const existing = ticketCounts.get(r.project_id) || {
          total: 0,
          open: 0,
          done: 0,
        };
        existing.total += r.count;
        if (r.status_category === 'done') existing.done += r.count;
        else existing.open += r.count;
        ticketCounts.set(r.project_id, existing);
      }
    }

    // 5. Cross-project conversations owned by this user. In 12.3 this
    //    is expected to return [] (the cross-project endpoint lands in
    //    12.5a). The dashboard renders an empty-state CTA when empty.
    const crossProjectChats = await sql`
      SELECT id::text                AS id,
             label,
             project_ids,
             title,
             last_message_at,
             created_at
        FROM conversations
       WHERE user_id = ${userIdText}
         AND project_ids IS NOT NULL
         AND deleted_at IS NULL
       ORDER BY last_message_at DESC NULLS LAST, created_at DESC
       LIMIT 10
    `;

    // 6. Cross-project spend MTD. Cross-project messages have
    //    project_id IS NULL (BLOCK_12_PLAN decision F). Scope to this
    //    workspace user's conversations (the cap is per-user). In 12.3
    //    this should always return 0 since no cross-project messages
    //    exist yet; the cap-charging helper that writes them lands in
    //    12.5a.
    const spendRow = await sql`
      SELECT COALESCE(SUM(cost_usd), 0)::float AS spend_usd
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
       WHERE m.project_id IS NULL
         AND m.created_at >= ${periodStartIso}::timestamptz
         AND m.deleted_at IS NULL
         AND c.user_id = ${userIdText}
         AND c.deleted_at IS NULL
    `;
    const crossProjectSpend = Number(spendRow[0]?.spend_usd ?? 0);

    // Assemble project rows with computed sprint metadata.
    const now = Date.now();
    const projectRows = projects.map((p) => {
      const sprint = sprintByProject.get(p.id);
      const counts = ticketCounts.get(p.id) || null;
      const hasJira = jiraProjectIds.has(p.id);

      let jiraActiveSprint = null;
      if (sprint) {
        const startMs = sprint.start_date
          ? Date.parse(sprint.start_date)
          : null;
        const endMs = sprint.end_date ? Date.parse(sprint.end_date) : null;
        let daysLeft = null;
        let percentComplete = null;
        if (Number.isFinite(endMs)) {
          daysLeft = Math.max(
            0,
            Math.ceil((endMs - now) / (1000 * 60 * 60 * 24))
          );
        }
        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
          const total = endMs - startMs;
          const elapsed = now - startMs;
          percentComplete = Math.round(
            Math.max(0, Math.min(100, (elapsed / total) * 100))
          );
        }
        jiraActiveSprint = {
          sprint_id: sprint.sprint_id,
          sprint_name: sprint.sprint_name || sprint.title,
          start_date: sprint.start_date,
          end_date: sprint.end_date,
          days_left: daysLeft,
          percent_complete: percentComplete,
          ticket_counts: counts || { total: 0, open: 0, done: 0 },
        };
      }

      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        owner_user_id: p.owner_user_id,
        created_at: p.created_at,
        updated_at: p.updated_at,
        has_jira: hasJira,
        jira_active_sprint: jiraActiveSprint,
      };
    });

    return json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name || '',
        is_admin: !!user.is_admin,
      },
      workspace: {
        cross_project_spend_usd: crossProjectSpend,
        cross_project_cap_usd: cap,
        cross_project_period_start: periodStartIso,
      },
      cross_project_chats: crossProjectChats.map((c) => ({
        ...c,
        project_ids: parseProjectIds(c.project_ids),
      })),
      projects: projectRows,
    });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup
    }
  }
}
