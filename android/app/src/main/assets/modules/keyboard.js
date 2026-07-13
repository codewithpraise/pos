/* ============================================================================
   VALENIXIA POS — KEYBOARD & SHORTCUTS MODULE
   Binds Ctrl+K, Ctrl+Shift+P, and Esc to core navigation/modal events.
   ============================================================================ */

import { haptic } from './animations.js';

/**
 * Find the topmost visible modal overlay and close it.
 */
export function closeTopmostModal() {
  const activeModals = Array.from(document.querySelectorAll('.modal-overlay.active'));
  if (activeModals.length === 0) return;
  const topmost = activeModals[activeModals.length - 1];
  const closeBtn = topmost.querySelector('.btn-close-modal, [data-action="close"], .btn-cancel');
  if (closeBtn) {
    closeBtn.click();
  } else {
    topmost.classList.remove('active');
  }
}

export function initKeyboardListeners() {
  try {
    document.addEventListener('keydown', (e) => {
      try {
        const tag = document.activeElement?.tagName;
        const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
                      || document.activeElement?.isContentEditable;

        // Ctrl/Cmd + K → focus product search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          const searchInput = document.getElementById('product-search-input');
          if (searchInput) {
            const checkoutNav = document.querySelector('[data-screen="checkout"]');
            if (checkoutNav && !checkoutNav.classList.contains('active')) checkoutNav.click();
            setTimeout(() => {
              searchInput.focus();
              searchInput.select();
            }, 80);
          }
          if (typeof window.announceToScreenReader === 'function') {
            window.announceToScreenReader('Product search focused');
          }
          return;
        }

        // Ctrl/Cmd + Shift + P → trigger charge / payment modal
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
          e.preventDefault();
          const chargeBtn = document.getElementById('btn-charge');
          if (chargeBtn && !chargeBtn.disabled) {
            chargeBtn.click();
            if (typeof window.announceToScreenReader === 'function') {
              window.announceToScreenReader('Payment modal opened');
            }
          }
          return;
        }

        // Esc → close topmost modal
        if (e.key === 'Escape' && !isTyping) {
          closeTopmostModal();
          return;
        }
      } catch (err) {
        console.error('[KeyboardModule] Error processing keydown event:', err);
      }
    });
  } catch (err) {
    console.error('[KeyboardModule] Failed to initialize keyboard listeners:', err);
  }
}

// Automatically initialize on module load
initKeyboardListeners();
