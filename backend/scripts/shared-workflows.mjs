import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

// Local operator commands only. Never import this module into the HTTP server.
const mode = process.argv[2] ?? '--status';
const names = ['odysc_student_workspaces', 'odysc_club_memberships', 'odysc_club_settings', 'odysc_applications', 'odysc_answer_bank', 'odysc_reviews', 'odysc_interviews', 'odysc_club_events'];
let pool;
try {
  const url = new URL(process.env.SUPABASE_DB_URL ?? '');
  const user = decodeURIComponent(url.username);
  const ref = 'cfrkamtsphdlowuiuarn';
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !(url.hostname === `db.${ref}.supabase.co` || (url.hostname.endsWith('.pooler.supabase.com') && user.endsWith(`.${ref}`))) || !url.password || !process.env.SUPABASE_DB_CA_FILE) throw new Error('configuration');
  pool = new Pool({ host: url.hostname, port: Number(url.port || 5432), user, password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)) || 'postgres', ssl: { ca: readFileSync(process.env.SUPABASE_DB_CA_FILE, 'utf8'), rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 8000, statement_timeout: 15000, options: '-c search_path=pg_catalog -c lock_timeout=3000', application_name: 'odysc-workflow-operator' });
  const status = async () => {
    const result = await pool.query(`SELECT c.relname AS name, c.relrowsecurity AS rls,
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
      has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS authenticated_access
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [names]);
    return result.rows;
  };
  if (mode === '--find') {
    const search = process.env.WORKFLOW_CLUB_SEARCH ?? '';
    if (!search.trim()) throw new Error('club_search_required');
    const clubs = await pool.query('SELECT club_id::text AS id,"Name" AS name FROM public.clubs WHERE "Name" ILIKE $1 OR "Name" ILIKE $2 ORDER BY club_id LIMIT 20', [`%${search}%`, '%National Society of Black Engineers%']);
    const email = process.env.WORKFLOW_ADMIN_EMAIL ?? '';
    const account = await pool.query("SELECT EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=lower($1) AND email ~* '^[^@[:space:]]+@usc[.]edu$' AND email_confirmed_at IS NOT NULL) AS eligible", [email]);
    console.log(JSON.stringify({ clubs: clubs.rows, confirmedAdminAccountExists: account.rows[0]?.eligible === true }));
  } else if (mode === '--apply') {
    const before = await status();
    if (before.length) throw new Error('workflow_tables_already_exist_review_required');
    await pool.query(readFileSync(new URL('../supabase/shared-workflows.sql', import.meta.url), 'utf8'));
    const tables = await status();
    if (tables.length !== names.length || tables.some(row => !row.rls || row.anon_access || row.authenticated_access)) throw new Error('workflow_schema_verification_failed');
    console.log(JSON.stringify({ status: 'applied', tables }));
  } else if (mode === '--bootstrap-admin') {
    const email = (process.env.WORKFLOW_ADMIN_EMAIL ?? '').trim().toLowerCase();
    const clubId = process.env.WORKFLOW_ADMIN_CLUB_ID ?? '';
    if (!/^[^@\s]+@usc\.edu$/u.test(email) || !/^\d{1,19}$/u.test(clubId)) throw new Error('approved_admin_email_and_club_id_required');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await client.query("SELECT id FROM auth.users WHERE lower(email)=$1 AND email_confirmed_at IS NOT NULL AND email ~* '^[^@[:space:]]+@usc[.]edu$' FOR SHARE", [email]);
      if (account.rows.length !== 1) throw new Error('confirmed_usc_admin_account_required');
      const club = await client.query('SELECT club_id::text AS id,"Name" AS name FROM public.clubs WHERE club_id=$1::bigint FOR UPDATE', [clubId]);
      if (club.rows.length !== 1) throw new Error('approved_club_not_found');
      const actorId = account.rows[0].id;
      await client.query(`INSERT INTO public.odysc_club_memberships(club_id,user_id,email,full_name,officer_role,access,status)
        VALUES($1::bigint,$2::uuid,$3,$4,'Prototype administrator','admin','active')
        ON CONFLICT(club_id,email) DO UPDATE SET user_id=EXCLUDED.user_id,access='admin',status='active',updated_at=now()`, [clubId, actorId, email, 'Odysc NSBE Administrator']);
      await client.query('COMMIT');
      console.log(JSON.stringify({ status: 'approved_admin_linked', club: club.rows[0], access: 'admin', membershipStatus: 'active' }));
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } else if (mode === '--status') {
    console.log(JSON.stringify({ status: 'inspected', tables: await status() }));
  } else throw new Error('unsupported_mode');
} catch (error) {
  // Never emit raw pg errors, credentials, IDs, email addresses, or row data.
  const known = new Set(['club_search_required', 'workflow_tables_already_exist_review_required', 'workflow_schema_verification_failed', 'approved_admin_email_and_club_id_required', 'confirmed_usc_admin_account_required', 'approved_club_not_found', 'unsupported_mode']);
  console.log(JSON.stringify({ status: 'not_completed', reason: error instanceof Error && known.has(error.message) ? error.message : 'operator_database_operation_failed', ...(typeof error?.code === 'string' && /^[A-Z0-9]{5}$/u.test(error.code) ? { sqlState: error.code } : {}) }));
  process.exitCode = 1;
} finally { await pool?.end(); }
