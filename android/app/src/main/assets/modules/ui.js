/* ============================================================================
   NEXOVA POS — UI MODULE
   Renders skeleton loaders and empty states.
   ============================================================================ */

/**
 * Inject a premium animated empty state into a container.
 * @param {string} containerId
 * @param {string} icon       - Emoji or SVG string
 * @param {string} title
 * @param {string} subtitle
 * @param {string} [ctaLabel] - Optional CTA button label
 * @param {Function} [ctaFn]  - Optional CTA click handler
 */
export function renderPremiumEmptyState(containerId, icon, title, subtitle, ctaLabel, ctaFn) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const ctaHtml = ctaLabel ? `<button class="btn-empty-cta" id="empty-cta-${containerId}">${ctaLabel}</button>` : '';

  container.innerHTML = `
    <div class="pos-empty-state" role="status" aria-label="${title}">
      <span class="pos-empty-state-icon" aria-hidden="true">${icon}</span>
      <h3>${title}</h3>
      <p>${subtitle}</p>
      ${ctaHtml}
    </div>
  `;

  if (ctaLabel && ctaFn) {
    const ctaEl = document.getElementById(`empty-cta-${containerId}`);
    if (ctaEl) ctaEl.addEventListener('click', ctaFn);
  }
}

/**
 * Inject a skeleton loader grid into a container.
 * @param {string} containerId
 * @param {number} count    - Number of skeleton cards
 * @param {'card'|'row'} type
 */
export function renderSkeletonLoader(containerId, count = 8, type = 'row') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (type === 'card') {
    container.innerHTML = Array.from({ length: count }, () => `
      <div class="skeleton-card" style="border-radius:10px;" aria-hidden="true"></div>
    `).join('');
  } else {
    container.innerHTML = Array.from({ length: count }, () => `
      <div style="display:flex; flex-direction:column; gap:6px; padding:12px 0; border-bottom:1px solid rgba(255,255,255,0.03);" aria-hidden="true">
        <div class="skeleton-line" style="width:60%;"></div>
        <div class="skeleton-line short" style="width:40%;"></div>
      </div>
    `).join('');
  }

  container.setAttribute('aria-busy', 'true');
  container.setAttribute('aria-label', 'Loading…');
}

// Expose globally for backward compatibility
window.renderPremiumEmptyState = renderPremiumEmptyState;
window.renderSkeletonLoader = renderSkeletonLoader;
