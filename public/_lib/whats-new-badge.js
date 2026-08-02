/* whats-new-badge.js — unread marker for What's New (PRD §5.11.10).

   One localStorage key holds the last release the user has read. When it
   differs from the newest PUBLISHED release, two markers render and clear
   together:
   - a dot on the nav link (.wn-navlink__dot), on every authed page
   - a "New" pill on the dashboard strip (.wn-strip__new)

   Per-device by design. Cross-device correctness would need a
   last_seen_version column on the D1 users table — a schema migration, so
   a security carve-out and a DDL approval gate — in exchange for not
   seeing a dot twice. Forward-compatible: the server-side column can be
   added later without changing the content model or either surface.

   Comparison is inequality, not semver ordering, per §5.11.10: any stored
   value other than the newest published version reads as unread.

   Reads window.WHATS_NEW (set by /_lib/whats-new-data.js), which is
   ordered newest-first. If that file has not loaded, or holds nothing
   published, every marker is hidden and the module no-ops — so this can
   ship before any entry is published.

   Marks read on the What's New page itself, detected via
   [data-whats-new-page] on <body>, falling back to the pathname.

   Usage — load deferred on any authed page, AFTER the data file
   (defer preserves document order):
     <script src="/_lib/whats-new-data.js" defer></script>
     <script src="/_lib/whats-new-badge.js" defer></script>

   Surfaces rendered after load (the dashboard strip is built by render()
   once its fetch resolves) should call window.whatsNewBadge.refresh()
   afterwards to apply the markers to the new markup.
*/
(function () {
  'use strict';

  var STORAGE_KEY = 'elinno-agent:whats-new-last-seen';

  // localStorage throws in Safari private mode and when storage is full or
  // blocked. Every access is guarded; failure degrades to "no marker".
  function readStored() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function writeStored(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  // The newest published release. WHATS_NEW is newest-first, so the first
  // published entry wins; drafts are skipped wherever they sit.
  function latestPublished() {
    var list = window.WHATS_NEW;
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].status === 'published') return list[i];
    }
    return null;
  }

  function isUnread() {
    var latest = latestPublished();
    if (!latest || !latest.version) return false;
    return readStored() !== latest.version;
  }

  // Version numbers are assigned by hand (PRD §5.11.3), so nothing stops two
  // entries carrying the same string. That is quietly destructive: the marker
  // fires on `stored !== newest`, so a reader who saw the first issue is
  // already storing that version and never gets a marker for the second.
  // Warn rather than throw — a duplicate should not blank the page — and warn
  // on load so it surfaces on the preview deploy, before publication.
  function warnOnDuplicateVersions() {
    var list = window.WHATS_NEW;
    if (!list || !list.length || !window.console || !console.warn) return;
    var seen = {};
    var dupes = [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i] && list[i].version;
      if (!v) continue;
      if (seen[v]) {
        if (dupes.indexOf(v) === -1) dupes.push(v);
      } else {
        seen[v] = true;
      }
    }
    if (dupes.length) {
      console.warn(
        "What's New: duplicate version string(s) " + dupes.join(', ') +
        ' — each issue needs a unique version or the unread marker will ' +
        'skip one of them.'
      );
    }
  }

  function onWhatsNewPage() {
    if (document.body && document.body.hasAttribute('data-whats-new-page')) return true;
    return /^\/whats-new(\.html)?\/?$/.test(window.location.pathname);
  }

  // Show or hide both markers against current state. Safe to call repeatedly
  // and safe when neither element is on the page.
  function refresh() {
    var unread = isUnread();

    var dots = document.querySelectorAll('.wn-navlink__dot');
    for (var i = 0; i < dots.length; i++) {
      dots[i].style.display = unread ? '' : 'none';
    }

    var pills = document.querySelectorAll('.wn-strip__new');
    for (var j = 0; j < pills.length; j++) {
      pills[j].style.display = unread ? '' : 'none';
    }

    return unread;
  }

  // Records the newest published version as read, then clears both markers.
  function markRead() {
    var latest = latestPublished();
    if (!latest || !latest.version) return false;
    var ok = writeStored(latest.version);
    refresh();
    return ok;
  }

  window.whatsNewBadge = {
    refresh: refresh,
    markRead: markRead,
    isUnread: isUnread,
    latestPublished: latestPublished,
    STORAGE_KEY: STORAGE_KEY
  };

  function init() {
    warnOnDuplicateVersions();
    if (onWhatsNewPage()) {
      // Visiting the page IS reading it — both markers clear together.
      markRead();
    } else {
      refresh();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
