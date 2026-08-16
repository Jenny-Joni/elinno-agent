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

  var STORAGE_KEY = 'elinno.sidenav.expanded';
  var PROJECT_CAP = 5;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var rail = document.querySelector('.side-nav');
  if (!rail) return;

  var body = document.body;
  var scroll = rail.querySelector('.side-nav__scroll');
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

  body.classList.add('has-side-nav');

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

  /* ─── Expand / collapse (desktop) ────────────────────────────────── */
  function setExpanded(on, persist) {
    rail.classList.toggle('is-expanded', on);
    body.classList.toggle('side-nav-expanded', on);
    var t = rail.querySelector('[data-sn-toggle]');
    if (t) {
      t.setAttribute('aria-expanded', String(on));
      t.setAttribute('aria-label', on ? 'Collapse navigation' : 'Expand navigation');
      var i = t.querySelector('i');
      if (i) i.className = 'ti ti-chevrons-' + (on ? 'left' : 'right');
    }
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (e) { /* private mode */ }
    }
  }

  var startExpanded = false;
  try { startExpanded = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { /* private mode */ }
  setExpanded(startExpanded, false);

  var toggleBtn = rail.querySelector('[data-sn-toggle]');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      var next = !rail.classList.contains('is-expanded');
      setExpanded(next, true);
      // Expanding from the collapsed state should reveal something useful.
      if (next && sectionBtn && sectionBtn.getAttribute('aria-expanded') !== 'true'
          && activeKey(location.pathname) === 'projects') {
        toggleSection();
      }
    });
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
      // The mobile rail always shows the full tree; ensure the accordion
      // has its data the first time it is opened on a phone.
      if (opening && sectionBtn && sectionBtn.getAttribute('aria-expanded') !== 'true'
          && activeKey(location.pathname) === 'projects') {
        toggleSection();
      }
    });
  }

  var backdrop = document.querySelector('[data-sn-backdrop]');
  if (backdrop) {
    backdrop.addEventListener('click', function () {
      // One backdrop, two jobs: it closes the mobile drawer, and below
      // 1100px it also closes the overlaying expanded rail (decision D).
      if (body.classList.contains('side-nav-open')) setDrawer(false);
      else if (body.classList.contains('side-nav-expanded')) setExpanded(false, true);
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

      var open = !!openProjects[i];
      html += '<button class="sn-l2' + (open ? ' is-open' : '') + '" type="button"'
            + ' data-sn-project="' + i + '" aria-expanded="' + open + '">'
            + '<span class="sn-l2__label">' + name + '</span>'
            + '<i class="ti ti-chevron-' + (open ? 'down' : 'right') + ' sn-chev"></i></button>';

      if (open) {
        acts.forEach(function (a) {
          html += '<a class="sn-l3" href="' + a.href + '">'
                + '<i class="ti ti-' + a.icon + '"></i>' + a.label + '</a>';
        });
      }
    });

    html += '<a class="sn-util" href="/projects.html"><i class="ti ti-arrow-right"></i>All projects</a>';
    if (isAdmin()) {
      html += '<a class="sn-util" href="/projects/new.html"><i class="ti ti-plus"></i>New project</a>';
    }

    childBox.innerHTML = html;
    markActiveChild();
  }

  // Mark the level-3 row matching the current URL, so a project's own
  // page highlights the action you are on rather than just the project.
  function markActiveChild() {
    var here = location.pathname;
    var links = childBox.querySelectorAll('.sn-l3, .sn-l2[href]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('href') === here) {
        links[i].setAttribute('aria-current', 'page');
        break;
      }
    }
  }

  function loadingRow(text) {
    return '<div class="sn-util" style="cursor:default;">' + text + '</div>';
  }

  var fetching = false;

  function ensureProjects() {
    if (projects || fetching || !childBox) return;
    fetching = true;
    childBox.innerHTML = loadingRow('Loading…');
    fetch('/api/projects', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        projects = (d && Array.isArray(d.projects)) ? d.projects : [];
        // /api/projects carries `role` per row; use it if /api/me lost the
        // race, so the admin rows are not silently withheld from an admin.
        if (!userSet && projects.length && projects[0].role === 'admin') {
          applyUser({ is_admin: true, display_name: '', email: '' });
        }
        if (!projects.length) {
          childBox.innerHTML = loadingRow('No projects yet')
            + (isAdmin() ? '<a class="sn-util" href="/projects/new.html"><i class="ti ti-plus"></i>New project</a>' : '');
          return;
        }
        renderProjects();
      })
      .catch(function () {
        childBox.innerHTML = loadingRow("Couldn't load projects");
      })
      .then(function () { fetching = false; });
  }

  function toggleSection() {
    if (!sectionBtn || !childBox) return;
    var open = sectionBtn.getAttribute('aria-expanded') === 'true';
    sectionBtn.setAttribute('aria-expanded', String(!open));
    childBox.style.display = open ? 'none' : '';
    var chev = sectionBtn.querySelector('.sn-chev');
    if (chev) chev.className = 'ti ti-chevron-' + (open ? 'right' : 'down') + ' sn-chev';
    if (!open) ensureProjects();
  }

  if (sectionBtn) {
    childBox.style.display = 'none';
    sectionBtn.addEventListener('click', function () {
      // Clicking the section while collapsed should expand the rail first —
      // there is nowhere to draw children at 64px.
      if (!rail.classList.contains('is-expanded') && !body.classList.contains('side-nav-open')) {
        setExpanded(true, true);
      }
      toggleSection();
    });
  }

  // Each project toggles independently — opening one does not close any
  // other. Delegated, because the rows are re-rendered on every toggle.
  if (childBox) {
    childBox.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-sn-project]');
      if (!btn) return;
      var i = Number(btn.getAttribute('data-sn-project'));
      if (openProjects[i]) delete openProjects[i];
      else openProjects[i] = true;
      renderProjects();
    });
  }

  // Auto-open the section on a page that lives under it, so the rail
  // reflects where you are rather than starting blank.
  if (rail.classList.contains('is-expanded') && activeKey(location.pathname) === 'projects') {
    toggleSection();
  }

  markActive();
})();
