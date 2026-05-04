# Block 4 — Slack Connector · Build Plan

| Field | Value |
| ----- | ----- |
| Document | Block 4 Build Plan v1.0 |
| Block | Block 4 of 9 (per BUILD_PLAN.md) |
| Companion to | BUILD_PLAN.md, PRD.md, HANDOFF.md, WORKFLOW.md |
| For | Solo build with Claude Code |
| Generated | 2026-05-04 (Block 4 design session, post-Block-3-closeout) |
| Mode | DEFAULT (security carve-out — OAuth + webhooks; per WORKFLOW.md §"Work that doesn't fit the plan→auto rhythm") |

## How to use this document

This file is the locked design for Block 4. Drop it (with `HANDOFF.md`,
`WORKFLOW.md`, `PROJECT.md`) into a fresh Claude Code session at the start
of any Block 4 working session. It contains:

- Block 4 deliverables and done-when criterion
- Every design decision locked (so Claude Code doesn't re-litigate)
- Schema migrations (lands in commits 3 + 6, applied by Jenny via Neon SQL Editor)
- Ten-commit work order
- Verification matrix gating ff-merge to main

Workflow per session, per WORKFLOW.md:
1. Open Claude Code with this file + HANDOFF.md + WORKFLOW.md as context.
2. Tell Claude Code which commit (1–10) you're working on.
3. Default mode: per-action review on every diff before approving the commit.
4. End the session with the trunk green and HANDOFF.md updated.

Block 4 is a single branch (`block-4-slack-connector`) with no sub-branches.
Sessions are scoped by commit number, not by branch.

## Context

Block 3 closed 2026-05-04. The connector framework, envelope encryption helper
([functions/_lib/crypto.js](functions/_lib/crypto.js)), dummy connector, and
connections HTTP API are live in production. The Connections tab in
[project.html](public/project.html) is the Block 2 placeholder.

Block 4 builds the **first real connector** (Slack), which:
1. Stress-tests the framework with real OAuth + real webhooks. The Block 3
   `POST /api/projects/:id/connections` handler 501-stubs the OAuth path;
   Block 4 wires it up and surfaces whatever the framework got wrong.
2. Lights up the first "Connect Slack" button in the Connections tab.
3. Prepares the ground for Block 5 — once Slack messages land in `entities`,
   the AI agent has data to search.

Per [BUILD_PLAN.md:95](BUILD_PLAN.md), done-when:
> You connect Slack to a project, post a new message in your test channel,
> and see it appear in the `entities` table within seconds.

## What Block 4 delivers

Mapping BUILD_PLAN §Block 4 onto the Block 3 framework:

1. **Slack app registration** (Jenny's hands, before commit 4 lands).
2. **Slack OAuth install flow** — refactor `connections/index.js` to handle
   `authUrl`-returning `startAuth`; new `/start` and `/callback` endpoints.
3. **Channel listing** — admin picks a test channel post-connect (G).
4. **Backfill** — `fullSync` pulls recent messages into `entities` (E/E2/E3, H, I).
5. **Slack Events API webhook handler** — real-time ingestion (D, D1–D4, F, F1, F2).
6. **`slack_messages` SQL view** over `entities` for fast lookups (J).
7. **Connect Slack UI** in the Connections tab (K, L).

## Block 3 drift findings (folded into V2 design and verification)

Three items found vs BLOCK_3_PLAN.md by reading the four framework files
([types.js](functions/_lib/connectors/types.js), [dummy.js](functions/_lib/connectors/dummy.js), [registry.js](functions/_lib/connectors/registry.js), [crypto.js](functions/_lib/crypto.js)):

1. **`registry.js` exports `isKnownSource(source)`** in addition to K's
   `getConnector` / `listConnectors`. Additive; used by the connections POST
   refactor (commit 3) and G's bespoke endpoint validation. No revision; the
   helper is good.
2. **`dummy.js` fixture entities carry `metadata.index: 1|2|3`.** Additive;
   verification-only. Same value-pinning convention informs N's error-string
   substring assertion.
3. **`crypto.js` applies AAD to BOTH the DEK wrap AND the credential
   encryption.** Block 3 strengthening over decision B's letter; documented
   in [crypto.js:13](functions/_lib/crypto.js) but not BLOCK_3_PLAN.md.
   **Load-bearing for C1's failure-mode argument.** Plan should match the
   helper — separate doc-only addendum to BLOCK_3_PLAN.md ships as its own
   commit AFTER Block 4 closes (Open follow-ups).

## Pre-Block-4 prerequisite (its own PR)

The deferred [admin/users.js](functions/api/admin/users.js) +
[admin/users/[id].js](functions/api/admin/users/[id].js) migration to
`requireWorkspaceAdmin` (Block 2 → 3 → 4 carry-over) ships as its **own
pre-Block-4 PR**, with its own plan, approval, and merge — not on the Block 4
branch. Reason: behavior-identical refactor that's independently shippable;
if Block 4 hits a snag and the branch needs a roll-back we shouldn't also be
rolling back unrelated cleanup. Includes the POST 200→201 fix on user-create.
Block 4 work starts on a clean trunk after this lands.

## Execute mode: DEFAULT (security carve-out)

Per [WORKFLOW.md:217-227](WORKFLOW.md), Block 4 is a security carve-out on
two dimensions: OAuth callbacks (token exfiltration risk) and webhook
handlers (signature verification + replay protection). **Default mode with
per-action review for the entire block** — even non-carve-out pieces
(channel listing, entity mapping, view migration, UI). A first-real-connector
block surfaces framework bugs that can't be predicted upfront, so keeping
every commit eyeballed is cheaper than re-flagging mid-block.

Files in carve-out categories carry a `// SECURITY-CARVE-OUT: do not edit in
auto mode` comment at the top.

**Carve-out-treatment expansion (forward-looking).** Future blocks:
decisions touching credential decryption frequency, freshness-layer
signals, or PRD §3 project-isolation get carve-out treatment by default,
not just decisions on the carve-out list. The carve-out list is a lower
bound on which decisions need per-action review, not a ceiling. Block 4's
experience with E2 (freshness contract reframed as a security-adjacent
concern), F (single-team_id project isolation), and N (data-path AAD test
through consumer code) showed that non-carve-out-listed decisions can
carry carve-out-grade failure modes. Block 5+ plans should default to
flagging any of those three classes for carve-out treatment, even if
they're "just" data-path or freshness.

---

## Locked design decisions

Block 3 was A–R; Block 4 lands at A–P with sub-letters (C1/C2/C3, D1–D4,
E2/E3, F1/F2). Each carve-out decision (C1/C2/C3, D1/D2/D3/D4, F1/F2, K, N)
includes a **specific failure mode the lock prevents** — the discipline
mirrors Block 3's verification matrix's silent-failure-mode framing.

### A. App distribution model — single-workspace install for v1.1

The Slack app is configured as an internal/single-workspace install in
Jenny's developer account. Slack's "Distribute App" flow stays disabled.
Install flow exercised against Jenny's test workspace only.

**v1.2 prerequisite:** before any non-Jenny customer can connect their
workspace, Distribution must be enabled in app settings, and Slack-side
review is required (cumulative scope additions feed into that review).
Tracked as a v1.2 prerequisite, not a v1.1 deliverable.

**Rationale:** ships v1.1 without Slack-side review friction.
**Tradeoff:** each new customer workspace until Distribution requires
Jenny to walk the install flow herself.

### B. OAuth scope set — `channels:read`, `channels:history`, `users:read`

v1.1 requests three bot scopes:
- `channels:read` — list public channels and read membership
- `channels:history` — read message history of channels the bot is in
- `users:read` — read basic user profile info (`display_name`, `real_name`,
  `id`) for citation rendering

No `groups:*`, `im:*`, `mpim:*`, `users:read.email`, or any other scope.
Slack app bot-scope configuration matches this set exactly.

`users:read` is added now as a **Block 5 prerequisite** — Block 5's
first-AI-answer milestone needs human-readable citations ("Jenny said..."
not "U0123 said..."). Adding it during Block 5 would force every Block 4
connection to re-install. P's install URL spec is unaffected
(`user_scope` still omitted entirely; the addition is to `scope`, the bot
scope list).

**Rationale:** matches PRD §3 "channel messages"; small breach blast
radius (no message-write, no DMs, no email addresses); `users:read` is
unsurprising and load-bearing for Block 5 citation utility.
**Tradeoff:** private channels (`groups:*`) deferred to Block 9 / v1.2.

### C1. Schema invariant for pending OAuth-state rows — migration allows NULL encryption columns at `status='pending'`, plus CHECK constraint enforcing presence at non-pending status

One migration file `db/migrations/2026-MM-DD-pending-oauth-state.sql` (date
pinned at commit-3 commit-day) bundles C1 + C3 changes; applied by Jenny
via Neon SQL Editor between commit 3 and commit 4 — same pattern as
Block 3's algorithm-tag migration.

```sql
ALTER TABLE connections
  ALTER COLUMN wrapped_data_key       DROP NOT NULL,
  ALTER COLUMN iv                      DROP NOT NULL,
  ALTER COLUMN ciphertext_credentials  DROP NOT NULL;

ALTER TABLE connections
  ADD CONSTRAINT connections_encryption_present_when_active
  CHECK (
    status = 'pending'
    OR (wrapped_data_key IS NOT NULL
        AND iv IS NOT NULL
        AND ciphertext_credentials IS NOT NULL)
  );

-- C3's column lands in the same migration; see C3's section.
```

**Rationale.** AAD is applied to BOTH the DEK wrap AND the credential
ciphertext (Block 3 strengthening; drift item 3). The placeholder-bytes
alternative — write fake bytes at startAuth INSERT, real bytes UPDATEd at
callback — creates a write window where AAD attests "this placeholder is
bound to (id, project_id, source)," proving nothing about the eventual real
credential. Allowing NULL keeps the AAD invariant: a row either has full
encrypted credential under valid AAD, or has nothing. The CHECK constraint
adds a second invariant: no row can drift to `status='active'` without
encryption columns populated.

**Specific failure mode the lock prevents:** a two-write-against-same-AAD
pattern in which the binding window doesn't hold. With placeholder bytes,
the AAD on the row at insert time attests to context (id, project_id,
source) being bound to placeholder ciphertext; if between INSERT and UPDATE
an attacker (or a code bug) substitutes different bytes, AAD validation
against the substituted bytes can succeed using the same triple — because
AAD attests the triple, not the credential identity. NULL-allow + CHECK
forces "no encrypted bytes ever sit in the row under invalid binding"; the
"real credential bound to real context" invariant is preserved end-to-end.

### C2. OAuth state single-use enforcement — server-side via SELECT-then-UPDATE on `status='pending'`, both filtered; UPDATE is the only true barrier

Callback handler shape:
```js
// Step 1: courtesy SELECT (NOT the barrier). Exists only because C3's
// session-match and AAD construction need columns from the row. If a
// future refactor inverts the order, the UPDATE alone still enforces
// single-use — the SELECT was never the barrier.
const [row] = await sql`
  SELECT id, project_id, source, initiated_by_user_id
  FROM connections
  WHERE id = ${state} AND status = 'pending' AND deleted_at IS NULL
`;
if (!row) return forbidden();  // 403-collapse

// ...verify session match (C3), exchange code with Slack, encrypt token...

// Step 2: atomic flip. THIS is the single-use barrier. WHERE status='pending'
// is what makes the second-callback case match zero rows.
const [updated] = await sql`
  UPDATE connections
  SET status                  = 'active',
      wrapped_data_key        = ${enc.wrapped_data_key},
      iv                      = ${enc.iv},
      ciphertext_credentials  = ${enc.ciphertext},
      encryption_algorithm    = ${enc.algorithm},
      external_account_id     = ${team.id},
      credential_metadata     = ${meta}
  WHERE id = ${state} AND status = 'pending'
  RETURNING id
`;
if (!updated) return forbidden();  // 403-collapse
```

**Rationale.** Slack's own protection burns the `code` parameter on first
exchange, so a same-state-same-code replay is rejected at Slack's
`oauth.v2.access` regardless of what we do server-side. The UPDATE-filtered-
on-pending barrier covers two failure modes Slack's defense does NOT:
1. **State replay with a different code.** An attacker who captures
   `state` (Referer, history, logs) but supplies a DIFFERENT valid code
   from their own initiated flow could otherwise burn the row's pending
   state. The UPDATE filter prevents the row from being mutated.
2. **Race between two near-simultaneous legitimate completions.** Two
   callbacks for the same state arriving within milliseconds (opened-twice
   tab, double-click) both pass the pre-flight SELECT before either has
   UPDATEd. Postgres serializes the row's status transition; the UPDATE
   filter ensures only one wins.

The 403-collapse on both `if (!row)` and `if (!updated)` returns byte-
identical responses, mirroring Block 2 decision Q.

**SELECT is courtesy, NOT barrier.** The SELECT exists only because C3's
session match and AAD construction need columns from the row. If a future
refactor inverts the order, the UPDATE alone still enforces single-use.
Conversely, anyone "tidying up" by removing the WHERE-pending filter on
UPDATE because "the SELECT already filters" would silently break single-use.
Inline code comment in the callback handler makes this load-bearing to a
2027 reader.

**Specific failure mode the lock prevents:** authorization-code / state
replay leading to credential overwrite or duplicate active connection.
Two sub-modes covered (state replay with different code; race between
near-simultaneous legitimate completions). The 403-collapse hides whether
the row existed, was wrong, was already consumed, was soft-deleted, or was
raced to second place.

### C3. Initiated-by-user binding — new `initiated_by_user_id` TEXT column; callback verifies session match

Schema migration (same file as C1):
```sql
ALTER TABLE connections
  ADD COLUMN initiated_by_user_id TEXT;
```
- Cross-DB seam: TEXT, no FK to D1, populated as `String(session.id)`.
- Nullable: NULL for non-OAuth connectors (dummy stays NULL; preserves
  backward compatibility on existing rows).
- Stays populated after the row flips to `active` — audit data. **NOT** on
  `CONNECTION_PUBLIC_COLUMNS` for v1.1 GET responses (admin-only if ever
  exposed). **NOT** credential-bearing; not under the AAD invariant.

startAuth handler (`functions/api/connectors/slack/oauth/start.js`):
```js
const session = await getSessionUser(request, env.DB);
// requireProjectRole(admin) on projectId already passed
const state = crypto.randomUUID();
await sql`
  INSERT INTO connections (
    id, project_id, source, status,
    display_name, external_account_id,
    initiated_by_user_id
  ) VALUES (
    ${state}, ${projectId}, 'slack', 'pending',
    'Slack', '',  -- placeholder external_account_id; UPDATEd in callback
    ${String(session.id)}
  )
`;
// ...build authUrl per P, return 302 to Slack consent...
```

Callback flow (extends C2's SELECT result):
```js
// C2's SELECT already loaded row.initiated_by_user_id
const session = await getSessionUser(request, env.DB);
if (!session || String(session.id) !== row.initiated_by_user_id) {
  return forbidden();  // 403-collapse; row stays pending so original initiator can retry
}
// ...continue to C2's UPDATE
```

**Specific failure mode the lock prevents:** OAuth-completion CSRF
(canonical "OAuth login CSRF"). Attacker initiates an OAuth flow against
their own elinno-agent project from their own browser, producing a pending
row with `initiated_by_user_id = attacker.id`. Attacker does NOT complete
the flow themselves; they trick a victim (phishing, malicious page,
cross-site iframe) into completing it from the victim's elinno-agent
session. Without C3, the callback can't distinguish "the admin who
initiated is completing" from "a different admin is completing someone
else's pending row" — token exchange succeeds, attacker's project gets the
victim's Slack workspace connected. With C3, the callback compares
`session.id` against `row.initiated_by_user_id`; mismatch is 403-collapse
with the row staying pending. The Block 4 UI separately mitigates the
related "victim doesn't realize they're connecting to attacker's project"
social-engineering vector by initiating Connect Slack from within a
specific project page; C3 is the server-side guarantee that holds even if
the UI is bypassed.

### D. Webhook signature verification placement — inline in `slack.js`

No shared `_lib/webhook-verify.js`. Slack-specific HMAC verification,
timestamp window check, and reject path live alongside the Slack handler
in the connector module.

**Rationale:** v1.1 has one webhook-bearing connector; speculative
abstraction risk. When Block 6 (Jira) adds webhooks (different signing
scheme — likely HMAC over different inputs), the abstraction can be
extracted from two real call sites with no guesswork.
**Tradeoff:** Block 6 has small upfront cost to extract if the patterns
are similar. Net cheap.

### D1. Constant-time HMAC comparison — `crypto.subtle.verify('HMAC', ...)` only

No `===` on hex digest strings. No reimplemented `safeEqual` byte-by-byte
loop. The only acceptable verification is SubtleCrypto's `verify`
operation, which is constant-time by contract.

```js
const signingKey = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(env.SLACK_SIGNING_SECRET),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['verify']
);

const sigHeader = request.headers.get('X-Slack-Signature') ?? '';
if (!sigHeader.startsWith('v0=')) return forbidden();
const sigBytes = hexToBytes(sigHeader.slice(3));  // small inline helper

const baseString = `v0:${tsHeader}:${rawBody}`;
const ok = await crypto.subtle.verify(
  'HMAC',
  signingKey,
  sigBytes,
  new TextEncoder().encode(baseString)
);
if (!ok) return forbidden();
```

The signing key is imported per request. Caching by isolate is Block 9
polish.

**Specific failure mode the lock prevents:** timing-side-channel signature
forgery. JavaScript's `===` and naive byte loops short-circuit on first
mismatch; the time difference between "first byte wrong" and "first 31
bytes right, last byte wrong" is small but measurable across many requests.
An attacker repeatedly forging signatures against an `===`-based verifier
can binary-search the correct HMAC byte-by-byte. SubtleCrypto's `verify` is
constant-time by contract; reimplementations are bug-prone (early-out on
length mismatch, V8 optimizations on hot paths) and unreviewable in PR
diffs without a benchmark harness. The lock forbids both `===` AND any
helper that "compares byte-by-byte without short-circuit"; the only
acceptable verification is `crypto.subtle.verify`.

### D2. Timestamp window — symmetric ±5 minutes; stale and future-dated fail identically

```js
const now = Math.floor(Date.now() / 1000);
const tsHeader = request.headers.get('X-Slack-Request-Timestamp');
const ts = parseInt(tsHeader ?? '', 10);
if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return forbidden();
```

Window is 300 seconds (Slack's recommendation), applied symmetrically.
Same status code and byte-identical response body for both stale and
future-dated; S15 in the verification matrix asserts on the byte equality.
Missing or non-numeric header rejects via the same `!Number.isFinite(ts)`
clause.

**Specific failure mode the lock prevents:** two failure modes covered:
1. **Replay beyond the window.** A captured webhook request, replayed
   later, presents an old (correctly-signed-against-its-original-ts)
   signature. The window cap makes signature validity time-bounded.
2. **Clock-skew side channel.** A defender who only checks staleness
   (`now - ts > 300` rather than `Math.abs`) leaks server-clock state via
   a differential. Over many probes, an attacker characterizes the
   server's clock-skew tolerance, narrows the replay window, or uses the
   differential as a clock oracle. Symmetric rejection with byte-identical
   response closes the channel.

### D3. Raw body fidelity — read text → verify → JSON.parse(text); same bytes for verify and dispatch

```js
const rawBody = await request.text();
// ...D2 timestamp check...
// ...D1 HMAC verify with baseString = `v0:${tsHeader}:${rawBody}`...
// ...only AFTER both pass:
let body;
try {
  body = JSON.parse(rawBody);
} catch (parseErr) {
  // Post-verify parse failure: signed body that doesn't parse. Should
  // never happen. Log rawBody (allowed post-verify) plus marker for ops
  // alerting; same 403 response as every other rejection path so D4's
  // single-canonical-observable contract holds.
  console.error('slack:post_verify_parse_failure', { rawBody, error: parseErr?.message });
  return forbidden();
}
```

The handler reads body bytes ONCE into a string and uses that string both
as HMAC base-string substrate AND as `JSON.parse` input. Re-stringifying
parsed JSON for any subsequent verification, comparison, or logging is
forbidden — JSON re-stringification is not byte-stable across engines or
options.

Order is locked: **read → verify → parse**. Never the reverse. Never
log the rawBody before verification clears.

**Post-verify parse failure handling.** If `JSON.parse` throws AFTER a
successful verify, that's operationally interesting. Log + return
`forbidden()` (same 403 as every other rejection path). Ops signal lives
in logs, NOT in response shape — preserves D4's single-canonical-
observable contract while surfacing the anomaly through the channel ops
actually monitors.

**Specific failure mode the lock prevents:** verification-vs-dispatch
byte divergence. Two sub-modes:
1. **False rejects from byte non-fidelity.** Parse-then-stringify-then-
   verify can fail intermittently as engines/options change; legitimate
   Slack requests fail verification, and the codebase carries an opaque
   "signatures sometimes fail" bug that future developers chase by
   relaxing the verifier — eroding the security boundary.
2. **Verifier-vs-dispatcher divergence (Stripe 2018 attack class).** HMAC
   verifies against the canonical re-stringified form while the dispatcher
   operates on the originally-parsed object. An attacker who constructs
   JSON that round-trips lossily through `parse → stringify` (duplicate
   keys, weird escapes, non-canonical Unicode) produces a body where the
   re-stringified form is benign-and-correctly-signed, but the
   originally-parsed form contains attacker-controlled content the
   verifier never saw. Read → verify → parse on the SAME bytes eliminates
   the class.

### D4. Reject-before-dispatch — signature failure short-circuits everything; one canonical 403 observable

On any signature, timestamp, or header malformation failure (D1, D2,
missing `X-Slack-Signature`, missing `X-Slack-Request-Timestamp`,
malformed `v0=` prefix, malformed hex, body-read failure, plus D3's
post-verify parse failure), the handler returns 403 with **none of**:
- DB write (no `sync_runs` row, no `entities` write, no log row except
  D3's post-verify-parse case which writes to logs only, not DB)
- JSON parse of the body (D3 handles parse-after-verify)
- Dispatch decision (no read of `body.type` or `body.event.type`)
- External API call

One verbatim 403 response for all rejection paths:
```js
function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}
```

**D3 + D4 are a complementary pair.** D3 closes BYTE-level divergence —
verifier and dispatcher operating on different bytes (Stripe-2018 attack
class). D4 closes CONTROL-FLOW divergence — different rejection paths
producing different observables ("log raw body for audit" attack
surfaces). Both are needed because closing one doesn't close the other;
the pair framing makes both visible in PR review and resistant to "tiny
ergonomic addition" drift.

**Specific failure mode the lock prevents:** asymmetric rejection paths
grow injection bugs. Classic pattern: "reject early if signature missing"
produces a 403 before parse, but "reject if signature wrong after parsing"
passes through `JSON.parse` first; unsigned-malformed JSON now hits a
different code path than signed-malformed JSON. An attacker observing the
differential (timing, error shape, side effects like a brief log entry or
DB row before the 403) gets a probe vector for distinguishing rejection
modes — fingerprint server state, trigger expensive code paths, write to
log surfaces read by ops dashboards or LLM-powered triage. The
reject-before-dispatch lock collapses every rejection mode into a single
canonical observable: `403 {"error":"Forbidden"}`, no side effects in the
HTTP response, ops-side anomalies via logs only.

### E. Sync execution model — synchronous inline for v1.1; document Queues upgrade path

Block 4 sync handler runs `fullSync`/`incrementalSync` inline in the
request, same as Block 3's
[sync.js](functions/api/projects/[id]/connections/[connId]/sync.js).
The handler creates the `sync_runs` row, calls the connector, updates the
row, returns. No Cloudflare Queues, no DLQ, no separate Worker.

`sync.js`'s existing header comment gets a one-line Block 4 update: Slack's
backfill cap (E3) keeps inline viable for v1.1 even on busy channels;
Queues stays documented as the v1.2 upgrade path.

**Rationale:** Queues adds binding + DLQ + Worker code; ship v1.1 first.
30s CPU limit + E3's cap keep inline viable for Slack.
**Tradeoff:** any future connector with backfill that can't fit in 30s
under a similar cap will need either a tighter cap or the Queues upgrade.

### E2. Rate-limit handling on Slack 429 — read `Retry-After`; sleep-and-retry if it fits CPU budget, abort with structured failure if not

On 429 from `conversations.history`:
- Read `Retry-After` header (seconds, integer).
- Track elapsed CPU time via `performance.now()` at `fullSync` entry,
  deltaed at retry decision.
- If `Retry-After + elapsed_so_far <= ~25s`: sleep `Retry-After * 1000`
  ms, retry the same paginated call.
- Else: abort the sync. Mark the sync_run row:
  ```js
  {
    status: 'failed',
    error: `rate_limited: Retry-After=${retryAfterSec}s`,
    records_inserted: <in-memory count of entities written before the limit>,
    records_updated:  <in-memory count of entities upserted before the limit>,
    detail: {
      reason: 'rate_limited',
      retry_after_seconds: retryAfterSec,
      records_so_far: <inserted + updated>,
      recommendation: 'Re-run sync after Retry-After elapses; cursor resumes from the last paginated page.'
    }
  }
  ```
- Linear backoff between paged calls when no 429 hit; sleep ~250ms
  between pages.

**5s margin rationale.** The 25s budget threshold (vs 30s CPU limit) is
generous enough to absorb Neon round-trip + closing logic + response
serialization, deliberately not optimized — abort-path correctness matters
more than abort-path latency.

**`records_so_far` accuracy.** Counts are tracked in-memory during sync;
never re-queried from the database on the abort path. Querying back would
create a second failure mode (the abort path itself can fail or time out,
leaving the sync_run row inconsistent). Code comment in `slack.js`'s sync
code makes this load-bearing.

**Specific failure mode the lock prevents:** freshness-layer inconsistency.
PRD §5.6 commits to "data as of [timestamp] per source cited" and §5.9
surfaces it on every AI response. A rate-limited partial sync that marks
itself succeeded (or leaves itself in `running`) causes the freshness
layer to report stale-as-fresh — user gets a confident "5 minutes ago"
timestamp on data missing 70% of yesterday's messages, with no way to
know. Block 5's AI tool layer inherits the lie because it builds on
`last_sync_at` and `sync_runs.status`. Structured failure with
`error='rate_limited:...'` and accurate in-memory `records_so_far` is what
makes PRD §5.6's freshness contract honest end-to-end. This is the actual
security-adjacent concern, not just immediate-sync correctness.

### E3. Backfill cap enforcement — API-call-shape; deterministic stopping conditions; cap-hit signaled in `sync_runs.detail`

```js
slackApi.conversations.history({
  channel,
  oldest: Math.floor(Date.now() / 1000) - 30 * 86400,  // 30-day floor
  limit: 200,                                            // Slack's max page
  cursor: <next_cursor or undefined>,
});
```

Stopping conditions (first to fire):
- 5 paginated calls completed (5 × 200 = 1000 message ceiling).
- A page returns < 200 records (Slack convention: last page).
- Hard ceiling: ~1000 messages, ~30 days, whichever is smaller in practice.

Cap is enforced at API call shape, NOT by fetching unlimited then slicing
post-fetch. Server-side `oldest` clamps the time window; `limit=200` is
Slack's max page size; the 5-page stop-after counter caps total volume.

**Cap-hit signaling.** When the 5-page stop fires before the time window
is exhausted, the sync `status='succeeded'` but coverage is partial.
Record in `sync_runs.detail`:
```json
{
  "cap_hit": true,
  "cap_pages": 5,
  "cap_records": 1000,
  "oldest_synced_ts": "<the ts of the oldest message we wrote>"
}
```
Block 5's freshness layer reads `detail.cap_hit` and `oldest_synced_ts`
to communicate "data as of `<oldest_synced_ts>` for older messages"
rather than reporting `last_sync_at` for content beyond the cap.

**Rationale:** cheaper than over-fetch-then-slice; respects Slack rate
limits; deterministic stopping conditions make sync runtime predictable;
cap-hit signal preserves PRD §5.6 freshness honesty.
**Tradeoff:** an active channel with > 1000 messages in 30 days has older
content invisible to v1.1; configurable per-channel cap is Block 9 polish.

### F. Webhook ingestion path — inline write with 2.5s budget; single connection per Slack `team_id` (v1.1)

The Events API webhook handler processes events inline, completing within
2.5s (0.5s margin under Slack's 3s acknowledgement deadline). The handler:

1. Reads body bytes (D3).
2. Verifies signature + timestamp window (D1, D2, D4).
3. Branches on `body.type` — F1 for `url_verification`, F2 for
   `event_callback`.
4. For `event_callback` with a message-shaped event (`message`,
   `message_changed`, `message_deleted`, `thread_broadcast`): looks up
   the **single active connection** matching
   `source = 'slack' AND external_account_id = body.team_id AND status = 'active' AND deleted_at IS NULL`,
   decrypts the bot token, UPSERTs/DELETEs one entity, returns 200.
5. **If the lookup returns >1 active connection for the same `team_id`:
   500 with the multi-row event logged for ops alerting.** Schema-permitted
   but v1.1-unsupported state.

No Cloudflare Queues. No deferred processing. No "ack-and-defer."

**Rationale.** v1.1's project-isolation contract (PRD §3) treats one
Slack workspace as belonging to one elinno-agent project. The schema
permits multi-project-per-workspace for v1.2 (PRD §11.1), but v1.1
doesn't ship the machinery — project-grouped citations, cross-project
audit — that makes multi-project-per-workspace useful. Single-connection
lookup keeps the 2.5s budget unambiguous, decryption surface area
minimized, freshness contract simple.
**Tradeoff:** a customer who genuinely wants one Slack workspace in two
projects is blocked until v1.2; if surfaces in v1.1, escalate (might
require a v1.1 plan amendment; might be a polite "v1.2"). The
500-on-multi-row guards against silent "first-row-wins" routing.

### F1. URL verification challenge — first code path post-verify; JSON response with `{ challenge }`; no DB write

After D1+D2+D4 verification clears, **before any event-dispatch logic**:
```js
if (body.type === 'url_verification') {
  return new Response(JSON.stringify({ challenge: body.challenge }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
```

Two contract-pinning requirements when commit 7 ships:
1. `events.js` header includes a comment with the URL of Slack's current
   url_verification docs page, **dated to the day commit 7 lands.** If
   Slack tightens the contract later, the comment is the audit trail.
2. Handler returns `application/json` with `{ challenge: "..." }`. **NOT
   `text/plain` even if Slack's current docs allow that form.** Slack has
   changed the response shape multiple times historically; JSON form is
   the safer subset that has worked in every documented version.

**Specific failure mode the lock prevents:** two failure modes covered:
1. **Configuration deadlock at endpoint registration.** Slack's first
   interaction with the webhook endpoint is the url_verification
   challenge. If verification rejects it (handler hits event-dispatch
   before checking `type`), the webhook URL can't be registered in Slack
   app settings. Slack's only signal back is "URL verification failed" —
   debug-by-guessing. Locking F1 as the FIRST code path after D1–D4
   verify, with explicit type detection before any event dispatch,
   eliminates the class.
2. **Contract drift between Slack docs and Slack API.** Slack has shipped
   contract changes (text/plain → JSON; query-param vs body) that broke
   webhook endpoints with no migration window. The "JSON response only,
   never text/plain" rule plus the dated docs-URL comment means: if the
   contract drifts again, the comment reads "written against Slack docs
   as of `<date>`," and the JSON shape has historically worked across
   every version.

### F2. Event envelope dispatch — dispatch on `body.event.type`, NOT `body.type`; subtype-switch handles edits/deletes/thread_broadcast

Events API wraps each event in:
```json
{
  "type": "event_callback",
  "team_id": "T0123",
  "event_id": "Ev0789",
  "event_time": 1706140800,
  "event": {
    "type": "message",
    "subtype": "message_changed",
    "channel": "C0123",
    "ts": "1706140800.000100"
  }
}
```

- `body.type` is always `"event_callback"` for events (F1 already consumed
  `"url_verification"`).
- The actual event kind is `body.event.type`.
- The variant is `body.event.subtype` (absent on plain new messages).

Dispatch logic shape:
```js
if (body.type === 'url_verification') return f1Challenge(body);
if (body.type !== 'event_callback') return forbidden();           // unknown envelope
if (body.event?.type !== 'message') return new Response(null, { status: 200 });
switch (body.event.subtype) {
  case undefined:               // plain new message
  case 'thread_broadcast':      // H clarification: ONE entity, broadcast ts
    return upsertEntity(connection, body.event);
  case 'message_changed':
    return upsertEntity(connection, body.event.message);  // edits carry .message child
  case 'message_deleted':
    return deleteEntity(connection, body.event.deleted_ts, body.event.channel);
  default:                      // bot_message, channel_join, file_share, etc.
    return new Response(null, { status: 200 });           // ack-only, no write
}
```

Unhandled event kinds and subtypes return 200 with no body — Slack
expects a 200 even when we don't process the event; non-200 triggers
Slack's 3-retry-then-fail loop. Unknown envelope `body.type` returns
the same 403-collapse as a verification failure.

**Specific failure mode the lock prevents:** dispatch-key typo causing
silent message drop. The most common bug pattern: developer reads
`body.type` (always `event_callback`) and switches on it expecting
`message`/`message_changed`/`message_deleted`. The switch falls through
to default; the handler 200-acks every event without writing anything.
Symptoms: messages stop appearing in the entities table; webhook is
"working" (200 responses); backfill data still looks fine but real-time
updates are silently dropped. PRD §5.6 freshness contract violated
invisibly — `last_sync_at` advances on the periodic backfill while live
messages disappear. Locking the dispatch shape with the envelope
structure inline catches the typo at PR review.

### G. Channel listing — bespoke endpoint, not a Connector interface method

Endpoint: `GET /api/projects/:id/connections/:connId/slack/channels`
(admin role via `requireProjectRole(admin)`).

Calls Slack `conversations.list` (`exclude_archived=true`,
`types=public_channel`, paginated) using the connection's decrypted bot
token. Returns:
```json
{
  "channels": [
    { "id": "C0123", "name": "general",     "is_member": true },
    { "id": "C0456", "name": "engineering", "is_member": false }
  ]
}
```

The connector module (`slack.js`) exports a non-interface helper
`listChannels(connection)` that the bespoke endpoint calls. The Connector
interface in [types.js](functions/_lib/connectors/types.js) is **NOT**
widened to include channel listing — that would force every future
connector to implement an awkward "list things this source has" method
that doesn't generalize.

The endpoint validates that the connection's `source === 'slack'` before
invoking `listChannels`; otherwise 404. `isKnownSource` from
[registry.js](functions/_lib/connectors/registry.js) (drift item 1) is
the validation layer for the connections POST refactor; here it's a
per-endpoint source-check.

**Rationale:** premature generalization is a real cost; bespoke per-source
admin endpoints are locally cheaper and the natural seam in v1.1.
**Tradeoff:** four connectors with similar admin endpoints multiplies
code; if Block 6/7/8 patterns rhyme, Block 9 polish can extract a shared
per-source admin namespace.

### H. Entity mapping for Slack messages — one entity per message; thread replies as separate entities; thread_broadcast = ONE entity not two

For each Slack message:
- `source = 'slack'`
- `source_type = 'slack_message'`
- `source_id = '${channel_id}:${ts}'`
- `metadata = { channel_id, channel_name, thread_ts, team_id, user, subtype, edited_ts }`
- `source_url = 'https://${team_domain}.slack.com/archives/${channel_id}/p${ts.replace(".","")}'`
- `title` — null for v1.1 (Slack messages don't have titles)
- `content_text` — `event.text` (raw Slack mrkdwn)
- `author_external_id` — Slack user ID (e.g., `U0123`)
- `author_display_name` — Slack `display_name` (preferred) or `real_name`
  (fallback) from `users.info`, cached per `user_id`. Falls back to null
  if the lookup fails (404, permission error) — `author_external_id` and
  `source_url` still satisfy PRD principle 2.
- `source_created_at` — `event.ts` parsed to TIMESTAMPTZ
- `source_updated_at` — `event.edited?.ts` if present, else `event.ts`
- `raw` — `event` JSONB

Thread reply: a separate entity with `metadata.thread_ts` populated
(pointing at parent `ts`). The parent stays its own single entity. Block 5
search-time joins reconstruct threads.

**`thread_broadcast` clarification.** Slack emits TWO events for "send to
channel" thread replies — one as a thread reply, one as a top-level
message with `subtype='thread_broadcast'`. Both have the same `ts`.
**Block 4 writes ONE entity, keyed by the broadcast's own `ts`, with
`metadata.thread_ts` set AND `metadata.subtype='thread_broadcast'`.** Two
entities for the same logical message would create duplicate citations in
Block 5's chat output, violating PRD principle 2.

**`users.info` caching strategy.** First sighting of a Slack user during
a sync triggers `users.info(user=<user_id>)`; result cached in-memory
for the life of the sync (`Map<user_id, displayName>`). For backfill:
extra calls = unique participants within the cap, typically << total
messages. For webhook events: one extra call per first-sighting per
isolate; isolates cycle, so worst-case is one redundant lookup per
user-isolate-restart. Cross-sync persistence (a `slack_users` cache table,
or extending `credential_metadata`) is Block 9 polish.

If `users.info` returns 404 or permission error, store
`author_external_id` only and continue. **Never 500 a sync or fail a
webhook over a name lookup.**

**Rationale:** schema's `(connection_id, source_type, source_id)` UNIQUE
makes upsert trivial; `source_url` required for citations; storing `raw`
lets us re-derive on mapping changes; thread_broadcast collapse closes a
real Block 5 citation-duplication bug.
**Tradeoff:** v1.1 author_display_name falls back to null for users
deleted post-message-creation; acceptable under the v1.1 freshness model.

### I. Edits and deletions — `message_changed` UPSERTs by source_id; `message_deleted` hard-DELETEs by source_id

Both subtypes share the upsert key:
`(connection_id, source_type='slack_message', source_id='${channel_id}:${ts}')`.

- `message_changed`: F2 dispatch routes to
  `upsertEntity(connection, body.event.message)` — edited content lives in
  `body.event.message`. UPSERT advances `updated_at` and replaces
  `content_text`, `metadata`, `raw`. `source_url` preserved.
- `message_deleted`: F2 dispatch routes to
  `deleteEntity(connection, body.event.deleted_ts, body.event.channel)`.
  Hard DELETE on `entities`; `entity_embeddings` cascade-delete via FK.

**Race behavior.** `message_changed` for an unknown message → UPSERT
inserts (we get the edited content). `message_deleted` for an unknown
message → DELETE matches zero rows; no-op, no error.

**Rationale:** matches schema's hard-delete-on-FK-cascade policy for
derived data; no tombstoning needed.
**Tradeoff:** a deleted-then-cited message returns 404 in Block 5 chat
("source unavailable"). PRD principle 2 degrades gracefully.

### J. `slack_messages` SQL view — thin filter + JSONB projection

```sql
CREATE VIEW slack_messages AS
SELECT
  e.id,
  e.project_id,
  e.connection_id,
  e.source_id,
  e.title,
  e.content_text,
  e.author_external_id,
  e.author_display_name,
  e.source_created_at,
  e.source_updated_at,
  e.source_url,
  (e.metadata->>'channel_id')   AS channel_id,
  (e.metadata->>'channel_name') AS channel_name,
  (e.metadata->>'thread_ts')    AS thread_ts,
  (e.metadata->>'team_id')      AS team_id,
  (e.metadata->>'subtype')      AS subtype
FROM entities e
WHERE e.source = 'slack' AND e.source_type = 'slack_message';
```

Migration file: `db/migrations/2026-MM-DD-slack-messages-view.sql` (date
pinned at commit 6 commit-day). Jenny applies via Neon SQL Editor before
commit 6's view-querying paths get exercised in Phase C verification.

Block 5's AI tool layer reads this view. Flat columns over JSONB
projections so SQL stays readable. The `subtype` column lets future
filters exclude `thread_broadcast` duplicates if H's collapse rule ever
loosens.

**Rationale:** views are zero-cost reads; schema-level documentation of
the JSONB shape; a single bottleneck Block 5 modifies if metadata layout
drifts.
**Tradeoff:** view migration adds a manual SQL Editor step.

### K. UI for connection lifecycle — full-page redirect; callback redirect destination hardcoded server-side; no `redirect_to` query param accepted

Connect flow:
1. **Connect button** in `project.html` Connections tab →
   `window.location = '/api/connectors/slack/oauth/start?project_id=<projectId>'`.
   No popup. No fetch + parse + redirect from JS.
2. **`/start` endpoint** (admin-gated via `requireProjectRole(admin)`)
   INSERTs the pending row (per C1, C3 column populated, P's scope set)
   and 302s to Slack's authorize URL.
3. **Slack consent screen** (B's bot scopes). User clicks Approve.
4. **Slack callback** hits
   `/api/connectors/slack/oauth/callback?code=...&state=...`. Callback
   runs C2's SELECT-then-UPDATE flow + C3's session-match check.
5. **Callback redirect — hardcoded server-side:**
   ```js
   const dest = new URL('/project.html', new URL(request.url).origin);
   dest.searchParams.set('project_id', pendingRow.project_id);
   dest.searchParams.set('tab', 'connections');
   dest.searchParams.set('just_connected', 'slack');
   return Response.redirect(dest.toString(), 302);
   ```
   `pendingRow.project_id` comes from C2's SELECT result. **Never from
   any callback query param.**
6. `/project.html?just_connected=slack` triggers L's channel-picker modal.

**Neither `/start` nor `/callback` accepts a `redirect_to` query param.**
The only project_id-bearing input consumed is `/start`'s `?project_id=`
(for `requireProjectRole`); the callback's redirect destination is fully
derived from the pending row's `project_id`.

**Specific failure mode the lock prevents:** open-redirect via OAuth
callback. Classic pattern: callback accepts `?redirect_to=...` "for
testability" or "for future flexibility." Attacker crafts a phishing
chain: legitimate-looking link → elinnoagent.com OAuth → Slack consent
(user trusts) → callback with `?redirect_to=https://evil.com/?...`.
Referer header on the redirected response leaks the OAuth `code` and
URL params to evil.com; bounce-via-trusted-domain laundering is itself a
phishing primitive — `https://elinnoagent.com/...` shows up before the
redirect to evil.com fires. With destination hardcoded server-side, no
attacker-controlled redirect input. Combined with C3's cross-session
prevention, the attack class is closed at two layers.

### L. Channel picker — post-connect modal, single channel; selection writes to `credential_metadata.selected_channel_id` via new admin PATCH endpoint

Trigger: `project.html` loads with `?just_connected=slack`; JS opens a
channel-picker modal, consumes G's endpoint to populate the list.

Selection flow:
1. `PATCH /api/projects/:id/connections/:connId` with body
   `{ credential_metadata: { selected_channel_id: 'C0123', selected_channel_name: 'general' } }`
   — writes the selection (admin-gated).
2. `POST /api/projects/:id/connections/:connId/sync` — triggers backfill.
3. UI updates connection-row pill: "needs setup" → "syncing" → "active".

Until a channel is picked, the connection row shows pill = "needs setup"
(UI-derived from `credential_metadata.selected_channel_id IS NULL`, **not**
a new schema status). The connection is technically `status='active'` but
functionally inert — `fullSync` reads `selected_channel_id`; if absent,
returns `{ records_inserted: 0, records_updated: 0, records_skipped: 0 }`
with `sync_runs.detail = { reason: 'no channel selected' }`.

**Inert syncs write a `sync_runs` row but do NOT advance
`connections.last_sync_at`.** The field stays at its previous value (NULL
on first inert, unchanged on subsequent inerts after a real sync).
Without this rule, an admin who triggers sync-before-channel-pick
advances `last_sync_at` to NOW, and Block 5's freshness layer reads
"data as of now" for a connection with zero data — the same stale-as-
fresh failure E2 closes for rate-limited partial syncs, applied to
empty-by-config syncs.

**New PATCH endpoint.**
[`connections/[connId]/index.js`](functions/api/projects/[id]/connections/[connId]/index.js)
gains `onRequestPatch` — admin-only, validates `credential_metadata` keys
against an allowlist (`selected_channel_id`, `selected_channel_name` for
v1.1; future fields explicit). Lands in commit 8 alongside UI wiring.
**Not a security carve-out** (no credential touching; just sets non-secret
JSONB keys). Admin-gated.

**Rationale:** multi-channel selection is Block 9 / v1.2 polish;
one-channel v1.1 is enough for done-when. Selection in
`credential_metadata` requires no schema migration; column exists and is
whitelist-protected from API responses.
**Tradeoff:** in-place channel switch requires disconnect-and-reconnect
in v1.1.

### M. ~~`requireWorkspaceAdmin` migration~~ — moved to its own pre-Block-4 PR

Not on the Block 4 branch. See "Pre-Block-4 prerequisite" above.

### N. Data-path AAD-tampering test — verification matrix S12; Neon branch isolation; assert BOTH `status='failed'` AND error-string substring

Block 3's deferred scenario 16 (data-path version) lands as Block 4's S12:

1. **[Claude Code]** Create a Neon branch off production via
   `neonctl branches create`. Capture connection string.
2. **[Claude Code]** Connect a Slack connector against the branch (preview
   deploy pointed at the branch). Capture `connId`.
3. **[Claude Code]** SELECT pre-tampering snapshot.
4. **[Jenny]** Neon SQL Editor against the branch:
   ```sql
   UPDATE connections SET project_id = '<other_project_id>' WHERE id = '<connId>';
   ```
5. **[Claude Code]**
   `POST /api/projects/<other_project_id>/connections/<connId>/sync` against
   the preview. SubtleCrypto throws on AAD mismatch.
6. **Assertion (BOTH required):**
   - `sync_run.status === 'failed'`
   - `sync_run.error LIKE '%OperationError%'` (exact substring pinned at
     commit-7 coding time; queued as Open follow-up).
7. **[Claude Code]** Drop the Neon branch.

The error-string assertion is **mandatory** — a bare `status='failed'`
would pass for any unrelated reason.

**Specific failure mode the lock prevents:** two failure modes covered:
1. **AAD-binding regression undetected through the consumer code path.**
   A future refactor to `crypto.js` or to the connections POST handler
   could break the AAD chain. Block 3's Phase B helper-layer smoke
   endpoint catches this for the helper, but only the data-path test
   catches it through the actual *consumer* — the sync flow constructing
   AAD from the SELECTed row and handing it to the helper.
2. **Insufficient-strength assertion.** Without the error-string match,
   S12 passes whenever the sync fails for any reason. A future refactor
   that breaks Slack API calls would coincidentally produce
   `status='failed'`. Pinning the substring keeps S12 honest as a
   security check.

### O. `refreshAuth` for Slack v1.1 — no-op; token rotation NOT enabled in Slack app settings

```js
async refreshAuth(_ctx, credentials) {
  return credentials;
}
```

Slack app settings: "Token Rotation" feature stays **OFF**. Long-lived
`xoxb-` bot token is the v1.1 model.

**Rationale.** Token rotation adds failure modes — refresh races,
expired refresh tokens, refresh-token-itself as a second credential
surface — for marginal security gain when the access token is
envelope-encrypted at rest under AES-256-GCM (Block 3). Encryption-at-rest
covers "what if the DB leaks"; rotation would cover "what if the token
leaks despite encryption-at-rest" — vanishingly small additional risk for
the surface added.

Revisitable in v1.2 if: long-lived-token risk profile changes; Slack
deprecates long-lived bot tokens; an incident surfaces a token leak that
rotation would have contained.

**Tradeoff:** if a Slack token is exfiltrated despite encryption-at-rest,
no auto-revocation; admin manually disconnects + reconnects via L's flow.

### P. Install URL scope shape — `scope` populated with B's bot scopes; `user_scope` parameter omitted entirely

```js
const url = new URL('https://slack.com/oauth/v2/authorize');
url.searchParams.set('client_id', env.SLACK_CLIENT_ID);
url.searchParams.set('scope', 'channels:read,channels:history,users:read');
url.searchParams.set('state', pendingConnection.id);
url.searchParams.set('redirect_uri', `${env.SITE_URL}/api/connectors/slack/oauth/callback`);
// NO url.searchParams.set('user_scope', ...) — omitted ENTIRELY, not even empty.
```

Slack app settings:
- Bot token scopes: `channels:read`, `channels:history`, `users:read`.
- User token scopes: NONE (per PRD §3 reserving per-user identity for v1.2+).
- Redirect URLs: `https://elinnoagent.com/...` AND preview-deploy
  equivalent (Slack supports multiple).

**Rationale.** Including `user_scope=` (even empty) is easy to typo and
invisible in code review without explicit verification. PRD §3 reserves
per-user Slack identity for v1.2+; the parameter has no v1.1 purpose.
S3 in the verification matrix asserts on the URL bytes.
**Tradeoff:** none.

---

## Schema migrations summary

Two migrations land in this block. Both follow Block 3's pattern: file
lands in repo for review; Jenny applies via Neon SQL Editor before the
dependent code commit ships.

| File | Lands in | Applied before | Purpose |
| ---- | -------- | -------------- | ------- |
| `db/migrations/2026-MM-DD-pending-oauth-state.sql` | commit 3 | commit 4 | C1's NULL-allow + CHECK constraint; C3's `initiated_by_user_id` column |
| `db/migrations/2026-MM-DD-slack-messages-view.sql` | commit 6 | Phase C run | J's `slack_messages` view |

---

## Commit ordering (10 commits)

Branch: `block-4-slack-connector`. Single branch, no sub-branches.

| #  | Subject                                                                                  | Notes                                                                                         |
| -- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1  | `docs(block-4): lock Block 4 design decisions A–P`                                       | This file (`BLOCK_4_PLAN.md`).                                                                |
| 2  | `feat(block-4): add Slack connector — startAuth/completeAuth/refreshAuth/testConnection` | `slack.js` minus sync + webhook. Registry entry. Drift item 1 (`isKnownSource`) used here.    |
| 3  | `feat(block-4): refactor connections POST for OAuth authUrl flow + Slack OAuth start endpoint` | Includes C1+C3 schema migration **file landed but NOT applied** — Jenny applies before commit 4 ships. |
| 4  | `feat(block-4): add Slack OAuth callback endpoint`                                       | Carve-out concentration. C2 single-use UPDATE; C3 session-match; K hardcoded redirect.        |
| 5  | `feat(block-4): add Slack channel listing endpoint`                                      | G's bespoke endpoint.                                                                         |
| 6  | `feat(block-4): add Slack fullSync + incrementalSync + slack_messages view migration`    | E2/E3 rate-limits + cap + cap-hit signal. View migration **file landed but NOT applied** — Jenny applies before Phase C. H entity mapping. |
| 7  | `feat(block-4): add Slack Events API webhook handler`                                    | D1–D4 spec. F1 + F2 dispatch. I edits/deletes. F1's docs-URL comment dated to commit day.     |
| 8  | `feat(block-4): wire Connect Slack UI in project.html + PATCH endpoint`                  | K full-page flow. L channel-picker modal + new `onRequestPatch` on `connections/[connId]/index.js`. |
| 9  | `fix(block-4): <one-line subject>`                                                       | **Convention locked**: if a fix-up surfaces during commits 2–8 review, it lands here with `fix(block-4):` prefix AND a one-line note in BLOCK_4_PLAN.md describing what was fixed. If nothing surfaces, this slot is dropped and commit 10 becomes commit 9. **Anything bigger than a fix-up goes through WORKFLOW scope-expansion (plan amendment), NOT a sneaky commit 9.** |
| 10 | `docs(block-4): closeout — verification matrix + HANDOFF addendum`                       | `curl-matrix-block-4.md` + HANDOFF Block 4 closeout. The BLOCK_3_PLAN.md AAD-on-both addendum (drift item 3) ships as a SEPARATE post-Block-4 commit. |

---

## Verification matrix

Continuous numbering across phases; ~26 scenarios. Full per-scenario
detail in commit 10's `curl-matrix-block-4.md`.

### Phase A — Jenny's hands (between commits 1 and 4)
- Register Slack app at api.slack.com/apps; capture `SLACK_CLIENT_ID`
  (plaintext var → `wrangler.toml`), `SLACK_CLIENT_SECRET` +
  `SLACK_SIGNING_SECRET` (Workers Secrets, Production AND Preview).
- Configure redirect URIs in Slack settings (Production + Preview).
- Configure Events API URL after commit 7 deploys to preview.
- Apply C1+C3 migration to Neon production via SQL Editor (before commit 4).
- Apply J's view migration to Neon production (before Phase C runs).
- Provide test workspace + test channel.
- **Slack app settings → OAuth & Permissions → Token Rotation:
  confirmed OFF** (per O's lock — drift-detection for app settings
  that code can't catch).
- **Slack app settings → Bot Token Scopes shows exactly
  `channels:read`, `channels:history`, `users:read`; no User Token
  Scopes; no commands; no incoming-webhook** (per B's verification
  setup and P's `user_scope`-omitted lock).

### Phase B — Connector-layer smoke (preview deploy)
- **S1.** Block 3 `crypto-roundtrip` smoke endpoint still 200 — regression.
- **S2.** After commit 2: `getMetadata('slack')` returns expected shape;
  `isKnownSource('slack')` returns true.
- **S3.** After commit 3: `startAuth(ctx)` returns `{ authUrl, state }`
  with the right scopes (assert byte-level on URL per P), state matches
  newly-INSERTed pending row.

### Phase C — End-to-end against Jenny's test workspace (preview deploy)
- **S4.** Connect → consent → callback → row flips to `status='active'`,
  encryption columns populated, `external_account_id = team.id`.
- **S5.** Channel listing returns Jenny's test channel.
- **S6.** Picking a channel + triggering sync → backfill writes entities;
  direct SQL count matches Slack's channel message count within E3 window.
- **S7.** Post a new message → webhook fires → entity appears within 5s.
- **S8.** Edit a message → entity row updates (`updated_at` advances).
- **S9.** Delete a message → entity row removed.
- **S10.** Re-run sync → idempotent (`records_inserted=0`,
  `records_updated=N`).
- **S11.** Send a thread reply with "also send to channel" checked → ONE
  entity written (per H's thread_broadcast clarification);
  `metadata.subtype='thread_broadcast'`.

### Phase D — Silent-failure-mode + auth/scoping (security-critical)
- **S12.** AAD-tampering on Neon branch (per N) → sync fails with
  `error LIKE '%OperationError%'`, no partial writes.
- **S13.** Webhook with bad signature → 403, no DB write (D1+D4).
- **S14.** Webhook with timestamp >5min stale → 403, no DB write (D2).
- **S15.** Webhook with timestamp >5min future-dated → **paired
  assertion against S14**: same HTTP status code AND byte-identical
  response body. Different errors between stale and future-dated would
  be a clock-skew side channel. The assertion is the byte equality,
  not just "rejects" (D2 symmetry).
- **S16.** Webhook duplicate delivery (same body, same signature, second
  time) → 200 but no duplicate entity (UPSERT idempotent).
- **S17.** Mirror Block 3 auth/scoping scenarios 1–6 against Slack
  connections (POST/GET/DELETE/sync/sync-runs auth + scoping).
- **S18.** Plaintext-leak guard:
  `SELECT ciphertext_credentials FROM connections WHERE id = $slackConn`
  → bytes are NOT the UTF-8 encoding of the `xoxb-` token.
- **S19.** Response whitelist holds — no `wrapped_data_key` /
  `ciphertext_credentials` / `encryption_algorithm` /
  `credential_metadata` / `initiated_by_user_id` in any GET-connections
  response for Slack rows.
- **S20.** OAuth state single-use replay (C2): replay an old callback
  URL → second hit returns 403-collapse, no row mutation.
- **S21.** Initiated-by-user mismatch (C3): Jenny initiates, Bob's
  session completes → 403-collapse, row stays pending.
- **S22.** URL verification (F1): signed POST
  `{ type:'url_verification', challenge:'X' }` → 200 with the challenge
  echoed (verify exact response shape against Slack's current docs at
  commit-7 coding time).
- **S23.** URL verification negative (F1 + D4): same payload bad
  signature → 403, response body does NOT contain the challenge.
- **S24.** Open-redirect closure (K): callback with `?redirect_to=evil.com`
  appended → response Location header points to `/project.html`,
  NOT `evil.com`.

### Phase E — UI smoke (preview)
- **S25.** Connect button → consent screen → returns to project page
  with `just_connected=slack` query param → channel-picker modal opens.
- **S26.** Disconnect button → connection soft-deleted, row no longer
  visible in connections tab.

Jenny eyeballs the preview after Phase E before approving the push to
main per WORKFLOW Phase 3.

---

## Critical files

**To create:**
- `BLOCK_4_PLAN.md` — commit 1
- `functions/_lib/connectors/slack.js` — connector module (security carve-out)
- `functions/api/connectors/slack/oauth/start.js` — OAuth start (security carve-out)
- `functions/api/connectors/slack/oauth/callback.js` — OAuth callback (security carve-out)
- `functions/api/connectors/slack/events.js` — Events API webhook (security carve-out)
- `functions/api/projects/[id]/connections/[connId]/slack/channels.js` — channel listing
- `db/migrations/2026-MM-DD-pending-oauth-state.sql` — C1 + C3 schema migration
- `db/migrations/2026-MM-DD-slack-messages-view.sql` — J view migration
- `curl-matrix-block-4.md` — verification matrix

**To modify:**
- [functions/api/projects/[id]/connections/index.js](functions/api/projects/[id]/connections/index.js)
  — replace 501 stub with `authUrl`-handling branch
- [functions/api/projects/[id]/connections/[connId]/index.js](functions/api/projects/[id]/connections/[connId]/index.js)
  — add `onRequestPatch` for L's allowlisted credential_metadata writes
- [functions/_lib/connectors/registry.js](functions/_lib/connectors/registry.js)
  — add `slack`
- [public/project.html](public/project.html) — Connections tab Slack flow + channel picker modal
- [wrangler.toml](wrangler.toml) — add `SLACK_CLIENT_ID` plaintext var
- [HANDOFF.md](HANDOFF.md) — Block 4 closeout addendum

**To consume but not modify:**
- [functions/_lib/crypto.js](functions/_lib/crypto.js) — `encrypt`,
  `decrypt`, `aadFor` (AAD-on-both-layers per drift item 3)
- [functions/_lib/connectors/types.js](functions/_lib/connectors/types.js)
  — Connector contract
- [functions/_lib/auth.js](functions/_lib/auth.js) —
  `requireProjectRole`, `requireWorkspaceAdmin`, `getSessionUser`
- Block 3 connections POST/GET/DELETE/sync handlers — pattern reuse

---

## Block 5 prerequisites — freshness-contract decisions in Block 4

Block 5's first-AI-answer milestone reads `BLOCK_4_PLAN.md` as input
during plan-mode design. Five Block 4 decisions are explicitly
freshness-contract-adjacent and load-bearing for Block 5's correctness:

- **E2** — rate-limit handling produces structured `sync_runs.failed`
  with accurate `records_so_far`; freshness layer reads `last_sync_at`
  + `sync_runs.status` and must NOT report stale-as-fresh.
- **F (base)** — single connection per Slack `team_id` keeps freshness
  per-project unambiguous; multi-project routing would multiply the
  freshness signal.
- **F2** — dispatch on `body.event.type` (not `body.type`) prevents
  silent message drop where backfill freshness advances but live
  updates disappear.
- **I** — `message_changed` UPSERTs / `message_deleted` hard-DELETEs
  keep entity state consistent with source state; freshness layer
  reading entity timestamps gets honest answers.
- **L** — inert syncs do NOT advance `last_sync_at`; admins triggering
  sync-before-channel-pick don't poison the freshness signal.

Block 5's plan-mode should reference this list; the freshness contract
degrades silently if any of the five regress.

---

## Out-of-scope for Block 4

- AI chat queries against Slack data — Block 5.
- Embeddings on Slack messages — Block 5.
- Multiple Slack workspaces per project — v1.2.
- Per-user Slack identity (PRD §3 reserves for v1.2+).
- Drive / Jira / Monday connectors — their own blocks.
- DM ingestion — gated on B (out for v1.1).
- Sending TO Slack — v1.1 read-only per PRD.
- Distribution-mode public-app review — A defers.
- Multi-channel picker / channel-management UI — Block 9 polish.
- Token rotation in Slack app settings — O defers.
- In-place channel switch (vs disconnect-reconnect) — L defers.
- Cleanup worker for stuck `pending` connections — Block 9 polish.
- Slack admin events (channel created/archived) beyond freshness needs.
- `requireWorkspaceAdmin` migration of admin/users — own pre-Block-4 PR.
- Cross-sync `users.info` cache (in-memory only for v1.1) — Block 9 polish.
- One Slack workspace in two elinno-agent projects — v1.2.

---

## Open follow-ups (queued, not Block 4 work)

- **BLOCK_3_PLAN.md addendum** — one-line note that `crypto.js` applies
  AAD to BOTH the DEK wrap and the credential ciphertext (drift item 3).
  Plan should match the helper. Doc-only commit; ships AFTER Block 4
  closes so it doesn't compete with Block 4 doc commits.
- **S22 response shape pinning** — Slack has changed the
  url_verification response shape historically. Pin exact shape at
  commit-7 coding time; follow-up to re-verify when Slack's Events API
  docs roll over.
- **S12 `OperationError` substring pinning** — same risk class; pin at
  commit-7 coding time; follow-up to re-verify on Workers runtime
  upgrades.
- **`detail` JSONB on `sync_runs`** — currently not on the Phase D
  whitelist for verification (matches Block 3 decision Q's whitelist
  scope). Block 9 polish: admin endpoint exposing `detail` for debugging.
- **Cross-sync `users.info` cache** — in-memory-per-sync for v1.1;
  Block 9 polish considers a `slack_users` cache table or extending
  `credential_metadata`.
- **`slack_messages` view subtype projection** — verify behavior under
  JSONB extraction edge cases (null subtype on plain messages) in
  Phase C if Block 5's tools depend on subtype filtering. Pin at
  Phase C run time; if the view returns empty strings vs NULLs
  inconsistently, update the view definition in a migration follow-up.
- **Block 9 polish hooks tied to v1.1 completeness:** in-place channel
  switch (L), multi-channel picker (L), `groups:*` private channels (B),
  cleanup worker for stuck `pending` connections (C1/C2), shared
  `_lib/webhook-verify.js` extraction (D, when Block 6 lands).

---

## Things deferred (don't build in Block 4)

- **Cloudflare Queues for async sync** (E, F) — synchronous inline is
  fine for v1.1 Slack volumes; Queues introduced when a real connector
  needs it.
- **Multi-project-per-workspace** (F) — schema permits; v1.1 returns 500
  on multi-row lookup; v1.2 reopens with cross-project query support.
- **Refresh tokens / token rotation** (O) — Slack app setting OFF; v1.1
  uses long-lived `xoxb-` tokens.
- **`groups:*` private channel scopes** (B) — Block 9 / v1.2.
- **Token-rotation runtime code path** (O) — refreshAuth no-op for v1.1.
- **Block 5+ work**: embeddings, search, AI agent loop, citations.

---

*End of Block 4 Build Plan v1.0. Generated 2026-05-04 in the design
session for the Slack connector block. Mirrors the structure of
BLOCK_3_PLAN.md for consistency. Updates to locked decisions require
a re-lock from Jenny per WORKFLOW.md.*
