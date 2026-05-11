# Block 9.5 — Curl Verification Matrix

Verification record for Block 9.5 (records_skipped + no-op upsert
detection). Branch `block-9-5-records-skipped` ff-merged to `main` at
`5282436` on 2026-05-11. Production deploy at `elinnoagent.com`
confirmed healthy (HTTP 200, Hyperdrive → Neon Postgres 17.8).

Code surface: 3 files, 130 insertions, 19 deletions.
- `functions/_lib/connectors/_shared/entity_writer.js` — SQL WHERE-DO-UPDATE
  pattern, RETURNING extended with `changed`, embed-call gating per
  decision C.
- `functions/_lib/connectors/slack.js` — three-branch counter
  (inserted / updated / skipped) per decision B.
- `functions/_lib/connectors/jira.js` — same three-branch counter at two
  sites (sprint loop + issue loop).

## Verification posture at ff-merge

Per BLOCK_9_PLAN.md verification matrix. Jenny's "approve push to main"
shipped the code ahead of the canary verification step; cells V5-2 + V5-3
are runtime-pending against production.

| Cell | Status | Notes |
|---|---|---|
| **V5-7** | **PASS-by-inspection** | NULL handling in `IS DISTINCT FROM`. Confirmed by Postgres semantics: `NULL IS DISTINCT FROM NULL` → false (treats NULLs as equal, no update fires); `NULL IS DISTINCT FROM 'x'` → true (NULL→value triggers update); `'x' IS DISTINCT FROM 'y'` → true. NULLs in `source_updated_at`, `author_external_id`, `author_display_name`, `source_created_at` correctly don't trigger updates on re-sync. |
| **V5-5** | **PASS-by-inspection** | Slack webhook `message_changed` idempotency. The webhook path (`processMessageEvent` at slack.js:773) goes through the same `writeEntityWithEmbedding` as `_doSync`. The upsert path's classification is identical regardless of caller; webhook re-replay of the same `message_changed` event produces `inserted=false, changed=false` on the second pass, skipping the embed call. No code path divergence to verify at runtime. |
| **V5-2** | **PENDING runtime** | Idempotent re-sync produces `records_skipped > 0`. To run on production: Jenny's DevTools-console-fetch admin pattern, trigger Jira sync twice back-to-back, expect 2nd sync's `sync_run` row to show `records_inserted=0, records_updated=0, records_skipped=N` (where N is the synced entity count). |
| **V5-3** | **PENDING runtime — canary discriminator** | Single upstream edit produces `records_updated=1` exactly. To run: edit one RAINONE issue body in `rain-labs.atlassian.net`, wait 5s, re-trigger sync. Expect `records_updated=1, records_skipped=N-1, records_inserted=0`. **If `records_updated > 1`, swap upsertEntityRow's body to the CTE fallback documented in entity_writer.js's header docblock; this matrix entry then becomes the trigger for that hotfix.** |
| **V5-4** | **PENDING runtime** | Embed call count drops on idempotent re-sync. Observable via `wrangler pages deployment tail` while V5-2 runs: 2nd sync should produce zero `embedTextsBatch` invocations (entity_writer.js gates `toEmbed` on `inserted || changed`). |
| **V5-1** | **DEFERRED** | Fresh import → all `records_inserted`. Requires disconnect+reconnect of the Jira connection on production (destroys synced state). Confirmable separately if needed; not load-bearing for 9.5's correctness (the inserted-vs-updated classification is unchanged from pre-9.5; what's new is the updated-vs-skipped split). |
| **V5-6** | **DEFERRED** | Sweep catches missing embedding on a `skipped` row. Requires manual `entity_embeddings` DELETE in production + manual sweep trigger. Sweep path (`embedEntityRow` standalone) is untouched by 9.5 — decision C explicitly preserves the sweep recovery contract. PASS-by-inspection candidate; runtime probe deferred to Block 10 or later. |
| **V5-8** | **DEFERRED** | Full Block 6 matrix re-run. Sanity check that 9.5's SQL change didn't break Block 6's Jira-tools surface. Deferred — the upsert path's interface preserves the existing fields, the new `changed` field is additive in the return shape. If a Block 6 cell were to break it would be `records_*` counts only, observable directly via V5-2/V5-3. |

## Production verification (Jenny's next pickup)

V5-2 + V5-3 still owed. Run against `elinnoagent.com` per the script in
the chat handoff (Steps 4–10 of the verification step-by-step). Cells
update from PENDING-runtime → PASS-runtime once outputs are recorded
here. If V5-3 fails the exactness check, see CTE fallback in
[entity_writer.js](functions/_lib/connectors/_shared/entity_writer.js)
header docblock.

## Mid-flight fixes

None. Three commits + plan-lock commit landed inline per decisions A,
B, C with no fixup commits. Plan v1.0 holds; no amendments to
BLOCK_9_PLAN.md.
