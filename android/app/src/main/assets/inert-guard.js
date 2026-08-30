// === INERT SAFETY GUARD ===
// Clears residual inert=true that router.js sets on non-checkout views.
// Belt-and-suspenders safety net on top of the switchActiveScreen fix.
(function ensureActiveViewIsInteractive() {
  'use strict';
  function applyInertGuard() {
    try {
      var activeScreen = (window.state && window.state.activeScreen) ||
                         (window.ValenixiaRouter && window.ValenixiaRouter.currentScreen) ||
                         'checkout';
      var targetId = activeScreen.startsWith('view-') ? activeScreen : 'view-' + activeScreen;
      document.querySelectorAll('.content-view').forEach(function(view) {
        var isActive = view.classList.contains('active') || view.id === targetId;
        if (isActive && (view.inert || view.hasAttribute('inert'))) {
          console.warn('[InertGuard] Clearing residual inert on active view: ' + view.id);
          view.inert = false;
          view.removeAttribute('inert');
        }
      });
    } catch (e) { /* never throw */ }
  }
  applyInertGuard();
  document.addEventListener('DOMContentLoaded', function() {
    applyInertGuard();
    setTimeout(applyInertGuard, 300);
    setTimeout(applyInertGuard, 900);
  });
  window.__clearInertOnActiveView = applyInertGuard;
})();
