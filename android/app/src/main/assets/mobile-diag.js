/* ===== VALENIXIA MOBILE DIAGNOSTIC HARNESS v2 ===== */
(function(){
  window.__VALENIXIA_DIAG = {
    logs: [],
    max: 500,
    push(lvl, src, msg, meta){
      const entry = {t:Date.now(), lvl, src, msg, meta, ua:navigator.userAgent};
      this.logs.push(entry);
      if(this.logs.length > this.max) this.logs.shift();
      const overlay = document.getElementById('valenixia-live-log');
      if(overlay){
        const line = document.createElement('div');
        line.style.cssText = 'font-size:11px;font-family:monospace;padding:2px 4px;border-bottom:1px solid #333;';
        line.style.color = lvl==='error'?'#ff4444':lvl==='warn'?'#ffaa00':'#ccc';
        line.textContent = `[${new Date(entry.t).toLocaleTimeString()}] [${lvl}] ${src}: ${msg}`;
        overlay.appendChild(line);
        overlay.scrollTop = overlay.scrollHeight;
      }
    }
  };

  ['log','warn','error','info','debug'].forEach(lvl => {
    const orig = console[lvl].bind(console);
    console[lvl] = function(...args){
      const msg = args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
        catch(e){ return '[unserializable]'; }
      }).join(' ');
      
      // Error-specific logging filter: Only log errors, warnings, and autotest insights to diagnostic memory
      const isErrorOrInsight = lvl === 'error' || lvl === 'warn' || 
        msg.includes('[AUTOTEST') || msg.includes('CRITICAL') || msg.includes('FATAL') || msg.includes('FAIL');
      
      if (isErrorOrInsight) {
        window.__VALENIXIA_DIAG.push(lvl, 'console', msg, {raw:args});
      }
      
      // Only forward to browser devtools console if it is an actual error or debug mode is explicitly active
      const isDebug = window.__VALENIXIA_DEBUG__ || (typeof localStorage !== 'undefined' && localStorage.getItem('valenixia_debug') === 'true');
      if (lvl === 'error' || isDebug) {
        orig(...args);
      }
    };
  });

  window.addEventListener('error', e => {
    window.__VALENIXIA_DIAG.push('error', 'window.onerror', e.message, {
      file: e.filename, line: e.lineno, col: e.colno,
      stack: e.error && e.error.stack ? e.error.stack : null
    });
  });
  window.addEventListener('unhandledrejection', e => {
    window.__VALENIXIA_DIAG.push('error', 'unhandledrejection', String(e.reason), {
      stack: e.reason && e.reason.stack ? e.reason.stack : null
    });
  });

  const origWorker = window.Worker;
  window.Worker = function(url, opts){
    const w = new origWorker(url, opts);
    w.addEventListener('error', e => {
      window.__VALENIXIA_DIAG.push('error', 'Worker', e.message, {filename:e.filename, lineno:e.lineno});
    });
    w.addEventListener('messageerror', e => {
      window.__VALENIXIA_DIAG.push('error', 'Worker.messageerror', 'Message deserialization failed', {});
    });
    const origPost = w.postMessage.bind(w);
    w.postMessage = function(msg, transfer){
      if (msg && (msg.type === 'ERROR' || msg.error)) {
        window.__VALENIXIA_DIAG.push('error', 'Worker→SW', msg.error || msg.type, {});
      }
      return origPost(msg, transfer);
    };
    return w;
  };

  window.runButtonAudit = function() {
    const selectors = 'button, .btn, a[role="button"], input[type="button"], input[type="submit"], [data-screen], [data-view], .nav-item, .icon-btn, .pin-key';
    const elements = Array.from(document.querySelectorAll(selectors));
    const auditResults = [];
    let activePassed = 0, activeWarnings = 0, activeFailed = 0, inactiveCount = 0;

    elements.forEach((el, index) => {
      const id = el.id || `btn_${index}`;
      const text = (el.innerText || el.textContent || el.value || el.title || el.getAttribute('aria-label') || '').trim().substring(0, 30);
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const issues = [];
      let status = 'PASS';

      // Context check: Is this button in an inactive view or closed modal?
      const parentView = el.closest('.content-view');
      const parentModal = el.closest('.modal-overlay, #auth-lock-screen');
      const isParentViewInactive = parentView && (!parentView.classList.contains('active') || window.getComputedStyle(parentView).display === 'none');
      const isParentModalClosed = parentModal && (window.getComputedStyle(parentModal).display === 'none' || parentModal.style.display === 'none');

      if (isParentViewInactive || isParentModalClosed) {
        inactiveCount++;
        auditResults.push({
          id,
          text: text || '<empty>',
          tag: el.tagName.toLowerCase(),
          class: el.className,
          status: isParentModalClosed ? 'MODAL_CLOSED' : 'INACTIVE_SCREEN',
          rect: '0x0 (hidden view)',
          diagnosis: isParentModalClosed ? 'Modal is currently closed (expected hidden)' : `Screen '${parentView ? parentView.id : 'unselected'}' is currently inactive`
        });
        return;
      }

      // 1. Check DOM Visibility for active screen buttons
      const isVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      if (!isVisible) {
        issues.push('Hidden in active DOM (display:none, visibility:hidden, opacity:0, or 0x0 rect)');
        status = 'FAIL';
      }

      // 2. Check Touch Target Sizing (Mobile recommended min 36px)
      if (isVisible && (Math.floor(rect.width) < 36 || Math.floor(rect.height) < 36)) {
        issues.push(`Small touch target (${Math.round(rect.width)}x${Math.round(rect.height)}px < 36px minimum threshold)`);
        if (status !== 'FAIL') status = 'WARN';
      }

      // 3. Check Disablement & Pointer-Events
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
        issues.push('Disabled via attribute (disabled or aria-disabled=true)');
        if (status !== 'FAIL') status = 'WARN';
      }
      if (style.pointerEvents === 'none') {
        issues.push('CSS pointer-events: none (clicks will pass through)');
        status = 'FAIL';
      }

      // 4. Check Touch Obstruction via elementFromPoint (ignoring dev diagnostic harness buttons & live log overlay)
      if (isVisible) {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        if (centerX >= 0 && centerX <= window.innerWidth && centerY >= 0 && centerY <= window.innerHeight) {
          const topEl = document.elementFromPoint(centerX, centerY);
          const diagOverlay = topEl && topEl.closest('#valenixia-live-log, #app-boot-loader, #diag-copy-btn, #diag-toggle-btn');
          const isDiagEl = !!diagOverlay || (topEl && (topEl.id === 'diag-copy-btn' || topEl.id === 'diag-toggle-btn' || topEl.id === 'valenixia-live-log' || topEl.id === 'app-boot-loader'));

          if (topEl && !isDiagEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
            issues.push(`Obstructed by overlay element <${topEl.tagName.toLowerCase()} class="${topEl.className}"> at (${Math.round(centerX)},${Math.round(centerY)})`);
            status = 'FAIL';
          }
        }
      }

      // 5. Check Navigation Target View Existence
      const targetViewId = el.getAttribute('data-screen') || el.getAttribute('data-view') || (el.getAttribute('href') || '').replace('#', '');
      if (targetViewId && !targetViewId.startsWith('http') && !targetViewId.startsWith('javascript:')) {
        const targetEl = document.getElementById(targetViewId) || document.getElementById(`view-${targetViewId}`);
        if (!targetEl) {
          issues.push(`Target view '#${targetViewId}' does not exist in DOM`);
          status = 'FAIL';
        }
      }

      if (status === 'PASS') activePassed++;
      else if (status === 'WARN') activeWarnings++;
      else activeFailed++;

      auditResults.push({
        id,
        text: text || '<empty>',
        tag: el.tagName.toLowerCase(),
        class: el.className,
        status,
        rect: `${Math.round(rect.width)}x${Math.round(rect.height)} @ (${Math.round(rect.left)},${Math.round(rect.top)})`,
        diagnosis: issues.length ? issues.join(' | ') : 'Working properly & interactive'
      });
    });

    const auditSummary = {
      timestamp: new Date().toISOString(),
      totalElements: elements.length,
      activeScreenTested: activePassed + activeWarnings + activeFailed,
      activePassed,
      activeWarnings,
      activeFailed,
      inactiveScreenElements: inactiveCount,
      results: auditResults
    };

    if (window.__VALENIXIA_DIAG && Array.isArray(window.__VALENIXIA_DIAG.logs)) {
      window.__VALENIXIA_DIAG.logs.push({
        t: Date.now(),
        lvl: 'log',
        src: 'ButtonAudit',
        msg: `[ButtonAudit] ${elements.length} scanned (${activePassed} PASS, ${activeWarnings} WARN, ${activeFailed} FAIL, ${inactiveCount} INACTIVE)`,
        meta: auditSummary
      });
    }

    console.log(`[ButtonAudit] Complete. Scanned: ${elements.length} | Active PASS: ${activePassed} | Active WARN: ${activeWarnings} | Active FAIL: ${activeFailed} | Inactive: ${inactiveCount}`, auditSummary);
    return auditSummary;
  };

  window.dumpSettingsDiagnostics = function() {
    // Select unique settings card elements inside #view-settings
    const rawElements = Array.from(document.querySelectorAll('#view-settings .settings-section, #view-settings .dm-card'));
    const sections = Array.from(new Set(rawElements));

    const report = {
      timestamp: new Date().toISOString(),
      totalSectionsFound: sections.length,
      squishedOrNestedOffenders: [],
      sections: []
    };

    sections.forEach((sec, idx) => {
      // Force natural un-squished height at runtime
      sec.style.setProperty('height', 'auto', 'important');
      sec.style.setProperty('max-height', 'none', 'important');
      sec.style.setProperty('min-height', '0', 'important');
      sec.style.setProperty('overflow-y', 'visible', 'important');
      sec.style.setProperty('box-sizing', 'border-box', 'important');

      const h3 = sec.querySelector('h3, .title, .dm-danger-header, span, div');
      const title = h3 ? h3.textContent.trim().substring(0, 40) : `Section #${idx + 1}`;
      const cs = window.getComputedStyle(sec);
      const parentSec = sec.parentElement ? sec.parentElement.closest('#view-settings .settings-section, #view-settings .dm-card') : null;

      const isScrollableOverridden = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && (sec.scrollHeight > sec.clientHeight + 12);
      const isNested = !!parentSec;
      const isCollapsed = sec.offsetHeight > 0 && sec.offsetHeight < 48;

      const secInfo = {
        index: idx + 1,
        id: sec.id || `<card-${idx + 1}>`,
        title,
        classes: sec.className,
        offsetHeight: sec.offsetHeight,
        offsetHeightPx: `${sec.offsetHeight}px`,
        scrollHeight: sec.scrollHeight,
        scrollHeightPx: `${sec.scrollHeight}px`,
        computedHeight: cs.height,
        computedMaxHeight: cs.maxHeight,
        computedOverflowY: cs.overflowY,
        isNestedInsideParentSection: isNested,
        parentSectionId: parentSec ? (parentSec.id || parentSec.className) : 'ROOT_GRID',
        hasActiveVerticalScrollbar: isScrollableOverridden,
        isCollapsed
      };

      if (isScrollableOverridden || isNested || isCollapsed) {
        report.squishedOrNestedOffenders.push({ id: secInfo.id, title, isNested, isScrollableOverridden, isCollapsed, height: secInfo.offsetHeightPx });
      }

      report.sections.push(secInfo);
    });

    const hasRealIssues = report.squishedOrNestedOffenders.length > 0;
    const logLevel = hasRealIssues ? 'error' : 'info';

    console[logLevel](`[SettingsDiagnostic v4] ${sections.length} settings cards audited. Critical UI Issues: ${hasRealIssues ? `YES (${report.squishedOrNestedOffenders.length} offending cards)` : 'NONE (100% OK)'}`, report);

    if (hasRealIssues) {
      console.warn('[SettingsDiagnostic] Offending Cards:', report.squishedOrNestedOffenders);
    }

    if (window.__VALENIXIA_DIAG && Array.isArray(window.__VALENIXIA_DIAG.logs)) {
      window.__VALENIXIA_DIAG.logs.push({
        t: Date.now(),
        lvl: logLevel,
        src: 'SettingsDiag',
        msg: `[SettingsDiag] Audited ${sections.length} cards. Real Issues: ${hasRealIssues ? report.squishedOrNestedOffenders.length : 0}`,
        meta: report
      });
    }

    return report;
  };

  // Run audit on load and whenever view-settings becomes active
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (typeof window.dumpSettingsDiagnostics === 'function') {
        window.dumpSettingsDiagnostics();
      }
    }, 1500);
  });

  window.dumpUIDiagnostics = function() {
    const offenders = [];
    document.querySelectorAll('*').forEach(el => {
      if (el.scrollWidth > window.innerWidth + 2) {
        offenders.push({ tag: el.tagName, class: el.className, id: el.id, scrollWidth: el.scrollWidth });
      }
    });
    const visibleViews = Array.from(document.querySelectorAll('.content-view')).filter(v => {
      const s = window.getComputedStyle(v);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    });
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: window.devicePixelRatio,
      overflowCount: offenders.length,
      activeViewsCount: visibleViews.length,
      activeViews: visibleViews.map(v => v.id),
      buttonAuditSummary: typeof window.runButtonAudit === 'function' ? window.runButtonAudit() : null,
      settingsDiagnostics: typeof window.dumpSettingsDiagnostics === 'function' ? window.dumpSettingsDiagnostics() : null
    };
  };

  window.copyValenixiaLogs = async function(){
    const settingsReport = typeof window.dumpSettingsDiagnostics === 'function' ? window.dumpSettingsDiagnostics() : null;
    const payload = {
      dumpVersion: 3,
      url: location.href,
      ua: navigator.userAgent,
      screen: {w:window.innerWidth, h:window.innerHeight, dpr:window.devicePixelRatio},
      storage: {idb:!!window.indexedDB, ls:!!window.localStorage},
      settingsDiag: settingsReport,
      ui: typeof window.dumpUIDiagnostics === 'function' ? window.dumpUIDiagnostics() : {},
      logs: window.__VALENIXIA_DIAG.logs
    };

    const text = JSON.stringify(payload, null, 2);
    try{
      await navigator.clipboard.writeText(text);
      alert('Diagnostic log copied (' + payload.logs.length + ' entries). Settings cards: ' + (settingsReport ? settingsReport.sections.length : 0));
    }catch(e){
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      alert('Diagnostic log copied (' + payload.logs.length + ' entries). Settings cards: ' + (settingsReport ? settingsReport.sections.length : 0));
    }
  };
})();
