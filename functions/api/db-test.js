// functions/api/db-test.js
//
// Block 1 Task 4 deliverable: prove the Postgres schema works end-to-end
// through Hyperdrive — INSERT one row into `projects`, read it back, return
// the persisted row plus the same Hyperdrive sanity-check fields db-health.js
// reports. Closes Block 1.
//
// Public, unauthenticated — same posture as /api/db-health, same caveats.
//
// Test rows accumulate in `projects` (no cleanup on this endpoint). They're
// harmless because they all share owner_user_id 'block-1-task-4-test-user'
// and can be soft-deleted later in one shot:
//
//   UPDATE projects SET deleted_at = NOW()
//   WHERE owner_user_id = 'block-1-task-4-test-user';
//
// The owner_user_id is a STATIC PLACEHOLDER, not a real D1 user ID. The
// cross-DB seam (PRD §6 + db/schema-postgres.sql header) requires app code
// to verify D1 existence before inserting, but this endpoint is plumbing
// verification, not a real user flow. A real "create project" endpoint will
// be auth-protected and resolve the user ID from the session.
import postgres from 'postgres';

const TEST_OWNER_USER_ID = 'block-1-task-4-test-user';

export async function onRequestGet({ env }) {
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    // Same Workers-tuned defaults as db-health.js — see that file for the
    // reasoning. Keeping the two endpoints' connection setup identical makes
    // any future consolidation into a shared client helper straightforward.
    max: 5,
    fetch_types: false,
  });

  try {
    // Suffix the name with Date.now() so repeated hits never collide on a
    // future UNIQUE constraint on `projects.name`. The schema currently only
    // enforces NOT NULL on name, but the suffix is cheap insurance and makes
    // the rows trivially distinguishable in the database.
    const requestedAt = new Date();
    const projectName = `Block 1 Task 4 verification ${requestedAt.getTime()}`;
    const description = `Block 1 Task 4 verification row, created at ${requestedAt.toISOString()}`;

    // INSERT ... RETURNING * gives us the row Postgres actually persisted
    // (including the server-generated id, created_at, updated_at) in a single
    // round-trip. Chosen over a separate SELECT because:
    //   - One round-trip vs two (cheaper through Hyperdrive)
    //   - Atomic — no chance of a concurrent INSERT slipping a different row
    //     between our INSERT and SELECT, even with the unique-suffix name
    //   - Documents intent: "I want the row I just wrote, exactly as written"
    const [inserted] = await sql`
      INSERT INTO projects (name, description, owner_user_id)
      VALUES (${projectName}, ${description}, ${TEST_OWNER_USER_ID})
      RETURNING *
    `;

    // Sanity-check field. Mirrors db-health.js: a Neon-shaped host here would
    // mean the request bypassed Hyperdrive. See db-health.js for the full
    // explanation of why we parse from connectionString instead of reading
    // env.HYPERDRIVE.host directly.
    let hyperdriveHost = null;
    try {
      hyperdriveHost = new URL(env.HYPERDRIVE.connectionString).host;
    } catch {
      // Unparseable connection string. Don't 500 a request that already
      // succeeded its primary work (the insert + readback).
    }

    // version() round-trip mirrors db-health.js's response shape so verifying
    // either endpoint tells you the same things about the live database.
    // Cached by Hyperdrive after the first hit, so the marginal cost is tiny.
    const [{ version }] = await sql`SELECT version() AS version`;

    return new Response(
      JSON.stringify({
        ok: true,
        inserted,
        postgres_version: version,
        hyperdrive_host: hyperdriveHost,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message ?? String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // Best-effort cleanup; never let connection teardown mask a real error.
    }
  }
}
