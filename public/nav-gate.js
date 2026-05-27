// public/nav-gate.js
// =========================================================================
// 2026-05-27 (shared-workspace-visibility follow-up).
//
// Hides elements marked with [data-admin-only] for non-admin (member)
// users. Used by the top-nav Dashboard + Projects links — members
// don't need them (the dashboard is already their landing page; the
// projects list is identical to the dashboard's grid in v1.3).
//
// Loads on every authenticated page via <script src="/nav-gate.js"
// defer></script> in <head>. Failure-mode is fail-open: if /api/me
// errors, links stay visible. That's safe because the backend rejects
// every non-admin mutation regardless of UI state — this gate is
// UX-only.
//
// Brief flash for members (links visible during the round-trip, then
// hidden) is acceptable; the alternative (hide-then-show-for-admin)
// would flash for admins, which is the more common case.
// =========================================================================
(async () => {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.user && !data.user.is_admin) {
      document.querySelectorAll('[data-admin-only]').forEach((el) => {
        el.style.display = 'none';
      });
    }
  } catch {
    // Network/parse failure → fail-open (links stay visible).
  }
})();
