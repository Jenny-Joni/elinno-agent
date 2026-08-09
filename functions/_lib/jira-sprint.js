// functions/_lib/jira-sprint.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Single source of truth for "which stored sprint is the active one".
//
// Extracted verbatim from functions/api/projects/[id]/sprint.js (Block 16)
// in Block 18.1 so that more than one surface can share one answer. Behaviour
// is unchanged by the move — same predicate, same grace window, same
// null-return contract.
//
// WHY THIS IS A CARVE-OUT
// -----------------------
// The predicate below decides which sprint's data a user is shown. Both
// consumers are project-scoped reads, and loosening it (dropping the
// complete_date test, widening the grace) would surface a closed or
// long-dead sprint as current — wrong data under a "live" label rather than
// an empty state. Any change to the predicate or the grace window is a
// re-lock trigger per WORKFLOW.md.
//
// Callers must still enforce their own project scoping. This helper receives
// an already-scoped result set and does not read the database.
//
// CONSUMERS
//   - functions/api/projects/[id]/sprint.js   (Block 16, Sprint View)
//   - functions/api/projects/[id]/index.js    (Block 18.2, suggestion_context)
//
// NOT a consumer: functions/api/dashboard.js resolves "active sprint" with a
// looser rule of its own (metadata->>'state' = 'active' ordered by
// source_updated_at, no complete_date or stale-end_date exclusion), so its
// card can still name a sprint these two treat as absent. Pre-existing and
// deliberately not bundled into Block 18 — see BLOCK_18_PLAN.md.
// =========================================================================

const DAY_MS = 86_400_000;

// A stored sprint counts as "the active sprint" only if it's state='active',
// not completed, and not stale. A completed sprint has complete_date set; a
// record whose end_date passed long ago is a stale state whose Jira close never
// synced (the sprint-refresh step swallows its own errors, so states can freeze
// indefinitely). The grace keeps genuinely-overdue-but-running sprints visible
// (they still render via the `overdue` path) while excluding months-old records.
export const ACTIVE_SPRINT_STALE_GRACE_MS = 30 * DAY_MS;

export function pickActiveSprint(results, nowMs = Date.now()) {
  return (results || []).find((s) => {
    if (!s || s.sprint_id == null) return false;
    if (s.complete_date) return false; // definitively closed in Jira
    const endMs = s.end_date ? Date.parse(s.end_date) : NaN;
    // Only exclude on a validly-parsed, long-past end date; null/unparseable is kept.
    if (!Number.isNaN(endMs) && endMs < nowMs - ACTIVE_SPRINT_STALE_GRACE_MS) return false;
    return true;
  }) || null;
}
