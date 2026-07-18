// VALENIXIA COMMERCE ECOSYSTEM - BARCODE SCANNER DEFERRED LOADER
// ZXing is only needed when the barcode scanner is opened.
// We defer it to avoid blocking the main thread on page load.
(function() {
  const globalScope = typeof self !== 'undefined' ? self : window;

  globalScope._zxingLoaded = false;
  globalScope._zxingLoadCallbacks = [];
  
  globalScope.loadZXing = function(cb) {
    if (globalScope._zxingLoaded) { if (cb) cb(); return; }
    if (cb) globalScope._zxingLoadCallbacks.push(cb);
    if (document.querySelector('script[src="zxing.min.js"]')) return; // already loading
    
    var s = document.createElement('script');
    s.src = 'zxing.min.js';
    s.setAttribute('integrity', 'sha384-ET1PhbRYLe6k2AXPuFZAF+LZYXgMwkHwqrsbw4PobRULALuRP1buPYV++5ODebL5');
    s.setAttribute('crossorigin', 'anonymous');
    s.onload = function() {
      globalScope._zxingLoaded = true;
      globalScope._zxingLoadCallbacks.forEach(function(fn) { try { fn(); } catch(e) {} });
      globalScope._zxingLoadCallbacks = [];
    };
    document.head.appendChild(s);
  };
})();
