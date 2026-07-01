// Temporary workspace test file
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

console.log('Testing connection with URL:', url);

if (!url || !key) {
  console.error('Credentials missing in .env');
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  try {
    const { data, error } = await supabase
      .from('cloud_crdt_backups')
      .select('db_version')
      .limit(1);

    if (error) {
      console.error('Query returned error:', error.message);
    } else {
      console.log('Success! Table exists. Rows found:', data);
    }
  } catch (err) {
    console.error('Crash error:', err.message);
  }
}

run();
