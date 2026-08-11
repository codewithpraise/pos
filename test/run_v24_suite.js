const { spawn } = require('child_process');
const path = require('path');

const testFiles = [
  path.join(__dirname, 'v24_subscription_layout.test.js'),
  path.join(__dirname, 'v24_comprehensive_architecture.test.js')
];

const child = spawn('npx', ['mocha', ...testFiles], {
  stdio: 'inherit',
  shell: true
});

child.on('close', (code) => {
  process.exit(code);
});
