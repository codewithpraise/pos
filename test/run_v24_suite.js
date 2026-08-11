const { spawn } = require('child_process');
const path = require('path');

const child = spawn('npx', ['mocha', path.join(__dirname, 'v24_subscription_layout.test.js')], {
  stdio: 'inherit',
  shell: true
});

child.on('close', (code) => {
  process.exit(code);
});
