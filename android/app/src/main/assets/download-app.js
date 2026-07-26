/* ============================================================================
   VALENIXIA COMMERCE ECOSYSTEM — DOWNLOAD CENTER ENGINE
   Strict CSP compliant (No inline scripts), Awwwards-tier interactive features
   ============================================================================ */

(function () {
  'use strict';

  // ── 1. OS & Platform Auto-Detector ─────────────────────────────────────────
  function detectOS() {
    const ua = navigator.userAgent || navigator.vendor || window.opera || '';
    const platform = navigator.platform || '';

    if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(platform) || /Macintosh|Mac OS/i.test(ua)) {
      if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
      return 'mac';
    }
    if (/Android/i.test(ua)) return 'android';
    if (/Linux|X11/i.test(platform) || /Linux/i.test(ua)) return 'linux';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    return 'web';
  }

  function highlightRecommendedPlatform() {
    const userOS = detectOS();
    const cardIdMap = {
      windows: 'card-windows',
      mac: 'card-mac',
      linux: 'card-linux',
      android: 'card-android',
      ios: 'card-ios'
    };

    const targetCardId = cardIdMap[userOS];
    if (targetCardId) {
      const card = document.getElementById(targetCardId);
      if (card) {
        card.classList.add('recommended-card');
        const badge = document.createElement('div');
        badge.className = 'rec-badge';
        badge.innerHTML = '✨ Recommended for your device';
        card.prepend(badge);
      }
    }
  }

  // ── 2. Background Particle Canvas ──────────────────────────────────────────
  function initParticleCanvas() {
    const canvas = document.getElementById('hero-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, particles = [];

    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function createParticles(count) {
      return Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.8 + 0.4,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        alpha: Math.random() * 0.6 + 0.15,
        color: Math.random() > 0.4 ? '16, 185, 129' : '56, 189, 248'
      }));
    }

    function renderFrame() {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.fill();

        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
      }
      requestAnimationFrame(renderFrame);
    }

    resize();
    particles = createParticles(90);
    renderFrame();

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resize();
        particles = createParticles(90);
      }, 100);
    });
  }

  // ── 3. Scroll Reveal Animations ───────────────────────────────────────────
  function initScrollAnimations() {
    const fadeEls = document.querySelectorAll('.fade-up');
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      }, { threshold: 0.1 });

      fadeEls.forEach(el => observer.observe(el));
    } else {
      fadeEls.forEach(el => el.classList.add('visible'));
    }
  }

  // ── 4. QR Code Renderer ───────────────────────────────────────────────────
  function initQRCode() {
    const container = document.getElementById('qr-canvas-container');
    if (!container) return;
    const targetUrl = window.location.origin + '/index.html';

    if (typeof QRCode !== 'undefined') {
      container.innerHTML = '';
      new QRCode(container, {
        text: targetUrl,
        width: 140,
        height: 140,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } else {
      container.innerHTML = `
        <div style="text-align:center; padding:12px; font-family:sans-serif;">
          <div style="font-size:32px; margin-bottom:4px;">📱</div>
          <div style="font-size:10px; font-weight:700; color:#0f172a; word-break:break-all; max-width:130px;">${targetUrl}</div>
        </div>
      `;
    }
  }

  // ── 5. Tabbed Installation Guide ──────────────────────────────────────────
  function initGuideTabs() {
    const tabBtns = document.querySelectorAll('.guide-tab-btn');
    const tabPanes = document.querySelectorAll('.guide-tab-pane');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');

        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const activePane = document.getElementById(`tab-pane-${targetTab}`);
        if (activePane) activePane.classList.add('active');
      });
    });
  }

  // ── 6. Checksum Modal / Copy Action ───────────────────────────────────────
  function initCopyButtons() {
    document.querySelectorAll('.btn-copy-hash').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const text = btn.getAttribute('data-copy') || '';
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          const originalText = btn.textContent;
          btn.textContent = 'Copied!';
          btn.style.color = '#10b981';
          setTimeout(() => {
            btn.textContent = originalText;
            btn.style.color = '';
          }, 2000);
        }).catch(() => {});
      });
    });
  }

  // ── 7. DOM Ready Initializer ──────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    highlightRecommendedPlatform();
    initParticleCanvas();
    initScrollAnimations();
    initQRCode();
    initGuideTabs();
    initCopyButtons();
  });

})();
