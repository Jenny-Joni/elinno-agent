/* sticky-topbar.js — progressive enhancement for .app-nav.

   Adds two on-scroll affordances per v1.4 SPEC §4:
   - .is-lifted (desktop + mobile): subtle shadow appears once the
     user has scrolled past a small threshold; the hairline border
     drops away so the lift reads cleanly.
   - .is-hidden (mobile only): the bar slides offscreen when the
     user scrolls down past a larger threshold, and pulls back in
     when they scroll up. Reclaims ~56px of viewport.

   Respects prefers-reduced-motion: skips the hide-on-scroll-down
   behavior entirely (the lift is still applied — it's not motion,
   it's just a shadow).

   Debounced via requestAnimationFrame.

   Usage — load deferred from any authed page:
     <script src="/_lib/sticky-topbar.js" defer></script>

   The script auto-attaches to every .app-nav on the page. To opt out
   on a specific surface, remove the .app-nav class (or wrap it in
   [data-sticky-topbar="off"]). To opt in on a different element, add
   [data-sticky-topbar] to it.
*/
(function () {
  'use strict';

  var targets = Array.prototype.slice.call(
    document.querySelectorAll('.app-nav, [data-sticky-topbar]')
  ).filter(function (el) {
    return el.getAttribute('data-sticky-topbar') !== 'off';
  });
  if (!targets.length) return;

  var reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  var mobileMQ = window.matchMedia
    ? window.matchMedia('(max-width: 700px)')
    : { matches: false };

  var LIFT_THRESHOLD = 4;   // px — show shadow once scrolled past this
  var HIDE_THRESHOLD = 80;  // px — engage hide-on-scroll-down past this

  var lastY = window.pageYOffset || document.documentElement.scrollTop || 0;
  var ticking = false;

  function update() {
    ticking = false;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var isMobile = mobileMQ.matches;

    for (var i = 0; i < targets.length; i++) {
      var el = targets[i];

      // Lift (shadow + drop hairline) — applies on every viewport.
      if (y > LIFT_THRESHOLD) {
        el.classList.add('is-lifted');
      } else {
        el.classList.remove('is-lifted');
      }

      // Hide-on-scroll-down (mobile only, motion-allowed only).
      if (isMobile && !reducedMotion) {
        if (y > HIDE_THRESHOLD && y > lastY + 2) {
          el.classList.add('is-hidden');
        } else if (y < lastY - 2 || y <= HIDE_THRESHOLD) {
          el.classList.remove('is-hidden');
        }
      } else if (el.classList.contains('is-hidden')) {
        el.classList.remove('is-hidden');
      }
    }

    lastY = y;
  }

  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  // Keep the bar visible after a viewport flip (e.g. rotate).
  if (mobileMQ.addEventListener) {
    mobileMQ.addEventListener('change', update);
  } else if (mobileMQ.addListener) {
    mobileMQ.addListener(update);
  }

  // Initial state — covers reload-at-scrolled-position.
  update();
})();
