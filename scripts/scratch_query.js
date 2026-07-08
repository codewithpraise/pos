const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('valenixia.db');

db.all("SELECT * FROM crsql_changes LIMIT 10", (err, rows) => {
  if (err) {
    console.error('Error querying:', err.message);
  } else {
    console.log('crsql_changes on server SQLite:', rows);
  }
  db.close();
});
