// functions/_lib/jira-sprint.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Single source of truth for "which stored sprint is the active one".
//
// Extracted verbatim from functions/api/projects/[id]/sprint.js (Block 16)
// in Block 18.1 so that more than one surface can share one answer. The move
// itself changed nothing; the predicate was later narrowed — see the
// 2026-08-18 note below.
//
// WHY THIS IS A CARVE-OUT
// -----------------------
// The predicate below decides which sprint's data a user is shown. Both
// consumers are project-scoped reads, and dropping the complete_date test
// would surface a sprint Jira has closed as current — wrong data under a
// "live" label rather than an empty state. complete_date is therefore load-
// bearing and must not be relaxed. Any change to this predicate is a
// carve-out edit: default mode, per-action review.
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
// source_updated_at, no complete_date exclusion), so its card can still name
// a sprint Jira has closed. Removing the end_date grace here (2026-08-18)
// closed the larger half of that divergence — the two now disagree only
// about completed sprints, not merely-overdue ones. Pre-existing and
// deliberately not bundled into Block 18 — see BLOCK_18_PLAN.md.
// =========================================================================

// A stored sprint counts as "the active sprint" if the caller's query said
// state='active' and Jira has not closed it. complete_date is Jira's own
// definitive close signal, and is now the sole exclusion.
//
// 2026-08-18 — the end_date staleness grace was REMOVED.
// The predicate also used to drop any sprint whose end_date was more than 30
// days past, on the theory that such a record was a frozen state whose Jira
// close had never synced. That theory misfires on a team running one long
// sprint. Gems Launchpad's "23/02-09/03" ended 2026-03-08, is still the open
// sprint on the board, syncs correctly every day, and was hidden from Sprint
// View for 163 days — while the dashboard's looser rule named it, so the two
// surfaces disagreed about the same sprint on the same screenful of app.
//
// An end date does not measure record staleness; sync recency does, and that
// is already surfaced independently as the "as of" stamp on every Sprint View
// payload. A genuinely overdue sprint now renders through the existing
// `overdue` path ("Ended 8 Mar · ran 163 days over"), which states the
// situation plainly — strictly more informative than an empty state that
// reads as "this project has no sprint".
//
// Consequence worth naming: a sprint deleted or closed in Jira whose close
// never syncs will now persist as "active" indefinitely rather than ageing
// out after 30 days. That is a deliberate trade — it is visible via `as_of`
// and the overdue banner, whereas the silent empty state was not.
//
// No longer time-dependent: the result is a pure function of the rows.
export function pickActiveSprint(results) {
  return (results || []).find((s) => {
    if (!s || s.sprint_id == null) return false;
    if (s.complete_date) return false; // definitively closed in Jira
    return true;
  }) || null;
}
