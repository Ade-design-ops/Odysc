const fs = require('fs');
const { Client } = require('pg');
const caPath = process.env.SUPABASE_DB_CA_FILE || '';
let ca = '';
try { ca = fs.readFileSync(caPath, 'utf8'); } catch (e) { console.log('CA ERROR: cannot read', caPath); process.exit(0); }
console.log('CA looks like a certificate:', ca.includes('BEGIN CERTIFICATE'));
const u = new URL(process.env.SUPABASE_DB_URL || '');
console.log('host:', u.hostname, '| port:', u.port || '5432');
const c = new Client({
  host: u.hostname, port: Number(u.port || 5432),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: decodeURIComponent(u.pathname.slice(1)) || 'postgres',
  ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 8000,
});
c.connect()
  .then(() => c.query('select count(*) from public.clubs'))
  .then(r => console.log('CONNECTED. Clubs in table:', r.rows[0].count))
  .catch(e => console.log('DB ERROR:', e.code || '', e.message))
  .finally(() => c.end().catch(() => {}));
