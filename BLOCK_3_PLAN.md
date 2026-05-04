# Block 3 — Connector Framework · Build Plan


| Field        | Value                                                      |
| ------------ | ---------------------------------------------------------- |
| Document     | Block 3 Build Plan v1.0                                    |
| Block        | Block 3 of 9 (per BUILD_PLAN.md)                           |
| Companion to | BUILD_PLAN.md, PRD.md, HANDOFF.md, WORKFLOW.md             |
| For          | Solo build with Claude Code                                |
| Generated    | 2026-05-04 (Block 3 design session, post-Block-2-closeout) |


---

## How to use this document

This file is the locked design for Block 3. Drop it (with `HANDOFF.md`,
`WORKFLOW.md`, `PROJECT.md`) into a fresh Claude Code session at the start
of any Block 3 working session. It contains:

- The Block 3 deliverables and done-when criterion
- Every design decision already locked (so Claude Code doesn't re-litigate)
- The schema prerequisite that must run before any code is written
- A five-commit work order, so each session has a clear scope
- The verification matrix that gates ff-merge to `main`

Workflow per session, per WORKFLOW.md:

1. Open Claude Code with this file + `HANDOFF.md` + `WORKFLOW.md` as context.
2. Tell Claude Code which commit (1–5) you're working on.
3. Have Claude Code implement one sub-step at a time. Read every diff
  before approving the commit.
4. End the session with the trunk green and an updated `HANDOFF.md`.

Block 3 is small enough to fit on a single branch (`block-3-connector- framework`) without sub-branches. Sessions are scoped by commit number,
not by branch.

---

## What Block 3 delivers

Per BUILD_PLAN, the done-when criterion for Block 3 is:

> You can "connect" the dummy connector to a project and see three rows
> appear in the `entities` table.

Translated into concrete deliverables:

- **Envelope encryption helper** — AES-256-GCM via Web Crypto, master
key in Workers Secrets, per-credential data key. Generic enough that
Block 4 OAuth state tokens can use it too.
- `**Connector` interface** — JSDoc-typed contract every connector
implements. Methods: `getMetadata`, `startAuth`, `completeAuth`,
`refreshAuth`, `testConnection`, `fullSync`, `incrementalSync`,
optional `handleWebhook`.
- **Connector registry** — static `source → implementation` map.
`dummy` is the only entry; Slack/Jira/Monday/Drive added in their
own blocks.
- **Dummy connector** — `authKind: 'none'`, syncs three hardcoded rows
into `entities`, idempotent on re-sync. Exercises the framework
end-to-end.
- **Connections + sync HTTP API** — five endpoints under
`/api/projects/:id/connections/...` for connect, list, delete, sync,
and sync-runs.
- **Verification matrix** — curl scenarios covering auth, scoping,
idempotency, plus three silent-failure-mode checks (plaintext leak,
AAD-tampering detection, algorithm-tag presence).

Backend-only block. The Connections tab in `project.html` stays as the
Block 2 placeholder state-card ("No tools connected yet…") until Block
4's first real "Connect" button.

---

## Design principles still in force (from HANDOFF §"Key design principles")

For Block 3, the live constraints are **#3 and #6**. Others bite later.

- **#3 Project scoping is enforced server-side, not in the prompt.**
Every connections endpoint is gated by `requireProjectRole`. The
connector itself never receives or queries `user`/`project` objects
— auth is settled in the API handler before the connector is called
(decision I).
- **#6 Secrets never in plaintext.** Block 3 introduces the master
encryption key (in Workers Secrets) and the encrypted credential
storage path. Plaintext credentials exist only on the call stack
during encrypt; never persisted, never logged, never returned in API
responses (decisions B, Q).

Principles #1, #2, #4, #5 become live in Block 5.

---

## Security carve-out (per WORKFLOW.md)

Per WORKFLOW.md §"Security carve-out", crypto code is on the flagged
list. Three sub-changes in this block warrant explicit "would normally
be a code-review-required change" treatment. Decision per-item at
commit time — external review, spot-check vs reference, or accept
single-reviewer risk.

1. **Crypto helper itself** (`functions/_lib/crypto.js`, commit 2).
  Envelope encryption with AES-GCM via SubtleCrypto. Subtle bugs
   here (IV reuse, wrong AAD, plaintext leak in error path) ship
   silently and are not detected by integration tests.
2. **AAD binding** (also commit 2). The `aadFor(connection)` helper
  constructs the additional-authenticated-data string. If this is
   wrong (e.g., excludes `project_id`), an attacker who can move a
   ciphertext row across projects defeats the binding. The R-1
   verification scenario catches one specific failure (row swap)
   but doesn't exhaustively cover the construction.
3. **Master key loading** (also commit 2). `loadMasterKey(env)`
  imports the Workers Secret as a `CryptoKey`. Bugs here (wrong
   key length validation, accepting a non-base64 secret, caching the
   wrong thing) shift the cryptographic ground under everything else.

Generation of the master key value itself is Jenny's, per WORKFLOW.md
("No credential generation"). Claude Code never writes or prints the
key; will only point at the `wrangler pages secret put` command.

---

## Schema prerequisite (must run before commit 4)

The `connections.encryption_algorithm` column currently defaults to
`'aes-256-gcm'`. Block 3 lands the value `'aes-256-gcm-v1'` (decision
clarification 2 — the `-v1` suffix names the envelope scheme, not the
primitive, preserving the option to define v2 later without another
schema migration at that point).

Migration file: `**db/migrations/2026-05-04-encryption-algorithm-v1.sql`**
(committed in commit 2 alongside the crypto helper). Contents:

```sql
-- Update connections.encryption_algorithm default to the versioned
-- envelope scheme tag. -v1 names the envelope scheme (AES-256-GCM
-- + 12-byte random IV + per-credential DEK wrapped by master key
-- + AAD = length-prefixed bytes of (connection_id, project_id, source)
-- as a Uint8Array — 4-byte big-endian length prefix per component,
-- ensuring no two distinct triples can produce the same AAD bytes);
-- a future v2 may change any of those without another migration.

ALTER TABLE connections
  ALTER COLUMN encryption_algorithm SET DEFAULT 'aes-256-gcm-v1';

COMMENT ON COLUMN connections.encryption_algorithm IS
  'Envelope scheme tag. v1 = AES-256-GCM + 12-byte random IV + per-credential DEK wrapped by master key + AAD = length-prefixed bytes of (connection_id, project_id, source) — 4-byte big-endian length prefix per component, ensuring no two distinct triples produce the same AAD bytes. See functions/_lib/crypto.js header for details.';
```

Zero existing rows affected (no production connections yet — `dummy`
exists in the CHECK constraint but the `connections` table is empty).
Jenny applies via Neon SQL Editor (per WORKFLOW Hard Limits) **before**
commit 4 lands the connect endpoint that writes the value.

---

## Locked design decisions

These were settled in the Block 3 design conversation (2026-05-04).
Each has a short rationale so future sessions don't second-guess.

### Crypto block — A through F

#### A. Algorithm

AES-256-GCM via Web Crypto (`crypto.subtle`). Workers SubtleCrypto is
sufficient for the primitive — no third-party crypto library, supply-
chain surface stays at zero. AEAD (auth + encryption in one operation)
matches the envelope-encryption pattern.

#### B. Envelope structure

- **Master key (KEK)** — 32 bytes, lives in Cloudflare Workers Secret
`MASTER_ENCRYPTION_KEY`. Never in code, never in repo, never in logs.
- **Data key (DEK)** — 32 bytes, generated fresh on **every** encrypt
call via `crypto.getRandomValues`. Re-encrypting an unchanged
credential yields different ciphertext — this is intentional
(rotation-friendly; defends against ciphertext-equality oracles).
Helper carries a comment so future readers don't "optimize" by
reusing DEKs.
- **Layout on disk:**
  - `wrapped_data_key` (BYTEA): `dek_iv (12 bytes) || ciphertext_dek_with_tag`
  - `iv` (BYTEA): the 12-byte random IV used to encrypt the credential
  - `ciphertext_credentials` (BYTEA): the credential ciphertext + auth tag
  - `encryption_algorithm` (TEXT): `'aes-256-gcm-v1'` (per the migration)
- **DEK lifetime** — exists in plaintext only on the call stack between
`crypto.getRandomValues` and `crypto.subtle.encrypt`. Never assigned
to a long-lived variable, never `console.log`'d, never serialized.
Helper's `encrypt` function is structured so the plaintext DEK goes
out of scope as soon as wrapping completes.

#### C. AAD binding

GCM's additional-authenticated-data field binds ciphertext to context.
Block 3 binds the **triple**: `connection_id`, `project_id`, `source`.

**Encoding: length-prefixed concatenation, not a delimited string.**
The property we want is unambiguous and unconditional: no two distinct
`(connection_id, project_id, source)` triples can produce the same AAD
bytes. A delimited form (`:`, `\0`, etc.) only achieves this *if* you
know the components themselves never contain that delimiter — true
today (UUIDs have no colons; `source` is CHECK-constrained to a small
enum) but "by happenstance" rather than "by construction." Length-
prefixing is unambiguous regardless of component contents and remains
unambiguous if a future block widens the `source` CHECK or changes
the ID format.

`aadFor(connection)` returns a `Uint8Array` shaped as:

```
[ 4-byte BE length of bytes(connection_id) ][ bytes(connection_id) ]
[ 4-byte BE length of bytes(project_id)    ][ bytes(project_id)    ]
[ 4-byte BE length of bytes(source)        ][ bytes(source)        ]
```

Each string component is UTF-8 encoded via `TextEncoder` first; the
4-byte big-endian length prefix is the byte count (not character
count). Web Crypto's GCM `additionalData` parameter accepts
`BufferSource`, so the `Uint8Array` flows through `crypto.subtle .encrypt`/`decrypt` directly.

- Defends against row swaps within a project AND row moves across
projects.
- Construction lives in a helper `aadFor(connection)` so encrypt and
decrypt callers cannot drift apart.
- The `connection` argument is the SELECTed row (object with `id`,
`project_id`, `source`). Required because ctx (decision I) is IDs-
only — handlers SELECT the whitelisted row first, then pass it.
- App generates `connection_id` via `crypto.randomUUID()` **before** the
INSERT (don't rely on Postgres `gen_random_uuid()` default). Required
so AAD can be constructed at encrypt time, before the row exists in
the database.

#### D. Master key loading

- Stored as base64-encoded 32 raw bytes in the Workers Secret
`MASTER_ENCRYPTION_KEY`.
- Helper `loadMasterKey(env)` does `atob → Uint8Array → crypto.subtle .importKey({name:'AES-GCM'}, false, ['encrypt','decrypt'])`.
- Throws on missing secret, throws on wrong-length decoded value.
- **Module-scope cache** for the imported `CryptoKey`:
  ```js
  const keyCache = new Map(); // secretName → CryptoKey
  ```
  Workers reuse module-level state across requests within an isolate;
  without caching, every encrypt/decrypt re-imports. Map keyed by
  secret name (not just "the imported key") so a future second key
  (e.g., for rotation) doesn't conflict silently.

**Generation of the master key value is Jenny's:**

```bash
openssl rand -base64 32 | npx wrangler pages secret put \
    MASTER_ENCRYPTION_KEY --project-name=elinno-agent
```

Run for both Production and Preview environments. Claude Code never
generates, prints, or persists the value.

#### E. Key rotation

Not implemented in v1.1. Document the upgrade path in the helper file
header:

- `encryption_algorithm` column tags rows by envelope-scheme version.
- A future rotation script reads each row, decrypts with `v1`, re-
encrypts with `v2`, updates the tag.
- **Critical caveat:** if v2 changes AAD inputs (e.g., adds a workspace
ID), rotation must reconstruct AAD per row using v1's rules at
decrypt time AND v2's rules at encrypt time. Not just unwrap-and-
rewrap.
- **Trigger conditions:** suspected master-key compromise, scheme
change, or scheduled rotation if we ever commit to a cadence (none
in v1.1).

**Master-key value rotation** (separate from algorithm-version
rotation). The `MASTER_ENCRYPTION_KEY` value itself can be rotated
independently of the envelope-scheme tag. This is the more common
operational rotation — suspected key leak, routine cadence (post-
launch, e.g., yearly), or a person with key access leaving.

Mechanism (no v1 envelope-shape change required):

1. Generate the new key as a *separate* Workers Secret —
  `MASTER_ENCRYPTION_KEY_NEW`. Old `MASTER_ENCRYPTION_KEY` stays in
   place. Both are loadable concurrently because the cache from D is
   keyed by secret name.
2. Rotation script (operates against Neon directly, not via Pages
  Functions): for each row in `connections`, unwrap the DEK using
   `MASTER_ENCRYPTION_KEY`, re-wrap the same DEK using
   `MASTER_ENCRYPTION_KEY_NEW`, UPDATE the `wrapped_data_key` column.
   `ciphertext_credentials` is **not** re-encrypted — only the DEK
   wrap changes. AAD is unaffected. `encryption_algorithm` tag is
   unchanged (still `aes-256-gcm-v1`).
3. Once every row is migrated, atomically swap the secret names:
  either rename `MASTER_ENCRYPTION_KEY_NEW` → `MASTER_ENCRYPTION_KEY`
   (Cloudflare's secret API allows this) or update the helper to
   read from the new name and then rename. The cache from D handles
   either ordering safely as long as the old name remains loadable
   until every Workers isolate is recycled.
4. Drop the old key value once you're confident no isolate still
  references it.

The rotation **script** is post-launch work, not v1.1 code. The
**design must not preclude it** — and as written, the v1 envelope
shape supports the mechanism above without code changes.

#### F. Helper file

`functions/_lib/crypto.js`. Mirrors `functions/_lib/auth.js` location.

Exports:

- `encrypt(env, plaintext, aad)` → `{ wrapped_data_key, iv, ciphertext, algorithm }` — `aad` is `Uint8Array` (typically built via `aadFor`)
- `decrypt(env, ciphertextRow, aad)` → `plaintext: string` — same `aad` shape
- `aadFor(connection)` → `Uint8Array` — length-prefixed bytes per decision C

Plain `encrypt`/`decrypt` names — module path disambiguates at call
sites (`import * as crypto from '../_lib/crypto.js'`, or named imports).
Helper isn't credentials-specific; Block 4 OAuth state tokens may
piggyback on the same primitive.

### Interface — G through J

#### G. Language

JSDoc-typed `.js`. **No TypeScript.**

Repo is 100% `.js` today. Introducing `.ts` would be a precedent
decision (build step, tooling, CI) masquerading as a Block 3
implementation detail. Revisit in Block 9 polish or post-launch — not
now. JSDoc + `@typedef` blocks give editor autocomplete with zero
infrastructure change.

Interface contract lives in `functions/_lib/connectors/types.js` with
`@typedef` declarations.

#### H. Interface methods

Every connector implements:

```js
/**
 * @typedef {Object} Connector
 * @property {(ctx) => ConnectorMetadata} getMetadata
 * @property {(ctx) => Promise<StartAuthResult>} startAuth
 * @property {(ctx, params) => Promise<CompleteAuthResult>} completeAuth
 * @property {(ctx, credentials) => Promise<Credentials>} refreshAuth
 * @property {(ctx, connection) => Promise<TestConnectionResult>} testConnection
 * @property {(ctx, connection) => Promise<SyncResult>} fullSync
 * @property {(ctx, connection) => Promise<SyncResult>} incrementalSync
 * @property {(ctx, request) => Promise<Response>} [handleWebhook]
 */
```

**Every method takes `ctx` as its first arg, including `getMetadata`.**
Consistent signature simplifies typing and mocking. `getMetadata`
ignores `ctx` for v1.1 connectors but the door stays open for context-
dependent metadata later (e.g., region-specific OAuth scopes).

**Note on `testConnection` shape (revised from H's original wording).**
Signature is `testConnection(ctx, connection)` where `connection` is
the SELECTed row, not plaintext credentials. The connector decrypts
internally (decision L). This was inconsistent with the L decision in
Jenny's lock; resolved here in favor of L.

**Authoring guidance for future connectors** (Slack, Jira, Monday,
Drive — Blocks 4+). Your `testConnection`, `fullSync`,
`incrementalSync`, and `refreshAuth` implementations receive the
**full connection row** as their second argument and **decrypt the
credentials internally** by calling `decrypt(env, connection, aadFor(connection))`. They do **not** receive plaintext credentials
from the API handler. The handler's job ends at SELECTing the row
(whitelisted columns *plus* `wrapped_data_key`/`iv`/
`ciphertext_credentials`/`encryption_algorithm`) and gating auth via
`requireProjectRole`; from there, the connector owns the credential
lifecycle. This keeps decryption surface area tightly localized to
per-connector code where the AAD construction and the source-system
call sit together — no plaintext credential flowing across module
boundaries.

#### I. ctx shape

```js
/** @typedef {{ env, request, sql, projectId, connectionId? }} ConnectorCtx */
```

**IDs only.** No full user/project objects, no role info, no member list.
Connectors must not do their own auth checks — that's the API handler's
job (HANDOFF principle #3, settled before the connector is called).

If a future connector legitimately needs project name or user email
(e.g., OAuth state generation), add the specific field at that point
with a clear reason. Default to less. Each new field passed into
`ctx` widens the connector's surface area — keep it tight.

When a connector needs the connection row itself (e.g., for AAD or
decryption), the API handler SELECTs a whitelisted row and passes it
explicitly as the second argument (decision H), separate from `ctx`.

#### J. Connector metadata

```js
/**
 * @typedef {Object} ConnectorMetadata
 * @property {'dummy'|'slack'|'jira'|'monday'|'drive'} source
 * @property {string} displayName
 * @property {'none'|'token'|'oauth'} authKind
 * @property {string} [description]
 */
```

`source` matches the schema CHECK constraint values. Used by the
registry → API → eventually the Block 4+ Connections UI for icon and
button copy.

### Registry — K

#### K. Registry shape

`functions/_lib/connectors/registry.js`:

```js
import { dummy } from './dummy.js';

/** @type {Record<string, Connector>} */
const connectors = { dummy };

export function getConnector(source) {
  const conn = connectors[source];
  if (!conn) throw new Error(`Unknown connector source: ${source}`);
  return conn;
}

export function listConnectors() {
  return Object.values(connectors).map(c => c.getMetadata({}));
}
```

`dummy` is the only entry. Slack/Jira/Monday/Drive added in their own
blocks. **No pre-stubs** — empty entries invite drift, and the schema
CHECK already lists them so adding implementations later is non-
breaking.

### Dummy connector — L through N

#### L. Dummy auth model

`authKind: 'none'`.

- `startAuth(ctx)` → returns `{ credentials: {} }` immediately.
- `completeAuth(ctx, params)` → no-op, returns `{ credentials: {}, accountInfo: { id: ctx.dummyAccountId } }`.
- `refreshAuth(ctx, credentials)` → returns input unchanged.
- `testConnection(ctx, connection)` → **calls `decrypt(env, connection, aadFor(connection))` and asserts the round-trip succeeds.** Returns
`{ ok: true }` on success, throws (caught by handler → 500) on
failure. Does NOT return a bare `{ ok: true }` without exercising the
crypto path. The dummy's job is to validate the framework end-to-
end; the crypto round-trip is part of the framework.
- `fullSync(ctx, connection)` → see decision N.
- `incrementalSync(ctx, connection)` → delegates to `fullSync` (no
cursor semantics for dummy).
- No `handleWebhook`.

The empty `{}` payload is encrypted on connect (decision M); subsequent
`testConnection` calls verify the row decrypts to `{}` byte-identical.
This proves encrypt/decrypt/AAD are wired up correctly without needing
real credentials.

#### M. Dummy connection metadata

On `POST /api/projects/:id/connections` with `{ source: 'dummy' }`:

- `display_name` defaults to `"Dummy Connector"` if admin doesn't
override (POST body field is optional for dummy).
- `external_account_id` = `dummy-${crypto.randomUUID().slice(0, 12)}`
so multiple dummy connects to the same project don't collide on the
schema's UNIQUE constraint
(`(project_id, source, external_account_id, deleted_at)` NULLS NOT
DISTINCT).
- `status` flips `pending → active` immediately on connect (no OAuth
wait).
- `credential_metadata` JSONB starts as `{}`.

#### N. Dummy entity payload

`fullSync` writes 3 hardcoded entities:

```js
[
  {
    source: 'dummy',
    source_type: 'dummy_item',
    source_id: 'dummy-1',
    title: 'Dummy item 1',
    content_text: 'Fixture content for the first dummy entity.',
    metadata: { tag: 'fixture' },
    source_url: 'https://example.com/dummy/1',
  },
  { /* dummy-2 */ },
  { /* dummy-3 */ },
]
```

- `source_url` populated because PRD principle 2 / schema comment
requires it for citations. `example.com` is IANA-reserved and conveys
"fixture" clearly.
- Idempotency via UPSERT on the schema's
`UNIQUE (connection_id, source_type, source_id)` constraint:
  ```sql
  INSERT INTO entities (...) VALUES (...)
  ON CONFLICT (connection_id, source_type, source_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    content_text = EXCLUDED.content_text,
    metadata = EXCLUDED.metadata,
    source_url = EXCLUDED.source_url,
    updated_at = NOW()
  RETURNING (xmax = 0) AS inserted;
  ```
  `xmax = 0` distinguishes inserts from updates — feeds
  `sync_runs.records_inserted` vs `records_updated` counts.

### API surface — O through Q

#### O. URL shapes

Five endpoints under `/api/projects/:id/connections/`. All gated by
`requireProjectRole`.


| Method   | Path                                              | Role   | Purpose                             |
| -------- | ------------------------------------------------- | ------ | ----------------------------------- |
| `POST`   | `/api/projects/:id/connections`                   | admin  | Create a new connection             |
| `GET`    | `/api/projects/:id/connections`                   | member | List active connections for project |
| `DELETE` | `/api/projects/:id/connections/:connId`           | admin  | Soft-delete a connection            |
| `POST`   | `/api/projects/:id/connections/:connId/sync`      | admin  | Trigger a full sync (synchronous)   |
| `GET`    | `/api/projects/:id/connections/:connId/sync-runs` | member | List recent sync runs               |


File layout under `functions/api/projects/[id]/connections/`:

- `index.js` — onRequestPost (create), onRequestGet (list)
- `[connId]/index.js` — onRequestDelete (soft-delete)
- `[connId]/sync.js` — onRequestPost (trigger sync)
- `[connId]/sync-runs.js` — onRequestGet (list runs)

#### P. Sync execution model

Synchronous, inline in the request. Dummy syncs in <50ms; well under
the 30s Workers CPU limit.

**Header comment in `sync.js` documents both the upgrade path AND the
limit boundary:**

```js
// SYNC EXECUTION NOTE
// -------------------
// Synchronous, inline. Dummy syncs in <50ms — well under Workers' 30s
// CPU limit. This pattern works for any connector whose full sync fits
// in one Worker invocation.
//
// UPGRADE PATH (Block 4+ if needed):
//   - Slack backfill on a busy channel WILL exceed 30s.
//   - When that happens: enqueue a sync job to Cloudflare Queues from
//     this handler, return 202 with the sync_run id, and process the
//     queue in a separate Worker. The sync_run row's status field
//     (running → succeeded/failed) is the polling target for the UI.
//
// LIMIT BOUNDARY (today):
//   - If a sync exceeds 30s here, Workers will kill it mid-flight.
//     The sync_run row will be left in 'running' status with no
//     finished_at — orphan rows that the v1.1 deployment doesn't
//     reap. Acceptable for dummy; revisit before any real connector
//     ships syncs that could plausibly approach 30s.
```

For Block 3 specifically, no need to actually handle the >30s case —
just document it.

#### Q. Error contract + response whitelist

Mirror Block 2:

- `401 Not authenticated` — no session cookie or expired
- `403 Forbidden` — collapses all auth failures (not member, wrong role,
cross-project, project soft-deleted)
- `400 <verbatim message>` — validation errors render verbatim in client
- `409` — Postgres `23505` unique-constraint violation (e.g.,
reconnecting same dummy at same `external_account_id` while one is
still active)
- `500 Internal error` — generic, no detail leaked

**Response whitelist** for connection rows (apply to POST create and
GET list responses):

```js
const CONNECTION_PUBLIC_COLUMNS = [
  'id',
  'project_id',
  'source',
  'display_name',
  'external_account_id',
  'status',
  'status_reason',
  'last_sync_at',
  'created_at',
  'updated_at',
];
```

**Explicit deny-list comment in the response shaping code:**

```js
// SECURITY: never include the following columns in API responses:
//   - wrapped_data_key, iv, ciphertext_credentials
//     (the encrypted credential bytes — directly attackable offline)
//   - encryption_algorithm
//     (information leak about security posture; "transparency" is
//      not a user benefit here, only an attacker benefit)
//   - credential_metadata
//     (may contain non-secret OAuth scopes / refresh-expiry hints
//      that aid reconnaissance; surface only via admin endpoints
//      added later, not the per-project members API)
```

`status_reason` IS in the whitelist (admin needs to see "Slack token
revoked, please reconnect" or similar). The schema column is
`status_reason`, not `error_message` (Jenny's lock named
`error_message`; resolved here in favor of the actual schema column).

`sync_runs` rows whitelist (for the GET sync-runs endpoint):

```js
const SYNC_RUN_PUBLIC_COLUMNS = [
  'id',
  'connection_id',
  'project_id',
  'status',
  'sync_mode',
  'started_at',
  'finished_at',
  'records_inserted',
  'records_updated',
  'records_skipped',
  'error',
];
```

`detail` JSONB is NOT in the whitelist for v1.1 — admin-only diagnostic
data, not member-facing. Add to a future admin endpoint if needed.

### Verification — R

#### R. Curl matrix + commit ordering

**Verification matrix scenarios** (see "Verification matrix" section
below for full per-scenario detail). Three are silent-failure-mode
checks specifically called out in Jenny's lock:

1. **Plaintext leak check** — read the row directly via SQL after
  connect; assert `ciphertext_credentials` is NOT the UTF-8 bytes
   of `{}`. Defends against an "encryption helper accidentally stores
   plaintext" bug that all functional tests would pass.
2. **AAD-tampering detection** — direct SQL UPDATE swaps the row's
  `connection_id` (or `project_id`/`source`); subsequent decrypt-
   triggering API call (sync, testConnection) must fail. Defends
   against "AAD wired through code path but never actually validated."
   **Run on a Neon branch off production, not on production itself**
   — DML against security-test rows feels wrong on prod data and the
   branch is cheap (Neon free tier allows 10).
3. **Algorithm-tag check** — after connect, verify
  `encryption_algorithm = 'aes-256-gcm-v1'` in the row. Defends
   against a future "forgot to set this column" regression.

**Five-commit ordering** for the branch:


| #   | Commit subject                                                            | Contents                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `docs(block-3): lock Block 3 design decisions A–R`                        | This file (`BLOCK_3_PLAN.md`) only                                                                                                                                                                                                                                                                                                                                       |
| 2   | `feat(block-3): add envelope encryption helper + algorithm tag migration` | `functions/_lib/crypto.js` (envelope encryption + length-prefixed AAD per decision C), `db/migrations/2026-05-04-encryption-algorithm-v1.sql` (file landed but NOT applied — Jenny applies via Neon SQL Editor before commit 4 ships), plus `functions/api/crypto-roundtrip.js` smoke endpoint (env-gated via `env.ALLOW_CRYPTO_SMOKE`, Preview-only, 404 in production) |
| 3   | `feat(block-3): add Connector interface + registry + dummy connector`     | `functions/_lib/connectors/types.js`, `functions/_lib/connectors/registry.js`, `functions/_lib/connectors/dummy.js`                                                                                                                                                                                                                                                      |
| 4   | `feat(block-3): add connections + sync HTTP API`                          | Five endpoints under `functions/api/projects/[id]/connections/...`                                                                                                                                                                                                                                                                                                       |
| 5   | `docs(block-3): closeout — verification matrix + HANDOFF addendum`        | `curl-matrix-block-3.md`, `HANDOFF.md` Block 3 closeout addendum, optional cleanup of any tracked-but-deferred files                                                                                                                                                                                                                                                     |


**Schema migration application** (per "Schema prerequisite" above):
Jenny applies the `db/migrations/2026-05-04-encryption-algorithm-v1.sql`
file to Neon production via the SQL Editor before commit 4 lands the
code that writes the value.

**Roundtrip endpoint gating** (commit 2, locked): the smoke-test
endpoint at `functions/api/crypto-roundtrip.js` is env-gated via
`env.ALLOW_CRYPTO_SMOKE`. Returns 404 in production. Set
`ALLOW_CRYPTO_SMOKE=true` on the Preview environment only (via
`wrangler pages secret put` for the Preview env, or as a
Preview-scoped `var` in `wrangler.toml`). The endpoint catches
"encryption silently broken" failure modes earlier in the verification
chain than the end-to-end flows do — worth keeping in the repo as a
permanent preview-only smoke surface.

---

## Five-commit work order

Same five commits as decision R; expanded with per-commit gates and
expected diff size.

### Commit 1 — `BLOCK_3_PLAN.md` (this file)

- Files: `BLOCK_3_PLAN.md` (new)
- Diff size: ~500 lines, single new file
- Gate: Jenny reviews end-to-end, approves before commit (this step,
per WORKFLOW)
- Push: separate per-push approval after commit

### Commit 2 — Crypto helper + algorithm migration + smoke endpoint

- Files: `functions/_lib/crypto.js` (new), `db/migrations/2026-05-04- encryption-algorithm-v1.sql` (new), `functions/api/crypto-roundtrip .js` (new, env-gated via `env.ALLOW_CRYPTO_SMOKE`, Preview-only,
404 in production)
- Diff size: ~250 lines code + ~10 lines SQL
- **SECURITY CARVE-OUT** — re-flag at commit time per WORKFLOW. Three
sub-changes (helper, AAD, master key loading) listed above.
- **Migration application timing:** the migration *file* is committed
in commit 2 (so it's reviewable and tracked in repo history). The
migration is **NOT applied** as part of this commit. Jenny applies
it via Neon SQL Editor before commit 4 ships — the gap lets commits
2 and 3 land while the schema migration is staged for application.
This split is intentional: separates "code change" gating from
"production data change" gating, per WORKFLOW Hard Limits. **The
commit body must explicitly say:** *"Migration file landed but NOT
applied — Jenny applies via Neon SQL Editor before commit 4 ships."*
Belt-and-suspenders against tribal knowledge: a future reader of
the commit history shouldn't need to cross-reference this plan to
know the schema state.
- **Pre-commit (Jenny's hands-on work, between diff approval and the
commit landing):**
  - Set `MASTER_ENCRYPTION_KEY` Workers Secret for Production *and*
  Preview (`openssl rand -base64 32 | npx wrangler pages secret put MASTER_ENCRYPTION_KEY`).
  - Set `ALLOW_CRYPTO_SMOKE=true` for Preview only.
  - The schema migration file itself is reviewed in this commit's
  diff but applied later (per the timing note above).
- Gate: diff review, then commit approval, then per-push approval

### Commit 3 — Connector interface + registry + dummy

- Files: `functions/_lib/connectors/types.js` (new), `functions/_lib/ connectors/registry.js` (new), `functions/_lib/connectors/dummy.js`
(new)
- Diff size: ~200 lines (mostly JSDoc + dummy implementation)
- Gate: standard diff + commit + push approval

### Commit 4 — Connections + sync HTTP API

- Files: `functions/api/projects/[id]/connections/index.js` (new),
`functions/api/projects/[id]/connections/[connId]/index.js` (new),
`functions/api/projects/[id]/connections/[connId]/sync.js` (new),
`functions/api/projects/[id]/connections/[connId]/sync-runs.js` (new)
- Diff size: ~400 lines across four files
- Gate: standard diff + commit + push approval. After push, run the
full verification matrix on the preview deploy.

### Commit 5 — Verification matrix + HANDOFF addendum + closeout

- Files: `curl-matrix-block-3.md` (new), `HANDOFF.md` (Block 3 closeout
addendum), possibly small cleanup
- Diff size: ~300 lines docs + addendum
- Gate: ff-merge to `main` after push approval. Smoke-test endpoint is
removed from production paths via the env gate; no code change
required. Roundtrip endpoint can stay in the repo for future preview
smoke tests.

---

## Verification matrix

To be expanded into the full per-scenario doc in commit 5
(`curl-matrix-block-3.md`). Sketch of the scenarios:

### Auth + scoping (mirrors Block 2 patterns)

1. POST/GET/DELETE/POST-sync/GET-sync-runs without session → 401
2. POST without admin role on the project → 403
3. POST as Bob to project Alice owns and Bob isn't a member of → 403
4. DELETE/POST-sync as member (not admin) → 403
5. Session valid, project soft-deleted → 403 (collapse with not-a-
  member case)
6. Cross-project leakage on GET — Bob in P1 cannot see P2 connections
  even by guessing the connId

### Functional flow

1. POST `/api/projects/:id/connections` with `{ source: 'dummy' }` as
  admin → 201, response carries whitelisted columns only, no
   `wrapped_data_key`/`iv`/`ciphertext_credentials`/`encryption_  algorithm`/`credential_metadata`
2. GET `/api/projects/:id/connections` → list contains the new row,
  whitelisted columns only
3. POST `/api/projects/:id/connections/:connId/sync` → 200, response
  carries the sync_run row, status='succeeded', records_inserted=3
4. Direct SQL: `SELECT count(*) FROM entities WHERE connection_id =
  $1` → 3
5. Re-run scenario 9 → response status='succeeded',
  records_inserted=0, records_updated=3 (idempotency on the upsert
    key)
6. Direct SQL: same count after re-sync → still 3
7. GET `/api/projects/:id/connections/:connId/sync-runs` → list
  returns both runs in chronological order
8. DELETE `/api/projects/:id/connections/:connId` → 200, GET list no
  longer returns the row, DB row has `deleted_at IS NOT NULL`

### Silent-failure-mode checks (Jenny's lock — R)

1. **Plaintext leak.** After connect (scenario 7), direct SQL:
  `SELECT ciphertext_credentials FROM connections WHERE id = $1` →
    bytes are NOT the UTF-8 encoding of `{}` (i.e., not `0x7B 0x7D`).
2. **AAD-tampering detection.** On a **Neon branch off production**.
  Ownership is split per WORKFLOW Hard Limits — DML against a real
    Neon database (even a branch) is Jenny's. Each step is tagged
    with its owner so the handoff is unambiguous:
  - **[Claude Code]** Create a Neon branch off the production
  branch via the Neon API or `neonctl branches create`.
  Capture the branch's connection string.
  - **[Claude Code]** Connect a dummy connector against the branch
  (preview deploy or local `wrangler pages dev` pointed at the
  branch's connection string), capture `connId`.
  - **[Claude Code]** SELECT the row to capture pre-tampering state
  (`id`, `project_id`, `source`, `encryption_algorithm`) — used
  in the post-test assertion to confirm the tampering actually
  changed what we think it changed.
  - **[Jenny]** Direct SQL via Neon SQL Editor against the branch:
  `UPDATE connections SET project_id = $other WHERE id = $connId`
  (or swap `source`/`connection_id` similarly).
  - **[Claude Code]** POST `/api/projects/$other/connections/$connId/sync`
  against the preview deploy → must result in a sync_run with
  `status='failed'` and a decrypt-error message in the `error`
  column. NOT a successful sync.
  - **[Claude Code]** Drop the Neon branch (`neonctl branches delete` or Neon dashboard).
3. **Algorithm-tag check.** After scenario 7, direct SQL:
  `SELECT encryption_algorithm FROM connections WHERE id = $1` →
    `'aes-256-gcm-v1'` exact match.

### Validation

1. POST with body `{ source: 'unknown_source' }` → 400 with verbatim
  `"Unknown connector source: unknown_source"`
2. POST with body `{}` → 400 with verbatim `"source is required"`
3. POST with body `{ source: 'dummy', display_name: '   ' }` →
  accepts (display_name empty-after-trim falls back to default
    `"Dummy Connector"`)
4. POST with malformed JSON → 400 with verbatim `"Invalid JSON"`
5. Reconnect same dummy with same external_account_id while previous
  is still active → 409 (PG 23505)

---

## Things deferred (don't build in Block 3)

- **Key rotation** — code deferred to post-launch. Schema column is
ready; rotation is additive when we need it. (Decision E.)
- `**handleWebhook` for any connector** — dummy doesn't have webhooks;
Slack/Jira webhooks land in their respective blocks.
- **Real `incrementalSync` semantics** — dummy delegates to `fullSync`;
cursor-based incremental sync is per-connector logic in Blocks 4–8.
- **Cloudflare Queues for async sync** — synchronous inline is fine for
dummy. Queues introduced in Block 4 if Slack backfill needs it.
(Decision P; documented in `sync.js` header.)
- **Connections tab UI in `project.html`** — backend-only block per
HANDOFF. Tab stays as the Block 2 placeholder state-card. First real
"Connect" button lands in Block 4.
- **Admin endpoint for `credential_metadata`** — non-secret OAuth
scopes / refresh-expiry would be useful for admin debugging but are
out of scope for v1.1 dummy. Add when a real connector needs it.
- **Sync scheduling / `next_sync_at` automation** — schema column
exists; populating it (cron, queue-based scheduling) is Block 4+.
- **Reaping orphan `running` sync_runs** — schema index exists for the
query (`sync_runs_running_idx`); cleanup worker is Block 9 polish.
- **Promoting/demoting connection status to `degraded` or `revoked`
on sync failure** — v1.1 dummy can't fail in interesting ways. Real
connectors will set this when their refreshAuth or sync fails
irrecoverably.

---

## Open follow-ups carried INTO Block 3 from Block 2 closeout

Not in Block 3 scope but documented so they don't get lost:

- `**requireWorkspaceAdmin` migration of `admin/users.js` + `admin/ users/[id].js`.** Behavior-identical refactor of code Block 3
doesn't otherwise touch. Good "between blocks" task.
- **Stale Hyperdrive-cache comments** in `db-test.js:71`, `projects/ [id]/index.js:38`, `db-health.js:15`. Pure doc fix; could fold into
Block 3 closeout commit 5 if convenient, otherwise Block 9.
- **Test data accumulation on Neon** — Block 2 verification rows still
present. Combined cleanup remains a between-blocks task.

---

*End of Block 3 Build Plan v1.0. Generated 2026-05-04 in the design
session for the connector framework block. Mirrors the structure of
`BLOCK_2_PLAN.md` for consistency. Updates to locked decisions require
a re-lock from Jenny per WORKFLOW.md §"Decision-locking pattern".*