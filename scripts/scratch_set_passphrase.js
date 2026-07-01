const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('nexova.db');

db.run(
  "INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('sync_passphrase', 'STR', '1', 0, ?)",
  [Date.now()],
  (err) => {
    if (err) {
      console.error('Error setting passphrase:', err.message);
    } else {
      console.log('Successfully set sync_passphrase = 1 in SQLite database.');
    }
    db.close();
  }
);
