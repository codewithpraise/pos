/* ============================================================================
   VALENIXIA POS — ANIMATIONS & HAPTICS MODULE
   Wraps device vibration, cart additions, quantity pulses, and error shakes.
   ============================================================================ */

function haptic(pattern = 50) {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
      return;
    }
    const localPref = window.state?.preferences?.['haptic_feedback_enabled'];
    const storagePref = localStorage.getItem('valenixia_haptics_enabled');
    const enabled = localPref !== 'false' && storagePref !== 'false';
    if (enabled && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch (_) { /* Silently fail in restricted contexts */ }
}

function animateCartItemAdd(row) {
  if (!row) return;
  row.classList.remove('adding');
  void row.offsetWidth;
  row.classList.add('adding');
  row.addEventListener('animationend', () => { try { row.classList.remove('adding'); } catch(e){} }, { once: true });
  haptic(30);
}

function animateCartItemRemove(row, onComplete) {
  if (!row) { if (onComplete) onComplete(); return; }
  row.classList.add('removing');
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      if (onComplete) onComplete();
    }
  };
  row.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 250);
  haptic([30, 20]);
}

function pulseQtyDisplay(qtyEl) {
  if (!qtyEl) return;
  qtyEl.classList.remove('bump');
  void qtyEl.offsetWidth;
  qtyEl.classList.add('bump');
  qtyEl.addEventListener('animationend', () => { try { qtyEl.classList.remove('bump'); } catch(e){} }, { once: true });
}

function flashPaymentSuccess() {
  const btn = document.getElementById('btn-charge');
  if (!btn) return;
  btn.classList.add('success-pulse');
  btn.addEventListener('animationend', () => { try { btn.classList.remove('success-pulse'); } catch(e){} }, { once: true });
  haptic([50, 30, 100]);
  if (typeof window.announceToScreenReader === 'function') {
    window.announceToScreenReader('Payment successful!');
  }
}

function shakeElement(elOrId) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  el.addEventListener('animationend', () => { try { el.classList.remove('shake'); } catch(e){} }, { once: true });
  haptic([50, 30, 50]);
}

if (typeof window !== 'undefined') {
  window.haptic = haptic;
  window.animateCartItemAdd = animateCartItemAdd;
  window.animateCartItemRemove = animateCartItemRemove;
  window.pulseQtyDisplay = pulseQtyDisplay;
  window.flashPaymentSuccess = flashPaymentSuccess;
  window.shakeElement = shakeElement;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { haptic, animateCartItemAdd, animateCartItemRemove, pulseQtyDisplay, flashPaymentSuccess, shakeElement };
}
