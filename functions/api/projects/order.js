// functions/api/projects/order.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// PUT /api/projects/order — set the GLOBAL display order of projects.
//
//   body: { order: ["<uuid>", "<uuid>", ...] }
//
// AUTHORIZATION (workspace-admin only)
// ------------------------------------
// Gated by requireWorkspaceAdmin (D1 users.is_admin = 1). Members get 403
// before any read/write. The order is workspace-global — one admin sets it,
// every user sees the same arrangement (sort_position lives on `projects`,
// no per-user state) — so this MUST stay admin-only.
//
// INPUT IS ATTACKER-CONTROLLED. `order` is validated hard:
//   - must be a non-empty array of strings;
//   - every item must match the canonical UUID format (no SQL ever sees a
//     non-UUID string — ids are passed as a text[] param and cast ::uuid);
//   - no duplicates.
//
// CONSISTENCY (permutation gate)
// ------------------------------
// The posted set must be an EXACT permutation of the workspace's live
// (deleted_at IS NULL) project ids. If a project was created or deleted
// since the admin's page loaded, the sets differ → 409 {code:'stale_order'}
// and the client refetches. This guarantees a fully-defined global order
// (no half-ordered state) and is checked inside the same transaction as the
// write so the snapshot can't drift between check and update.
//
// The UPDATE sets ONLY sort_position (0-based, in posted order) and never
// touches updated_at — reordering must not disturb the "Updated X ago"
// labels or the list's secondary sort. `AND deleted_at IS NULL` keeps a
// concurrently-soft-deleted row from being resurrected into the order.
// =========================================================================
import postgres from 'postgres';
import { error, json, requireWorkspaceAdmin } from '../../_lib/auth.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestPut({ request, env }) {
  const { error: errResp } = await requireWorkspaceAdmin(request, env);
  if (errResp) return errResp;

  // ── Parse + validate body (attacker-controlled) ──────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }
  const order = body?.order;
  if (!Array.isArray(order) || order.length === 0) {
    return error('order must be a non-empty array of project ids', 400);
  }
  const seen = new Set();
  for (const id of order) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return error('order contains an invalid project id', 400);
    }
    if (seen.has(id)) {
      return error('order contains a duplicate project id', 400);
    }
    seen.add(id);
  }

  // postgres-js array-binding gotcha (HANDOFF 9.2 / Block 12.3 ANY() fix):
  // passing a JS array as a bind param (`unnest(${order}::text[])`) trips the
  // driver under Hyperdrive + fetch_types:false and 500s. The codebase's
  // established pattern is to build a Postgres array LITERAL string and let the
  // server cast it (cf. cross-project conversations `{...}::uuid[]`). Every
  // element is already hard-validated against UUID_RE above, so joining them
  // into `{…}` is injection-safe.
  const orderLiteral = '{' + order.join(',') + '}';

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    await sql.begin(async (sql) => {
      // Permutation gate: posted set must equal the live project set.
      const live = await sql`
        SELECT id::text AS id FROM projects WHERE deleted_at IS NULL
      `;
      const liveSet = new Set(live.map((r) => r.id));
      if (liveSet.size !== order.length || !order.every((id) => liveSet.has(id))) {
        // Surface as a typed error the catch below turns into 409.
        const e = new Error('stale_order');
        e._stale = true;
        throw e;
      }

      // One atomic UPDATE: sort_position = 0-based index in posted order.
      // WITH ORDINALITY yields a 1-based `ord`; subtract 1.
      await sql`
        UPDATE projects AS p
           SET sort_position = v.ord - 1
          FROM unnest(${orderLiteral}::text[]) WITH ORDINALITY AS v(id, ord)
         WHERE p.id = v.id::uuid
           AND p.deleted_at IS NULL
      `;
    });

    return json({ ok: true });
  } catch (err) {
    if (err && err._stale) {
      return error('Project list changed — refresh and try again', 409, {
        code: 'stale_order',
      });
    }
    return error('Internal error', 500);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best-effort cleanup; never masks the return value
    }
  }
}
