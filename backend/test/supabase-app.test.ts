import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { ResumeFiles } from '../src/resume-files.js';
import type { CatalogQuery, CatalogRow } from '../src/supabase-catalog.js';
import { pdfFixture } from './fixtures/pdf.js';

const origin = 'https://cfrkamtsphdlowuiuarn.supabase.co';
const apiKey = 'test-supabase-publishable-key';
const studentId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const createdAt = '2026-11-14T12:00:00.000Z';
const headers = { authorization: 'Bearer student-token' };
const otherHeaders = { authorization: 'Bearer other-token' };
type Json = Record<string, unknown>;

function providerFixture() {
  const profiles = new Map<string, Json>();
  const calls: { path: string; method: string; token: string }[] = [];
  const users = new Map([
    ['student-token', { id: studentId, email: 'student@example.com', created_at: createdAt, app_metadata: { role: 'student' }, user_metadata: { name: 'Alex Auth' } }],
    ['other-token', { id: otherId, email: 'other@example.com', created_at: createdAt, app_metadata: { role: 'student' }, user_metadata: { name: 'Other Auth' } }],
  ]);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.origin, origin);
    const requestHeaders = new Headers(init?.headers);
    assert.equal(requestHeaders.get('apikey'), apiKey);
    const token = requestHeaders.get('authorization')?.replace(/^Bearer /u, '') ?? '';
    const user = users.get(token);
    const method = init?.method ?? 'GET';
    calls.push({ path: url.pathname, method, token });
    if (url.pathname === '/auth/v1/token' && method === 'POST') {
      return json({ user: users.get('student-token'), access_token: 'student-token', expires_in: 3600 });
    }
    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      return user ? json(user) : json({ error_code: 'bad_jwt' }, 401);
    }
    if (url.pathname === '/auth/v1/logout' && method === 'POST') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/student_profiles' && user) {
      if (method === 'GET') {
        assert.equal(url.searchParams.get('user_id'), `eq.${user.id}`);
        return json(profiles.has(user.id) ? [profiles.get(user.id)] : []);
      }
      if (method === 'PATCH') {
        assert.equal(url.searchParams.get('user_id'), `eq.${user.id}`);
        const row = profiles.get(user.id);
        if (row) profiles.set(user.id, { ...row, ...JSON.parse(String(init?.body)) as Json });
        return new Response(null, { status: 204 });
      }
      if (method === 'POST') {
        assert.equal(url.searchParams.get('on_conflict'), 'user_id');
        assert.match(requestHeaders.get('prefer') ?? '', /resolution=merge-duplicates/u);
        const row = JSON.parse(String(init?.body)) as Json;
        assert.equal(row.user_id, user.id);
        profiles.set(user.id, { ...row });
        return json([row]);
      }
    }
    assert.fail(`Unexpected mocked provider request: ${method} ${url.pathname}`);
  };
  return { fetch, profiles, calls };
}

const clubRows: CatalogRow[] = [
  { id: '9007199254740993', name: 'Robotics Club', website: 'robotics.example.com', category: 'Engineering', tags: 'robotics, prototyping' },
  { id: '2', name: 'Music Ensemble', website: 'https://music.example.com', category: 'Arts', tags: 'music, singing' },
];

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'odysc-supabase-app-'));
  const sqlitePath = join(directory, 'must-not-exist.sqlite');
  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = sqlitePath;
  const provider = providerFixture();
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  const query: CatalogQuery = async (sql, values = []) => {
    assert.match(sql, /^SELECT /u, 'catalog only executes read queries');
    assert.match(sql, /FROM public\.clubs/u);
    queries.push({ sql, values });
    if (values.length === 1) return { rows: clubRows.filter(row => row.id === String(values[0])) };
    const search = String(values[0] ?? '').toLowerCase();
    const category = String(values[1] ?? '').toLowerCase();
    return { rows: clubRows.filter(row => (!search || `${row.name} ${row.tags}`.toLowerCase().includes(search)) && (!category || row.category?.toLowerCase() === category)) };
  };
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  t.after(async () => {
    try {
      await app?.close();
      await assert.rejects(access(sqlitePath), { code: 'ENOENT' }, 'Supabase mode must not create the SQLite store');
    } finally {
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
      await rm(directory, { recursive: true, force: true });
    }
  });
  const files = new ResumeFiles(join(directory, 'resumes'));
  app = await buildApp({
    backend: 'supabase', logger: false, rateLimit: false, ai: { apiKey: '' },
    frontend: false,
    supabase: { url: origin, publishableKey: apiKey, fetch: provider.fetch, studentEmailDomain: '' },
    catalog: {
      dbUrl: 'postgresql://postgres.cfrkamtsphdlowuiuarn:not-a-real-password@aws-0-us-west-2.pooler.supabase.com:5432/postgres',
      caFile: '/unused/test-certificate.crt', query,
    },
    resumeFiles: files,
  });
  return { app, provider, files, queries };
}

function uploadBody(pdf: Uint8Array) {
  const boundary = `odysc-${randomUUID()}`;
  return {
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="resume.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from(pdf), Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

async function completeBasics(app: Awaited<ReturnType<typeof buildApp>>) {
  const saved = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers, payload: { academicYear: 'first_year', major: 'Undeclared', interests: ['Still exploring'] } });
  assert.equal(saved.statusCode, 200, saved.body);
  const uploaded = await app.inject({ method: 'POST', url: '/api/v1/me/resume', ...uploadBody(pdfFixture({ text: '' })) });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const completed = await app.inject({ method: 'POST', url: '/api/v1/me/onboarding/complete', headers, payload: {} });
  assert.equal(completed.statusCode, 200, completed.body);
  return completed.json();
}

test('Supabase app mode serves the shared club format and preserves bigint IDs without SQLite', async t => {
  const { app, provider, queries } = await fixture(t);
  const health = await app.inject('/health');
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().backend, 'supabase');
  const list = await app.inject('/api/v1/clubs');
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().clubs.length, 2);
  const robotics = list.json().clubs.find((club: { name: string }) => club.name === 'Robotics Club');
  assert.equal(robotics.id, '9007199254740993');
  assert.equal(robotics.websiteUrl, 'https://robotics.example.com/');
  assert.deepEqual(robotics.tags, ['robotics', 'prototyping']);
  assert.equal(robotics.acceptingApplications, false);
  const detail = await app.inject(`/api/v1/clubs/${robotics.slug}`);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().club.id, robotics.id);
  assert.deepEqual(detail.json().events, []);
  assert.ok(queries.length >= 2);
  assert.equal(provider.calls.length, 0, 'public club listings do not read student data');
});

test('Supabase login and onboarding write to the user-scoped Data API through the full app', async t => {
  const { app, provider } = await fixture(t);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'student@example.com', password: 'PrototypePass123!' } });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().accessToken, 'student-token');
  const initial = await app.inject({ url: '/api/v1/me/onboarding', headers });
  assert.equal(initial.json().onboarding.status, 'not_started');
  const completed = await completeBasics(app);
  assert.equal(completed.onboarding.status, 'completed');
  assert.equal(completed.resume.textStatus, 'unavailable');
  assert.equal(provider.profiles.get(studentId)?.academic_year, 'first_year');
  assert.deepEqual(provider.profiles.get(studentId)?.interests, ['Still exploring']);
  const after = await app.inject({ url: '/api/v1/me/profile', headers });
  assert.equal(after.json().profile.major, 'Undeclared');
  const other = await app.inject({ url: '/api/v1/me/onboarding', headers: otherHeaders });
  assert.equal(other.json().profile.major, '');
  assert.equal(other.json().onboarding.status, 'not_started');
  assert.equal(other.json().resume, null);
  assert.ok(other.json().onboarding.missingRequiredFields.includes('resume'));
  assert.equal(provider.profiles.size, 1);
});

test('full app supports private cookie sessions and trusted frontend onboarding writes', async t => {
  const { app, provider } = await fixture(t);
  const originHeaders = { origin: 'http://localhost:3000' };
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: originHeaders, payload: { email: 'student@example.com', password: 'PrototypePass123!' } });
  assert.equal(login.statusCode, 200, login.body);
  const sessionCookie = login.cookies.find(cookie => cookie.name === 'odysc_session');
  assert.ok(sessionCookie, 'login sets the browser session through the full app wiring');
  const cookie = `${sessionCookie.name}=${sessionCookie.value}`;
  const session = await app.inject({ url: '/api/v1/auth/session', headers: { cookie } });
  assert.equal(session.json().authenticated, true);
  assert.equal(session.json().user.id, studentId);
  assert.equal(session.json().accessToken, undefined);
  assert.equal(session.headers['cache-control'], 'no-store');
  const saved = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers: { ...originHeaders, cookie }, payload: { major: 'Undeclared', academicYear: 'first_year', interests: ['Still exploring'] } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(provider.profiles.get(studentId)?.major, 'Undeclared');
  const forbidden = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers: { cookie, origin: 'https://foreign.example' }, payload: { major: 'Must not save' } });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(provider.profiles.get(studentId)?.major, 'Undeclared');
  const preflight = await app.inject({ method: 'OPTIONS', url: '/api/v1/auth/register', headers: { ...originHeaders, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  assert.equal(preflight.headers['access-control-allow-origin'], originHeaders.origin);
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
});

test('private PDF uploads populate Supabase onboarding metadata and deletion invalidates completion without removing profile data', async t => {
  const { app, provider } = await fixture(t);
  const completed = await completeBasics(app);
  const bytes = pdfFixture({ text: 'Campus volunteering and student projects.' });
  const uploaded = await app.inject({ method: 'POST', url: '/api/v1/me/resume', ...uploadBody(bytes) });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const snapshot = await app.inject({ url: '/api/v1/me/onboarding', headers });
  assert.equal(snapshot.json().resume.id, uploaded.json().resume.id);
  assert.equal(snapshot.json().onboarding.recommendedFields.includes('resume'), false);
  assert.deepEqual(snapshot.json().profile, completed.profile, 'PDF extraction must not silently rewrite the profile');
  const downloaded = await app.inject({ url: '/api/v1/me/resume', headers });
  assert.equal(downloaded.statusCode, 200, downloaded.body);
  assert.deepEqual(downloaded.rawPayload, Buffer.from(bytes));
  assert.match(downloaded.headers['cache-control'] ?? '', /private.*no-store/u);
  assert.equal((await app.inject('/api/v1/me/resume')).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/v1/me/resume', headers: otherHeaders })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/me/resume', headers: otherHeaders })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/me/resume', headers })).statusCode, 204);
  const removed = await app.inject({ url: '/api/v1/me/onboarding', headers });
  assert.equal(removed.json().resume, null);
  assert.equal(removed.json().onboarding.status, 'in_progress');
  assert.equal(removed.json().onboarding.completedAt, null);
  assert.deepEqual(removed.json().onboarding.missingRequiredFields, ['resume']);
  assert.deepEqual(removed.json().profile, completed.profile);
  assert.equal(provider.profiles.get(studentId)?.onboarding_completed_at, null);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/me/resume', ...uploadBody(pdfFixture({ text: '' })) })).statusCode, 201);
  assert.equal((await app.inject({ url: '/api/v1/me/onboarding', headers })).json().onboarding.status, 'in_progress');
});

test('Supabase matching requires a private PDF and uses available résumé text and profile goals with real directory IDs', async t => {
  const { app, provider } = await fixture(t);
  const initial = await app.inject({ method: 'POST', url: '/api/v1/me/matches', headers });
  assert.equal(initial.statusCode, 400, initial.body);
  assert.equal(initial.json().error.code, 'RESUME_REQUIRED');
  const blankPdf = await app.inject({ method: 'POST', url: '/api/v1/me/resume', ...uploadBody(pdfFixture({ text: '' })) });
  assert.equal(blankPdf.statusCode, 201, blankPdf.body);
  const baseline = await app.inject({ method: 'POST', url: '/api/v1/me/matches', headers });
  assert.equal(baseline.statusCode, 200, baseline.body);
  assert.equal(baseline.json().mode, 'local');
  assert.ok(baseline.json().matches.every((match: { score: number }) => match.score === 0));
  const goals = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers, payload: { goals: ['robotics'] } });
  assert.equal(goals.statusCode, 200, goals.body);
  const byGoals = await app.inject({ method: 'POST', url: '/api/v1/me/matches', headers });
  assert.equal(byGoals.json().matches[0].clubId, '9007199254740993');
  assert.ok(byGoals.json().matches[0].score > 0);
  const before = structuredClone(provider.profiles.get(studentId));
  const uploaded = await app.inject({ method: 'POST', url: '/api/v1/me/resume', ...uploadBody(pdfFixture({ text: 'Music and singing in a student ensemble.' })) });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const byResume = await app.inject({ method: 'POST', url: '/api/v1/me/matches', headers });
  assert.equal(byResume.statusCode, 200, byResume.body);
  assert.equal(byResume.json().matches[0].clubId, '2');
  assert.deepEqual(new Set(byResume.json().matches.map((match: { clubId: string }) => match.clubId)), new Set(clubRows.map(club => club.id)));
  assert.ok(byResume.json().matches.every((match: { clubId: string; club: { id: string } }) => match.clubId === match.club.id));
  assert.deepEqual(provider.profiles.get(studentId), before);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/me/resume', headers })).statusCode, 204);
  const afterDelete = await app.inject({ method: 'POST', url: '/api/v1/me/matches', headers });
  assert.equal(afterDelete.statusCode, 400, afterDelete.body);
  assert.equal(afterDelete.json().error.code, 'RESUME_REQUIRED');
});

test('unconnected Supabase application routes return an explicit unavailable error without falling back to SQLite', async t => {
  const { app, provider } = await fixture(t);
  const before = provider.calls.length;
  const applications = await app.inject({ url: '/api/v1/me/applications', headers });
  assert.equal(applications.statusCode, 503, applications.body);
  assert.equal(applications.json().error.code, 'FEATURE_NOT_CONNECTED');
  assert.equal(provider.calls.length, before, 'unavailable feature must not mutate Supabase profiles');
  assert.equal(provider.profiles.size, 0);
  assert.equal((await app.inject('/health')).json().backend, 'supabase');
});

test('Supabase onboarding basics and a failed PDF upload remain incomplete', async t => {
  const { app, provider } = await fixture(t);
  const draft = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers, payload: { academicYear: 'graduate', major: 'Cinema', interests: ['Film'] } });
  assert.equal(draft.statusCode, 200, draft.body);
  assert.deepEqual(draft.json().onboarding.missingRequiredFields, ['resume']);
  const invalid = await app.inject({ method: 'POST', url: '/api/v1/me/resume', ...uploadBody(new Uint8Array(Buffer.from('not a PDF'))) });
  assert.equal(invalid.statusCode, 400, invalid.body);
  const complete = await app.inject({ method: 'POST', url: '/api/v1/me/onboarding/complete', headers, payload: {} });
  assert.equal(complete.statusCode, 400, complete.body);
  assert.equal(complete.json().error.code, 'MISSING_ONBOARDING_FIELDS');
  assert.match(complete.json().error.message, /resume/u);
  assert.equal(provider.profiles.get(studentId)?.onboarding_completed_at, null);
});
