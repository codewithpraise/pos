# Guide: Mobile Layout & Responsiveness Testing via MCP Chrome DevTools

This handbook outlines how to use Chrome DevTools protocol (CDP) commands and the Model Context Protocol (MCP) DevTools server to programmatically audit mobile layouts, measure touch targets, verify keyboard avoidance, and capture rendering performance metrics in the browser.

---

## 1. Emulating Mobile Viewports

Mobile layout testing begins by emulating target screens. We override metrics via `Emulation.setDeviceMetricsOverride`.

### API Signature (CDP)
```json
{
  "method": "Emulation.setDeviceMetricsOverride",
  "params": {
    "width": 390,
    "height": 844,
    "deviceScaleFactor": 2.0,
    "mobile": true
  }
}
```

### Reference Testing Matrix
- **Budget Android Screen:** `360x640`
- **iPhone 12/13/14 Screen:** `390x844`
- **Standard 10" Android Tablet:** `1280x800`
- **iPad Portrait Screen:** `768x1024`

---

## 2. Checking Layout Overflow & Scroll Anchors

To guarantee that layouts fit the mobile screen without breaking columns or creating unintended horizontal scrollbars, verify that the page's scrollable content does not exceed the viewport window.

### Step-by-Step CDP Verification Script
Run the following JavaScript evaluate block via `Runtime.evaluate`:

```javascript
(() => {
  const scrollWidth = document.documentElement.scrollWidth;
  const clientWidth = document.documentElement.clientWidth;
  const hasHorizontalScroll = scrollWidth > clientWidth;
  
  return {
    scrollWidth,
    clientWidth,
    hasHorizontalScroll,
    status: hasHorizontalScroll ? "FAIL: Layout Overflow Detected!" : "PASS: Fitted"
  };
})()
```

---

## 3. Auditing Touch Target Sizing (>= 48px)

Under mobile accessibility standards (WCAG 2.1 AA / Android Design guidelines), touchable controls must offer a minimum interaction area of **48x48px** to prevent false taps.

### Step-by-Step CDP Target Scan
Query and evaluate bounding boxes for all active interactive controls (buttons, links, nav tabs, etc.):

```javascript
(() => {
  const targets = Array.from(document.querySelectorAll('.pin-btn, .pos-bottom-nav .nav-item, .category-pill, .product-quick-card'));
  const violations = [];
  
  targets.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 48 || rect.height < 48) {
      violations.push({
        selector: `${el.tagName.toLowerCase()}.${el.className.split(' ').join('.')}`,
        width: rect.width,
        height: rect.height,
        text: el.textContent.trim().substring(0, 15)
      });
    }
  });
  
  return {
    totalChecked: targets.length,
    violationsFound: violations.length,
    violations
  };
})()
```

---

## 4. Verifying Keyboard Avoidance

When a soft input panel (on-screen keyboard) rises, it eats up roughly **250px–300px** of vertical screen space. The app should reposition active text input fields so they are not covered.

### Simulation Protocol (CDP)
1. Trigger mobile emulation of a standard height, e.g. `390x844`.
2. Emulate keyboard popping by updating the viewport height override to `390x594` (reducing height by 250px).
3. Focus the input element and run the viewport coordinates check:

```javascript
(() => {
  const focusedInput = document.activeElement;
  if (!focusedInput || focusedInput.tagName !== "INPUT") {
    return "ERROR: No active text input focused!";
  }
  const rect = focusedInput.getBoundingClientRect();
  const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
  
  return {
    isVisible,
    inputTop: rect.top,
    inputBottom: rect.bottom,
    viewportHeight: window.innerHeight,
    status: isVisible ? "PASS" : "FAIL: Covered by Keyboard!"
  };
})()
```

---

## 5. Network Throttling & Offline Simulation

 POS systems must remain operational during Wi-Fi drops. You can simulate offline states or slow cellular links to test sync queues.

### Offline Mode Override (CDP)
```json
{
  "method": "Network.emulateNetworkConditions",
  "params": {
    "offline": true,
    "latency": 0,
    "downloadThroughput": 0,
    "uploadThroughput": 0
  }
}
```

### Regular 3G Connection Emulation
```json
{
  "method": "Network.emulateNetworkConditions",
  "params": {
    "offline": false,
    "latency": 150,
    "downloadThroughput": 1600 * 1024 / 8, // ~1.6 Mbps
    "uploadThroughput": 750 * 1024 / 8     // ~750 Kbps
  }
}
```

---

## 6. Capturing Performance Flamegraphs for Checkout

To ensure the product grid and cart updates perform at a smooth 60FPS, record performance metrics during transactions.

### Running a Timeline Trace
1. Enable the tracing domain:
   ```json
   { "method": "Tracing.start", "params": { "categories": "devtools.timeline,disabled-by-default-devtools.timeline" } }
   ```
2. Interact with the cart via JavaScript (e.g. adding 100 items).
3. Stop the trace and retrieve timeline frames:
   ```json
   { "method": "Tracing.end" }
   ```
4. Analyze the trace data for long frames (> 16.6ms) or excessive style recalculations.
