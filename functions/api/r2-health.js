// functions/api/r2-health.js
//
// Block 15.1 deliverable: prove the LOGOS R2 binding works on Preview
// and Production deploys. Mirrors functions/api/db-health.js (public,
// unauthenticated health check) so the binding is verifiable independent
// of the project-logo upload flow.
//
// What we check:
//   1. ctx.env.LOGOS is truthy (binding declared in wrangler.toml).
//   2. ctx.env.LOGOS.list({ limit: 1 }) succeeds (the deploy has
//      runtime credentials for the bucket — Pages issues these
//      automatically once the binding is in wrangler.toml).
//
// This endpoint is safe to leave open while 15.1 + 15.2 land. After
// 15.2 ships and the upload flow is the source of truth for "is R2
// alive," this file can be removed in a closeout commit.
export async function onRequestGet({ env }) {
  if (!env.LOGOS) {
    return new Response(
      JSON.stringify({ ok: false, error: 'LOGOS binding not present on env' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    // Read-only probe. List with limit:1 doesn't enumerate every key
    // (R2 returns a cursor); we just want a single round-trip to prove
    // the binding can authenticate to the bucket.
    const listing = await env.LOGOS.list({ limit: 1 });
    return new Response(
      JSON.stringify({
        ok: true,
        bucket: 'elinno-agent-logos',
        object_count_sample: listing.objects.length,
        truncated: listing.truncated,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message ?? String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}
