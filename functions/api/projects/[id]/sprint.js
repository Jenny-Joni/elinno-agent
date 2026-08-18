// functions/api/projects/[id]/sprint.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Block 16 — read-only Sprint View data endpoint.
//
//   GET /api/projects/:id/sprint?sprint_id=<int>
//
// Returns the active Jira sprint (or the ?sprint_id override) as a dashboard
// payload: header + date progress, status-category + issue-type counts,
// board-status columns (+ story points), assignee workload, and the FULL
// (uncapped, ≤500) issue list. Reads Neon directly via the existing sprint
// executors — BYPASSES the Block 5 agent loop entirely (no model spend).
//
// PROJECT ISOLATION (two enforced layers, both required)
// ------------------------------------------------------
//   1. requireWorkspaceScope(request, env, params.id) — auth + project
//      membership gate. 401/400/404 short-circuit before any data read.
//   2. EVERY downstream read is scoped by the URL-bound projectId:
//        - runListJiraSprints / runGetJiraSprintSummary filter
//          `WHERE project_id = $` (and the summary additionally matches
//          sprint_id — its cross-project sprint-id-collision guard).
//        - runAggregateJira server-injects project_id (the DSL has no
//          where-slot for it; project_id-in-where is rejected by the
//          compiler).
//        - the direct issue-list read below filters
//          `WHERE project_id = $ AND sprint_id = $` explicitly.
//
// ?sprint_id IS ATTACKER-CONTROLLED. The sprint is resolved EXACTLY ONCE
// here and the same integer is threaded into the summary executor, every
// aggregate DSL, and the issue-list read — no downstream call re-resolves
// "active sprint" (prevents counts/list drift). Because every consumer
// scopes by project_id AS WELL AS sprint_id, a valid-but-foreign sprint_id
// cannot leak another project's data: runGetJiraSprintSummary returns
// `sprint_not_found` (→ active:false here), and the issue-list read returns
// zero rows. A foreign sprint's issues are NEVER returned.
//
// FRESHNESS (decision E) — INTENTIONAL DIVERGENCE
// -----------------------------------------------
// "as of" = MAX(sync_runs.started_at) for the project's Jira connection,
// NOT connections.last_sync_at. This diverges from the Block 9.2 citation
// chip (which uses last_sync_at) on purpose — see BLOCK_16_PLAN.md decision
// E. started_at reflects when the data being shown was actually pulled.
// =========================================================================
import postgres from 'postgres';
import { error, json, requireWorkspaceScope } from '../../../_lib/auth.js';
import {
  runListJiraSprints,
  runGetJiraSprintSummary,
} from '../../../_lib/ai/tools.js';
import { runAggregateJira } from '../../../_lib/ai/aggregate_jira_compiler.js';
// Block 18.1: pickActiveSprint moved to _lib so the suggestion context can
// resolve the same sprint this endpoint does. Predicate unchanged by the move.
import { pickActiveSprint } from '../../../_lib/jira-sprint.js';

const ISSUE_LIST_MAX = 500; // == the sync ceiling; uncapped vs the agent's 50.
const DAY_MS = 86_400_000;

/* Pre-Block-21 ordering, kept verbatim as the fallback: category rank, then
   alphabetical. Used when a sprint has no stored board columns — every sprint
   synced before Block 21, plus Kanban boards and any board this token cannot
   read. Its alphabetical tiebreak is exactly why Block 21 exists (a status
   named "Done on Staging" sorted ahead of "In Progress"), so it is a fallback,
   not a preference. */
const CAT_RANK = { new: 0, indeterminate: 1, done: 2, unknown: 3 };
function sortStatusesByCategory(rows) {
  return rows.slice().sort(
    (a, b) =>
      (CAT_RANK[a.status_category] ?? 9) - (CAT_RANK[b.status_category] ?? 9) ||
      String(a.status).localeCompare(String(b.status))
  );
}

// A column's colour follows whichever category holds most of its issues.
// Empty columns have no issues to judge, so they stay 'unknown' (grey).
function dominantCategory(members) {
  const tally = new Map();
  for (const m of members) tally.set(m.status_category, (tally.get(m.status_category) || 0) + m.count);
  let best = 'unknown';
  let bestN = -1;
  for (const [cat, n] of tally) if (n > bestN) { best = cat; bestN = n; }
  return best;
}

/* The board's columns, in the board's order (BLOCK_21_PLAN decisions D and E).
   Each column sums every status mapped into it, so a two-status column renders
   as ONE bar exactly as it does on the board.
   D: a column with no issues this sprint still renders, at 0 — Jira shows it,
      and a column that silently vanishes reads as a bug.
   E: statuses belonging to no column are appended rather than dropped. Jira
      hides those issues entirely; doing the same here would leave the card's
      own total unreconcilable against the bars beneath it. They carry
      on_board:false so the UI can mark them. */
function groupRowsIntoBoardColumns(rows, boardColumns) {
  const claimed = new Set();
  const columns = boardColumns.map((col) => {
    const names = Array.isArray(col.statuses) ? col.statuses : [];
    const members = rows.filter((r) => names.includes(r.status));
    for (const m of members) claimed.add(m.status);
    return {
      status: col.name,
      status_category: dominantCategory(members),
      count: members.reduce((n, m) => n + m.count, 0),
      points: members.reduce((n, m) => n + m.points, 0),
      on_board: true,
    };
  });
  const unmapped = sortStatusesByCategory(rows.filter((r) => !claimed.has(r.status)))
    .map((r) => ({ ...r, on_board: false }));
  return columns.concat(unmapped);
}

export async function onRequestGet({ request, env, params }) {
  const { error: errResp } = await requireWorkspaceScope(
    request,
    env,
    params.id
  );
  if (errResp) return errResp;

  const projectId = params.id;

  // ── Parse ?sprint_id override (attacker-controlled — validate hard) ──
  const url = new URL(request.url);
  const sprintIdParam = url.searchParams.get('sprint_id');
  let overrideSprintId = null;
  if (sprintIdParam !== null) {
    if (!/^\d+$/.test(sprintIdParam)) {
      return error('sprint_id must be a positive integer', 400);
    }
    overrideSprintId = Number.parseInt(sprintIdParam, 10);
    if (!Number.isSafeInteger(overrideSprintId)) {
      return error('sprint_id out of range', 400);
    }
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // ── Step 2: resolve the sprint ONCE ────────────────────────────────
    let sprintId = overrideSprintId;
    if (sprintId === null) {
      const sprintList = await runListJiraSprints(sql, projectId, {
        state: 'active',
      });
      const active = pickActiveSprint(sprintList?.results);
      if (!active || active.sprint_id == null) {
        // No active sprint → empty state. No closed-sprint fallback (dec. C).
        // pickActiveSprint drops only sprints Jira has closed (complete_date).
        // A sprint that is merely past its end date IS returned, and renders
        // through the `overdue` path below — see jira-sprint.js (2026-08-18).
        return json({ ok: true, active: false, as_of: await freshness(sql, projectId) });
      }
      sprintId = active.sprint_id;
    }

    // ── Step 3: header / category counts / points ──────────────────────
    const summary = await runGetJiraSprintSummary(sql, projectId, {
      sprint_id: sprintId,
    });
    if (summary?.error) {
      // sprint_not_found here means the ?sprint_id override is foreign or
      // gone. Return THIS project's empty state — never the foreign sprint.
      return json({ ok: true, active: false, as_of: await freshness(sql, projectId) });
    }

    // ── Step 4: aggregates (project_id server-injected; sprint_id threaded) ─
    const whereSprint = { sprint_id: { eq: sprintId } };

    const [typeAgg, statusAgg, workloadAgg, boardColRows] = await Promise.all([
      runAggregateJira(sql, projectId, {
        select: ['issue_type', 'COUNT(*)'],
        group_by: ['issue_type'],
        where: whereSprint,
      }),
      runAggregateJira(sql, projectId, {
        select: ['status', 'status_category', 'COUNT(*)', 'SUM(story_points)'],
        group_by: ['status', 'status_category'],
        where: whereSprint,
      }),
      runAggregateJira(sql, projectId, {
        select: ['assignee_display_name', 'status_category', 'COUNT(*)'],
        group_by: ['assignee_display_name', 'status_category'],
        where: whereSprint,
      }),
      /* Block 21: the board's columns as stored by the sync. Read here rather
         than through runListJiraSprints because that executor is also an AGENT
         tool — adding this array there would push a JSON blob into every model
         context that lists sprints. Scoped by project_id as well as sprint_id,
         like every other read in this file. */
      sql`
        SELECT metadata->'board_columns' AS board_columns
          FROM entities
         WHERE project_id = ${projectId}
           AND source = 'jira'
           AND source_type = 'jira_sprint'
           AND metadata->>'sprint_id' = ${String(sprintId)}
         LIMIT 1
      `,
    ]);

    // ── Step 5: uncapped issue list — direct read, project_id AND sprint_id ─
    const issueRows = await sql`
      SELECT issue_key, sprint_id, issue_type, status, status_category,
             assignee_display_name, title, story_points, labels, source_url
        FROM jira_issues
       WHERE project_id = ${projectId}
         AND sprint_id  = ${sprintId}
       ORDER BY status_category, status, issue_key
       LIMIT ${ISSUE_LIST_MAX}
    `;
    const issues = issueRows.map((r) => ({
      issue_key: r.issue_key,
      sprint_id: r.sprint_id,
      issue_type: r.issue_type,
      status: r.status,
      status_category: r.status_category,
      assignee_display_name: r.assignee_display_name,
      title: r.title,
      story_points: r.story_points !== null ? Number(r.story_points) : null,
      labels: Array.isArray(r.labels) ? r.labels : [],
      source_url: r.source_url,
    }));

    // ── Step 6: freshness ──────────────────────────────────────────────
    const asOf = await freshness(sql, projectId);

    // ── Step 7: date math server-side (decision G) ─────────────────────
    const progress = computeProgress(
      summary.start_date,
      summary.end_date,
      summary.state
    );

    // ── Shape: issue-type stats (Total / Tasks / Bugs / Stories) ───────
    const stats = { total: 0, tasks: 0, bugs: 0, stories: 0 };
    for (const row of typeAgg?.rows || []) {
      const n = Number(row.count) || 0;
      stats.total += n;
      const t = (row.issue_type || '').toLowerCase();
      if (t === 'task') stats.tasks += n;
      else if (t === 'bug') stats.bugs += n;
      else if (t === 'story') stats.stories += n;
      // Epic/Sub-task/etc. fold into Total only (dec. step 4).
    }

    // ── Shape: board columns, in the board's own order ─────────────────
    const statusRows = (statusAgg?.rows || []).map((row) => ({
      status: row.status,
      status_category: row.status_category || 'unknown',
      count: Number(row.count) || 0,
      points: Number(row.sum_story_points) || 0,
    }));

    /* board_status stays per-STATUS, and its shape is unchanged. Two consumers
       in project.html depend on exactly that: the Status FILTER builds its set
       from these names and matches them against each issue's own it.status,
       and the group/chip colour lookups find a status here by name.
       Redefining these rows as board columns would compare column names
       against issue statuses and silently break every Status filter match. */
    const boardStatus = sortStatusesByCategory(statusRows);

    /* board_columns is additive and chart-only: the team's real columns, in
       the board's order, summing every status mapped into each. Null when this
       sprint has no stored configuration — the chart then falls back to
       board_status, which is the pre-Block-21 rendering. */
    const storedColumns = boardColRows && boardColRows[0] && boardColRows[0].board_columns;
    const boardColumns = Array.isArray(storedColumns) && storedColumns.length > 0
      ? groupRowsIntoBoardColumns(statusRows, storedColumns)
      : null;

    // ── Shape: assignee workload (stacked by category; null = Unassigned) ─
    const workloadMap = new Map();
    for (const row of workloadAgg?.rows || []) {
      const key = row.assignee_display_name || null;
      if (!workloadMap.has(key)) {
        workloadMap.set(key, {
          assignee: key,
          counts: { new: 0, indeterminate: 0, done: 0, unknown: 0 },
          total: 0,
        });
      }
      const bucket = workloadMap.get(key);
      const cat = row.status_category || 'unknown';
      const n = Number(row.count) || 0;
      if (cat in bucket.counts) bucket.counts[cat] += n;
      else bucket.counts.unknown += n;
      bucket.total += n;
    }
    const workload = [...workloadMap.values()].sort(
      (a, b) => b.total - a.total
    );

    return json({
      ok: true,
      active: true,
      sprint: {
        sprint_id: sprintId,
        name: summary.sprint_name || summary.title,
        goal: summary.goal || null,
        state: summary.state || null,
        start_date: summary.start_date || null,
        end_date: summary.end_date || null,
        complete_date: summary.complete_date || null,
        board_id: summary.board_id ?? null,
        project_key: summary.project_key || null,
        source_url: summary.source_url || null,
        progress,
      },
      stats,
      categories: summary.by_status_category, // {new,indeterminate,done,unknown}
      points: {
        total: Number(summary.total_story_points) || 0,
        completed: Number(summary.completed_story_points) || 0,
      },
      board_status: boardStatus,
      board_columns: boardColumns,
      workload,
      issues,
      as_of: asOf,
    });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup; never masks the return value
    }
  }
}

// MAX(sync_runs.started_at) for the project's Jira connection (decision E).
async function freshness(sql, projectId) {
  const [row] = await sql`
    SELECT MAX(sr.started_at) AS as_of
      FROM sync_runs sr
      JOIN connections c ON c.id = sr.connection_id
     WHERE sr.project_id = ${projectId}
       AND c.source = 'jira'
  `;
  return row?.as_of || null;
}

// Date-based progress only (decision G): no burndown, no velocity.
function computeProgress(startRaw, endRaw, state) {
  const start = startRaw ? new Date(startRaw) : null;
  const end = endRaw ? new Date(endRaw) : null;
  const startMs = start && !Number.isNaN(start.getTime()) ? start.getTime() : null;
  const endMs = end && !Number.isNaN(end.getTime()) ? end.getTime() : null;
  if (startMs === null || endMs === null || endMs <= startMs) {
    return {
      total_days: null,
      elapsed_days: null,
      pct_elapsed: null,
      days_left: null,
      overdue: false,
      days_overdue: 0,
    };
  }
  const now = Date.now();
  const totalDays = Math.max(1, Math.ceil((endMs - startMs) / DAY_MS));
  const elapsedDays = Math.min(
    totalDays,
    Math.max(0, Math.floor((now - startMs) / DAY_MS))
  );
  const pctElapsed = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
  const daysLeft = Math.max(0, Math.ceil((endMs - now) / DAY_MS));
  const overdue = now > endMs && state === 'active';
  const daysOverdue = overdue ? Math.ceil((now - endMs) / DAY_MS) : 0;
  return {
    total_days: totalDays,
    elapsed_days: elapsedDays,
    pct_elapsed: pctElapsed,
    days_left: daysLeft,
    overdue,
    days_overdue: daysOverdue,
  };
}
