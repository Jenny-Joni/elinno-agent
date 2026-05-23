// functions/_lib/slug.js
//
// Block 13.8 (v1.4 Phase 8) — shared slug validator + derivation utility.
// Decision 4 in BLOCK_13_DECISIONS.md locks the format + reserved list.
//
// Used by:
//   - functions/api/projects/slug-available.js (GET availability)
//   - functions/api/projects/index.js (POST validate + auto-derive)
//   - functions/api/projects/[id]/index.js (PATCH validate)
//   - functions/project/[[path]].js (catch-all routing; doesn't validate, just looks up)
//
// The client-side projects/new.html + project_settings.html mirror this logic
// inline for the live preview. Keep the regex shape identical there.

// ---------------------------------------------------------------------------
// Reserved words. Cannot be assigned as a slug; the availability endpoint
// and create/edit paths reject these.
// ---------------------------------------------------------------------------
export const RESERVED_SLUGS = Object.freeze(new Set([
  'new',
  'settings',
  'admin',
  'dashboard',
  'projects',
  'api',
  'login',
  'logout',
  'forgot-password',
  'reset-password',
  'workspace',
  'cross-project',
  '_dev',
]));

export function isReservedSlug(slug) {
  return RESERVED_SLUGS.has(String(slug || ''));
}

// ---------------------------------------------------------------------------
// Format validator. Returns { ok: true } | { ok: false, reason: 'invalid_format' }.
// Format (per Decision 4):
//   - lowercase letters / digits / hyphens
//   - must start with a letter
//   - max 64 chars
//   - no leading or trailing hyphen
//   - no consecutive hyphens
// ---------------------------------------------------------------------------
const SLUG_FORMAT_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function validateSlugFormat(slug) {
  if (typeof slug !== 'string') return { ok: false, reason: 'invalid_format' };
  if (slug.length === 0) return { ok: false, reason: 'invalid_format' };
  if (slug.length > 64) return { ok: false, reason: 'invalid_format' };
  if (!SLUG_FORMAT_RE.test(slug)) return { ok: false, reason: 'invalid_format' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Derive a slug from a freeform name. Mirrors the SQL backfill in
// 2026-05-23-block-13-8-projects-slug.sql so the client + server +
// backfill all produce the same result for the same input.
//
// Steps:
//   1. lowercase
//   2. replace any run of non-[a-z0-9] with a single '-'
//   3. collapse consecutive '-'
//   4. trim leading/trailing '-'
//   5. if empty OR doesn't start with a letter, prepend 'p-'
//   6. cap at 64 chars
//
// Returns '' if the input is null/undefined/empty (caller can decide
// fallback). On valid input, the returned string is always
// validateSlugFormat-clean (assuming non-empty step-4 output).
// ---------------------------------------------------------------------------
export function deriveSlugFromName(name) {
  if (name == null) return '';
  let s = String(name).toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  if (s.length === 0) return '';
  if (!/^[a-z]/.test(s)) s = 'p-' + s;
  if (s.length > 64) s = s.slice(0, 64).replace(/-+$/g, '');
  return s;
}
