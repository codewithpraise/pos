/* ============================================================================
   NEXOVA POS — ANIMATIONS & HAPTICS MODULE
   Wraps device vibration, cart additions, quantity pulses, and error shakes.
   ============================================================================ */

/**
 * Trigger device vibration for haptic feedback.
 * Pattern examples: 50 (single), [50,50,50] (triple tap)
 * @param {number|number[]} pattern
 */
export function haptic(pattern = 50) {
  try {
    const localPref = window.state?.preferences?.['haptic_feedback_enabled'];
    const storagePref = localStorage.getItem('nexova_haptics_enabled');
    const enabled = localPref !== 'false' && storagePref !== 'false';
    if (enabled && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch (_) { /* Silently fail in restricted contexts */ }
}

/**
 * Animate a cart row when it's added.
 * @param {HTMLElement} row - the <tr> or row element
 */
export function animateCartItemAdd(row) {
  if (!row) return;
  row.classList.remove('adding');
  // Force reflow
  void row.offsetWidth;
  row.classList.add('adding');
  row.addEventListener('animationend', () => row.classList.remove('adding'), { once: true });
  haptic(30);
}

/**
 * Animate a cart row when it's removed, then call callback.
 * @param {HTMLElement} row
 * @param {Function} onComplete
 */
export function animateCartItemRemove(row, onComplete) {
  if (!row) { if (onComplete) onComplete(); return; }
  row.classList.add('removing');
  row.addEventListener('animationend', () => {
    if (onComplete) onComplete();
  }, { once: true });
  haptic([30, 20]);
}

/**
 * Pulse the quantity display on quantity change.
 * @param {HTMLElement} qtyEl
 */
export function pulseQtyDisplay(qtyEl) {
  if (!qtyEl) return;
  qtyEl.classList.remove('bump');
  void qtyEl.offsetWidth;
  qtyEl.classList.add('bump');
  qtyEl.addEventListener('animationend', () => qtyEl.classList.remove('bump'), { once: true });
}

/**
 * Flash the charge button with a success ring animation.
 */
export function flashPaymentSuccess() {
  const btn = document.getElementById('btn-charge');
  if (!btn) return;
  btn.classList.add('success-pulse');
  btn.addEventListener('animationend', () => btn.classList.remove('success-pulse'), { once: true });
  haptic([50, 30, 100]);
  if (typeof window.announceToScreenReader === 'function') {
    window.announceToScreenReader('Payment successful!');
  }
}

/**
 * Shake an element to indicate an error.
 * @param {HTMLElement|string} elOrId
 */
export function shakeElement(elOrId) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
  haptic([50, 30, 50]);
}

// Expose globally for backward compatibility
window.haptic = haptic;
window.animateCartItemAdd = animateCartItemAdd;
window.animateCartItemRemove = animateCartItemRemove;
window.pulseQtyDisplay = pulseQtyDisplay;
window.flashPaymentSuccess = flashPaymentSuccess;
window.shakeElement = shakeElement;
