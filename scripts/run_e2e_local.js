const { spawn } = require('child_process');
const http = require('http');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkCDPAvailable() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 9222,
      path: '/json',
      method: 'GET',
      timeout: 1000
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function main() {
  // Clean up existing local database files to prevent test contamination
  const dbFiles = ['valenixia.db', 'valenixia.db-wal', 'valenixia.db-shm', 'nexova.db', 'nexova.db-wal', 'nexova.db-shm'];
  for (const file of dbFiles) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (_) {}
  }

  console.log('[Runner] Spawning headless Chrome on port 9222...');
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-sandbox',
    '--user-data-dir=c:\\Users\\DELL\\Desktop\\nexova\\chrome-profile',
    'http://localhost:3000'
  ], { detached: true, stdio: 'ignore' });
  chrome.unref();

  // Wait for Chrome to be ready
  let ready = false;
  for (let i = 0; i < 20; i++) {
    ready = await checkCDPAvailable();
    if (ready) {
      console.log('[Runner] Headless Chrome is ready and listening on port 9222!');
      break;
    }
    await sleep(500);
  }

  if (!ready) {
    console.error('[Runner] Error: Headless Chrome failed to start or listen on port 9222.');
    process.exit(1);
  }

  // Run the three test scripts in order
  const tests = [
    { name: 'e2e_full_test.js', file: 'e2e_full_test.js' },
    { name: 'full_diagnostic.js', file: 'full_diagnostic.js' },
    { name: 'cdp_mobile_e2e_full5.js', file: 'cdp_mobile_e2e_full5.js' }
  ];

  let allPassed = true;

  for (const test of tests) {
    console.log(`\n==================================================`);
    console.log(`[Runner] RUNNING TEST SUITE: ${test.name}`);
    console.log(`==================================================`);

    const result = await new Promise((resolve) => {
      const child = spawn('node', [test.file], { stdio: 'inherit' });
      child.on('close', (code) => {
        resolve(code === 0);
      });
    });

    if (!result) {
      console.error(`[Runner] Test suite ${test.name} failed!`);
      allPassed = false;
    } else {
      console.log(`[Runner] Test suite ${test.name} passed.`);
    }
  }

  // Clean up Chrome
  console.log('[Runner] Killing Chrome process...');
  // Force kill any chrome processes that are run under remote debugging on Windows
  const killProcess = spawn('taskkill', ['/F', '/IM', 'chrome.exe', '/FI', 'WINDOWTITLE eq about:blank*'], { stdio: 'ignore' });
  killProcess.on('close', () => {
    if (allPassed) {
      console.log('\n[Runner] ALL E2E TEST SUITES PASSED SUCCESSFULLY!');
      process.exit(0);
    } else {
      console.error('\n[Runner] SOME E2E TEST SUITES FAILED!');
      process.exit(1);
    }
  });
}

main().catch(err => {
  console.error('[Runner] Fatal runner error:', err);
  process.exit(1);
});
