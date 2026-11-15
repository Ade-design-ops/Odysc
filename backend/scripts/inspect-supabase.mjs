import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Local operator tool only. Do not import this into the application server.
// The credential is read from .env and never placed in argv or printed.
const raw = process.env.SUPABASE_DB_URL?.trim();
const fail = (reason, detail) => {
  console.log(JSON.stringify({ status: 'not_inspected', reason, ...(detail ? { detail } : {}) }));
  process.exitCode = 1;
};

let connection;
try { connection = raw ? new URL(raw) : undefined; } catch { /* Fixed error below. */ }
const projectRef = 'cfrkamtsphdlowuiuarn';
if (!connection || !['postgres:', 'postgresql:'].includes(connection.protocol)) {
  fail('missing_or_invalid_supabase_db_url');
} else {
  let user;
  let password;
  let database;
  let decodingValid = true;
  try {
    user = decodeURIComponent(connection.username);
    password = decodeURIComponent(connection.password);
    database = decodeURIComponent(connection.pathname.slice(1));
  } catch { decodingValid = false; }
  const direct = connection.hostname === `db.${projectRef}.supabase.co`;
  const pooler = connection.hostname.endsWith('.pooler.supabase.com') && user?.endsWith(`.${projectRef}`);
  if (!decodingValid || (!direct && !pooler) || !user || !password || /\[YOUR-PASSWORD\]/i.test(password)) {
    fail('credential_or_project_configuration_needs_attention');
  } else {
    const result = spawnSync('psql', [
      '--no-psqlrc', '--no-password', '--quiet', '--no-align', '--tuples-only',
      '--set', 'ON_ERROR_STOP=1',
    ], {
      input: readFileSync(new URL('./supabase-schema.sql', import.meta.url), 'utf8'),
      encoding: 'utf8', timeout: 25_000, maxBuffer: 2 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: 'en_US.UTF-8',
        PGHOST: connection.hostname,
        PGPORT: connection.port || '5432',
        PGDATABASE: database || 'postgres',
        PGUSER: user,
        PGPASSWORD: password,
        PGSSLMODE: 'verify-full',
        PGSSLROOTCERT: process.env.SUPABASE_DB_CA_FILE || 'system',
        PGCONNECT_TIMEOUT: '8',
        PGAPPNAME: 'odysc-schema-inspection',
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000',
      },
    });
    if (result.status === 0) {
      try {
        const metadata = JSON.parse(result.stdout);
        console.log(JSON.stringify({ status: 'inspected', metadata }, null, 2));
      } catch { fail('unexpected_metadata_response'); }
    } else {
      // libpq diagnostics can contain connection details. Classify internally
      // and return only fixed labels rather than logging stdout/stderr/errors.
      const diagnostic = result.stderr || '';
      const reason = result.error?.code === 'ENOENT' ? 'psql_not_installed'
        : /network is unreachable|no route to host/i.test(diagnostic) ? 'network_unreachable'
        : /could not translate host name|nodename nor servname|name or service not known/i.test(diagnostic) ? 'dns_failed'
        : /certificate|root certificate|SSL error|TLS/i.test(diagnostic) ? 'tls_verification_failed'
        : /password authentication failed|authentication failed|no password supplied/i.test(diagnostic) ? 'authentication_failed'
        : /timeout|timed out/i.test(diagnostic) || result.error?.code === 'ETIMEDOUT' ? 'connection_timeout'
        : /permission denied/i.test(diagnostic) ? 'query_permission_denied'
        : 'connection_or_inspection_failed';
      const detail = reason !== 'tls_verification_failed' ? undefined
        : /root certificate file .*does not exist|could not read root certificate|could not load SSL root certificate/i.test(diagnostic) ? 'ca_file_unavailable'
        : /does not match host name|hostname mismatch/i.test(diagnostic) ? 'hostname_mismatch'
        : /certificate verify failed|self.signed certificate|unable to get local issuer|unable to verify|unknown ca/i.test(diagnostic) ? 'untrusted_certificate_chain'
        : /server does not support SSL|SSL is not enabled/i.test(diagnostic) ? 'ssl_unavailable'
        : 'tls_configuration_needs_attention';
      fail(reason, detail);
    }
  }
}
