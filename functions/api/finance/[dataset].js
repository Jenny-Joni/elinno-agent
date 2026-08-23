// functions/api/finance/[dataset].js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Block 25 — Finance datasets. Routes:
//
//   GET  /api/finance/<dataset>  → the current dataset, for the page
//   POST /api/finance/<dataset>  → full-replace upload (admin only)
//
// Access model (BLOCK_25_PLAN.md decision C):
//
//   READ  — any authenticated session. This matches how projects already
//           behave: functions/_lib/workspace.js records that since
//           2026-05-27 project visibility is a single shared workspace
//           across all authenticated users, and owner_user_id is a
//           creator record, not a visibility scope. Finance is company
//           spend for that same one workspace, so "any signed-in user"
//           is the same blast radius, not a wider one.
//
//   WRITE — requireWorkspaceAdmin (D1 users.is_admin = 1). An upload
//           destroys the entire prior dataset, so it is deliberately
//           narrower than read.
//
//   The hidden nav item and the conditionally-rendered upload control on
//   finance.html are DISPLAY HINTS. Neither is a permission. Both gates
//   above are the only thing standing between a request and the data.
//
// v2.0 note: when real workspaces land (PRD v1.3 §6 cut #12), this file
// becomes the SECOND place needing a workspace filter, alongside the one
// functions/_lib/workspace.js already documents. The R2 key would gain a
// workspace prefix. Recorded here so the migration finds it.
//
// Storage (decision A): one JSON object per dataset in the FINANCE R2
// bucket — deliberately private, no custom domain. See wrangler.toml.
//
//   <dataset>/current.json   the live dataset
//   <dataset>/previous.json  the immediately prior one (decision I),
//                            so a bad upload has a single-step undo
//
// Caching (decision J): responses are `private, no-store`. During the
// prototype session the browser served a stale data file three separate
// times after it changed on disk. An upload nobody can see is worse than
// no upload, and this data is per-session, so a shared cache must never
// hold it.
// =========================================================================
import {
  error,
  getSessionUser,
  json,
  requireWorkspaceAdmin,
} from '../../_lib/auth.js';

// The three tabs finance.html ships with. An allowlist, not a passthrough:
// params.dataset lands in an R2 key, so an unchecked value is a path
// traversal into someone else's object.
const DATASETS = new Set(['reap', 'fiat', 'crypto']);

// 122 rows is ~40 KB. 4 MiB is ~100x headroom and still bounds the memory
// a single request can make the Worker allocate.
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 20000;
// Bounds any single cell. The longest real value is a vendor description
// at well under 200 chars.
const MAX_STR = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The only row fields that are ever persisted. The client's parse output is
// NEVER stored verbatim — each row is rebuilt from this list, so an extra
// key in the POST body cannot ride along into the stored object.
const ROW_STRINGS = [
  'name',
  'requestedBy',
  'accountOwner',
  'card',
  'project',
  'merchant',
  'vendor',
  'department',
  'category',
  'description',
];

function keyFor(dataset, which) {
  return `${dataset}/${which}.json`;
}

function noStore(data, status = 200) {
  return json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function str(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return null;
  return v.length > MAX_STR ? null : v;
}

/**
 * Rebuild the upload payload from known fields only, validating as we go.
 * Returns { ok: true, value } or { ok: false, status, message }.
 */
function validatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, message: 'Body must be a JSON object' };
  }

  const rows = body.rows;
  if (!Array.isArray(rows)) {
    return { ok: false, status: 400, message: 'Body.rows must be an array' };
  }
  if (rows.length === 0) {
    // A full-replace with zero rows would silently wipe the dataset. If
    // that is ever wanted it should be an explicit delete, not an upload
    // that happened to parse to nothing.
    return { ok: false, status: 422, message: 'Refusing to replace a dataset with zero rows' };
  }
  if (rows.length > MAX_ROWS) {
    return { ok: false, status: 413, message: `Too many rows (max ${MAX_ROWS})` };
  }

  const clean = [];
  let computed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, status: 400, message: `Row ${i} is not an object` };
    }

    const amount = typeof r.amount === 'number' ? r.amount : Number(r.amount);
    if (!Number.isFinite(amount)) {
      return { ok: false, status: 400, message: `Row ${i} has a non-numeric amount` };
    }

    const date = str(r.date);
    if (date === null || !DATE_RE.test(date)) {
      return { ok: false, status: 400, message: `Row ${i} has a bad date (want YYYY-MM-DD)` };
    }

    const out = { date, amount: Math.round(amount * 100) / 100 };
    for (const f of ROW_STRINGS) {
      const v = str(r[f]);
      if (v === null) {
        return { ok: false, status: 400, message: `Row ${i} field "${f}" is not a string under ${MAX_STR} chars` };
      }
      out[f] = v;
    }

    computed += out.amount;
    clean.push(out);
  }

  computed = Math.round(computed * 100) / 100;

  // Integrity check. The spreadsheet's own totals footer is an independent
  // check value: on the 2026-08-21 export it matched the sum of the 122
  // rows exactly. A mismatch means the parse dropped or double-counted
  // rows, which is precisely the failure a full-replace must not persist.
  const declared =
    body.footerTotal === undefined || body.footerTotal === null
      ? null
      : Number(body.footerTotal);

  if (declared !== null) {
    if (!Number.isFinite(declared)) {
      return { ok: false, status: 400, message: 'footerTotal is not a number' };
    }
    if (Math.abs(declared - computed) > 0.01) {
      return {
        ok: false,
        status: 422,
        message:
          `Row total ${computed.toFixed(2)} does not match the file's stated ` +
          `total ${declared.toFixed(2)} — the parse dropped or duplicated rows`,
      };
    }
  }

  const sourceFile = str(body.sourceFile);
  const sheet = str(body.sheet);
  const periodStart = str(body.periodStart);
  const periodEnd = str(body.periodEnd);
  if (sourceFile === null || sheet === null || periodStart === null || periodEnd === null) {
    return { ok: false, status: 400, message: 'sourceFile / sheet / periodStart / periodEnd must be short strings' };
  }
  for (const [k, v] of [['periodStart', periodStart], ['periodEnd', periodEnd]]) {
    if (v && !DATE_RE.test(v)) {
      return { ok: false, status: 400, message: `${k} must be YYYY-MM-DD` };
    }
  }

  return {
    ok: true,
    value: {
      sourceFile,
      sheet,
      periodStart,
      periodEnd,
      footerTotal: computed,
      rows: clean,
    },
  };
}

// ---------- GET — the dataset, for any authenticated user ----------------

export async function onRequestGet({ request, env, params }) {
  const dataset = params.dataset;
  if (!DATASETS.has(dataset)) return error('Unknown dataset', 404);

  const user = await getSessionUser(request, env.DB);
  if (!user) return error('Not authenticated', 401);

  if (!env.FINANCE) {
    return error('Finance storage is not configured on this deployment', 503);
  }

  const obj = await env.FINANCE.get(keyFor(dataset, 'current'));
  if (!obj) {
    // Not an error: Fiat and Crypto ship with no data at all, and Reap has
    // none until the first upload. The page renders its empty state.
    return noStore({ dataset, empty: true, rows: [] });
  }

  const stored = await obj.json();
  return noStore({ dataset, empty: false, ...stored });
}

// ---------- POST — full-replace upload, admins only ----------------------

export async function onRequestPost({ request, env, params }) {
  const dataset = params.dataset;
  if (!DATASETS.has(dataset)) return error('Unknown dataset', 404);

  // The gate. getSessionUser + is_admin, the same check
  // functions/api/admin/users.js and the project-logo upload both use.
  const adminResult = await requireWorkspaceAdmin(request, env);
  if (adminResult.error) return adminResult.error;
  const { user } = adminResult;

  if (!env.FINANCE) {
    return error('Finance storage is not configured on this deployment', 503);
  }

  const ctype = request.headers.get('content-type') || '';
  if (!ctype.includes('application/json')) {
    return error('Expected Content-Type: application/json', 415);
  }

  // Cheap pre-check before buffering anything. A client can lie or omit
  // this, so the parse below is still the real bound.
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
    return error('Payload too large', 413);
  }

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return error('Payload too large', 413);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return error('Invalid JSON', 400);
  }

  const checked = validatePayload(body);
  if (!checked.ok) return error(checked.message, checked.status);

  // uploadedAt and uploadedBy are set HERE, never taken from the client —
  // they are the audit trail for who replaced the dataset and when.
  const stored = {
    ...checked.value,
    uploadedAt: new Date().toISOString(),
    uploadedBy: user.email,
  };

  const currentKey = keyFor(dataset, 'current');
  const previousKey = keyFor(dataset, 'previous');
  const meta = { httpMetadata: { contentType: 'application/json' } };

  // Rotation order matters. Copy current → previous FIRST, then overwrite
  // current. A failure between the two leaves previous and current both
  // holding the old dataset, which is consistent and loses nothing. The
  // reverse order would risk previous and current both holding the NEW
  // dataset, destroying the undo the upload is supposed to create.
  let previousKept = false;
  const existing = await env.FINANCE.get(currentKey);
  if (existing) {
    await env.FINANCE.put(previousKey, existing.body, meta);
    previousKept = true;
  }

  await env.FINANCE.put(currentKey, JSON.stringify(stored), meta);

  return noStore({
    ok: true,
    dataset,
    rows: stored.rows.length,
    footerTotal: stored.footerTotal,
    uploadedAt: stored.uploadedAt,
    uploadedBy: stored.uploadedBy,
    previousKept,
  });
}
