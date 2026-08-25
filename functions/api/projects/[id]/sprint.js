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
//        - the direct issue-list read below filters
//          `WHERE project_id = $ AND sprint_id = $` explicitly, and every
//          count in the response is derived from ITS rows (2026-08-25) —
//          so there is now exactly one scoped read of issue data, not four.
//        - the board_columns read filters project_id AND sprint_id.
//
// ?sprint_id IS ATTACKER-CONTROLLED. The sprint is resolved EXACTLY ONCE
// here and the same integer is threaded into the summary executor and the
// issue-list read — no downstream call re-resolves
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
// Block 18.1: pickActiveSprint moved to _lib so the suggestion context can
// resolve the same sprint this endpoint does. Predicate unchanged by the move.
import { pickActiveSprint } from '../../../_lib/jira-sprint.js';

const ISSUE_LIST_MAX = 500; // == the sync ceiling; uncapped vs the agent's 50.

/* SPRINT MEMBERSHIP. Deliberately NOT filtered here — this note replaces a
   filter that was wrong.

   A blanket "sub-tasks are not sprint members" rule lived here on 2026-08-25.
   Checked against both Jira sites afterwards:

     Joni  sprint 268   Jira: 154 issues, ZERO sub-tasks.
                        Ours: 222, including 63 sub-tasks.
     Rain  sprint 1207  Jira: 91 issues, INCLUDING 26 sub-tasks.
                        Ours: 91. Exactly right.

   Sub-tasks genuinely are sprint members in one project and not in the other,
   so no rule applied at read time can be correct for both. The filter fixed
   part of Joni by breaking Rain Trade, which had been exact.

   The defect is upstream: the connector infers membership from each issue's
   own sprint field, and a sub-task carries its parent's sprint there whether
   or not it was ever added to the sprint. Jira's authoritative answer is
   /rest/agile/1.0/sprint/{id}/issue, which the sync never consults. That is
   where this has to be fixed, not here. */

/* STATUS CATEGORY OVERRIDES (2026-08-25, Jenny).

   Jira assigns every status one of three fixed categories — To Do / In
   Progress / Done — and this project's "Ready for Production" is categorised
   `new` (To Do). Jenny's call is that work in that column is finished, so it
   should read as Done here: the progress bar, the category split, the
   assignee workload and completed story points all follow the category, and
   43 finished issues sitting under "To Do" misrepresents the sprint.

   THIS IS A DELIBERATE DIVERGENCE FROM JIRA and the only one in this file —
   everything else here exists to make the two agree. The alternative is to
   change the category on the status in Jira itself, which would fix Jira's
   own burndown and velocity too and needs no code; that is the better fix if
   the team agrees, and this override should be removed if that happens.

   Keyed by status NAME, lower-cased, because category is what we are
   overriding — matching on category would rewrite every To Do status. */
const STATUS_CATEGORY_OVERRIDES = Object.freeze({
  // To Do
  'backlog': 'new',
  'to do': 'new',
  // In Progress
  'in progress': 'indeterminate',
  'ready for review': 'indeterminate',
  'qa': 'indeterminate',
  'qa staging': 'indeterminate',
  'in qa': 'indeterminate',        // Joni's spelling of the same stage
  // Done
  'ready for production': 'done',
  'done': 'done',
});

function categoryOf(row) {
  const key = String(row && row.status || '').trim().toLowerCase();
  return STATUS_CATEGORY_OVERRIDES[key] || row.status_category || 'unknown';
}

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
      /* Prefer the explicit mapping, keyed by the COLUMN's name. Without this
         an empty column has no members to derive a category from, so
         dominantCategory returns 'unknown' and it renders in the neutral
         colour — which is exactly what "Ready for review" and "QA Staging"
         did while sitting at 0 issues. The mapping is what Jenny specified,
         so it should hold whether or not anything is in the column. */
      status_category:
        STATUS_CATEGORY_OVERRIDES[String(col.name || '').trim().toLowerCase()]
        || dominantCategory(members),
      count: members.reduce((n, m) => n + m.count, 0),
      points: members.reduce((n, m) => n + m.points, 0),
      on_board: true,
    };
  });
  const unmapped = sortStatusesByCategory(rows.filter((r) => !claimed.has(r.status)))
    .map((r) => ({ ...r, on_board: false }));
  /* Off-board statuses lead rather than trail (2026-08-25, Jenny). The only
     one in practice is Backlog, and it is where work sits BEFORE the board's
     first column — reading it after Done put the earliest stage at the end of
     a left-to-right progression. They are still marked on_board:false, so the
     chart keeps labelling them "not on board". */
  return unmapped.concat(columns);
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
    /* The three per-issue aggregates that stood here — issue types, statuses,
       assignee workload — are gone. They could not see the board-parity
       filter, so they would have reported one set of numbers while the issue
       list below reported another. All three are now derived from the filtered
       list, which also removes three database round-trips.

       board_columns stays: it is the board's stored column CONFIGURATION, not
       a count over issues, so the filter does not apply to it. */
    const [boardColRows] = await Promise.all([
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
    const boardRows = issueRows
      /* Apply the category override ONCE, here. Everything downstream — the
         category bar, board_status, board_columns, workload, completed points
         and the issue list the client filters on — reads status_category off
         these rows, so overriding at the source keeps all six consistent. */
      .map((r) => ({ ...r, status_category: categoryOf(r) }));

    const issues = boardRows.map((r) => ({
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

    /* ── Shape: everything below is derived from boardRows ──────────────
       These four used to come from three SQL aggregates plus the sprint
       summary, none of which knew about the board-parity filter. Deriving
       them from the one filtered array is what makes the stat tiles, the
       category bar, the column chart and the issue list agree. */

    // Issue-type stats (Total / Tasks / Bugs / Stories)
    const stats = { total: boardRows.length, tasks: 0, bugs: 0, stories: 0 };
    for (const r of boardRows) {
      const t = String(r.issue_type || '').toLowerCase();
      if (t === 'task') stats.tasks += 1;
      else if (t === 'bug') stats.bugs += 1;
      else if (t === 'story') stats.stories += 1;
      // Anything else folds into Total only, as before.
    }

    // Per-status counts and points, in the shape board_status/board_columns want
    const statusMap = new Map();
    for (const r of boardRows) {
      const key = r.status || null;
      if (!statusMap.has(key)) {
        statusMap.set(key, {
          status: key,
          status_category: r.status_category || 'unknown',
          count: 0,
          points: 0,
        });
      }
      const bucket = statusMap.get(key);
      bucket.count += 1;
      bucket.points += Number(r.story_points) || 0;
    }
    const statusRows = [...statusMap.values()];

    // Status-category rollup, replacing the sprint summary's own counts —
    // those are computed over every issue and would contradict the chart.
    const categories = { new: 0, indeterminate: 0, done: 0, unknown: 0 };
    for (const r of boardRows) {
      const c = r.status_category || 'unknown';
      if (c in categories) categories[c] += 1;
      else categories.unknown += 1;
    }

    // Story points, same reasoning as categories.
    const pointsTotals = { total: 0, completed: 0 };
    for (const r of boardRows) {
      const pts = Number(r.story_points) || 0;
      pointsTotals.total += pts;
      if ((r.status_category || '') === 'done') pointsTotals.completed += pts;
    }

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
    for (const r of boardRows) {
      const key = r.assignee_display_name || null;
      if (!workloadMap.has(key)) {
        workloadMap.set(key, {
          assignee: key,
          counts: { new: 0, indeterminate: 0, done: 0, unknown: 0 },
          total: 0,
        });
      }
      const bucket = workloadMap.get(key);
      const cat = r.status_category || 'unknown';
      if (cat in bucket.counts) bucket.counts[cat] += 1;
      else bucket.counts.unknown += 1;
      bucket.total += 1;
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
      /* Both were read off the sprint summary, which counts every issue in
         the sprint. Left alone they would contradict the chart directly
         beneath them. Now derived from the same filtered rows as everything
         else. */
      categories,
      points: pointsTotals,
      board_status: boardStatus,
      board_columns: boardColumns,
      workload,
      issues,
      as_of: asOf,
    });
  } catch (err) {
    /* 2026-08-25. This catch used to swallow the exception whole and return a
       bare 500. When the board-parity filter (89aa257) broke this endpoint in
       production, there was nothing to read anywhere — not in the response,
       not in the Pages logs — and the change had to be reverted undiagnosed.

       Structured shape matches the connector's convention (see
       jira-connector `jira_board_columns_failed`), so Pages logs stay
       greppable by `event`.

       Nothing sensitive: this endpoint handles no credentials. The message is
       truncated and the stack capped at a few frames so a pathological error
       cannot flood the log. The RESPONSE is unchanged — still a bare
       'Internal error', because the client has no business seeing internals. */
    console.error(JSON.stringify({
      level: 'error',
      event: 'sprint_view_failed',
      project_id: projectId,
      /* No sprint_id here on purpose: it is `let`-declared INSIDE the try, so
         referencing it from this catch throws a ReferenceError inside the
         error handler and destroys the original exception — the exact failure
         this logging exists to prevent. project_id plus the stack is enough to
         locate the sprint. */
      error: err && err.message ? String(err.message).slice(0, 300) : 'unknown',
      stack: err && err.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ').slice(0, 500) : null,
    }));
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
