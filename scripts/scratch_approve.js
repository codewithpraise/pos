const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('nexova.db');

db.run("INSERT OR REPLACE INTO approved_devices (node_id, device_name, user_agent, approved_at, status) VALUES ('cfd_tab_2', 'Web Register', 'Manual Approve', ?, 'APPROVED')", [Date.now()], (err) => {
  if (err) {
    console.error('Error approving device:', err.message);
  } else {
    console.log('Successfully approved device cfd_tab_2 in SQLite database.');
  }
  db.close();
});
