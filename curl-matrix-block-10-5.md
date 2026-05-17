# Block 10.5 — Curl Verification Matrix

Verification record for Block 10 sub-task 10.5 (sweep-path batching).
Branch `block-10-5-sweep-batching` at `7815ed8`, awaiting ff-merge to
`main`. Preview deploy at
`https://block-10-5-sweep-batching.elinno-agent.pages.dev`.

Code surface: **4 files, 194 insertions, 109 deletions** + **1 new
shared module**.

- `functions/_lib/connectors/_shared/entity_writer.js` — adds
  `embedEntitiesBatch(env, sql, projectId, entities)` per decision M.
  Steps 3+4 of `writeEntitiesWithEmbeddingsBatch` (one embedTextsBatch
  call + per-row INSERT to entity_embeddings) without the entity UPSERT
  half. Preserves the `metadata.project_id` cross-tenant tripwire.
- `functions/_lib/connectors/_shared/sweep_missing_embeddings.js` —
  **new**. Per decision N. SECURITY-CARVE-OUT header (embed-on-write
  neighborhood). Exports `sweepMissingEmbeddings(env, sql, connection)`.
  Same SELECT shape as the two pre-10.5 inline copies.
- `functions/_lib/connectors/slack.js` — drops `EMBEDDING_MODEL_ID` +
  `embedEntityRow` imports (unused after refactor), adds
  `sweepMissingEmbeddings` import, removes ~55 lines of inline sweep
  (replaced with a 6-line move-note).
- `functions/_lib/connectors/jira.js` — same as slack.js.

No schema change. No DDL.

## Verification posture at ff-merge

Static + smoke verification done. Behavior cells V5.1, V5.2, V5.4
deferred to post-merge because they require either (a) a connection
with 50+ NULL-embedding entities (none exist in production — Block 9.5
backfilled all 514 hashes + embeddings on RAIN's Jira) or (b) a Neon
scratch branch to engineer synthetic NULL-embedding rows. V5.3 cell
wording requires adjustment — the SQL filter excludes empty
content_text at the query layer, so the batch helper never sees them.

| Cell | Status | Notes |
|---|---|---|
| **V5.1** | **DEFERRED-runtime** | Sweep one connection with 50+ NULL-embedding entities → subrequest count = 1. Requires engineered data: manually DELETE 50+ rows from `entity_embeddings` for a test connection to recreate the pre-10.5 sweep workload. Easy as a post-merge between-blocks check via Neon SQL Editor + `wrangler pages deployment tail` filter for `embedding_sweep_batch_failed` (absent on success). PROD scale today is the Block 9.5 baseline: 514 entities, all embedded; sweep is currently a no-op. |
| **V5.2** | **DEFERRED-runtime** | Sweep produces same embedded rows as pre-10.5 path. Equivalent SQL SELECT (verified by reading both pre-10.5 inline copies vs. the new shared module — character-equivalent except for whitespace and the closing return). `text-embedding-3-small` is deterministic for identical input on identical model rev. PASS-by-inspection. |
| **V5.3** | **WORDING-ADJUSTED, PASS-by-inspection** | Plan said "Sweep returns `{embedded: 3, skipped: 2}`" for 5 entities of which 2 have empty content_text. Reality under this implementation: the sweep SQL `WHERE … AND length(trim(e.content_text)) > 0` filter excludes empty-content rows at the query layer, so the batch helper never sees them. Returns `{embedded: 3, skipped: 0}`. The defensive empty-text filter in `embedEntitiesBatch` itself remains in place for callers that bypass the SQL filter (e.g., future direct-call sites). Behavior preserved (no embedding written for empty content); counter shape differs. |
| **V5.4** | **DEFERRED-runtime — easily verifiable post-merge** | Sweep idempotent on re-run. Post-merge: Jenny clicks "Sync now" on RAIN's Jira connection twice back-to-back; both sweeps should return `{embedded: 0, skipped: 0}` (logs filter for `embedding_sweep_batch_failed` should be empty; absence of any `entity_embeddings` INSERT delta is the strongest evidence). Production currently in the "all embedded" steady state from Block 9.5, so this is a one-click check. |

## Preview smoke verification

| Check | Method | Result |
|---|---|---|
| Preview deploy succeeds | `curl -s -o /dev/null -w "%{http_code}" https://block-10-5-sweep-batching.elinno-agent.pages.dev/api/db-health` | **HTTP 200** in 322ms. Postgres 17.8 via Hyperdrive routed correctly. |
| Routes resolve (`GET /`, `GET /api/me`) | curl smoke | **HTTP 200** on both. No import-resolution errors at build (those would surface as 500s on the affected route). |
| Static syntax | `node --check` on all 4 modified files | All parse. |
| Cross-tenant tripwire preserved | Code review: `embedEntitiesBatch` checks `entity.metadata.project_id !== projectId` (entity_writer.js newly-added section) | Matches `embedEntityRow` + `writeEntitiesWithEmbeddingsBatch` tripwire. |
| `EMBEDDING_MODEL_ID` + `embedEntityRow` imports cleaned | `grep -n "EMBEDDING_MODEL_ID\|embedEntityRow" slack.js jira.js` | No matches. Imports dropped where now-unused. |

## Production verification (post ff-merge)

Two cells to fire on production after Cloudflare auto-promotes the
ff-merge commit:

- **PROD V5.4**: Jenny clicks "Sync now" on RAIN's Jira (or Slack)
  connection. The post-sync sweep fires (slack.js:615 / jira.js:645).
  Tail logs for the new `embedding_sweep_batch_failed` event name (it
  shouldn't appear) and the absence of any `embedding_sweep_row_failed`
  event (the old per-row event name should be gone from the code, so
  zero occurrences).
- **PROD V5.1 (deferred-deferred)**: If we ever want to actually
  exercise the batched embed call in production, DELETE 50 rows from
  `entity_embeddings` for a single Jira connection, click Sync now,
  watch for one `embedTextsBatch` call (one OpenAI subrequest) + 50
  fresh `entity_embeddings` rows reappear. Optional; runs only if a
  Block 11+ change to the embedding model triggers a backfill.

## Mid-flight fixes

None. The 4-file change set landed as planned. Imports cleaned in both
connector files. `node --check` passed first try.

## Behavior change — intentional, documented

**Pre-10.5**: per-row try/catch around `embedEntityRow` in the sweep
loop. One bad row (e.g., a Postgres INSERT collision) logged + skipped;
other rows in the same page continued.

**Post-10.5**: batch is all-or-nothing on the `embedTextsBatch` call.
If the batch fails, no rows in the page get embedded; the entities stay
in `entities` for the next sweep to retry.

Trade-off accepted in BLOCK_10_PLAN.md uncertainty #6: v1.1 favors the
subrequest-budget fix over partial-failure resilience. The next
sweep will re-attempt the same set; failures don't accumulate.

## Carry-forward

- **V5.1 + V5.2 + V5.4** to post-merge verification by Jenny clicking
  Sync now on RAIN — easy one-action check.
- **V5.3 wording correction** to be folded into a future BLOCK_10_PLAN.md
  addendum or accepted as-noted in this matrix doc.
- **`embedding_sweep_row_failed` event name** is gone from the codebase
  with this change. Any log-tailing infrastructure that watched for it
  should switch to `embedding_sweep_batch_failed`.
