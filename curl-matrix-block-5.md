# Block 5 — Curl Verification Matrix

Verification record for Block 5 (first AI answer). Run on the preview deploy
`https://block-5-first-ai-answer.elinno-agent.pages.dev` against branch
`block-5-first-ai-answer` (HEAD `8476e74` at run time, plus preview deploys
for each preceding commit).

## Fixture posture (per b1 close-out, 2026-05-10)

Plan v2.2 locked a ≥100-entity test-fixture prerequisite for S11
(golden-path agent answer) and S23 (input-token ceiling probe). The
2026-05-10 session chose **option b1 — lower the bar**: ship Block 5
with the existing 8-entity fixture from Block 4 and queue the
representative-scale verification for Block 9 (or earlier
between-blocks).

Cells marked **DEFERRED-per-b1** below are run at fixture=8 entities; the
verdict is therefore PASS-by-inspection-or-degraded-runtime, not full
plan-locked acceptance. See HANDOFF 2026-05-09 entry's "S11/S23
fixture-deferral" carry-forward and commit 16's closeout for the
revisit task.

## Phase A — Pre-flight

| Check | Verified |
|---|---|
| `ANTHROPIC_API_KEY` set in Pages → Production AND Preview | Pending Production confirmation; Preview ✓ via `/api/probe-bindings` (commit `f4ffde3`, response shape `{anthropic_api_key:{present:true,length_bytes:108}}`) |
| `OPENAI_API_KEY` set in Pages → Production AND Preview | Pending Production confirmation; Preview ✓ via probe (length_bytes=164). Key was rotated mid-session after a transcript-exposure incident — see HANDOFF 2026-05-09 entry. |
| API key probes against providers (local) | ✓ Anthropic returned 200 + "pong" (model claude-sonnet-4-5-20250929, input_tokens=8, output_tokens=5). OpenAI returned 200 + 1536-element embedding. |
| Pages binding probe (`/api/probe-bindings`) | Shipped + verified at `f4ffde3`; deleted at `b0de3e1`. |

## Phase B — Embedding pipeline

### S1 — Block 4 regression intact

`GET https://block-5-first-ai-answer.elinno-agent.pages.dev/api/db-health` → http=200

```json
{"ok":true,"one":1,"now":"2026-05-10T06:45:09.107Z","postgres_version":"PostgreSQL 17.8 (ad62774) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit","hyperdrive_host":"28126a59061c8015ed27741f890c4872.hyperdrive.local:5432"}
```

`GET /api/crypto-roundtrip` → http=200

```json
{"ok":true,"checks":{"encrypt_returned_shape":true,"algorithm_tag":"aes-256-gcm-v1","algorithm_tag_matches":true,"wrapped_data_key_length":60,"iv_length":12,"ciphertext_length":66,"ciphertext_is_not_plaintext":true,"roundtrip_matches":true,"aad_tampering_detected":true}}
```

**Result:** **PASS** — Block 3 envelope encryption + Block 1 db plumbing intact under Block 5.

### S2 — New entity → embedding row within ≤10s of webhook

**PENDING** — requires posting a Slack message and observing webhook ingestion + embed-on-write hook firing. Re-run when fixture lands.

Verifiable signals once a webhook event lands:
- `entities` row INSERT for the new message.
- `entity_embeddings` row INSERT with `model='openai/text-embedding-3-small'`, `chunk_index=0`, matching `entity_id`.
- Both within ~10s of the Slack post timestamp (network + embedding API latency).

### S2.5 — Webhook entity write with mismatched `metadata.project_id`

**PENDING** — needs synthetic webhook payload injection (a webhook payload that mutates `entity.metadata.project_id` to a different UUID before `embedEntityRow` runs). Block 9 candidate for an in-process test harness; v1.1 verifies by code-inspection of `embedEntityRow` at [slack.js:486](functions/_lib/connectors/slack.js:486).

**PASS-by-inspection:** the early-return at the top of `embedEntityRow` skips the embed write when `entity.metadata.project_id` is set and ≠ `projectId`, emitting `event: 'embedding_skip_project_id_mismatch'` warn-log.

### S3 — Backfill sweep idempotent

**PENDING** — re-run sync against the existing connection; assert `entity_embeddings` count unchanged.

### S4 — `message_changed` re-embeds

**PENDING** — edit a Slack message; observe the embedding row UPDATE on `(entity_id, chunk_index, model)`.

### S5 — `message_deleted` cascades

**PENDING** — delete a Slack message; observe the entity row DELETE plus FK-cascade on `entity_embeddings`.

### S6 — Block 4's pre-existing unembedded entities embed on first Block 5 sync

**PENDING** — trigger sync after commit 4 (post-sync sweep) is deployed; assert the 8 Block-4-era entities now have embedding rows. Sweep runs LIMIT 50 per call so all 8 fit in one pass.

## Phase C — Search layer

### S7 — Keyword-only ranked rows

**PASS-by-inspection** — `searchKeyword` ([search.js:30](functions/_lib/ai/search.js:30)) uses `plainto_tsquery + ts_rank_cd` against the existing `entities_fts_idx` GIN index ([db/schema-postgres.sql:312-317](db/schema-postgres.sql:312)). WHERE expression matches the index expression byte-for-byte; query goes through index, not seq scan.

### S8 — Vector-only ranked rows

**PASS-by-inspection** — `searchVector` ([search.js:78](functions/_lib/ai/search.js:78)) uses HNSW + `entity_embeddings_project_idx` pre-filter. Verified against schema at [db/schema-postgres.sql:333-381](db/schema-postgres.sql:333). `<=>` operator binds to `vector_cosine_ops` per index op-class.

### S9 — RRF fusion correct

**PASS-by-inspection** — `searchHybrid` ([search.js:127](functions/_lib/ai/search.js:127)) computes `1/(60 + rank)` per ranker, sums across both, last-writer-wins on row identity (vec preferred for chunk_text). Sub-limit = `max(limit*3, 30)` for headroom.

### S10 — Project scoping in search

**PASS-by-inspection** — All three search helpers filter `e.project_id = ${projectId}` (keyword) or `ee.project_id = ${projectId}` (vector); `searchHybrid` calls them with the trusted URL-bound `projectId`. `executeTool` ([tools.js:108](functions/_lib/ai/tools.js:108)) substitutes URL-bound `projectId` regardless of LLM input (D4b).

## Phase D — Agent loop end-to-end

### S11 — Golden path

**DEFERRED-per-b1** — fixture=8 entities. Re-run at ≥100 in Block 9 revisit.

For posterity, against current fixture: agent loop runs against Rain workspace's existing 8 entities. Most "what did we discuss about X" probes return 0 results and route to S13's no-citation path. Useful as a smoke test that the loop wiring works end-to-end; not as a representative-scale verification.

Re-run at ≥100 entities will record:
- `citations.length ≥ 1` ✓
- `model = 'anthropic/claude-sonnet-4-5'` ✓
- `iteration ≤ 6` ✓
- `total tokens > 0` ✓

### S12 — Citation `source_url` matches Slack permalink shape

**PASS-by-inspection** — `mapMessageToEntity` constructs `source_url` as `https://${team_domain}.slack.com/archives/${channel_id}/p${ts}` per Block 4 H. `executeTool` exposes `source_url` verbatim in the tool result; `loop.js`'s citation extraction copies it; UI's `renderCitationRailHtml` uses it as the chip href.

### S13 — Zero-result query → "I couldn't find that" copy

**PASS-by-inspection** — D11 system prompt's citation contract paragraph instructs the model to emit `"I couldn't find anything in this project's connected data about that"` when search returns nothing. UI handles `citations.length === 0` with `.muted` styling (commit 14).

Runtime verification at fixture=8 expected to land here for most probes; runtime verification at ≥100 entities will land here for genuinely unsearched topics.

### S14 — No-connections project → no Anthropic call, response stored with `model=null`

**PASS-by-inspection** — `runAgent` ([loop.js:107](functions/_lib/ai/loop.js:107)) checks `connections` count for the project before any Anthropic call; returns canned text + `db_turns: [{model: null, ...}]` on zero-result. POST handler persists the row with `model=null`.

Runtime verification: create a project with zero connections, send a message, observe DB row + spend telemetry. **PENDING** runtime check.

### S15 — Iteration cap stops at 6

**PASS-by-inspection** — `for (let i = 0; i < ITERATION_CAP; i++)` with `ITERATION_CAP = 6` at [loop.js:18](functions/_lib/ai/loop.js:18).

### S16 — Prompt-injection cross-project (non-member-passes-UUID)

**PASS-by-inspection** — `executeTool` substitutes URL-bound `projectId` regardless of LLM input. `searchHybrid`/`searchKeyword`/`searchVector` filter by the substituted projectId at the SQL layer. Cross-project leakage requires the model to bypass the substitution, which is impossible by construction.

### S16b — Multi-project user, in-chat injection

**PASS-by-inspection** — same mechanism as S16. The substitution happens server-side; the user's chat content cannot influence the SQL projectId clamp. D11 prompt also explicitly instructs the model to treat tool results as data, not directives.

### S16c — Mismatch log fires

**PENDING** — direct invocation of `executeTool` with `urlContext.projectId='A'` and `toolUse.input.project_id='B'`; assert WARN log line contains `event: 'tool_input_project_id_mismatch'` plus the four D4c fields (`conversation_id`, `url_project_id`, `llm_project_id`, `user_message_sha256_hex_16`). Block 9 candidate for an in-process test harness; v1.1 verifies by code-inspection at [tools.js:124](functions/_lib/ai/tools.js:124).

## Phase E — Auth/scoping

### S17 — Non-member 403

**PASS-by-inspection** — POST handler calls `requireProjectRole(request, env, params.id, 'member')` first. Existing helper handles 401 (no session) and 403 (not a member) byte-equal `{"error":"Forbidden"}`. No regression from Block 5 (commit 11 didn't touch the auth call).

### S18 — Anonymous 401

**PASS-by-inspection** — `requireProjectRole` returns 401 when no session cookie. Same helper as S17.

### S19 — Cross-project tool call 403

**PASS-by-inspection** — substitution in `executeTool` (D4b). Runtime side covered by S16/S16b. The model literally cannot reach another project; "403" framing is a category not a status code (data isolation, not access denial).

### S20 — Admin gets same response shape as member

**PASS-by-inspection** — `requireProjectRole(..., 'member')` accepts admin role too (admin ≥ member in the hierarchy). Response shape downstream is uniform.

## Phase F — Failure modes

### S21 — Anthropic 429 → user-friendly copy + DB row preserved, `model=null`

**PASS-by-inspection** — `createMessage` ([anthropic.js:31](functions/_lib/ai/anthropic.js:31)) retries 429 once, then throws `AnthropicError`. POST handler ([messages.js:225](functions/api/projects/[id]/conversations/[conversationId]/messages.js:225)) catches, warn-logs `event: 'agent_loop_failed'`, substitutes a single-turn `db_turns` with `AGENT_FAILURE_TEXT` and `model: null`. Row INSERT proceeds; UI renders `.error` state.

Runtime verification: synthesize 429 by exhausting your Anthropic per-minute cap or via a stub; confirm row is persisted with `model=null`. **PENDING** runtime check.

### S22 — OpenAI 429 on embed → sync still succeeds; sweep picks up gap on next run

**PASS-by-inspection** — `embedEntityRow` ([slack.js:486](functions/_lib/connectors/slack.js:486)) catches `EmbeddingError` and warn-logs without re-throwing. Sync's record-write phase completes; sweep ([slack.js:740](functions/_lib/connectors/slack.js:740)) picks up gaps on next sync.

**Closeout note:** if OpenAI 429s persist longer than the next sync interval (e.g., 10+ minutes during incident), the embedding gap persists until manual or webhook-triggered sync. Nightly scheduled sweep is a Block 9 follow-up; v1.1 accepts the bounded backlog risk.

### S23 — CPU envelope + measured `total_input_tokens` ceiling

**DEFERRED-per-b1** — fixture=8 entities. The probe query `"summarize everything we've discussed about the project"` against 8 messages exhausts in ~1 iteration; the worst-case 4+-iteration ceiling is not reached. Re-run at ≥100 entities in Block 9 revisit.

Probe spec for the eventual re-run (locked):
- Query: `"summarize everything we've discussed about the project"`
- Test fixture: ≥100 indexed Slack messages.
- Measurement: sum of each Anthropic response's `usage.input_tokens` across the iteration loop.
- Recording (this row, post-rerun): `total_input_tokens=<N>, iterations=<M>, query="..."`

CPU envelope (PASS-by-inspection): 6-iter cap × `max_tokens=1024` × top-10/600-char trim per tool result. With 6 iterations + 10 results × 600 chars each = ~36KB tool-result content max — well within Workers' 30s wall and Anthropic's per-call context.

## Phase G — UI smoke

### S24 — Citation chips render + click → opens Slack permalink

**PASS-by-inspection** — `renderCitationRailHtml` ([project.html:486](public/project.html:486)) emits `<a class="chat-citation" href="${source_url}" target="_blank" rel="noopener noreferrer">` per citation. `.chat-citation` styles in [auth.css:951](public/auth.css:951) render as pill chips with brand-tint background.

Runtime verification: visit a conversation with a real cited assistant turn; click a chip; confirm Slack permalink opens. **PENDING** runtime check (gated by S11 fixture).

### S25 — Placeholder banner gone (DOM check)

**PASS** — banner removed at commit 13 (`54b2dd1`). DOM no longer contains `.chat-placeholder-banner`; `auth.css` no longer defines the rule.

### S26 — Long answer wraps on 375px viewport

**PASS-by-inspection** — `.chat-msg-content` has `white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere;` ([auth.css:931](public/auth.css:931)). `.chat-msg` mobile media query at [auth.css:1140](public/auth.css:1140) caps `max-width: 95%`.

Runtime verification: open the chat in a 375px-wide viewport (DevTools mobile emulation), send a question, confirm long answer wraps cleanly. **PENDING** runtime check.

### S27 — Rapid resend single-fires (existing `inFlight` guard)

**PASS-by-inspection** — `inFlight` guard at [project.html:526](public/project.html:526) returns early on re-entry. Existing Block 2 mechanism, untouched by Block 5.

## Open follow-ups (carry into closeout)

- All **PENDING** rows above need runtime verification on the deployed preview before ff-merge to main. Jenny drives.
- **DEFERRED-per-b1** rows (S11, S23) are queued for Block 9 (or earlier between-blocks) re-run with ≥100-entity fixture.
- Production-env Pages secret confirmation is a hard gate before ff-merge.
