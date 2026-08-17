/* side-nav.js — behavior for the persistent left rail (Block 19, v2.0).

   The MARKUP is static in each of the 11 authed pages, not rendered here
   (BLOCK_19_PLAN.md decision I). Two reasons, both load-bearing:

     1. A deferred module cannot render it in time. Every page's boot code
        calls `$('#logoutBtn').addEventListener(...)` synchronously from an
        inline <script> at the bottom of <body>, and inline scripts run
        BEFORE deferred external ones. A JS-rendered rail would hand every
        page a TypeError on load.
     2. No flash of missing navigation.

   This file therefore only adds behavior: expand/collapse, the mobile
   drawer, active-item marking, and the lazily-fetched Projects accordion.

   DECISION J — the rail reuses the ids #navUserAvatar, #adminLink and
   #logoutBtn, and the classes .wn-navlink / .wn-navlink__dot. Every page's
   existing avatar / admin-reveal / logout wiring keeps working with zero
   edits to page boot code, and _lib/whats-new-badge.js needs no change.
   #adminLink is hidden with `style="display:none"`, NOT the `hidden`
   attribute, because page code reveals it with `.style.display = ''` —
   which would not defeat `hidden`.

   ESCAPING (do not weaken). Project names are user-entered text from
   /api/projects and reach two sinks in renderProjects(), both escaped here:
     1. text node — via esc() on the name
     2. attribute — the slug interpolated into href, via esc()
   Slugs are validated server-side to [a-z0-9-] (functions/_lib/slug.js),
   so the href escape is belt-and-braces; keep it anyway. If you add a sink,
   escape it at the sink — do not "clean" the data upstream.

   ONE DATA SOURCE (decision G1b). This module fetches /api/projects and
   /api/me. It deliberately does NOT fetch /api/cross-project/conversations:
   individual chats are not children of the rail, so the ?ids= fallback URL
   shape that caused the reload loop fixed in fdf25be never enters here.

   Usage — load deferred on every authed page, after the rail markup:
     <script src="/_lib/side-nav.js" defer></script>
*/
(function () {
  'use strict';

  /* The rail is a fixed frame around the app, not part of any one page, so
     its whole state survives navigation — collapsed/expanded, whether the
     Projects section is open, and which projects are open inside it. Without
     this, every click reset the tree and you re-opened the same project on
     each page. Per-device by design, same as _lib/whats-new-badge.js.

     Open projects are keyed by SLUG, not list index: /api/projects orders by
     sort_position, so an admin reordering projects would otherwise silently
     expand a different one than the user left open. */
  var SECTION_KEY = 'elinno.sidenav.projectsOpen';
  var OPEN_KEY = 'elinno.sidenav.openProjects';
  var TREE_KEY = 'elinno.sidenav.treeHtml';
  var PROJECT_CAP = 5;

  function readStore(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var rail = document.querySelector('.side-nav');
  if (!rail) return;

  var body = document.body;
  var root = document.documentElement;   // carries sn-boot / sn-section-open / sn-admin
  var scroll = rail.querySelector('.side-nav__scroll');

  /* Keep the rail's own scroll position across navigation. Each page is a
     new document, so the scroll area starts at 0 — with several projects
     expanded, clicking something near the bottom (Members, say) jumped the
     menu back to the top and you lost your place in a list you had not
     touched. Saved here, restored before paint by the inline block after
     the rail markup.

     sessionStorage, like the tree cache: it only has to survive navigation
     inside one tab.

     Debounced with setTimeout, deliberately NOT requestAnimationFrame: rAF
     does not fire at all in a backgrounded tab, so an rAF-coalesced write
     silently loses the position for anyone who scrolls the menu and then
     switches away before clicking. A timer still fires when throttled. */
  var SCROLL_KEY = 'elinno.sidenav.scrollTop';
  if (scroll) {
    var scrollTimer = null;
    var saveScroll = function () {
      try { sessionStorage.setItem(SCROLL_KEY, String(scroll.scrollTop)); } catch (e) { /* private mode */ }
    };
    scroll.addEventListener('scroll', function () {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(saveScroll, 120);
    }, { passive: true });
    // A click navigates away before the debounce fires, so flush first.
    rail.addEventListener('click', function () {
      if (scrollTimer) clearTimeout(scrollTimer);
      saveScroll();
    }, true);
  }
  var childBox = rail.querySelector('[data-sn-children="projects"]');
  var sectionBtn = rail.querySelector('[data-sn-section="projects"]');
  var adminGroup = document.getElementById('adminLink');

  var user = null;          // { is_admin, display_name, email }
  var projects = null;      // cached /api/projects rows

  /* Which projects are expanded. Any number of them, independently —
     opening one no longer closes another.

     This reverses the plan's decision G2 (re-locked by Jenny, 2026-08-16).
     G2 existed because a fully expanded rail measured 1090px against a
     768px viewport. What actually solves that is G2b — .side-nav__scroll
     is the only scrolling part, with the brand row and the footer pinned
     outside it — so a taller tree scrolls instead of pushing Log out off
     the screen. G2 was a second, cruder guard on the same problem, and it
     cost the user the ability to compare two projects side by side. */
  var openProjects = Object.create(null);
  (function () {
    var saved = readStore(OPEN_KEY, []);
    if (Object.prototype.toString.call(saved) === '[object Array]') {
      saved.forEach(function (slug) { openProjects[slug] = true; });
    }
  })();

  // The boot script already added sn-boot before first paint. Re-add it so
  // the rail still lays out if that script was stripped or failed.
  root.classList.add('sn-boot');

  /* ─── Active item ────────────────────────────────────────────────────
     Every authed page maps to exactly ONE rail item. The block plan's
     first draft mapped /whats-new.html and /admin.html to no item, which
     contradicted its own "exactly 1 per page" threshold; they map to
     What's new and Members respectively. */
  function activeKey(path) {
    if (path === '/' || path.indexOf('/dashboard') === 0) return 'dashboard';
    if (path.indexOf('/projects') === 0) return 'projects';
    if (path.indexOf('/project/') === 0 || path.indexOf('/project.html') === 0) return 'projects';
    if (path.indexOf('/project_settings') === 0) return 'projects';
    if (path.indexOf('/cross-project') === 0) return 'cross-project';
    if (path.indexOf('/workspace_settings') === 0) return 'workspace-settings';
    if (path.indexOf('/admin') === 0) return 'members';
    if (path.indexOf('/whats-new') === 0) return 'whats-new';
    return '';
  }

  function markActive() {
    var key = activeKey(location.pathname);
    if (!key) return;
    var el = rail.querySelector('[data-sn-nav="' + key + '"]');
    if (el) el.setAttribute('aria-current', 'page');
    // Projects has no [data-sn-nav] element — it is the accordion's
    // <button data-sn-section>. It still gets aria-current: the attribute is
    // valid on any element, not just links, and without it the four
    // Projects-mapped pages (/projects, /projects/new, /project/*,
    // /project_settings/*) would expose no current-page marker at all.
    // .is-active is the styling hook; aria-current is the semantic one.
    if (key === 'projects' && sectionBtn) {
      sectionBtn.classList.add('is-active');
      sectionBtn.setAttribute('aria-current', 'page');
    }
  }

  /* ─── Mobile drawer (≤700px) ─────────────────────────────────────── */
  function setDrawer(on) {
    body.classList.toggle('side-nav-open', on);
    var t = document.querySelector('[data-sn-mobile-toggle]');
    if (t) {
      t.setAttribute('aria-expanded', String(on));
      t.setAttribute('aria-label', on ? 'Close navigation' : 'Open navigation');
      var i = t.querySelector('i');
      if (i) i.className = 'ti ti-' + (on ? 'x' : 'menu-2');
    }
  }

  var mobileToggle = document.querySelector('[data-sn-mobile-toggle]');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', function () {
      var opening = !body.classList.contains('side-nav-open');
      setDrawer(opening);
      // If the section was already open when the drawer opens, make sure its
      // data is loaded. Does not open a section the user had closed.
      if (opening && sectionBtn && sectionBtn.getAttribute('aria-expanded') === 'true') {
        ensureProjects();
      }
    });
  }

  var backdrop = document.querySelector('[data-sn-backdrop]');
  if (backdrop) {
    backdrop.addEventListener('click', function () {
      // One backdrop, two jobs: it closes the mobile drawer, and below
      // 1100px it also closes the overlaying expanded rail (decision D).
      // The backdrop only has one job now: close the mobile drawer.
      if (body.classList.contains('side-nav-open')) setDrawer(false);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (body.classList.contains('side-nav-open')) setDrawer(false);
  });

  /* ─── User + role ────────────────────────────────────────────────────
     The rail needs is_admin before the accordion is ever opened, so it
     cannot wait for /api/projects (which also carries `role`). Pages fetch
     /api/me too; this is a second small session lookup, accepted so the
     rail is correct on all 11 pages with no per-page special-casing —
     including /admin.html, which has no #adminLink for page code to reveal.
     A page that wants to avoid the duplicate can call
     window.SideNav.setUser(user) and this fetch's result is discarded. */
  var userSet = false;

  function applyUser(u) {
    if (!u || userSet) return;
    userSet = true;
    user = u;

    var av = document.getElementById('navUserAvatar');
    var name = u.display_name || u.email || '';
    if (av && !av.textContent) {
      av.textContent = String(name.trim()[0] || '?').toUpperCase();
      av.title = (u.display_name || '') + (u.email ? ' · ' + u.email : '');
    }
    var nameEl = rail.querySelector('[data-sn-username]');
    if (nameEl) nameEl.textContent = u.display_name || u.email || 'Account';

    if (u.is_admin && adminGroup) adminGroup.style.display = '';
    /* Remember the role and the avatar letter so the next page paints them
       instead of popping them in once /api/me answers. The admin group is two
       rows; revealing it after paint moved everything below it.

       This is a display hint, never a permission. The group's links are
       admin-gated server-side regardless, and /api/me overwrites this within
       the same page load — so a revoked admin sees the two rows for one paint
       and then loses them, which is the correct direction to fail. */
    try {
      localStorage.setItem('elinno.sidenav.admin', u.is_admin ? '1' : '0');
      localStorage.setItem('elinno.sidenav.initial', String(name.trim()[0] || '').toUpperCase());
    } catch (e) { /* private mode */ }

    // Role landed after the accordion was already drawn — redraw so the
    // admin-only Settings / New project rows appear.
    if (projects) renderProjects();
  }

  window.SideNav = { setUser: applyUser };

  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.user) applyUser(d.user); })
    .catch(function () { /* rail still navigates; only the admin group is withheld */ });

  /* ─── Projects accordion ─────────────────────────────────────────── */
  function isAdmin() { return !!(user && user.is_admin); }

  function actionsFor(p) {
    var out = [];
    if (p.has_jira) {
      out.push({ icon: 'layout-board', label: 'Sprint View', href: '/project/' + esc(p.slug) + '/sprint' });
    }
    out.push({ icon: 'message-circle', label: 'Chat', href: '/project/' + esc(p.slug) });
    if (isAdmin()) {
      out.push({ icon: 'settings', label: 'Settings', href: '/project_settings/' + esc(p.slug) });
    }
    return out;
  }

  function renderProjects() {
    if (!childBox) return;
    var rows = projects.slice(0, PROJECT_CAP);
    var html = '';

    rows.forEach(function (p, i) {
      var acts = actionsFor(p);
      var name = esc(p.name);

      // Decision G3: a project is an expander only when it has ≥2 actions.
      // A single-action expander would be a chevron that reveals one row.
      if (acts.length < 2) {
        html += '<a class="sn-l2" href="' + acts[0].href + '">'
              + '<span class="sn-l2__label">' + name + '</span></a>';
        return;
      }

      /* The action rows are ALWAYS in the DOM, inside a wrapper whose height
         animates. They used to be rendered only while open, which meant a
         toggle replaced the markup and there was nothing for a transition to
         act on. The chevron is one element rotated by CSS, not two icon
         classes swapped, for the same reason. */
      var open = !!openProjects[p.slug];
      html += '<button class="sn-l2' + (open ? ' is-open' : '') + '" type="button"'
            + ' data-sn-project="' + esc(p.slug) + '" aria-expanded="' + open + '">'
            + '<span class="sn-l2__label">' + name + '</span>'
            + '<i class="ti ti-chevron-right sn-chev"></i></button>';

      html += '<div class="sn-l3-group' + (open ? ' is-open' : '') + '"><div class="sn-l3-group__inner">';
      acts.forEach(function (a) {
        html += '<a class="sn-l3" href="' + a.href + '">'
              + '<i class="ti ti-' + a.icon + '"></i>' + a.label + '</a>';
      });
      html += '</div></div>';
    });

    html += '<a class="sn-util" href="/projects.html"><i class="ti ti-arrow-right"></i>All projects</a>';
    if (isAdmin()) {
      html += '<a class="sn-util" href="/projects/new.html"><i class="ti ti-plus"></i>New project</a>';
    }

    childBox.innerHTML = html;
    markActiveChild();
    // Stash the finished markup so the next page can paint the tree during
    // parse, before this module has even run. The inline restore block after
    // the rail markup reads this key. Caching HTML rather than re-deriving it
    // guarantees the restored tree is pixel-identical to this render — and
    // everything in it was escaped on the way in, above.
    try { sessionStorage.setItem(TREE_KEY, childBox.innerHTML); } catch (e) { /* quota */ }
  }

  // Mark the level-3 row matching the current URL, so a project's own
  // page highlights the action you are on rather than just the project.
  function markActiveChild() {
    var here = location.pathname;
    var links = childBox.querySelectorAll('.sn-l3, .sn-l2[href]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('href') === here) {
        links[i].setAttribute('aria-current', 'page');
        /* Exactly one aria-current="page" per document. The Projects section
           is marked by markActive() so the four Projects-mapped pages are not
           left with none, but on a page that matches a specific child — a
           project's Sprint View, say — the child is the page and the section
           is only its ancestor. Hand the attribute down; the section keeps
           .is-active, which is what actually draws the highlight. */
        if (sectionBtn) sectionBtn.removeAttribute('aria-current');
        break;
      }
    }
  }

  function loadingRow(text) {
    return '<div class="sn-util" style="cursor:default;">' + text + '</div>';
  }

  var fetching = false;

  function renderEmpty() {
    childBox.innerHTML = loadingRow('No projects yet')
      + (isAdmin() ? '<a class="sn-util" href="/projects/new.html"><i class="ti ti-plus"></i>New project</a>' : '');
  }

  /* Render the tree from the last page's copy, then revalidate.

     Without this the section shows "Loading…" and then pops the tree in on
     every navigation, because /api/projects is a fresh round trip per page.
     Moving between two children of the same project — Sprint View to Chat —
     made the whole tree vanish and rebuild, which reads as a glitch rather
     than a page change.

     sessionStorage, not localStorage: the cache only needs to survive
     navigation inside one tab, which is exactly the window the flash lives
     in. A new tab or a new day starts from the network. The network result
     always wins and overwrites; this only removes the empty gap before it
     arrives. */
  function cacheKeyFor() { return 'elinno.sidenav.projectsCache'; }

  function readCache() {
    try {
      var raw = sessionStorage.getItem(cacheKeyFor());
      var v = raw ? JSON.parse(raw) : null;
      return (Object.prototype.toString.call(v) === '[object Array]') ? v : null;
    } catch (e) { return null; }
  }

  function writeCache(rows) {
    try {
      // Only the fields the rail draws — not the whole project payload.
      sessionStorage.setItem(cacheKeyFor(), JSON.stringify(rows.slice(0, PROJECT_CAP).map(function (p) {
        return { name: p.name, slug: p.slug, has_jira: !!p.has_jira, role: p.role };
      })));
    } catch (e) { /* quota or private mode — the network path still works */ }
  }

  function ensureProjects() {
    if (fetching || !childBox) return;

    if (!projects) {
      var cached = readCache();
      if (cached && cached.length) {
        projects = cached;
        if (!userSet && cached[0].role === 'admin') {
          applyUser({ is_admin: true, display_name: '', email: '' });
        }
        renderProjects();          // paints immediately, no network wait
      } else {
        childBox.innerHTML = loadingRow('Loading…');
      }
    }

    fetching = true;
    fetch('/api/projects', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var fresh = (d && Array.isArray(d.projects)) ? d.projects : [];
        // /api/projects carries `role` per row; use it if /api/me lost the
        // race, so the admin rows are not silently withheld from an admin.
        if (!userSet && fresh.length && fresh[0].role === 'admin') {
          applyUser({ is_admin: true, display_name: '', email: '' });
        }
        projects = fresh;
        writeCache(fresh);
        if (!fresh.length) { renderEmpty(); return; }
        renderProjects();
      })
      .catch(function () {
        // Keep whatever the cache painted; only report if there is nothing.
        if (!projects) childBox.innerHTML = loadingRow("Couldn't load projects");
      })
      .then(function () { fetching = false; });
  }

  // `persist` is false when restoring saved state on load — writing then
  // would be a no-op at best and, if a read ever failed, would overwrite the
  // user's real state with the fallback.
  function setSection(open, persist) {
    if (!sectionBtn || !childBox) return;
    sectionBtn.setAttribute('aria-expanded', String(open));
    // Visibility and the chevron's direction are CSS, keyed to this class,
    // so an open section paints open instead of being opened a frame later.
    root.classList.toggle('sn-section-open', open);
    if (persist) writeStore(SECTION_KEY, open);
    if (open) ensureProjects();
  }

  function toggleSection() {
    setSection(sectionBtn.getAttribute('aria-expanded') !== 'true', true);
  }

  if (sectionBtn) {
    sectionBtn.addEventListener('click', function () {
      toggleSection();
    });
    // Restore the section exactly as it was left, on every page.
    setSection(readStore(SECTION_KEY, false) === true, false);
  }

  /* Toggling flips classes IN PLACE — it deliberately does not call
     renderProjects(). Re-rendering replaced the markup, so the browser saw
     a brand-new element already at its final height and had nothing to
     animate between. Keeping the DOM is what makes the transition possible.

     Each project still toggles independently: opening one does not close
     another (the G2 reversal). What animates is the row you clicked. */
  function setProjectOpen(btn, open) {
    var group = btn.nextElementSibling;
    btn.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (group && group.classList.contains('sn-l3-group')) {
      group.classList.toggle('is-open', open);
    }
  }

  if (childBox) {
    childBox.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-sn-project]');
      if (!btn) return;
      var slug = btn.getAttribute('data-sn-project');
      var open = !openProjects[slug];
      if (open) openProjects[slug] = true;
      else delete openProjects[slug];
      setProjectOpen(btn, open);
      writeStore(OPEN_KEY, Object.keys(openProjects));
      // The cache feeds the next page's pre-paint restore, so it has to
      // capture the state as it is NOW, after the class flip.
      try { sessionStorage.setItem(TREE_KEY, childBox.innerHTML); } catch (err) { /* quota */ }
    });
  }

  markActive();
})();
