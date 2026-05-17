# Block 10.4 — Curl Verification Matrix

Verification record for Block 10 sub-task 10.4 (connector guide).
Branch `block-10-4-connector-guide` at `f536dfc`, awaiting ff-merge
to `main`. Preview at
`https://block-10-4-connector-guide.elinno-agent.pages.dev`.

Code surface: **1 new file, 553 lines, 0 deletions, 0 code change.**

- `docs/CONNECTORS.md` — **new**. 13-section onboarding guide per
  BLOCK_10_PLAN.md decision L. Audience: future Jenny + Claude in
  v1.2 Monday + Drive sessions. References point at real file:line
  locations throughout.

No code change. No schema change. No DDL. Pure docs commit, AUTO
mode per per-commit classification.

## Verification posture at ff-merge

Both planned V4.x cells passed at the worktree before push.

| Cell | Status | Notes |
|---|---|---|
| **V4.1** | **PASS** | Markdown structure. 553 lines (within plan target of 400-600). 13 `## ` section headers matching the locked outline from decision L exactly (interface, OAuth, webhook, sync, crypto, write helpers, content hash, sweep, SQL view, AI tools, sync_runs, test posture, checklist). No malformed table syntax; all section anchors render. |
| **V4.2** | **PASS within ±10 line tolerance** | All 18 referenced files exist (`grep -oE '\(\.\./[a-zA-Z0-9_./\-]+\.(js\|sql\|md\|sh)' docs/CONNECTORS.md` → loop over each → all `OK`). All 13 numbered line refs land on the named symbol within the plan-allowed ±10 line tolerance. Specifically: `entity_writer.js` lines 96 / 169 / 239 / 281 / 407 each land on the named `export async function`; `entity_writer.js:253` lands on the subrequest budget comment; `tools.js` 62 / 66 / 91 / 151 / 231 / 355 land on TOOL_DEFINITIONS / search_project_data description / query_jira_issues name / list_jira_sprints description / executeTool export / runQueryJiraIssues; `content_hash.js:55` lands on `function canonicalContent(entity)`; `crypto.js:101+178` land on aadFor + encrypt exports; `types.js:13+27+35` land on the three header comment blocks (CONNECTORS DECRYPT INTERNALLY, CTX IS IDS-ONLY, CTX-FIRST SIGNATURE); `slack.js:615` + `jira.js:645` land on the `sweepMissingEmbeddings(...)` call sites; views land on `CREATE OR REPLACE VIEW slack_messages` + `CREATE OR REPLACE VIEW jira_issues`. |

## Preview smoke verification

Preview is doc-only — no compiled-Worker changes, no schema changes.

| Check | Method | Result |
|---|---|---|
| Branch alias resolves | `<branch>.elinno-agent.pages.dev` for branch `block-10-4-connector-guide` (26 chars, under 28-char alias cap) | Resolves — first poll returned 404 (build in flight); polled until 200. |
| Preview deploy succeeds | `curl -s -o /dev/null -w "%{http_code}" /api/db-health` against the preview alias | 200 (polled from background bash; logged in HANDOFF closeout for this sub-task). |
| docs/CONNECTORS.md not served as HTML | (intentional — `pages_build_output_dir = public`, `docs/` outside that) | `docs/CONNECTORS.md` is a repo-root doc, not a Pages asset. Renders only on GitHub / IDE. Confirmed by the wrangler.toml `pages_build_output_dir: public` already in production. |

## Mid-flight fixes

None. The 13-section outline from decision L was locked tight enough
that the draft landed first-try. Surveyed connector code for line
numbers BEFORE writing the guide (vs. writing-then-checking), which
caught the `EMBEDDING_MODEL_ID` constant name (vs. the plan's
shorthand `EMBED_MODEL`) and the absence of `db/schema-postgres.sql`
view definitions (views live in `db/migrations/`, not the schema
file). Both adjustments made in the draft itself, not as post-write
fixes.

## Maintenance contract

The guide is hand-maintained; code references can rot. The V4.2
verification cell is the runnable check — re-run the grep + per-line
sed when any of the referenced files moves more than ~10 lines. Per
the guide's own closing maintenance line, this is the
contract for future connector authors who touch any of the referenced
files.

If a Block 11+ change renames or moves any of `embedEntitiesBatch`,
`sweepMissingEmbeddings`, `upsertEntityRow`, `writeEntityWithEmbedding`,
`writeEntitiesWithEmbeddingsBatch`, `embedEntityRow`,
`computeContentHash`, `canonicalContent`, `executeTool`, `encrypt`,
`decrypt`, or `aadFor`, update the corresponding `[line N](path)`
ref in `docs/CONNECTORS.md` in the same commit.
