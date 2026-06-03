/* no-zoom.js — lock the app to a fixed, device-width zoom on touch devices.

   The viewport <meta> already declares `maximum-scale=1, user-scalable=no`,
   which is honored by Android Chrome. iOS Safari, however, ignores both of
   those (since iOS 10) and still allows pinch-, gesture- and double-tap-zoom.
   This script is the cross-browser backstop so every screen stays at a fixed
   size and position on the device.

   What it blocks:
   - iOS pinch/spread zoom (the `gesture*` events Safari fires).
   - Multi-finger pinch on engines that let `touchmove` be cancelled.
   - Double-tap-to-zoom (only the rapid SECOND tap is cancelled).

   What it preserves:
   - Single-finger panning / scrolling everywhere it's relevant (including
     inner scroll regions like the board-status chart) — only zoom gestures
     are cancelled, never normal scrolls.

   Usage — load from any page's <head>:
     <script src="/_lib/no-zoom.js" defer></script>
*/
(function () {
  'use strict';

  // iOS Safari pinch/spread zoom arrives as gesture events; cancel them.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault(); }, { passive: false });
  });

  // Multi-touch pinch on engines that honor touchmove cancellation.
  // Single-finger (touches.length === 1) scrolls pass through untouched.
  document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // Double-tap-to-zoom: cancel only the second tap of a quick pair so normal
  // taps/clicks still fire.
  var lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    if (now - lastTouchEnd <= 350) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
})();
