/* ============================================================================
   VALENIXIA POS — UI MODULE
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeIcon(rawIcon) {
    if (!rawIcon) return '';
    const clean = String(rawIcon).trim();
    if (clean.startsWith('<') && typeof window !== 'undefined' && window.DOMPurify) {
      return window.DOMPurify.sanitize(clean);
    }
    return escapeHtml(clean);
  }

  const escapedTitle = escapeHtml(title);
  const escapedSubtitle = escapeHtml(subtitle);
  const sanitizedIcon = sanitizeIcon(icon);
  const escapedCtaLabel = escapeHtml(ctaLabel);

  const ctaHtml = escapedCtaLabel ? `<button class="btn-empty-cta" id="empty-cta-${containerId}">${escapedCtaLabel}</button>` : '';

  container.innerHTML = `
    <div class="pos-empty-state" role="status" aria-label="${escapedTitle}">
      <span class="pos-empty-state-icon" aria-hidden="true">${sanitizedIcon}</span>
      <h3>${escapedTitle}</h3>
      <p>${escapedSubtitle}</p>
      ${ctaHtml}
    </div>
  `;

  if (escapedCtaLabel && ctaFn) {
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
