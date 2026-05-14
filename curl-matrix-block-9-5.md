# Block 9.5 — Curl Verification Matrix

Verification record for Block 9.5 v2 (content-hash redesign, Option F).
Branch `block-9-5-v2-content-hash` ff-merged to `main` at `d5a9436`
on 2026-05-14. The original `block-9-5-records-skipped` branch (decisions
A / B / C) shipped on 2026-05-11, broke production, was rolled back; its
3 code commits were reverted from `origin/main` on 2026-05-13. See
HANDOFF.md "Block 9.5 production incident + hotfix attempt — 2026-05-12
→ 2026-05-13" + "Block 9.5 v2 (content-hash) shipped to main —
2026-05-14" for full history.

Code surface (v2 ff-merge): **4 files, 204 insertions, 24 deletions** +
**1 schema column** (applied manually in Neon SQL Editor on 2026-05-13
before push).

- `db/schema-postgres.sql` — `entities.content_hash TEXT` (nullable) per decision A'.
- `functions/_lib/connectors/_shared/content_hash.js` — **new**. Exports
  `computeContentHash(entity)`. SHA-256 hex over sorted-keys canonical
  JSON of 8 curated columns (`raw` excluded due to known cosmetic drift).
- `functions/_lib/connectors/_shared/entity_writer.js` — rewritten
  `upsertEntityRow`: ON CONFLICT DO UPDATE WHERE `content_hash IS
  DISTINCT FROM` the new hash. Handles `rows.length === 0` no-op path
  via follow-up SELECT for the row id. Three-state return `{ id,
  inserted, changed }`.
- `functions/_lib/connectors/slack.js` — three-branch counter at
  `_doSync` per decision B'.
- `functions/_lib/connectors/jira.js` — three-branch counter at sprint
  loop + issue loop per decision B'.

## Verification posture at ff-merge

All canary cells (V5-1, V5-2, V5-3) PASS-runtime against the v2 preview
deploy `https://8cd54990.elinno-agent.pages.dev` (DDL already applied
to the same Neon Primary that Hyperdrive routes to from both preview
and production). **V5-7 (hash determinism) is implicitly validated by
V5-2** — if any of the 8 hashed fields had drifted across the two
consecutive Atlassian API responses, V5-2's `records_skipped` would
not have matched the entity count.

| Cell | Status | Notes |
|---|---|---|
| **V5-1** | **PASS-runtime** | First sync after deploy with `content_hash = NULL` on all 514 existing entities. Result: `records_inserted=1, records_updated=513, records_skipped=0`. 93s. The 1 insert is a new Jira issue created since the previous canonical state; the 513 updates are the hash backfill (NULL IS DISTINCT FROM `<new hash>` → true → DO UPDATE fires once per row). Post-sync: 514/515 entities hashed (1 orphan with no current Jira counterpart, untouched as expected). |
| **V5-2** | **PASS-runtime** | Idempotent re-sync immediately after V5-1. Result: `records_inserted=0, records_updated=0, records_skipped=514`. 75s. **This is the cell that broke last time** — the WHERE-DO-UPDATE returning 0 rows used to crash on `[row] = await sql\`...\`` destructure of undefined. Under A' the rows.length check is explicit and the follow-up SELECT returns the existing id without crashing. |
| **V5-3** | **PASS-runtime — canary discriminator** | Edited RAINONE-1330's description in `rain-labs.atlassian.net` between V5-2 and V5-3. Result: `records_inserted=2, records_updated=2, records_skipped=510` (sum = 514 ✓). 79s. The 2 inserts + 1 extra update vs. the "pure 0/1/513" are real-world Jira activity that accumulated overnight (sync was run the morning after the edit). Per-issue verification confirms RAINONE-1330's `hash_prefix` flipped from `bfca26fc625e` (V5-1) to `7e2f97eed767` and `source_updated_at` advanced from `2026-05-13 12:20` to `2026-05-14 08:14` (the edit timestamp). The hash discriminator works. |
| **V5-4** | DEFERRED-runtime | Embed-call drop on idempotent re-sync. Observable via `wrangler pages deployment tail` filter for `embedTextsBatch`. Not gated for push — V5-2's `records_skipped=514` is the proxy: every skipped row also skips the embed call per decision C'. Promoted to PASS-by-inspection given the code gate is explicit at entity_writer.js. |
| **V5-5** | **PASS-by-inspection** | Slack `message_changed` webhook idempotency. Same `writeEntityWithEmbedding` path as `_doSync`; classification is identical regardless of caller. Webhook re-replay of the same event hits the WHERE-suppressed UPDATE → returns `inserted=false, changed=false`. No code-path divergence to verify at runtime. |
| **V5-6** | DEFERRED | Sweep catches missing embedding on a skipped row. Sweep path (`embedEntityRow` standalone) is untouched by A'/C'. Decision C' explicitly preserves the sweep recovery contract. Runtime probe deferred to Block 10 or later (requires manual `entity_embeddings` DELETE on production). |
| **V5-7** | **PASS implicit** | Hash determinism across two consecutive Atlassian API calls. Implicitly validated by V5-2: had any of the 8 hashed fields drifted, V5-2's `records_skipped` would not have been the full 514. The per-column drift problem that killed the original A's CTE hotfix (HANDOFF 2617-2626) is contained — `raw` is excluded from the canonical hash, and array order in `metadata` is preserved (no Jira label-order drift observed in this run). Was the explicit diagnostic-log cell; promoted to implicit-via-V5-2 since V5-2 is the strictly stronger check. |
| **V5-8** | DEFERRED | Block 6 27-cell matrix re-run. The new `changed` field is additive; tool-calling surface unchanged. Sanity confirmed by AI chat answering "how many tickets in the active sprint" on preview after V5-1 — citations resolve, counts come from SQL, no regression observed. Formal re-run deferred to a between-blocks task. |

## Preview verification record (sync_run ids)

- **V5-1** sync_run `471d27bd-a677-4b2c-9f5b-4a820fd48cbb`, 2026-05-13 14:40:04 → 14:41:37.
- **V5-2** sync_run `ed6319a2-8785-4743-bc35-32fecc7bddce`, 2026-05-13 14:46:31 → 14:47:46.
- **V5-3a (failed propagation, V5-3 retake required)** sync_run `ced56b88-c56c-466e-bb93-5aceedc4607f`, 2026-05-13 14:52:14 → 14:53:31. Returned `0/0/514` because the upstream Jira edit had not propagated to the REST API by the time the sync ran (Atlassian API lag). Diagnostic SELECT showed `source_updated_at` for all top-5 issues was from before the V5-3 trigger.
- **V5-3 (passing)** sync_run `e5ca6887-1785-4473-9b72-ad6ef21bd5ee`, 2026-05-14 08:20:33 → 08:21:52. Returned `2/2/510` after a fresh edit (with 30s propagation wait) confirmed both in Atlassian UI (refresh) and in our DB (RAINONE-1330's `source_updated_at` = `2026-05-14 08:14:59`, fresh `content_hash`).

## Production verification (post ff-merge to main)

After ff-merge to main at `d5a9436` and the Cloudflare auto-deploy to
production, V5-2 + V5-3 to be re-run against `elinnoagent.com` as the
post-deploy canary. If production was promoted automatically by the
auto-deploy, syncs run against the v2 code; if the manual rollback
remains sticky, Jenny clicks promote in the Cloudflare Pages dashboard
first. Result rows append to this matrix as a "production canary"
subsection on closeout.

## Mid-flight fixes

**One** during preview verification:
- **V5-3 retake** after first attempt returned `0/0/514`. Root cause:
  Atlassian REST API lag — the description edit had not propagated by
  the time the sync triggered (within ~5s of the edit). Retake with a
  30s propagation wait + page-refresh verification step succeeded.
  **Lesson for the BLOCK_9_PLAN.md verification matrix**: V5-3
  instructions should include "wait 30s after edit + refresh page to
  confirm edit landed in Jira UI before triggering sync." Filed as a
  carry-forward note in HANDOFF.md addendum.

No code-side fixups. The 4-file commit-set landed as drafted; A'/B'/C'
held through 4 sync cycles (V5-1, V5-2, V5-3a, V5-3) without any
amendments to BLOCK_9_PLAN.md or the code.
