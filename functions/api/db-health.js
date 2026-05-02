// functions/api/db-health.js
//
// Block 1 Task 2 deliverable: prove a Pages Function can talk to Neon Postgres
// through the Cloudflare Hyperdrive binding. Public, unauthenticated health
// check — safe to leave open while the connector + AI work in Blocks 2–9
// builds on top of this plumbing.
import postgres from 'postgres';

export async function onRequestGet({ env }) {
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    // Workers-tuned defaults per Cloudflare Hyperdrive docs:
    //   max: 5            — small connection pool; Workers don't need many.
    //   fetch_types: false — skip the on-connect OID round trip; we only
    //                        touch built-in types here.
    // `prepare` is left at its default (true) so Hyperdrive caches the
    // prepared statements and saves round trips to Neon.
    max: 5,
    fetch_types: false,
  });

  try {
    const [{ one }] = await sql`SELECT 1 AS one`;
    const [{ now, version }] = await sql`SELECT NOW() AS now, version() AS version`;

    // The host the driver sees from the Hyperdrive-issued connection string.
    // By Cloudflare's design this is always a Hyperdrive endpoint, never the
    // Neon origin — Hyperdrive generates the connection string at runtime;
    // the binding does not expose Neon's URL. If a Neon-shaped host
    // (e.g., ep-*.aws.neon.tech) ever appears here, the HYPERDRIVE binding
    // is misconfigured and the request bypassed Hyperdrive.
    //
    // We parse from `connectionString` rather than reading `env.HYPERDRIVE.host`
    // because Cloudflare's docs only document `host` for MySQL Hyperdrive
    // bindings; for PostgreSQL bindings the documented access is
    // `connectionString` and the behavior of `host` is unspecified.
    let hyperdriveHost = null;
    try {
      hyperdriveHost = new URL(env.HYPERDRIVE.connectionString).host;
    } catch {
      // Unparseable connection string. Leave host null rather than 500-ing
      // a request that already produced valid query results.
    }

    return new Response(
      JSON.stringify({
        ok: true,
        one,
        now,
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
