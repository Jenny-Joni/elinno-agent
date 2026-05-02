# Build Plan

**Elinno Agent — Ordered Task List for Cursor + Claude**

| Field | Value |
|---|---|
| Document | Build Plan v1.1 |
| Companion to | PRD v1.1, HANDOFF.md |
| For | Solo build with Cursor + Claude |
| Last updated | 2026-05-02 |

---

## Big Idea: One Thing at a Time

Don't work on everything at once. The right order matters more than the speed. Each task below builds on the one before it. Finish a task, see it working in production, then move to the next.

> **Rule of thumb:** If a task feels too big for one Cursor session, it is. Break it down. Each task here should fit in one to a few sessions — not days of unstructured work.

---

## Already Done (skip)

- Cloudflare Pages site live at elinnoagent.com.
- Login, password reset, admin user management.
- D1 database for users/sessions.
- Resend for emails.

Everything below builds on top of this. Don't touch the auth code unless you have a reason.

---

## Build in This Order

Each block is one focused chunk. Finish it, deploy it, see it work, then move on. Don't skip ahead.

### Block 1 — Set up the database

*Why this first: nothing else works without a place to store project data and embeddings.*

**Tasks (in order):**

1. Sign up for Neon (free tier). Create a Postgres database. Enable the pgvector extension.
2. Set up Cloudflare Hyperdrive pointing at Neon. Verify a Worker can connect.
3. With Claude's help, draft the schema: `projects`, `project_members`, `connections`, `entities`, `entity_embeddings`, `sync_runs`, `conversations`, `messages`. Review it. Apply it to Neon.
4. Write a tiny test endpoint: "insert a row into projects, read it back." Confirm it works from a deployed Worker.

**Done when:** You can insert and read rows in Neon from a Cloudflare Worker.

---

### Block 2 — Build the project shell

*Why this next: you need a project to attach connectors and chats to.*

**Tasks (in order):**

1. Admin UI: "Create project" form (name, description). Saves to Postgres.
2. Admin UI: project list page.
3. Admin UI: invite a member by email (creates a row in `project_members`).
4. Add a placeholder project page with a chat input box that just echoes your message back. Persist messages to Postgres.

**Done when:** You can create a project, invite yourself as a member, open the project page, and send chat messages that persist.

---

### Block 3 — Build the connector framework (no real connector yet)

*Why this next: you'll write four connectors. Get the shape right once, before writing one.*

**Tasks (in order):**

1. Define a TypeScript interface every connector implements: `startAuth`, `completeAuth`, `refreshAuth`, `testConnection`, `fullSync`, `incrementalSync`, optional `handleWebhook`. Have Claude help draft this; review carefully.
2. Build a connector registry: type → implementation. Empty for now.
3. Write the credential encryption helper. A connector's tokens never sit in plaintext in the database.
4. Write a fake "dummy" connector that pretends to sync three rows of test data into the `entities` table. Used to prove the plumbing works.

**Done when:** You can "connect" the dummy connector to a project and see three rows appear in the `entities` table.

---

### Block 4 — Slack connector

*Why Slack first: it forces all the hard patterns (OAuth, webhooks, real-time). Once Slack works, the others are easier.*

**Tasks (in order):**

1. Register a Slack app in Slack's developer portal. Capture the OAuth client ID and secret.
2. Build the Slack OAuth install flow: "Connect Slack" button → Slack consent screen → callback that stores the encrypted bot token.
3. List the channels the bot can see. Pick one to test against.
4. Backfill: pull recent messages from the test channel and write them as entities in Postgres.
5. Set up the Slack Events API webhook so new messages flow in real-time.
6. Add a `slack_messages` SQL view over `entities` for fast lookups.

**Done when:** You connect Slack to a project, post a new message in your test channel, and see it appear in the `entities` table within seconds.

---

### Block 5 — First AI answer

*Why this is huge: it's the first time the product feels real.*

**Tasks (in order):**

1. Embeddings pipeline: when a new entity is written, compute and store its embedding in `entity_embeddings`.
2. Build a hybrid search function: keyword (Postgres FTS) + vector (pgvector). Returns top N matching entities for a query.
3. Build the AI agent loop in a Worker: receive user message → call Claude with one tool (`search_project_data`) → execute the tool → return result to Claude → get final answer → send back to user.
4. Render the answer in the chat UI with citations as clickable links to the source Slack message.

**Done when:** You ask "what did we discuss about X" in chat and get a real cited answer pulled from your test Slack channel.

> **🎯 Milestone:** If you stop here, you already have a working product. Everything after this is adding more sources and polish.

---

### Block 6 — Jira connector

*Why next: Jira is the most structured. Adding it teaches you how to query exact data (counts, statuses) instead of just searching.*

**Tasks (in order):**

1. Add Jira as a connector: OAuth or API token (your choice; API token is faster to ship).
2. Backfill Jira issues, sprints, and statuses into `entities`.
3. Add a `jira_issues` SQL view over `entities`.
4. Add new AI tools: `query_jira_issues`, `list_jira_sprints`, `get_jira_sprint_summary`.
5. Update the agent's system prompt so the LLM knows which connectors are available for the current project.

**Done when:** "How many tickets are in this sprint?" returns the right number with a link to the sprint.

---

### Block 7 — Monday connector

*Why next: Monday is the budget/time-tracking story. Adding it unlocks the "how much did we spend" questions.*

**Tasks (in order):**

1. Add Monday as a connector with API token auth (their GraphQL API).
2. Sync boards, items, and column values.
3. Add a `monday_items` SQL view.
4. Add tools: `list_monday_boards`, `get_monday_board_schema` (boards have custom columns — the AI must check the schema first), `query_monday_items`, `aggregate_monday`.
5. Test "how much did we spend on testing?" against a real board.

**Done when:** Sum/aggregation queries against your Monday board return numbers computed in the database, not guessed by the AI.

---

### Block 8 — Google Drive connector

*Why last: Drive is mostly unstructured documents. The semantic search you already built handles them well.*

**Tasks (in order):**

1. Add Google Drive as a connector with OAuth (read-only scopes).
2. Sync file metadata: name, type, owner, folder, modified time.
3. Extract text from Google Docs (export-as-text), Sheets (cell ranges), and PDFs. Skip images and OCR.
4. Chunk long documents and embed each chunk.
5. Add tools: `list_drive_files`, `read_drive_file`.

**Done when:** "Find the spec for feature X" returns the right doc with a snippet.

---

### Block 9 — Polish for launch

*Why now: the product works end-to-end. This block makes it usable by people who aren't you.*

**Tasks (in order):**

1. Connection management UI: status, last sync time, manual re-sync (admin), disconnect.
2. Member "refresh and ask again" action on each AI response.
3. Per-project AI cost cap with admin notification when hit.
4. Daily message limits per project.
5. "Data as of" timestamp on every AI answer.
6. Suggested example questions on first project open.
7. Write the "how to add a new connector" guide — it's also the prompt template you'll use to scaffold the next connector with Claude.

**Done when:** Someone other than you can sign up, connect their tools, and ask their first question without asking you for help.

---

## How to Work With Cursor + Claude

### For each block above

1. Open a fresh Claude chat. Paste this Build Plan and the PRD. Say "we're working on Block N — help me think through the schema/design before I open Cursor."
2. Settle the design in chat (data shape, edge cases, error handling, what to test).
3. Switch to Cursor. Implement one task at a time. Read every diff before accepting.
4. Test it. Deploy a preview branch. Verify it works.
5. Merge to main. Update PROJECT.md / STATUS.md with what changed.
6. Move to the next task.

### Hard rules

- One task at a time. Don't mix Slack and Jira work in one session.
- Read every diff. AI-generated code looks right but isn't, especially for OAuth, retry logic, and SQL.
- Don't push to main without verifying it works on a preview deploy first.
- Never put plaintext credentials in the database, in code, or in logs.
- Always end a session with the trunk green. Don't leave half-done refactors overnight.

### When you get stuck

- Paste the failing code into chat with Claude. Ask "what could be wrong?" — don't describe it, paste it.
- Check Cloudflare Workers logs. Most issues show up there.
- If you're fighting the platform (Workers limits, D1 quirks), ask before working around it. Sometimes the answer is to use a sidecar.

### When NOT to use AI

- Pasting a real OAuth secret into a chat. Use placeholders.
- Letting AI design the schema without your review.
- Letting AI run database migrations or production deploys for you.
- Letting AI choose between two architectural options without you understanding both.

---

## Things to Remember While Building

- **The AI never invents numbers.** Counts and aggregations come from SQL queries, not from the model. If a number appears without a tool call, that's a bug.
- **Every answer needs a citation.** If the AI can't cite a source, it should say "I couldn't find that," not guess.
- **Project scoping is enforced in code, not in the prompt.** Every tool requires `project_id`. The server rejects calls outside the current project. Don't trust the LLM to behave — enforce it.
- **Write tool signatures so they're extensible.** v1.2 will add cross-project mode. Don't paint into a corner that requires breaking changes later.
- **Cost matters.** Free product = no revenue offsetting LLM bills. Use cheap models for routing, strong models only for synthesis. Cap iterations. Trim tool result payloads.

---

## Right Now: Your First Task

Don't plan more. Don't read more docs. Just do this:

1. Sign up for Neon. Create a database. Enable pgvector.
2. Open Cursor. Open this plan and the PRD as context.
3. Ask Claude to draft the schema for: `projects`, `project_members`, `connections`, `entities`, `entity_embeddings`, `sync_runs`, `conversations`, `messages`.
4. Review it. Apply it. Confirm tables exist in Neon.

That's Block 1, Task 1. Do that, then come back to this plan and pick the next task. If you do this on each session, you'll ship.

---

*End of Build Plan v1.1.*
