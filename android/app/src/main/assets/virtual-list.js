// ============================================================================
// VALENIXIA VIRTUAL LIST — WINDOWED DOM RENDERER
// Guarantees 60fps scrolling for arbitrarily large datasets by keeping only
// ~15 DOM nodes live at any time, regardless of total item count.
// ============================================================================

'use strict';

class VirtualList {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container     — The scrollable outer container
   * @param {number}      options.itemHeight    — Fixed height per row/card in px
   * @param {Function}    options.renderItem    — (item, index) => HTMLElement
   * @param {number}      [options.bufferCount] — Extra rows to render above/below viewport (default: 5)
   */
  constructor({ container, itemHeight, renderItem, bufferCount = 5 }) {
    this.container   = container;
    this.container.innerHTML = ''; // Clear skeleton loaders or old static markup!
    this.itemHeight  = itemHeight;
    this.renderItem  = renderItem;
    this.bufferCount = bufferCount;
    this.items       = [];
    this._scrollTop  = 0;
    this._raf        = null;

    // ── DOM structure ────────────────────────────────────────────────────────
    // Outer container must be `position: relative` and have a fixed height
    this.container.style.overflowY  = 'auto';
    this.container.style.position   = 'relative';
    this.container.style.willChange = 'scroll-position';

    // Ghost spacer div that sets total scroll height
    this._spacer = document.createElement('div');
    this._spacer.style.cssText = 'position: absolute; top: 0; left: 0; width: 1px; pointer-events: none;';
    this.container.appendChild(this._spacer);

    // Content layer
    this._content = document.createElement('div');
    this._content.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%;';
    this.container.appendChild(this._content);

    this._onScroll = this._scheduleRender.bind(this);
    this.container.addEventListener('scroll', this._onScroll, { passive: true });
  }

  /** Replace dataset and re-render */
  setItems(items) {
    this.items = items;
    this._spacer.style.height = `${items.length * this.itemHeight}px`;
    this._render();
  }

  /** Force re-render at current scroll position (call after external state change) */
  refresh() {
    this._render();
  }

  /** Clean up listeners */
  destroy() {
    this.container.removeEventListener('scroll', this._onScroll);
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _scheduleRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._render();
    });
  }

  _render() {
    const scrollTop      = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;
    const total          = this.items.length;
    const itemH          = this.itemHeight;

    if (total === 0) {
      this._content.innerHTML = '';
      return;
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / itemH) - this.bufferCount);
    const endIndex   = Math.min(total - 1, Math.ceil((scrollTop + viewportHeight) / itemH) + this.bufferCount);

    // Offset to position the content window correctly
    this._content.style.transform = `translateY(${startIndex * itemH}px)`;

    // Build fragment for visible slice
    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i <= endIndex; i++) {
      const el = this.renderItem(this.items[i], i);
      el.style.height = `${itemH}px`;
      el.style.boxSizing = 'border-box';
      fragment.appendChild(el);
    }

    this._content.innerHTML = '';
    this._content.appendChild(fragment);
  }
}
