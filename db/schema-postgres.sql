-- =============================================================================
-- Elinno Agent — Postgres schema (v1.1)
-- =============================================================================
--
-- Canonical Postgres schema for the Elinno Agent platform. This file is the
-- source of truth for the structure of the Neon database `elinno_agent_db`.
-- It lives at `db/schema-postgres.sql` in the repo and is committed to git.
--
-- HOW TO APPLY
-- ------------
-- The recommended path for v1.1 is the Neon SQL Editor:
--   1. Open Neon → Project "Elinno Agent" → branch "production"
--   2. Open SQL Editor against database `elinno_agent_db`
--   3. Paste this entire file, click Run
--   4. Verify with: SELECT table_name FROM information_schema.tables
--                   WHERE table_schema = 'public' ORDER BY table_name;
--      Expected (8 tables):
--          connections, conversations, entities, entity_embeddings,
--          messages, project_members, projects, sync_runs
--
-- Alternative: psql or wrangler against the direct (non-pooled) Neon endpoint.
-- Do not apply through Hyperdrive — Hyperdrive caches read queries and is the
-- wrong layer for DDL.
--
-- IDEMPOTENT
-- ----------
-- Every CREATE statement uses IF NOT EXISTS. Safe to re-run; existing tables,
-- indexes, and extensions are left alone. Re-running does NOT migrate columns
-- — schema changes after the initial apply will live in `db/migrations/*.sql`.
--
-- DESIGN DECISIONS (settled in chat, 2026-05-02 schema design session)
-- --------------------------------------------------------------------
-- 1. Primary keys: UUID v4 via gen_random_uuid() (pgcrypto). Better for
--    multi-tenant safety, no row-enumeration leak in URLs, easier to support
--    v1.2 cross-project work.
--
-- 2. Embedding dimension: 1536, planning OpenAI text-embedding-3-small.
--    Dimension is locked at column-creation time — model can change later
--    (any 1536-dim model drops in), dimension cannot without a migration.
--
-- 3. Vector index: HNSW with cosine distance (vector_cosine_ops). Fast queries,
--    appropriate for read-heavy chat workloads. m=16, ef_construction=64
--    (pgvector defaults; tune ef_search at query time if needed).
--
-- 4. Soft-delete strategy: HYBRID.
--    - Soft delete (deleted_at TIMESTAMPTZ NULL): projects, connections,
--      conversations, messages — user/admin may want recovery.
--    - Hard delete on FK cascade: project_members, entities, entity_embeddings,
--      sync_runs — derived/observability data, regenerable from source.
--
-- 5. Connection credential storage: envelope encryption with three columns
--    (wrapped_data_key, iv, ciphertext_credentials) plus an algorithm column.
--    Master key lives in Cloudflare Workers Secrets, never in the database.
--
-- CROSS-DATABASE SEAM
-- -------------------
-- Users live in Cloudflare D1 (auth database, SQLite at the edge), NOT in
-- this Postgres database. Columns that reference users (projects.owner_user_id,
-- project_members.user_id, conversations.user_id, etc.) are stored as TEXT
-- with NO foreign key — Postgres cannot enforce FKs across database engines.
-- Application code is responsible for verifying user existence in D1 before
-- inserting user-referencing rows here.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------

-- gen_random_uuid() for UUID v4 primary keys.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pgvector for embedding storage and HNSW index. Already enabled on Neon
-- (verified at v0.8.0); included idempotently for completeness.
CREATE EXTENSION IF NOT EXISTS vector;


-- =============================================================================
-- Table 1 of 8: projects
-- =============================================================================
-- Top-level container. Every connector, entity, conversation is scoped to a
-- project. No FKs out of this table — projects are the root.
-- Soft-deleted: archive without losing history.

CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,

    -- Cross-DB seam: references D1's users table by ID. App code verifies
    -- the user exists in D1 before inserting. Stored as TEXT for forward
    -- compatibility with any D1 user-ID format change.
    owner_user_id   TEXT NOT NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Soft delete: NULL = active, non-NULL = archived
    deleted_at      TIMESTAMPTZ
);

-- "List my active projects" — Member's main UI query.
CREATE INDEX IF NOT EXISTS projects_owner_active_idx
    ON projects (owner_user_id)
    WHERE deleted_at IS NULL;

-- "List all active projects" — admin overview.
CREATE INDEX IF NOT EXISTS projects_active_idx
    ON projects (created_at DESC)
    WHERE deleted_at IS NULL;


-- =============================================================================
-- Table 2 of 8: project_members
-- =============================================================================
-- Membership of users in projects. Roles in v1.1: 'admin', 'member'.
-- Composite PK = natural shape (no separate row identity needed).
-- Hard-deleted: removing a member means DELETE row.

CREATE TABLE IF NOT EXISTS project_members (
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Cross-DB seam (see header).
    user_id         TEXT NOT NULL,

    -- TEXT + CHECK over ENUM for evolvability. v1.2 may add 'project_admin'
    -- (per PRD §11.2 deferred items) without a type migration.
    role            TEXT NOT NULL CHECK (role IN ('admin', 'member')),

    -- Audit: who invited whom. NULL for the project owner who is auto-added
    -- as admin at project creation.
    invited_by      TEXT,
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- NULL = pending invite, non-NULL = active member.
    joined_at       TIMESTAMPTZ,

    PRIMARY KEY (project_id, user_id)
);

-- "What projects am I a member of, with active membership?" — every chat
-- session starts here. Excludes pending invites.
CREATE INDEX IF NOT EXISTS project_members_user_active_idx
    ON project_members (user_id)
    WHERE joined_at IS NOT NULL;

-- Note: "who is in this project?" is served by the PK's leading column
-- (project_id, user_id). No additional index needed.


-- =============================================================================
-- Table 3 of 8: connections
-- =============================================================================
-- Connection between a project and an external system (Slack/Jira/Monday/Drive).
-- Holds envelope-encrypted credentials and sync state. One row per
-- (project, source, external_account).
-- Soft-deleted: admin may reconnect later or restore.

CREATE TABLE IF NOT EXISTS connections (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id                  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Connector type. Extends per Block: 'dummy' (Block 3), 'slack' (Block 4),
    -- 'jira' (Block 6), 'monday' (Block 7), 'drive' (Block 8).
    source                      TEXT NOT NULL CHECK (source IN (
        'dummy', 'slack', 'jira', 'monday', 'drive'
    )),

    -- Human-readable label set by admin at connect time.
    display_name                TEXT NOT NULL,

    -- External account/workspace ID from the source system.
    -- Slack: team_id. Jira: cloudid. Monday: account_id. Drive: user email.
    external_account_id         TEXT NOT NULL,

    -- Envelope encryption (per PRD §5.4).
    -- wrapped_data_key:        per-connection DEK encrypted by master key
    --                          (master key lives in Workers Secrets, never here)
    -- iv:                      AES-GCM initialization vector (random per row)
    -- ciphertext_credentials:  the OAuth/API token, encrypted by the DEK
    -- encryption_algorithm:    recorded so we can migrate algorithms safely
    wrapped_data_key            BYTEA NOT NULL,
    iv                          BYTEA NOT NULL,
    ciphertext_credentials      BYTEA NOT NULL,
    encryption_algorithm        TEXT NOT NULL DEFAULT 'aes-256-gcm',

    -- Non-secret metadata about the credentials (scopes, refresh expiry, etc.).
    -- NEVER put plaintext credentials here — schema can't enforce, app must.
    credential_metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Lifecycle:
    --   pending:  OAuth flow started but not yet completed
    --   active:   healthy, syncs running normally
    --   degraded: recent failures, retrying — usually auth refresh issues
    --   revoked:  admin disconnected or auth refresh permanently failed
    status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','active','degraded','revoked')),
    -- Free-text reason populated by sync code on status changes.
    status_reason               TEXT,

    -- Sync schedule + state.
    -- last_sync_cursor: opaque, connector-defined (Slack ts, Jira ISO date, etc.).
    -- next_sync_at NULL = "do not schedule" (webhook-only or revoked).
    last_sync_at                TIMESTAMPTZ,
    last_sync_cursor            TEXT,
    next_sync_at                TIMESTAMPTZ,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMPTZ,

    -- Prevents the same admin from connecting the same Slack workspace twice
    -- WHILE ACTIVE. NULLS NOT DISTINCT (Postgres 15+) lets reconnections work:
    -- two soft-deleted rows with timestamp values don't collide with a new
    -- active row whose deleted_at is NULL.
    -- If Neon's Postgres rejects this clause, fall back to a partial unique
    -- index: CREATE UNIQUE INDEX ... ON (project_id, source, external_account_id)
    -- WHERE deleted_at IS NULL.
    UNIQUE NULLS NOT DISTINCT (project_id, source, external_account_id, deleted_at)
);

-- "What's connected to this project?" — admin connections panel.
CREATE INDEX IF NOT EXISTS connections_project_active_idx
    ON connections (project_id)
    WHERE deleted_at IS NULL;

-- "Which connections are due for sync?" — sync scheduler hot path.
CREATE INDEX IF NOT EXISTS connections_due_for_sync_idx
    ON connections (next_sync_at)
    WHERE deleted_at IS NULL
      AND status = 'active'
      AND next_sync_at IS NOT NULL;


-- =============================================================================
-- Table 4 of 8: entities
-- =============================================================================
-- The unified record store. Every Jira ticket, Slack message, Monday item,
-- Drive file lands here. Project-scoped, indexed for relational queries,
-- full-text search, and JSONB containment.
-- Hard-deleted on FK cascade — derived data, regenerated on re-sync.

CREATE TABLE IF NOT EXISTS entities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Denormalized for query performance: every search filters by project_id,
    -- and avoiding the join through connections matters. App code MUST set
    -- this to match connections.project_id when inserting.
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    connection_id   UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,

    -- Mirrors connections.source. Denormalized for the same reason as project_id.
    source          TEXT NOT NULL CHECK (source IN (
        'dummy', 'slack', 'jira', 'monday', 'drive'
    )),

    -- Connector-defined object kind. NOT CHECK-constrained — connectors add
    -- types freely (jira_issue, jira_sprint, slack_message, slack_channel,
    -- drive_doc, drive_sheet, drive_pdf, monday_item, monday_board, etc.).
    source_type     TEXT NOT NULL,

    -- External system's ID for this object. Format varies by source.
    source_id       TEXT NOT NULL,

    -- Short human-readable label for citations and UI display.
    title           TEXT,

    -- Full searchable text. Fed to FTS index AND to embedding model.
    content_text    TEXT,

    -- Author info from the source system (NOT a reference to our users table).
    author_external_id      TEXT,
    author_display_name     TEXT,

    -- Timestamps from the SOURCE system (not our DB row timestamps).
    -- source_updated_at drives incremental sync cursors and recency sorting.
    source_created_at       TIMESTAMPTZ,
    source_updated_at       TIMESTAMPTZ,

    -- Connector-defined structured fields. AI tool-calling reads this for
    -- filters: e.g., metadata @> '{"status": "In Progress"}'.
    -- NEVER duplicates content_text — that's separate.
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Complete original payload from source API. Lets us re-derive
    -- title/content_text/metadata without re-fetching from source if connector
    -- logic changes. Optional — connector decides whether to store.
    raw             JSONB,

    -- Direct link to source object. Required for AI citations
    -- (PRD design principle 2: every answer needs a citation).
    source_url      TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Sync upserts on this key.
    UNIQUE (connection_id, source_type, source_id)
);

-- Project-scoped recency search: "recent Jira tickets in this project."
CREATE INDEX IF NOT EXISTS entities_project_source_recency_idx
    ON entities (project_id, source, source_type, source_updated_at DESC NULLS LAST);

-- Sync cursor support: "what's the most recent thing I've already synced?"
CREATE INDEX IF NOT EXISTS entities_connection_updated_idx
    ON entities (connection_id, source_updated_at DESC NULLS LAST);

-- Full-text search on title + content. Used for keyword search, complementing
-- vector search.
CREATE INDEX IF NOT EXISTS entities_fts_idx
    ON entities USING GIN (
        to_tsvector('english',
            COALESCE(title, '') || ' ' || COALESCE(content_text, '')
        )
    );

-- JSONB containment for tool-calling filters: metadata @> '{...}'.
-- jsonb_path_ops is smaller/faster than default jsonb_ops for @> queries.
CREATE INDEX IF NOT EXISTS entities_metadata_idx
    ON entities USING GIN (metadata jsonb_path_ops);


-- =============================================================================
-- Table 5 of 8: entity_embeddings
-- =============================================================================
-- pgvector embeddings, separated from entities so the entity row stays small
-- when not needed and so v1.2 multi-chunk doesn't need a schema migration.
-- One row per (entity, chunk_index, model). HNSW with cosine distance.
-- Hard-deleted on FK cascade — derived from entities.content_text.

CREATE TABLE IF NOT EXISTS entity_embeddings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    entity_id       UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

    -- Denormalized for HNSW pre-filter (vector index doesn't combine well
    -- with WHERE clauses through joins). App code MUST set this to match
    -- entities.project_id.
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- v1.1: always 0. v1.2: long Drive docs may chunk into 0, 1, 2, ...
    chunk_index     INTEGER NOT NULL DEFAULT 0,

    -- The exact text that was embedded. Lets us re-embed on model switch
    -- without re-fetching from source, and lets citations show the precise
    -- chunk that matched a query.
    chunk_text      TEXT NOT NULL,

    -- Dimension locked at 1536 (Q2: OpenAI text-embedding-3-small).
    -- Different dimension requires new column or new table.
    embedding       VECTOR(1536) NOT NULL,

    -- Provider/model identifier. Format: 'provider/model'.
    -- E.g., 'openai/text-embedding-3-small'. Critical for model migrations.
    model           TEXT NOT NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Re-embedding same chunk with same model = UPSERT (replace).
    -- Different model = new row (lets us run dual-search during migration).
    UNIQUE (entity_id, chunk_index, model)
);

-- HNSW with cosine distance for similarity search. Operator: embedding <=> $vec.
-- m=16, ef_construction=64 are pgvector defaults — solid for our scale.
-- Tune ef_search at query time, not here.
CREATE INDEX IF NOT EXISTS entity_embeddings_hnsw_idx
    ON entity_embeddings USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Pre-filter index for project_id. Critical: HNSW alone doesn't filter by
-- project; this index is what makes "WHERE project_id = $1 ORDER BY embedding
-- <=> $2 LIMIT N" use the project_id filter before the vector op.
CREATE INDEX IF NOT EXISTS entity_embeddings_project_idx
    ON entity_embeddings (project_id);

-- Re-embedding sweeps: "find entities without an embedding from model X."
CREATE INDEX IF NOT EXISTS entity_embeddings_entity_model_idx
    ON entity_embeddings (entity_id, model);


-- =============================================================================
-- Table 6 of 8: sync_runs
-- =============================================================================
-- Observability for connector syncs. One row per sync attempt.
-- Hard-deleted on FK cascade — observability data, churns naturally.
-- No retention policy at schema level for v1.1; revisit if growth becomes an issue.

CREATE TABLE IF NOT EXISTS sync_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    connection_id   UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    -- Denormalized for project-scoped admin queries.
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Lifecycle:
    --   running:    in-flight (started_at set, finished_at NULL)
    --   succeeded:  clean finish
    --   failed:     fatal error (error column populated)
    --   cancelled:  killed (admin disconnected mid-sync, etc.)
    status          TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','cancelled')),

    -- full:        complete re-sync (rare — first connect or admin reset)
    -- incremental: cursor-based catch-up (the default)
    -- webhook:     real-time event from source (one row per webhook event)
    sync_mode       TEXT NOT NULL CHECK (sync_mode IN ('full','incremental','webhook')),

    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,

    -- What happened during the sync.
    records_inserted    INTEGER NOT NULL DEFAULT 0,
    records_updated     INTEGER NOT NULL DEFAULT 0,
    records_skipped     INTEGER NOT NULL DEFAULT 0,

    -- Cursor window for debugging incremental syncs.
    cursor_before   TEXT,
    cursor_after    TEXT,

    -- Free-text error message, NULL unless status='failed'.
    error           TEXT,
    -- Optional connector-defined structured detail (rate limits hit, channels
    -- skipped, etc.).
    detail          JSONB
);

-- Admin UI: recent sync runs for a connection.
CREATE INDEX IF NOT EXISTS sync_runs_connection_recency_idx
    ON sync_runs (connection_id, started_at DESC);

-- Operational: stuck running rows (cleanup workers).
CREATE INDEX IF NOT EXISTS sync_runs_running_idx
    ON sync_runs (started_at)
    WHERE status = 'running';

-- Project-scoped sync overview.
CREATE INDEX IF NOT EXISTS sync_runs_project_recency_idx
    ON sync_runs (project_id, started_at DESC);


-- =============================================================================
-- Table 7 of 8: conversations
-- =============================================================================
-- AI chat threads. Each conversation is owned by a single user, scoped to a
-- single project. Soft-deleted: archive is recoverable.
-- Per PRD §3, conversations are private to their owner — other project
-- members do not see each other's conversations.

CREATE TABLE IF NOT EXISTS conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Cross-DB seam (see header). The user who owns the conversation.
    user_id         TEXT NOT NULL,

    -- Auto-generated by AI from first message; user-editable. NULL allowed
    -- for brand-new conversations that haven't accumulated content yet.
    title           TEXT,

    -- Denormalized for the conversation list query (sidebar UI). App code
    -- updates this on each new message — drift is a code-review concern, no
    -- trigger.
    last_message_at TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- Hot path: "my conversations in this project, recent first."
CREATE INDEX IF NOT EXISTS conversations_user_project_recency_idx
    ON conversations (user_id, project_id, last_message_at DESC NULLS LAST)
    WHERE deleted_at IS NULL;

-- Admin/analytics: all conversations in a project.
CREATE INDEX IF NOT EXISTS conversations_project_active_idx
    ON conversations (project_id, last_message_at DESC NULLS LAST)
    WHERE deleted_at IS NULL;


-- =============================================================================
-- Table 8 of 8: messages
-- =============================================================================
-- Individual turns in a conversation. Mirrors Anthropic's Messages API role
-- structure for direct replay. Soft-deleted: per-message undo is a real UX feature.

CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    -- Denormalized for project-scoped analytics (token usage, message volume).
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- 'user'      — human input
    -- 'assistant' — AI output (text and/or tool_use blocks)
    -- 'tool'      — tool result; on replay we map this to a 'user'-role
    --               tool_result content block per Anthropic's API
    role            TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),

    -- Text content. NULL allowed for assistant turns that are pure tool calls
    -- with no user-visible text.
    content         TEXT,

    -- For role='assistant'. Array of tool_use blocks per Anthropic API shape:
    --   [{ "id": "toolu_01", "name": "search_entities", "input": { ... } }, ...]
    tool_calls      JSONB,

    -- For role='tool'. Shape: { "tool_use_id": "toolu_01", "result": { ... } }
    tool_result     JSONB,

    -- Per PRD design principle 2: every answer needs a citation. Stored
    -- structured (not embedded in content) so UI can render citations as
    -- chips/links separately from prose.
    -- Shape: [{ "entity_id": "...", "snippet": "...", "source_url": "..." }, ...]
    citations       JSONB,

    -- Cost tracking (assistant messages only). NULL for user/tool messages.
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    -- Format: 'provider/model', e.g., 'anthropic/claude-sonnet-4-5'.
    model           TEXT,

    -- Per PRD §7: max 6 iterations per chat message. iteration=0 is the user's
    -- initial input; subsequent assistant/tool turns increment until the
    -- assistant stops calling tools.
    iteration       INTEGER NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- Hot path: chat-screen render — load conversation chronologically.
CREATE INDEX IF NOT EXISTS messages_conversation_chronological_idx
    ON messages (conversation_id, created_at)
    WHERE deleted_at IS NULL;

-- Project-scoped analytics: "messages in this project this week," token rollups.
CREATE INDEX IF NOT EXISTS messages_project_recency_idx
    ON messages (project_id, created_at DESC)
    WHERE deleted_at IS NULL;


-- =============================================================================
-- End of schema. To verify:
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
--
-- Expected (8 rows):
--   connections, conversations, entities, entity_embeddings, messages,
--   project_members, projects, sync_runs
--
-- And to verify pgvector and HNSW are present:
--
--   SELECT extname, extversion FROM pg_extension
--   WHERE extname IN ('pgcrypto', 'vector');
--
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE indexname = 'entity_embeddings_hnsw_idx';
--
-- =============================================================================
