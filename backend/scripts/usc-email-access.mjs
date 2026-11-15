import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Operator-only, pinned to the team's project. Credentials never enter argv or output.
const mode = process.argv[2] ?? '--status';
const fail = reason => { console.log(JSON.stringify({ status: 'failed', reason })); process.exitCode = 1; };
const projectRef = 'cfrkamtsphdlowuiuarn';
const statusSql = `
SELECT pg_catalog.json_build_object(
  'profile_rls_enabled', COALESCE((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = pg_catalog.to_regclass('public.student_profiles')), false),
  'ownership_policy_count', (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'student_profiles' AND permissive = 'PERMISSIVE' AND policyname IN ('student_profiles_read_own','student_profiles_insert_own','student_profiles_update_own','student_profiles_delete_own')),
  'usc_policy_enabled', EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'student_profiles' AND policyname = 'student_profiles_usc_email_required' AND permissive = 'RESTRICTIVE' AND cmd = 'ALL'),
  'eligibility_function_exists', pg_catalog.to_regprocedure('odysc_private.has_confirmed_usc_email()') IS NOT NULL,
  'signup_hook_function_exists', pg_catalog.to_regprocedure('public.odysc_before_user_created_usc_email(jsonb)') IS NOT NULL,
  'confirmed_usc_account_count', (SELECT count(*) FROM auth.users WHERE email ~* '^[^@[:space:]]+@usc[.]edu$' AND email_confirmed_at IS NOT NULL)
);`;

function connectionEnv() {
  const connection = new URL(process.env.SUPABASE_DB_URL ?? '');
  const user = decodeURIComponent(connection.username);
  const password = decodeURIComponent(connection.password);
  const direct = connection.hostname === `db.${projectRef}.supabase.co`;
  const pooler = connection.hostname.endsWith('.pooler.supabase.com') && user.endsWith(`.${projectRef}`);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || (!direct && !pooler) || !password || !process.env.SUPABASE_DB_CA_FILE) throw new Error('configuration');
  return {
    PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8',
    PGHOST: connection.hostname, PGPORT: connection.port || '5432',
    PGDATABASE: decodeURIComponent(connection.pathname.slice(1)) || 'postgres',
    PGUSER: user, PGPASSWORD: password, PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: process.env.SUPABASE_DB_CA_FILE, PGCONNECT_TIMEOUT: '8',
    PGAPPNAME: 'odysc-usc-email-access', PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=3000',
  };
}

function run(sql, env) {
  const result = spawnSync('psql', ['--no-psqlrc', '--no-password', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose', '--file=-'], {
    input: sql, env, encoding: 'utf8', timeout: 40_000, maxBuffer: 512 * 1024,
  });
  if (result.status !== 0) {
    // Never echo libpq diagnostics, Auth rows, or test payloads.
    if (mode === '--verify') {
      const diagnostic = result.stderr ?? '';
      console.log(JSON.stringify({ verificationFailure: {
        sqlState: diagnostic.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? null,
        check: diagnostic.match(/ODYSC_[A-Z_]+/)?.[0] ?? null,
        sqlLine: Number(diagnostic.match(/(?:<stdin>|stdin):(\d+):/)?.[1]) || null,
        column: diagnostic.match(/COLUMN NAME:\s+([a-z_][a-z_0-9]*)/)?.[1] ?? null,
        constraint: diagnostic.match(/CONSTRAINT NAME:\s+([a-z_][a-z_0-9]*)/)?.[1] ?? null,
      } }));
    }
    const reason = result.error?.code === 'ENOENT' ? 'psql_unavailable'
      : /certificate|SSL|TLS/i.test(result.stderr ?? '') ? 'tls_verification_failed'
      : /password authentication failed/i.test(result.stderr ?? '') ? 'database_authentication_failed'
      : /timeout|timed out/i.test(result.stderr ?? '') ? 'database_timeout'
      : 'database_operation_failed';
    throw new Error(reason);
  }
  return result.stdout.trim();
}

try {
  if (!['--status', '--apply', '--verify'].includes(mode)) throw new Error('unsupported_mode');
  const env = connectionEnv();
  const before = JSON.parse(run(`BEGIN READ ONLY; ${statusSql} ROLLBACK;`, env));
  if (!before.profile_rls_enabled || before.ownership_policy_count !== 4) throw new Error('existing_ownership_policies_require_review');
  if (mode === '--apply') {
    run(readFileSync(new URL('../supabase/usc-email-access.sql', import.meta.url), 'utf8'), env);
  } else if (mode === '--verify') {
    if (!before.usc_policy_enabled || !before.eligibility_function_exists || !before.signup_hook_function_exists) throw new Error('usc_migration_not_applied');
    const sql = readFileSync(new URL('./verify-usc-email-access.sql', import.meta.url), 'utf8');
    run(sql, env);
  }
  const metadata = JSON.parse(run(`BEGIN READ ONLY; ${statusSql} ROLLBACK;`, env));
  if (mode !== '--status' && (!metadata.usc_policy_enabled || !metadata.eligibility_function_exists || !metadata.signup_hook_function_exists)) throw new Error('usc_migration_verification_failed');
  console.log(JSON.stringify({ status: mode === '--apply' ? 'applied' : mode === '--verify' ? 'verified_with_rollback' : 'inspected', metadata, authHookActivation: 'must_be_checked_in_supabase_dashboard' }));
} catch (error) {
  const known = new Set(['unsupported_mode', 'existing_ownership_policies_require_review', 'usc_migration_not_applied', 'usc_migration_verification_failed', 'psql_unavailable', 'tls_verification_failed', 'database_authentication_failed', 'database_timeout', 'database_operation_failed']);
  fail(error instanceof Error && known.has(error.message) ? error.message : 'configuration_or_operator_check_failed');
}
