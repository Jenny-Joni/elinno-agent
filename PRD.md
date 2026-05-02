# Product Requirements Document

**Elinno Agent — Project Intelligence Platform**

| Field | Value |
|---|---|
| Document | PRD v1.1 |
| Owner | Jenny (jenny@elinnovation.net) |
| Status | Draft — ready for review |
| Last updated | 2026-05-02 |
| Related | Build Plan v1.1, HANDOFF.md, PROJECT.md |

---

## 1. Summary

Elinno Agent is a multi-tenant project intelligence platform. An admin creates a project, connects the team's existing tools (Jira, Slack, Monday, Google Drive), and the platform syncs and indexes that data into a unified store. Team members then chat with an AI assistant scoped to a single project, asking questions like "How many tickets are still open in this sprint?" or "How much did we spend on testing this quarter?"

The AI does not guess. Every answer is derived from a tool call against the synced data, and every fact in a response links back to its source so the user can verify. The four MVP connectors are deliberate; the architecture is built so additional connectors (Notion, Telegram, GitHub, etc.) can be added later as plug-in modules without core changes.

---

## 2. Problem & Goals

### 2.1 The problem

Project information lives across at least four tools. Status updates require humans to manually aggregate from Jira, cross-reference Monday for budget, scan Slack for context, and hunt through Drive for the relevant spec. This is slow, error-prone, and produces stale answers by the time a question is asked twice.

### 2.2 Goals (what success looks like)

- **Single source for project questions:** answers come back in seconds, with citations to the underlying record.
- **Trustworthy by construction:** the AI never invents numbers; aggregations are computed in SQL, not by the model.
- **Scoped per project:** data and AI access are isolated so cross-project leakage is not possible.
- **Pluggable connectors:** adding the fifth, sixth, tenth integration is days of work, not weeks.

### 2.3 Non-goals (v1.1)

- Cross-project AI mode. v1.1 chat is strictly bound to one project at a time. Cross-project queries are a planned v1.2 extension (see §11.1).
- Writing back to source systems (creating Jira tickets, posting to Slack, etc.). Read-only in v1.1.
- Real-time streaming chat dashboards. The chat is request/response.
- Mobile-native apps. Web only in v1.1.
- Per-user permission mirroring from source systems. The bot operates with the credentials provided at connection time; what the bot can see, all members of the project can see.

---

## 3. Users & Roles

| Role | What they do | Key capabilities |
|---|---|---|
| **Admin** | Creates the workspace and projects, connects external systems, manages members and billing. | Full control: workspace settings, projects, connectors, members, billing. |
| **Member** | Asks questions in the project chat. | Read-only chat access; sees citations and source links. |
| **AI Bot** | Internal actor that runs tools on behalf of members. | Scoped to a single project; cannot read another project's data. |

---

## 4. Core User Stories

### As an Admin

- I can create a new project with a name and description.
- I can add connections to Jira, Slack, Monday, and Google Drive using each service's recommended auth method (OAuth where supported, API token otherwise).
- I can see the sync status of each connection: last sync time, record counts, and any errors.
- I can disconnect or reconnect a service, and trigger a manual full re-sync.
- I can invite teammates to the project as Members.

### As a Member

- I can open a project and see a chat interface.
- I can ask natural-language questions and get answers with citations linking back to Jira issues, Monday items, Slack threads, or Drive files.
- I can see when data was last synced, so I know how fresh the answer is.
- I can view my conversation history within a project.

### As the System

- I encrypt every credential at rest with envelope encryption.
- I sync incrementally; full re-sync is an explicit action.
- I scope every AI tool call to the project ID; cross-project access is rejected at the tool layer regardless of prompt content.

---

## 5. Functional Requirements

### 5.1 Account & access

- Email + password authentication for app users (Admin, Member).
- Session cookies: HTTP-only, Secure, SameSite=Lax.
- Roles enforced at the API layer; the frontend role gating is convenience only.

### 5.2 Projects

- A project has: name, description, owner, created_at, members.
- Each project has its own connection set, sync schedule, AI conversation history, and entity store.
- Soft delete (archive) in v1.1; hard delete is an admin-only action with a confirmation step.

### 5.3 Connectors (MVP set)

| System | Auth method | Sync mode | Primary use |
|---|---|---|---|
| **Jira** | OAuth 2.0 (3LO) or API token + email | Incremental every 15 min; webhooks where available | Tickets, sprints, statuses, story points |
| **Slack** | OAuth bot token (workspace-scoped) | Real-time via Events API; backfill on connect | Channel messages, threads, reactions |
| **Monday** | API token (GraphQL) | Incremental every 30 min | Boards, items, custom columns (budget/time) |
| **Google Drive** | OAuth 2.0 (read-only scopes) | Incremental every 60 min; change notifications | Docs, Sheets, PDFs only in v1.1 (text extracted). Images/OCR deferred. |

### 5.4 Credential storage

- All credentials stored in a dedicated secrets store (cloud KMS-backed) or, if stored in the app database, encrypted with envelope encryption: a KMS-managed master key encrypts a per-tenant data key, which encrypts the actual secret.
- Database holds only references and minimal non-secret metadata (e.g., scope, expiry, account_id).
- OAuth refresh tokens are rotated automatically; failed refreshes mark the connection as DEGRADED and surface a re-auth prompt to the admin.
- Plaintext credentials are never logged. Logs and error reports redact secret fields by allow-list.

### 5.5 Data ingestion & storage

- All synced records are normalized into a single `entities` table with: project_id, source, source_type, source_id, title, body, url, author, metadata (jsonb), raw payload, timestamps.
- Specialized SQL views (`jira_issues`, `monday_items`, `slack_messages`, `drive_files`) provide fast typed access for structured queries.
- Vector embeddings are computed at sync time for searchable content and stored in pgvector.
- Sync jobs run on a queue with retries, backoff, dead-letter handling, and per-connector rate limiting.

### 5.6 Freshness & manual re-sync

- Every AI response shows a "data as of" timestamp per source cited, so users can judge freshness at a glance.
- Admins can trigger a manual full re-sync per connection. Rate-limited to **1 per hour** per connection to protect source-system rate limits.
- Members cannot trigger a full re-sync. They can use a "refresh and ask again" action on any AI response, which performs a targeted refresh of only the sources cited in that response, then re-runs the question. Rate-limited to **5 per user per hour**.
- The agent loop can opt into a synchronous pre-fetch on the relevant source(s) when a question contains time-sensitive language (e.g., "right now," "today," "just") or when confidence is low. This is invisible to the user.
- If a re-sync fails (rate limit, auth failure, source outage), the user sees a clear message and the existing answer remains valid with its original timestamp.

### 5.7 AI assistant

- Backed by a tool-calling LLM (Anthropic Claude). The model never produces facts directly; it picks tools and synthesizes results.
- Tool catalogue (MVP):
  - `search_project_data` — hybrid keyword + semantic search across all sources.
  - `query_jira_issues`, `list_jira_sprints`, `get_jira_sprint_summary`.
  - `list_monday_boards`, `get_monday_board_schema`, `query_monday_items`, `aggregate_monday`.
  - `list_slack_channels`, `query_slack_messages`.
  - `list_drive_files`, `read_drive_file`.
  - `aggregate_jira` (counts, sums by group).
- Every tool requires `project_id` as the first argument; the server rejects cross-project calls regardless of LLM input.
- Every response includes citations (links to source records). Responses with zero citations are treated as a model failure and surfaced as such.
- Hard cap of ~6 tool iterations per user message to bound cost and latency.

### 5.8 Admin UI

- Project list, project create flow, project members management.
- Connections panel per project: connect new, view status, manual re-sync (1/hour per connection), disconnect.
- Sync activity log: last 50 sync runs per connection with outcome and duration.

### 5.9 Member UI

- Chat interface, message history, citations rendered as inline links + source-record cards.
- "Data as of" freshness indicator on every AI response, per source cited.
- "Refresh and ask again" action on each AI response: targeted re-sync of only the cited sources, then the question is re-run automatically.
- Suggested example questions on first open per project.

---

## 6. Architecture & Hosting

Elinno Agent runs on Cloudflare's platform with one external piece for heavy-duty data. The auth foundation (Pages, Pages Functions, D1, Resend) is already deployed in production at elinnoagent.com; the connector and AI work builds on top of that, not next to it.

### 6.1 Stack

| Layer | Choice | Status |
|---|---|---|
| Frontend (welcome, login, admin, chat UI) | Cloudflare Pages | Live. |
| Light API (auth, projects, sessions) | Cloudflare Pages Functions | Live (auth endpoints shipped). |
| Auth database | Cloudflare D1 (SQLite, Frankfurt) | Live (users, sessions, password_resets). |
| Sync workers + AI agent | Cloudflare Workers | To build. |
| Job queue | Cloudflare Queues | To build. |
| Connector data + embeddings | Neon Postgres (with pgvector) via Hyperdrive | Provisioned (Block 1 in progress). |
| Email | Resend | Live (domain verified). |
| LLM | Anthropic Claude API (called from Workers) | To wire up. |

### 6.2 Why this split

- **Two databases by purpose, not by accident.** D1 is excellent for small, auth-shaped, edge-replicated data. Postgres + pgvector is what the connector data layer needs (real FTS, vector search, large JSON, heavy aggregations). Forcing one to do both would compromise either auth latency or query power.
- **Stay where things already work.** Auth, email, and hosting are deployed. Re-platforming would throw away working code and verified configuration without a clear win.
- **Free model alignment.** Cloudflare's free tier + Neon's scale-to-zero is one of the cheapest production stacks available. Important when there is no revenue offsetting infra cost.
- **Sidecar escape hatch.** If a specific connector ever needs a Node-only library that can't run in Workers, that one connector can run on a Render or Fly sidecar reached over HTTPS. The architecture does not assume Cloudflare-only forever.

### 6.3 Cloudflare-specific constraints

- Workers have a 30s CPU time limit (60s on Workers Unbound). Sync jobs and AI agent loops must chunk work; full backfills run as many small invocations rather than one long one.
- PBKDF2 iterations are capped at 100,000 in Workers Web Crypto. The auth system already accommodates this. Any future password-hashing change should verify runtime support before increasing iterations.
- Cloudflare Queues are still maturing. Adequate for v1.1; if limitations emerge, BullMQ on a Render/Fly sidecar is the migration path.
- Workers cold-start is not zero. Latency-sensitive endpoints (chat) should keep handlers small and avoid heavy cold-path initialization.
- **No managed KMS.** Cloudflare doesn't offer AWS-KMS-style managed key management. "KMS-backed" envelope encryption in our context means app-level envelope encryption with the master key stored in Workers Secrets (encrypted at rest by Cloudflare), wrapping per-tenant data keys in code. This satisfies the envelope-encryption property; it just isn't a separate managed service.

---

## 7. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | P50 chat response < 6s; P95 < 15s. Sync jobs do not block user-facing requests. |
| Availability | 99.5% target in v1.1. Single-region acceptable; multi-region is post-v1.1. |
| Security | All credentials encrypted at rest with envelope encryption. Transport TLS 1.2+. No secrets in logs. Project-scoped access enforced server-side. |
| Privacy | Users can request export and deletion of all data for a project. Sync data deletion cascades to embeddings. |
| Cost ceiling | Service is free to users; infrastructure cost is the company's burden. Per-project monthly AI cost cap; over-cap usage queues for next cycle and notifies the admin. Hard rate limits on chat messages per project per day. |
| Observability | Structured logs, per-connector sync metrics, AI tool-call traces, error budgets. |

---

## 8. Pricing & Limits

Elinno Agent is free to use in v1.1. There is no paid tier, no per-seat pricing, and no usage billing. All infrastructure cost (LLM calls, embeddings, hosting, storage) is borne by the company. This shapes several downstream decisions: usage limits exist to bound cost, not to upsell.

### 8.1 Per-project limits (v1.1 defaults)

| Limit | Default | Rationale |
|---|---|---|
| Chat messages per project per day | 100 | Bounds LLM cost. Soft limit — over-cap messages queue or return a friendly cap message. |
| Tool iterations per chat message | 6 | Caps a single question's cost; aligns with PRD section on AI assistant. |
| Connected systems per project | All MVP connectors | No artificial cap on which integrations a project can use. |
| Synced records per project | Soft cap 250k | Beyond this, ingestion slows and admin is notified. Prevents runaway storage. |
| Manual full re-sync per connection | 1 per hour (admin only) | Prevents accidental thrash on source-system rate limits. |
| Targeted re-sync per member | 5 per user per hour | "Refresh and ask again" action on a chat response; refreshes only cited sources. |
| Members per project | Unlimited (v1.1) | No reason to cap; usage cost is dominated by chat volume, not membership. |

### 8.2 Cost discipline

Because there is no revenue offsetting infrastructure cost, the AI layer must be economical by design:

- Cheap model (Haiku) for routing and tool selection; strong model (Sonnet) only for final synthesis.
- Aggressive caching of stable lookups (sprint lists, board schemas, channel lists).
- Trim tool results before passing to the LLM — never raw 80-field JSON when 8 fields suffice.
- Embed once on sync, never on query. Use a small embedding model.
- Per-project monthly hard cap (configurable). Hitting the cap pauses AI for that project until the next cycle, with admin notification and a clear in-product message.

### 8.3 Future pricing

Free in v1.1 is a deliberate choice for adoption, not a permanent commitment. Post-v1.1 may introduce paid tiers (e.g., higher message caps, priority sync, more connectors, longer history retention) without changing the architecture. The cost-cap and rate-limit infrastructure built in v1.1 is the same machinery that would later differentiate tiers.

---

## 9. Success Metrics

- **Activation:** % of new projects that connect at least 2 systems within 24 hours of creation. Target: 70%.
- **Engagement:** median chat messages per active project per week. Target after launch: 15.
- **Trust:** % of AI responses with at least one citation. Target: 95%+.
- **Reliability:** % of sync runs that complete without error. Target: 98% rolling 7-day.
- **Latency:** P95 chat response time. Target: < 15s.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Hallucinated answers erode trust | Tool-calling architecture; LLM cannot produce facts without a tool result. Always show citations. Prompt explicitly forbids guessing. |
| Credential breach | KMS-backed envelope encryption, no plaintext in logs, scoped least-privilege OAuth scopes, rotation on schedule, immediate revocation flow on incident. |
| Cross-project data leakage via prompt injection | Project ID enforced server-side on every tool call; cannot be overridden by user/model input. Tool implementations re-verify caller authorization. |
| Source-system rate limits | Per-connector token-bucket rate limiter, exponential backoff, queued retries, prefer webhooks over polling where supported. |
| Infrastructure cost runaway (no revenue offset) | Hard per-project monthly AI cost cap with auto-pause. Daily message limits. Cheap-model routing before strong-model synthesis. Aggressive caching of stable lookups. Trimmed tool result payloads. Embed once at sync, never at query. Watch metrics closely; ratchet caps down if needed. |
| Monday board heterogeneity (custom columns) | Schema-discovery tool (`get_monday_board_schema`) called before aggregation; defensive type handling and currency normalization. |
| Stale data at query time | "Data as of" timestamp shown in every answer; high-stakes queries can opt into a synchronous pre-fetch. |

---

## 11. Post-v1.1 Backlog

Items intentionally deferred from v1.1. Cross-project AI mode (§11.1) gets a fuller sketch because it's the most likely v1.2 extension and the design needs to be settled before the v1.1 architecture is locked. The remaining items are listed briefly.

### 11.1 Cross-project AI mode (planned for v1.2)

v1.1 is strictly project-scoped: every chat is bound to a single project, and tools cannot read across projects. v1.2 adds a second mode where an admin can ask questions across multiple projects — "which project is most behind schedule?", "total spent on testing across all projects?", "compare velocity between Project A and Project B."

This is the highest-privacy-risk feature in the system, so it is deliberately deferred until the project-scoped flow is rock-solid. Sketch of the v1.2 design:

#### Modes

- **Project mode (v1.1, unchanged).** Chat is bound to one project. Tools require `project_id`. Server rejects any cross-project access regardless of LLM input.
- **Cross-project mode (v1.2).** Separate chat surface at the workspace level. User explicitly opts in by entering this surface; mode is visible in the header at all times.

#### Access control

- The user must be a member of every project included in the query. Server validates membership per project on every tool call — the LLM's argument list is never trusted.
- New per-project setting: "Include in cross-project queries." Admin-only, default ON. Off by default for projects flagged as sensitive (NDA work, M&A, HR).
- If any selected project excludes itself, the AI says so plainly rather than silently dropping it.

#### Tool changes

- Existing tools accept either `project_id` (single) or `project_ids` (array). Behavior is identical otherwise.
- New tools: `compare_projects(metric, project_ids)` and `aggregate_across_projects(metric, project_ids, group_by)`.
- System prompt for cross-project mode is distinct — explicitly tells the LLM it is in cross-project mode and lists the projects in scope.

#### UI

- Workspace-level "Cross-project chat" entry point, separate from any single project.
- Project picker at the top: "All projects (5)" with checkboxes to narrow. Excluded projects are visibly grayed out with a tooltip.
- Citations grouped by project; "Sources from 4 projects" expandable rollup.
- Per-project breakdown rendering for comparison answers.

#### Limits & cost

- Separate, tighter daily message cap for cross-project mode (defaulting lower than per-project).
- Slightly higher iteration ceiling per message (e.g., 8 vs. 6) to accommodate broader scope, still bounded.
- Cross-project queries count against the workspace cost cap, not any single project's cap.

#### Risks specific to this mode

- **Permission elevation:** covered by per-call membership re-validation.
- **Prompt-injection blast radius widens;** project-scoped guardrails enforced server-side reduce but don't eliminate the risk. Treat any cross-project tool call as security-sensitive in logs.
- **Confidential project bleed:** covered by the "Include in cross-project queries" setting.
- **Citation noise from many sources:** covered by per-project rollup rendering.

#### v1.1 forward-compatibility

- v1.1 tool signatures should accept `project_id` as a string today but be defined in code in a way that extending to `project_ids: string[]` in v1.2 is non-breaking.
- v1.1 storage already keys all entities by `project_id`, so cross-project queries are a question of authorization + UI, not a data migration.

### 11.2 Other deferred items

- **Audit log for admin actions.** Track who connected/disconnected what, who invited/removed members, who triggered re-syncs. Add when there are multi-admin projects or compliance pressure.
- **Drive: images and OCR.** Extract text from screenshots, scanned PDFs, and image files in Drive.
- **Additional connectors.** Notion, Telegram, GitHub, Linear, HubSpot, etc. — added as plug-ins via the connector registry.
- **Write-back actions.** Creating Jira tickets, posting Slack messages, updating Monday items from chat. v1.1 is read-only by design.
- **Paid tiers.** Higher message caps, priority sync, longer history, more connectors. Architecture is ready; pricing is the open question.
- **Per-user permission mirroring.** Surface only data the asking user has access to in the source system, instead of project-level admin access.
- **Per-project sub-roles.** Project-scoped admin without billing access (re-introducing some of the Owner/Admin split from earlier drafts).
- **Mobile native apps.** v1.1 is web-only.

---

*End of PRD.*
