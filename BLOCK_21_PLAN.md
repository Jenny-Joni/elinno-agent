# Block 21 — Sprint View renders the real Jira board columns

## Context

Sprint View's "Issues by board status" card does not match the Jira board it
claims to mirror. Observed on Gems Launchpad (GLNP board 3), 2026-08-18:

| | Order |
|---|---|
| **Jira board** | To Do · In Progress · IN QA · Done on Staging · **Done on Production** |
| **Sprint View** | To Do · Done on Staging · In Progress · IN QA · **Done** |

**The counts are correct** — 10 / 39 / 10 / 46 / 32 match the board exactly.
Only the order and one label are wrong, so this is a presentation defect, not
a data defect.

Two separate causes, one root.

**Root: Elinno never fetches the board's column configuration.** The Jira sync
calls exactly four endpoints (`functions/_lib/connectors/jira.js`):

- `/rest/api/3/myself`
- `/rest/agile/1.0/board`
- `/rest/agile/1.0/board/{id}/sprint`
- `/rest/api/3/search/jql`

`/rest/agile/1.0/board/{id}/configuration` — which returns column names, their
order, and the statuses mapped into each — is never called.

**Cause 1 — order.** With no column data, `sprint.js:183` reconstructs
something column-shaped by grouping distinct issue statuses and sorting them:

```js
const catRank = { new: 0, indeterminate: 1, done: 2, unknown: 3 };
// sort by category rank, then alphabetically by status name
```

Within `indeterminate` the alphabetical tiebreak yields **D**one on Staging →
**In P**rogress → **IN Q**A. That is the entire explanation for the observed
order: the team's *last* workflow stage sorts *second* because its name starts
with D.

**Cause 2 — label.** `Done` is the Jira **status**. `Done on Production` is the
**column** containing it. In Jira these are different objects: a column is
named independently of its statuses and may contain several. Elinno is showing
status names under a heading that says columns.

**Cause 3 — latent, not yet visible.** Each GLNP column happens to hold exactly
one status. A column holding two statuses would render as two bars, and a
column holding zero issues does not render at all.

## Locked decisions

- **A. Fetch the board configuration during sync.** It is the only source for
  column identity, order, and membership. Nothing else can be derived.
- **B. Resolve status IDs to names at sync time, not query time.** The
  configuration endpoint returns status **IDs**; `mapIssueToEntity`
  (`jira.js:341`) stores status **names**. Adding `status_id` to every issue
  would pull the `aggregate_jira` DSL's field allowlist into scope. Instead one
  `/rest/api/3/status` call per sync resolves IDs → names, and columns are
  stored carrying names. The existing `statusAgg` then groups by column with
  **no compiler change**.
- **C. Store on the sprint entity's `metadata`. No schema migration.**
  `entities.metadata` is `JSONB NOT NULL DEFAULT '{}'` and already carries
  `board_id` for `jira_sprint` rows. Columns go beside it. **No DDL means no
  production migration and no schema carve-out.**
- **D. Empty columns render at 0.** Jira shows them; a silently absent column
  reads as a data error.
- **E. Statuses mapped to no column render in a trailing group, labelled.**
  Jira hides these issues entirely. Elinno will not: the card states a total of
  137, and dropping issues to match Jira's hiding would make that total lie.
  Visible and labelled beats accurate-to-Jira-but-silently-lossy.
- **F. Fallback is today's behaviour, not an error.** Any sprint without
  `board_columns` renders exactly as it does now.

## Architecture

Four layers, in order:

1. **Sync** — `fetchBoardConfiguration(siteUrl, email, apiToken, boardId)`
   called alongside the existing `listSprintsForBoard` in `_doSync`. Reuses the
   already-decrypted `email`/`apiToken` that `listBoardsForProject` and
   `listSprintsForBoard` receive today, so this adds **no new credential
   decryption call site** and does not trip the carve-out in WORKFLOW.md.
2. **Storage** — `mapSprintToEntity` gains a `boardColumns` argument, written to
   `metadata.board_columns` as `[{ name, statuses: [status names] }]`.
3. **API** — `sprint.js` replaces the `catRank` + alphabetical sort with a walk
   over `board_columns` in board order, summing `count` and `points` across each
   column's statuses.
4. **UI** — no change. The card's existing subtitle ("Your team's workflow
   columns") stops being a false claim.

Rules never reference a board. They reference stored columns; the sync supplies
them.

## Sub-tasks

| # | Sub-task | Mode |
|---|---|---|
| 21.0 | This plan | AUTO |
| 21.1 | `fetchBoardConfiguration` + `/rest/api/3/status` ID→name resolution, with runtime shape validation | DEFAULT (unverified external contract) |
| 21.2 | `mapSprintToEntity` writes `metadata.board_columns`; `_doSync` threads it through | AUTO |
| 21.3 | `sprint.js` groups `board_status` by stored column, in board order | AUTO |
| 21.4 | Fallback + empty-column + unmapped-status paths | AUTO |
| **21.5** | **VERIFICATION GATE — matrix below, against the real GLNP board** | DEFAULT |

## Files

- **Modified:** `functions/_lib/connectors/jira.js` (new fetch, ID→name
  resolution, `mapSprintToEntity` signature), `functions/api/projects/[id]/sprint.js`
  (the `boardStatus` block, ~line 182–195)
- **Reused:** `jiraGet` and its 429-retry, the `JiraApiError` 400-swallow
  pattern from `listSprintsForBoard`, the existing `statusAgg` aggregate
- **Untouched:** `public/project.html`, the `aggregate_jira` compiler, the
  schema, `_lib/jira-sprint.js`

## Verification matrix (21.5)

| # | Check | Threshold |
|---|---|---|
| 1 | Column order matches the GLNP board exactly | To Do · In Progress · IN QA · Done on Staging · Done on Production |
| 2 | Column **names** are the board's, not status names | "Done on Production", not "Done" |
| 3 | Counts unchanged | 10 / 10 / 46 / 39 / 32, total 137 |
| 4 | Total still reconciles | sum of columns + unmapped group == `stats.total` |
| 5 | Other three Jira projects still render | Rain Trade, Joni, Gems Trade — no empty states, counts unchanged |
| 6 | Fallback | a sprint with no `board_columns` renders in today's order, no error |
| 7 | Sync resilience | board config 400/404 does not abort the sync run; `sync_runs` still completes |
| 8 | No new decryption sites | `grep` for `decrypt(` in `jira.js` returns the same count as before |
| 9 | Console | 0 errors, all four projects |

## Risks worth naming

- **The external contract is unverified.** The Agile API rejects browser
  session cookies (401 — confirmed 2026-08-18), so the response shape could not
  be inspected without handling an API token, which Claude does not do. 21.1 is
  therefore DEFAULT mode and validates the shape at runtime, falling back to
  today's ordering rather than trusting it. Jenny can retire this risk by
  running the `curl` herself and pasting the structure.
- **`content_hash` churn.** Adding `metadata` fields changes the hash, so every
  `jira_sprint` row rewrites once on the next sync and `records_skipped` dips
  for exactly one run. Expected, not a regression.
- **One extra API call per board, per sync**, plus one `/status` call per sync.
  Negligible against the issue-search pagination that dominates a run.
- **This does not fix the `dashboard.js` divergence** (still open from Block
  18) or the type-tile shortfall — 34 Bugs + 34 Stories + 4 Tasks = 72 against
  a total of 137, because Sub-task and Epic get no tile. Both are separate.
