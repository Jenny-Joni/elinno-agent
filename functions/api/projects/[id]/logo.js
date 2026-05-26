// functions/api/projects/[id]/logo.js
//
// Block 15.1 — project-logo upload + delete.
//
// Routes:
//   POST   /api/projects/:id/logo  → multipart upload (field name: "file")
//   DELETE /api/projects/:id/logo  → clear the project's logo
//
// Security model (mirrors the existing PATCH/DELETE on /api/projects/:id —
// the "edit a project" gate):
//
//   1. requireWorkspaceScope: the authed session's workspace contains
//      this project (projects.owner_user_id = String(session.user.id)
//      via the helper). Failure → 401 or 403; project existence is
//      never leaked.
//
//   2. requireWorkspaceAdmin: the authed user has D1 users.is_admin = 1.
//      Failure → 403.
//
// Both gates must pass for either write. Per CLAUDE.md, this is a
// security carve-out (project-scoping enforcement on a new write
// surface) — the auth chain matches the proven pattern from
// functions/api/projects/[id]/index.js (PATCH/DELETE).
//
// Validation (POST):
//   - field "file" present                                  → otherwise 400
//   - file.type ∈ { image/png, image/jpeg }                 → otherwise 415
//   - file.size ≤ 1 MiB (1,048,576 bytes)                   → otherwise 413
//
// Side effects on a successful POST:
//   - R2 put at key `<project-id>/<8-hex>.<ext>` (ext per MIME).
//     The random suffix busts the CF edge cache on re-upload so the
//     browser never serves a stale logo.
//   - DB UPDATE: projects.logo_r2_key = <new key>, updated_at = NOW().
//   - If the project previously had a logo, the old R2 key is deleted
//     after the DB update commits (orphan-safe ordering: keep the old
//     key live until the new key is persisted).
//
// Side effects on a successful DELETE:
//   - DB UPDATE: projects.logo_r2_key = NULL, updated_at = NOW().
//   - R2 delete of the prior key (best-effort).
//
// Response shape:
//   POST 200 → { ok: true, logo_r2_key, logo_url }
//   DELETE 204 (no body, per HTTP semantics)
//
// Per BLOCK_15_PLAN.md section 2.4.
import postgres from 'postgres';
import {
  error,
  json,
  requireWorkspaceScope,
  requireWorkspaceAdmin,
} from '../../../_lib/auth.js';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg']);
const MAX_BYTES = 1024 * 1024; // 1 MiB
const LOGO_DOMAIN = 'https://logos.elinnoagent.com';

// MIME → file extension. The dot is included to keep template concat tidy.
const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

function buildLogoUrl(logoR2Key) {
  return logoR2Key ? `${LOGO_DOMAIN}/${logoR2Key}` : null;
}

// 8-hex-char random suffix using the Workers runtime crypto. 4 bytes →
// 4.3 billion possible suffixes per project; collisions effectively zero
// for the upload-per-project rate.
function randomSuffix() {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- POST — upload a new logo --------------------------------------

export async function onRequestPost({ request, env, params }) {
  const scopeResult = await requireWorkspaceScope(request, env, params.id);
  if (scopeResult.error) return scopeResult.error;

  const adminResult = await requireWorkspaceAdmin(request, env);
  if (adminResult.error) return adminResult.error;

  // Multipart parse. request.formData() is native in the Workers runtime
  // and handles RFC 7578 boundary delimiters + content disposition.
  let form;
  try {
    form = await request.formData();
  } catch {
    return error('Invalid multipart body', 400);
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return error('Missing form field "file"', 400);
  }

  // file.type comes from the Content-Type sub-header of the multipart
  // part. Browsers set it from the file's MIME on disk; the client can
  // spoof it, but R2's content-type and the eventual <img> render are
  // both driven by this value, so a mismatch only hurts the uploader.
  if (!ALLOWED_MIME.has(file.type)) {
    return error(
      `Unsupported file type "${file.type || 'unknown'}". Use PNG or JPG.`,
      415
    );
  }

  if (file.size > MAX_BYTES) {
    return error('File too large. Maximum is 1 MB.', 413);
  }

  const ext = MIME_EXT[file.type];
  const newKey = `${params.id}/${randomSuffix()}${ext}`;

  // Open the DB connection AFTER we know we have a writable request.
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  let oldKey = null;
  try {
    // Capture the previous key so we can clean it up after the DB
    // update commits. SELECT on the same row we're about to UPDATE;
    // requireWorkspaceScope already confirmed the project is visible
    // to this workspace, so this row exists.
    const [row] = await sql`
      SELECT logo_r2_key
        FROM projects
       WHERE id          = ${params.id}
         AND deleted_at  IS NULL
       LIMIT 1
    `;
    if (!row) {
      // Race: project soft-deleted between requireWorkspaceScope and
      // this SELECT.
      return error('Not found', 404);
    }
    oldKey = row.logo_r2_key;

    // Put to R2 first. If this fails the DB stays in its previous
    // state (NULL or previous key) — the new object never existed.
    await env.LOGOS.put(newKey, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    // Commit the DB update. If THIS fails the new object is orphaned
    // in R2; we best-effort delete it inside the catch.
    let project;
    try {
      [project] = await sql`
        UPDATE projects
           SET logo_r2_key = ${newKey},
               updated_at  = NOW()
         WHERE id          = ${params.id}
           AND deleted_at  IS NULL
        RETURNING id, logo_r2_key
      `;
    } catch (dbErr) {
      // Orphan cleanup. Failure here doesn't matter — the DB never
      // committed the new key, so the orphan is unreferenced and
      // eligible for a manual sweep later.
      try { await env.LOGOS.delete(newKey); } catch {}
      throw dbErr;
    }

    if (!project) {
      // Same race-on-soft-delete case as above; pre-commit object is
      // already in R2 so clean it up.
      try { await env.LOGOS.delete(newKey); } catch {}
      return error('Not found', 404);
    }

    // DB committed the new key. Safe to drop the previous object.
    if (oldKey) {
      try { await env.LOGOS.delete(oldKey); } catch {
        // Best-effort. Orphan is harmless (just storage cost on a
        // ~10 KB object); a manual sweep can reconcile if needed.
      }
    }

    return json({
      ok: true,
      logo_r2_key: project.logo_r2_key,
      logo_url: buildLogoUrl(project.logo_r2_key),
    });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}

// ---------- DELETE — clear the project's logo ----------------------------

export async function onRequestDelete({ request, env, params }) {
  const scopeResult = await requireWorkspaceScope(request, env, params.id);
  if (scopeResult.error) return scopeResult.error;

  const adminResult = await requireWorkspaceAdmin(request, env);
  if (adminResult.error) return adminResult.error;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  try {
    // One round-trip: CTE reads the old key, then UPDATE clears it.
    // postgres-js executes the whole statement in a single transaction;
    // there is no window where prev has run but upd has not.
    const [row] = await sql`
      WITH prev AS (
        SELECT logo_r2_key
          FROM projects
         WHERE id          = ${params.id}
           AND deleted_at  IS NULL
      ),
      upd AS (
        UPDATE projects
           SET logo_r2_key = NULL,
               updated_at  = NOW()
         WHERE id          = ${params.id}
           AND deleted_at  IS NULL
        RETURNING 1
      )
      SELECT logo_r2_key FROM prev
    `;

    if (!row) {
      return error('Not found', 404);
    }

    if (row.logo_r2_key) {
      try { await env.LOGOS.delete(row.logo_r2_key); } catch {
        // Best-effort; orphan cost is negligible.
      }
    }

    return new Response(null, { status: 204 });
  } catch (_err) {
    return error('Internal error', 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}
