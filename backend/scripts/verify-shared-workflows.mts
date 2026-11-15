import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { FrontendStore, type FrontendDatabase, type SqlConnection } from '../src/frontend-store.js';
import { HttpError } from '../src/errors.js';
import type { Actor } from '../src/frontend-models.js';

// Explicit operator command only. No HTTP calls, emails, real credential changes,
// or persistent test accounts. Every write remains inside one outer ROLLBACK.
// The chosen club's settings/row may be briefly locked during verification.
class VerificationFailure extends Error {
  constructor(readonly check: string) { super('Shared workflow verification failed.'); }
}
const passed: string[] = [];
let currentCheck = 'configuration';
function verify(condition: unknown): asserts condition {
  if (!condition) throw new VerificationFailure(currentCheck);
}
async function step(name: string, action: () => Promise<void>) {
  currentCheck = name;
  await action();
  passed.push(name);
}
async function denied(action: () => Promise<unknown>, statuses: number[]) {
  try { await action(); }
  catch (error) {
    verify(error instanceof HttpError && statuses.includes(error.statusCode));
    return;
  }
  throw new VerificationFailure(currentCheck);
}
function configuration() {
  const url = new URL(process.env.SUPABASE_DB_URL ?? '');
  const user = decodeURIComponent(url.username);
  const ref = 'cfrkamtsphdlowuiuarn';
  const direct = url.hostname === `db.${ref}.supabase.co`;
  const pooler = url.hostname.endsWith('.pooler.supabase.com') && user.endsWith(`.${ref}`);
  const port = Number(url.port || 5432);
  const caFile = process.env.SUPABASE_DB_CA_FILE;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler) || !user || !url.password || !caFile || !Number.isInteger(port) || port < 1 || port > 65535) throw new VerificationFailure('configuration');
  return { host: url.hostname, port, user, password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)) || 'postgres', ssl: { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true } };
}
const fixture = (label: string, suffix: string, confirmed = true, usc = true): Actor & { confirmed: boolean } => ({
  user: { id: randomUUID(), name: `Rollback-only ${label}`, email: `odysc-verify-${suffix}-${label.toLowerCase()}@${usc ? 'usc.edu' : 'example.invalid'}`, role: 'student', createdAt: new Date().toISOString() },
  token: 'unused-rollback-verification-token', confirmed,
});
let pool: Pool | undefined;
let client: PoolClient | undefined;
let rolledBack = false;
let failure: unknown;
try {
  pool = new Pool({ ...configuration(), max: 1, connectionTimeoutMillis: 8000, statement_timeout: 15000, query_timeout: 17000, application_name: 'odysc-workflow-verification', options: '-c search_path=pg_catalog -c lock_timeout=3000' });
  pool.on('error', () => {});
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SET LOCAL lock_timeout='3s'");
  const q: SqlConnection = { query: async <T extends QueryResultRow>(sql: string, values?: readonly unknown[]) => {
    const result = await client!.query<T>(sql, values ? [...values] : undefined);
    return { rows: result.rows, rowCount: result.rowCount };
  } };
  let savepoint = 0;
  const database: FrontendDatabase = {
    ...q,
    async transaction<T>(action: (connection: SqlConnection) => Promise<T>) {
      const name = `odysc_verification_${++savepoint}`;
      await client!.query(`SAVEPOINT ${name}`);
      try {
        const result = await action(q);
        await client!.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await client!.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await client!.query(`RELEASE SAVEPOINT ${name}`);
        throw error;
      }
    },
    async close() {},
  };
  const store = new FrontendStore({ dbUrl: '', caFile: '', database });
  const clubId = process.env.WORKFLOW_VERIFY_CLUB_ID ?? '36288';
  if (!/^-?\d{1,19}$/.test(clubId)) throw new VerificationFailure('club_configuration');
  const club = await q.query('SELECT club_id FROM public.clubs WHERE club_id=$1::bigint', [clubId]);
  verify(club.rows.length === 1);
  const otherClub = (await q.query<{ id: string }>('SELECT club_id::text AS id FROM public.clubs WHERE club_id<>$1::bigint ORDER BY club_id LIMIT 1', [clubId])).rows[0]?.id;
  verify(otherClub);
  const suffix = randomUUID().slice(0, 8);
  const a = fixture('A', suffix), b = fixture('B', suffix), admin = fixture('Admin', suffix), reviewer = fixture('Reviewer', suffix), invitee = fixture('Invitee', suffix), unconfirmed = fixture('Unconfirmed', suffix, false), nonUsc = fixture('Outside', suffix, true, false);
  const actors = [a, b, admin, reviewer, invitee, unconfirmed, nonUsc];
  for (const actor of actors) await q.query('INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) VALUES($1::uuid,\'authenticated\',\'authenticated\',$2,$3::timestamptz,now(),now())', [actor.user.id, actor.user.email, actor.confirmed ? new Date().toISOString() : null]);
  const basic = { name: 'Rollback-only student', year: 2, major: 'Engineering', interests: ['Robotics'], skills: ['Python'], experiences: ['Built a campus project.'], uscId: '8765432109' };
  await step('confirmed_profile_save_and_read', async () => {
    await store.saveProfile(a, { ...basic, name: 'Rollback-only A' });
    await store.saveProfile(b, { ...basic, name: 'Rollback-only B' });
    verify((await store.getProfile(a)).name === 'Rollback-only A');
    verify((await store.getProfile(b)).name === 'Rollback-only B');
  });
  await step('unconfirmed_and_non_usc_private_access_denied', async () => {
    await denied(() => store.getProfile(unconfirmed), [401]);
    await denied(() => store.getWorkspace(nonUsc), [401]);
  });
  await step('workspace_isolation_and_version_conflict', async () => {
    const before = await store.getWorkspace(a);
    const saved = await store.saveWorkspace(a, { myClubs: [clubId], expectedVersion: before.version });
    verify(saved.myClubs.includes(clubId) && saved.version > before.version);
    verify(!(await store.getWorkspace(b)).myClubs.length);
    await denied(() => store.saveWorkspace(a, { myClubs: [], expectedVersion: before.version }), [409]);
    verify((await store.getWorkspace(a)).myClubs.includes(clubId));
  });
  await step('personal_calendar_persistence', async () => {
    const event = { id: randomUUID(), title: 'Rollback-only personal event', start: new Date(Date.now() + 86400000).toISOString(), durationMin: 30 };
    await store.saveWorkspace(a, { personal: [event], calColors: { personal: '#990000' }, calHidden: ['personal'] });
    const saved = await store.getWorkspace(a);
    verify(saved.personal[0]?.id === event.id && saved.calColors.personal === '#990000' && saved.calHidden.includes('personal'));
  });
  await step('officer_request_is_pending_not_self_admin', async () => {
    const session = await store.requestMembership(b, clubId, 'Requested officer');
    verify(session.account?.role === 'officer' && session.account.verified === false);
    verify(session.organization?.myMembership?.status === 'pending' && session.organization.myMembership.access === 'reviewer');
    await denied(() => store.applicants(b, clubId), [403]);
  });
  // Bootstrap only synthetic fixture administrators, inside the outer rollback.
  for (const [actor, access] of [[admin, 'admin'], [reviewer, 'reviewer']] as const) await q.query("INSERT INTO public.odysc_club_memberships(club_id,user_id,email,full_name,officer_role,access,status) VALUES($1::bigint,$2::uuid,$3,$4,'Rollback-only officer',$5,'active')", [clubId, actor.user.id, actor.user.email, actor.user.name, access]);
  await step('administrator_approval_and_reviewer_boundaries', async () => {
    await store.approve(admin, clubId, b.user.email);
    const approved = await store.getSession(b, 'officer');
    verify(approved.account?.verified === true && approved.organization?.myMembership?.access === 'reviewer');
    await denied(() => store.invite(reviewer, clubId, { email: invitee.user.email, name: 'Invitee', officerRole: 'Reviewer' }), [403]);
    await denied(() => store.updateSettings(reviewer, clubId, { requiresUscId: false }), [403]);
    await denied(() => store.applicants(admin, otherClub), [403]);
  });
  await step('invitation_claim_requires_verified_email_owner', async () => {
    await store.invite(admin, clubId, { email: invitee.user.email, name: 'Rollback-only Invitee', officerRole: 'Reviewer' });
    const claimed = await store.getSession(invitee, 'officer');
    verify(claimed.account?.verified === true && claimed.organization?.myMembership?.status === 'active' && claimed.organization.myMembership.access === 'reviewer');
  });
  await step('usctype_reason_and_current_questions_configured', async () => {
    await denied(() => store.updateSettings(admin, clubId, { requiresUscId: true, uscIdReason: 'short' }), [400]);
    await store.updateSettings(admin, clubId, { requiresUscId: true, uscIdReason: 'Rollback-only documented student ID purpose.', questions: [{ id: 'one', prompt: 'Describe your contribution.', maxWords: 8 }, { id: 'two', prompt: 'Describe your contribution.', maxWords: 8 }], deadline: '' });
  });
  const answers = [{ questionId: 'one', text: 'I build campus robots.' }, { questionId: 'two', text: 'I collaborate with student teams.' }];
  let applicationA = '', applicationB = '';
  await step('submission_enforces_current_answers_and_id_consent', async () => {
    await denied(() => store.submit(a, { clubId, answers: [{ questionId: 'unknown', text: 'Wrong question.' }], shareUscId: true }), [400]);
    await denied(() => store.submit(a, { clubId, answers, shareUscId: false }), [400]);
    const result = await store.submit(a, { clubId, answers, shareUscId: true, rememberAnswers: true });
    applicationA = result.application.id;
    verify(result.workspace.applicationIds[clubId] === applicationA && result.workspace.answerBank.length === 1);
    verify(result.application.studentId === a.user.id);
    await denied(() => store.submit(a, { clubId, answers, shareUscId: true }), [409]);
  });
  await step('application_snapshot_is_frozen_and_private_id_is_consented', async () => {
    await store.saveProfile(a, { major: 'Updated after submission' });
    const snapshot = (await store.applicants(admin, clubId)).find(app => app.applicationId === applicationA);
    verify(snapshot?.major === 'Engineering' && snapshot.uscId === '8765432109');
    verify(snapshot?.verifiedStudent === false && snapshot.verifiedUscEmail === true);
    await denied(() => store.applicants(a, clubId), [403]);
  });
  await step('unshared_id_and_answer_memory_stay_private', async () => {
    await store.updateSettings(admin, clubId, { requiresUscId: false });
    const result = await store.submit(b, { clubId, answers, rememberAnswers: false });
    applicationB = result.application.id;
    verify(result.workspace.answerBank.length === 0);
    const snapshot = (await store.applicants(admin, clubId)).find(app => app.applicationId === applicationB);
    verify(snapshot && snapshot.uscId === undefined);
    verify(!(await store.applications(b)).some(app => app.id === applicationA));
  });
  await step('reviewer_can_score_but_not_decide', async () => {
    await store.saveReview(reviewer, applicationA, { Motivation: 4, Experience: 3 });
    await denied(() => store.decide(reviewer, applicationA, 'accept'), [403, 404]);
    verify((await store.getOrganization(admin)).scores[applicationA]?.[reviewer.user.email]?.Motivation === 4);
  });
  const firstSlot = new Date(Date.now() + 14 * 86400000 + Math.floor(Math.random() * 3600) * 1000).toISOString();
  const secondSlot = new Date(Date.parse(firstSlot) + 3600000).toISOString();
  await step('interview_schedule_and_student_ownership', async () => {
    for (const applicationId of [applicationA, applicationB]) await store.schedule(admin, { applicationId, format: 'in-person', slots: [firstSlot, secondSlot], durationMin: 20, buildingCode: 'TCC', room: 'Rollback-only room' });
    await denied(() => store.book(b, applicationA, firstSlot), [404]);
    await store.book(a, applicationA, firstSlot);
    verify((await store.getWorkspace(a)).interviews[applicationA]?.booked === firstSlot);
  });
  await step('booking_collision_and_cancellation', async () => {
    await denied(() => store.book(b, applicationB, firstSlot), [409]);
    await store.book(b, applicationB, secondSlot);
    await store.book(a, applicationA, null);
    verify((await store.getWorkspace(a)).interviews[applicationA]?.booked === undefined);
    await store.book(a, applicationA, firstSlot);
  });
  await step('final_decision_clears_booking_and_cannot_be_reversed', async () => {
    // A second synthetic administrator finalizes the first administrator's
    // earlier 'advance' decision; subsequent scoring must not resurrect it.
    await q.query("UPDATE public.odysc_club_memberships SET access='admin' WHERE club_id=$1::bigint AND user_id=$2::uuid", [clubId, b.user.id]);
    await store.decide(b, applicationA, 'accept');
    verify((await store.getWorkspace(a)).interviews[applicationA]?.booked === undefined);
    await denied(() => store.book(a, applicationA, firstSlot), [409]);
    await denied(() => store.decide(admin, applicationA, 'decline'), [409]);
    verify((await store.getWorkspace(a)).apps[clubId]?.status === 'accepted');
  });
  await step('later_scores_do_not_restore_historical_decisions', async () => {
    // This administrator's earlier scheduling decision was 'advance'. A later
    // score update must still report the application's final accepted status.
    await store.saveReview(admin, applicationA, { Motivation: 5 });
    verify((await store.getOrganization(admin)).decisions[applicationA] === 'accept');
  });
  await step('changed_email_cannot_reuse_stale_membership', async () => {
    const changedEmail = `odysc-verify-${suffix}-changed@usc.edu`;
    await q.query('UPDATE auth.users SET email=$2 WHERE id=$1::uuid', [invitee.user.id, changedEmail]);
    const changed = { ...invitee, user: { ...invitee.user, email: changedEmail } };
    const session = await store.getSession(changed);
    verify(session.account?.role === 'student' && session.organization === null);
    await denied(() => store.getOrganization(changed), [403]);
    await denied(() => store.getProfile(invitee), [401]);
  });
  await step('administrator_cannot_remove_own_last_access', async () => {
    await denied(() => store.removeMember(admin, clubId, admin.user.email), [409]);
  });
  await step('club_events_require_administrator_and_persist', async () => {
    const event = { clubId, title: 'Rollback-only event', kind: 'Workshop', start: firstSlot, durationMin: 30, buildingCode: 'TCC', room: 'Rollback-only room' };
    await denied(() => store.createEvent(reviewer, event), [403]);
    const saved = await store.createEvent(admin, event);
    verify((await store.events()).some(item => item.id === saved.id));
  });
  await step('new_tables_remain_denied_to_browser_database_roles', async () => {
    const names = ['odysc_student_workspaces','odysc_club_memberships','odysc_club_settings','odysc_applications','odysc_answer_bank','odysc_reviews','odysc_interviews','odysc_club_events'];
    const result = await q.query<{ rls: boolean; exposed: boolean }>("SELECT c.relrowsecurity AS rls,(has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) AS exposed FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])", [names]);
    verify(result.rows.length === names.length && result.rows.every(row => row.rls && !row.exposed));
  });
} catch (error) {
  failure = error;
} finally {
  if (client) {
    try { await client.query('ROLLBACK'); rolledBack = true; }
    catch { if (!failure) failure = new VerificationFailure('rollback_not_confirmed'); }
    client.release(!rolledBack);
  }
  await pool?.end();
}
if (failure || !rolledBack) {
  const sqlState = (failure as { code?: unknown } | undefined)?.code;
  console.log(JSON.stringify({ status: 'not_verified', check: failure instanceof VerificationFailure ? failure.check : currentCheck, rolledBack, ...(typeof sqlState === 'string' && /^[0-9A-Z]{5}$/.test(sqlState) ? { sqlState } : {}) }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: 'verified_with_rollback', checksPassed: passed.length, checks: passed, rolledBack: true }));
}
