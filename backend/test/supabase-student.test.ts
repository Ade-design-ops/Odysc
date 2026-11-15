import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify, { type FastifyError } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ResumeFiles } from '../src/resume-files.js';
import { parseResumePdf } from '../src/resume.js';
import { pdfFixture } from './fixtures/pdf.js';
import { HttpError } from '../src/errors.js';
import { registerSupabaseStudent } from '../src/supabase-student.js';

const projectUrl = 'https://cfrkamtsphdlowuiuarn.supabase.co';
const publishableKey = 'test-publishable-key';
const studentId = '11111111-1111-4111-8111-111111111111';
const otherStudentId = '22222222-2222-4222-8222-222222222222';
const organizerId = '33333333-3333-4333-8333-333333333333';
const createdAt = '2026-11-14T12:00:00.000Z';
const password = 'SupabaseTestPass123!';
const headers = { authorization: 'Bearer student-jwt' };

type JsonObject = Record<string, unknown>;
interface ProviderCall {
  url: URL;
  method: string;
  headers: Headers;
  body: JsonObject | JsonObject[] | null;
}

function authUser(id: string, email: string, name: string, role = 'student') {
  return { id, email, created_at: createdAt, app_metadata: { role }, user_metadata: { name, full_name: name, role }, role: 'authenticated' };
}

function profileRow(userId = studentId, changes: JsonObject = {}): JsonObject {
  return {
    user_id: userId, full_name: 'Alex Profile', academic_year: 'second_year', graduation_year: 2028,
    major: 'Computer Science', interests: ['Robotics'], goals: ['Find friends'],
    bio: 'I enjoy campus projects.', skills: ['TypeScript'], experience: 'Built a class project.',
    onboarding_started_at: createdAt, onboarding_completed_at: null, created_at: createdAt, updated_at: createdAt,
    ...changes,
  };
}

function mockProvider() {
  const calls: ProviderCall[] = [];
  const unexpected: string[] = [];
  const profiles = new Map<string, JsonObject>();
  const users = new Map([
    ['student-jwt', authUser(studentId, 'student@example.com', 'Alex Auth')],
    ['other-student-jwt', authUser(otherStudentId, 'other@example.com', 'Other Auth')],
    ['organizer-jwt', { ...authUser(organizerId, 'organizer@example.com', 'Organizer', 'organizer'), user_metadata: { name: 'Organizer', full_name: 'Organizer', role: 'student' } }],
  ]);
  const state = { confirmEmail: false, invalidLogin: false, profileFailure: false, authFailure: false };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.origin, projectUrl, 'all provider calls stay on the configured project');
    const requestHeaders = new Headers(init?.headers);
    assert.equal(requestHeaders.get('apikey'), publishableKey);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as JsonObject | JsonObject[] : null;
    calls.push({ url, method, headers: requestHeaders, body });
    const token = requestHeaders.get('authorization')?.replace(/^Bearer /u, '') ?? '';
    const user = users.get(token);
    if (url.pathname === '/auth/v1/signup' && method === 'POST') {
      const value = body as JsonObject;
      const userData = value.data as JsonObject | undefined;
      const created = authUser(otherStudentId, String(value.email), String(userData?.name ?? userData?.full_name ?? 'New Student'));
      if (state.confirmEmail) return json(created);
      users.set('signup-jwt', created);
      return json({ access_token: 'signup-jwt', refresh_token: 'signup-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 1_800_000_000, user: created });
    }
    if (url.pathname === '/auth/v1/token' && method === 'POST' && url.searchParams.get('grant_type') === 'password') {
      if (state.invalidLogin) return json({ code: 400, error_code: 'invalid_credentials', message: 'RAW_PROVIDER_SECRET JWT_PRIVATE_9281' }, 400);
      return json({ access_token: 'student-jwt', refresh_token: 'student-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 1_800_000_000, user: users.get('student-jwt') });
    }
    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      if (state.authFailure || !user) return json({ message: 'RAW_PROVIDER_SECRET JWT_PRIVATE_9281', error: 'invalid token' }, 401);
      return json(user);
    }
    if (url.pathname === '/auth/v1/logout' && method === 'POST') {
      if (!user) return json({ message: 'invalid token' }, 401);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/rest/v1/student_profiles') {
      if (!user) return json({ message: 'invalid token' }, 401);
      if (state.profileFailure) return json({ message: 'RAW_PROVIDER_SECRET JWT_PRIVATE_9281', details: 'student-jwt test-publishable-key' }, 500);
      if (method === 'GET') {
        assert.equal(url.searchParams.get('user_id'), `eq.${user.id}`, 'profile read must filter by verified Auth user');
        const row = profiles.get(user.id);
        return json(row ? [row] : []);
      }
      if (method === 'POST' || method === 'PATCH') {
        const row = (Array.isArray(body) ? body[0] : body) as JsonObject;
        if (method === 'POST') assert.equal(row.user_id, user.id, 'profile upsert must use the verified Auth user');
        if (method === 'PATCH') assert.equal(url.searchParams.get('user_id'), `eq.${user.id}`);
        const updated = { ...profiles.get(user.id), ...row, user_id: user.id, created_at: profiles.get(user.id)?.created_at ?? createdAt, updated_at: row.updated_at ?? createdAt };
        profiles.set(user.id, updated);
        return json([updated]);
      }
    }
    unexpected.push(`${method} ${url.pathname}`);
    return json({ message: 'Unexpected mocked provider endpoint.' }, 500);
  };
  return { calls, profiles, users, state, fetch, unexpected };
}

async function fixture(t: TestContext, withResumeService = true) {
  const provider = mockProvider();
  const directory = await mkdtemp(join(tmpdir(), 'odysc-native-onboarding-'));
  const files = new ResumeFiles(directory);
  const savePdf = async (userId = studentId) => {
    const bytes = pdfFixture({ text: '' });
    const parsed = await parseResumePdf(bytes);
    await files.save({ studentId: userId, bytes, text: parsed.text, info: { id: randomUUID(), fileName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: bytes.byteLength, pageCount: parsed.pageCount, textStatus: parsed.textStatus, uploadedAt: createdAt } });
  };
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error.validation) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again.' } });
  });
  await registerSupabaseStudent(app, { url: projectUrl, publishableKey, fetch: provider.fetch, studentEmailDomain: '' }, { apiKey: '' }, withResumeService ? { getResumeInfo: async id => await files.getInfo(id) ?? null } : {});
  t.after(async () => { try { await app.close(); assert.deepEqual(provider.unexpected, []); } finally { await rm(directory, { recursive: true, force: true }); } });
  return { app, provider, files, savePdf };
}

const profileWrites = (calls: ProviderCall[]) => calls.filter(call => call.url.pathname === '/rest/v1/student_profiles' && call.method !== 'GET');

test('Supabase login and private profile reads forward the API key and user JWT and map provider rows', async t => {
  const { app, provider } = await fixture(t);
  provider.profiles.set(studentId, profileRow());
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'student@example.com', password } });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().accessToken, 'student-jwt');
  assert.equal(login.json().user.id, studentId);
  assert.equal(login.json().user.role, 'student');
  const me = await app.inject({ url: '/api/v1/auth/me', headers });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().user.id, studentId);
  const profile = await app.inject({ url: '/api/v1/me/profile', headers });
  assert.equal(profile.statusCode, 200, profile.body);
  assert.equal(profile.json().user.name, 'Alex Profile');
  assert.equal(profile.json().profile.academicYear, 'second_year');
  assert.equal(profile.json().profile.graduationYear, 2028);
  assert.deepEqual(profile.json().profile.goals, ['Find friends']);
  for (const call of provider.calls.filter(call => call.url.pathname === '/auth/v1/user' || call.url.pathname.startsWith('/rest/'))) {
    assert.equal(call.headers.get('authorization'), 'Bearer student-jwt');
  }
  assert.equal(profileWrites(provider.calls).length, 0);
});

test('login forwards an existing shorter password while signup retains the new-password minimum', async t => {
  const { app, provider } = await fixture(t);
  const existingPassword = 'Abc123';
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'student@example.com', password: existingPassword } });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().accessToken, 'student-jwt');
  const credentialRequest = provider.calls.find(call => call.url.pathname === '/auth/v1/token')!;
  assert.equal((credentialRequest.body as JsonObject).password, existingPassword, 'Supabase validates the original existing-account credential');
  const callsAfterLogin = provider.calls.length;
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'new-student@example.com', password: existingPassword, name: 'New Student', role: 'student' } });
  assert.equal(signup.statusCode, 400, signup.body);
  assert.equal(provider.calls.length, callsAfterLogin, 'short new passwords never reach Supabase');
  const emptyLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'student@example.com', password: '' } });
  assert.equal(emptyLogin.statusCode, 400, emptyLogin.body);
  assert.equal(provider.calls.length, callsAfterLogin, 'empty login passwords never reach Supabase');
});

test('signup requiring email confirmation returns no fake session or profile write', async t => {
  const { app, provider } = await fixture(t);
  provider.state.confirmEmail = true;
  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'new-student@example.com', password, name: 'New Trojan', role: 'student' } });
  assert.equal(registered.statusCode, 201, registered.body);
  assert.equal(registered.json().accessToken, null);
  assert.equal(registered.json().requiresEmailConfirmation, true);
  assert.equal(registered.json().user.email, 'new-student@example.com');
  assert.equal(profileWrites(provider.calls).length, 0);
  assert.equal(provider.calls.some(call => call.url.pathname === '/auth/v1/user'), false);
  const signup = provider.calls.find(call => call.url.pathname === '/auth/v1/signup')!;
  assert.equal((signup.body as JsonObject).email, 'new-student@example.com');
});

test('onboarding partial writes preserve omitted data, normalize fields, and invalidate completion atomically', async t => {
  const { app, provider, savePdf } = await fixture(t);
  await savePdf();
  provider.profiles.set(studentId, profileRow(studentId, { onboarding_completed_at: createdAt }));
  const optional = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers, payload: { name: '  New Profile Name  ', skills: [' Python ', 'python', ' '], goals: [' Meet people ', 'meet PEOPLE'] } });
  assert.equal(optional.statusCode, 200, optional.body);
  assert.equal(optional.json().user.name, 'New Profile Name');
  assert.equal(optional.json().profile.major, 'Computer Science');
  assert.deepEqual(optional.json().profile.interests, ['Robotics']);
  assert.deepEqual(optional.json().profile.skills, ['Python']);
  assert.deepEqual(optional.json().profile.goals, ['Meet people']);
  assert.equal(optional.json().onboarding.status, 'completed');
  assert.equal(optional.json().onboarding.completedAt, createdAt);
  const before = profileWrites(provider.calls).length;
  const cleared = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers, payload: { major: '   ' } });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().profile.major, '');
  assert.equal(cleared.json().onboarding.status, 'in_progress');
  assert.equal(cleared.json().onboarding.completedAt, null);
  assert.ok(cleared.json().onboarding.missingRequiredFields.includes('major'));
  const writes = profileWrites(provider.calls).slice(before);
  assert.equal(writes.length, 1, 'required-field removal and completion clearing must share one database write');
  const written = (Array.isArray(writes[0]!.body) ? writes[0]!.body[0] : writes[0]!.body) as JsonObject;
  assert.equal(written.major, '');
  assert.equal(written.onboarding_completed_at, null);
  assert.equal(provider.profiles.get(studentId)?.full_name, 'New Profile Name');
});

test('onboarding completion requires a private PDF and basics while parsing never saves extracted data', async t => {
  const { app, provider, savePdf } = await fixture(t);
  const initial = await app.inject({ url: '/api/v1/me/onboarding', headers });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().user.name, 'Alex Auth');
  assert.equal(initial.json().onboarding.status, 'not_started');
  assert.equal(initial.json().resume, null);
  const incomplete = await app.inject({ method: 'POST', url: '/api/v1/me/onboarding/complete', headers, payload: {} });
  assert.equal(incomplete.statusCode, 400, incomplete.body);
  assert.equal(incomplete.json().error.code, 'MISSING_ONBOARDING_FIELDS');
  assert.equal(profileWrites(provider.calls).length, 0);
  const parsed = await app.inject({ method: 'POST', url: '/api/v1/me/profile/parse', headers, payload: { text: 'Major: Architecture\nSkills: Sketching' } });
  assert.equal(parsed.statusCode, 200, parsed.body);
  assert.equal(parsed.json().needsReview, true);
  assert.equal(parsed.json().profile.major, 'Architecture');
  assert.equal(profileWrites(provider.calls).length, 0);
  const draft = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers, payload: { academicYear: 'first_year', major: 'Undeclared', interests: ['Still exploring'] } });
  assert.equal(draft.statusCode, 200, draft.body);
  assert.deepEqual(draft.json().onboarding.missingRequiredFields, ['resume']);
  const noPdf = await app.inject({ method: 'POST', url: '/api/v1/me/onboarding/complete', headers, payload: {} });
  assert.equal(noPdf.statusCode, 400, noPdf.body);
  assert.equal(noPdf.json().error.code, 'MISSING_ONBOARDING_FIELDS');
  await savePdf();
  const completed = await app.inject({ method: 'POST', url: '/api/v1/me/onboarding/complete', headers, payload: {} });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json().onboarding.status, 'completed');
  assert.deepEqual(completed.json().onboarding.missingRequiredFields, []);
  assert.equal(completed.json().resume.textStatus, 'unavailable');
  assert.deepEqual(completed.json().profile.skills, []);
  assert.deepEqual(completed.json().profile.goals, []);
});

test('verified Auth identity isolates profiles and rejects payload identity or role mutations', async t => {
  const { app, provider } = await fixture(t);
  provider.profiles.set(studentId, profileRow());
  provider.profiles.set(otherStudentId, profileRow(otherStudentId, { full_name: 'Other Profile', major: 'Cinema', interests: ['Film'] }));
  const otherHeaders = { authorization: 'Bearer other-student-jwt' };
  const read = await app.inject({ url: `/api/v1/me/profile?user_id=${studentId}`, headers: otherHeaders });
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json().user.id, otherStudentId);
  assert.equal(read.json().profile.major, 'Cinema');
  for (const payload of [{ user_id: studentId }, { studentId }, { role: 'organizer' }, { completedAt: createdAt }]) {
    const rejected = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers: otherHeaders, payload });
    assert.equal(rejected.statusCode, 400, rejected.body);
  }
  const update = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers: otherHeaders, payload: { major: 'Theatre' } });
  assert.equal(update.statusCode, 200, update.body);
  assert.equal(provider.profiles.get(otherStudentId)?.major, 'Theatre');
  assert.equal(provider.profiles.get(studentId)?.major, 'Computer Science');
  const wrongPut = await app.inject({ method: 'PUT', url: '/api/v1/me/profile', headers, payload: { ...update.json().profile, user_id: otherStudentId } });
  assert.equal(wrongPut.statusCode, 400, wrongPut.body);
});

test('profile PUT maps fields into an owner upsert and rejects mismatched or malformed provider rows', async t => {
  const { app, provider } = await fixture(t);
  provider.profiles.set(studentId, profileRow());
  const updated = await app.inject({
    method: 'PUT', url: '/api/v1/me/profile', headers,
    payload: {
      major: '  Physics  ', academicYear: 'third_year', graduationYear: 2027,
      bio: '  A reviewed introduction.  ', interests: [' Astronomy ', 'astronomy'],
      skills: [' Python ', 'python'], experience: ' A class project. ',
    },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().profile.major, 'Physics');
  assert.equal(updated.json().profile.academicYear, 'third_year');
  assert.equal(updated.json().profile.graduationYear, 2027);
  assert.deepEqual(updated.json().profile.interests, ['Astronomy']);
  assert.deepEqual(updated.json().profile.skills, ['Python']);
  assert.deepEqual(updated.json().profile.goals, ['Find friends'], 'omitted optional fields remain saved');
  const stored = provider.profiles.get(studentId)!;
  assert.equal(stored.user_id, studentId);
  assert.equal(stored.academic_year, 'third_year');
  assert.equal(stored.full_name, 'Alex Profile');
  const write = profileWrites(provider.calls).at(-1)!;
  assert.equal(write.headers.get('authorization'), 'Bearer student-jwt');
  assert.equal(write.url.searchParams.get('on_conflict'), 'user_id');
  assert.match(write.headers.get('prefer')!, /return=representation/);
  provider.profiles.set(studentId, profileRow(otherStudentId, { bio: 'PRIVATE_OTHER_STUDENT_9281' }));
  const mismatched = await app.inject({ url: '/api/v1/me/profile', headers });
  assert.equal(mismatched.statusCode, 502, mismatched.body);
  assert.equal(mismatched.body.includes('PRIVATE_OTHER_STUDENT_9281'), false);
  provider.profiles.set(studentId, { user_id: studentId, full_name: 'Malformed profile' });
  const malformed = await app.inject({ url: '/api/v1/me/profile', headers });
  assert.equal(malformed.statusCode, 502, malformed.body);
});

test('student endpoints deny missing, invalid, and nonstudent sessions and organizer signup stays unavailable', async t => {
  const { app, provider } = await fixture(t);
  for (const [auth, expected] of [[undefined, 401], [{ authorization: 'Bearer invalid-jwt' }, 401], [{ authorization: 'Bearer organizer-jwt' }, 403]] as const) {
    for (const request of [
      { method: 'GET' as const, url: '/api/v1/me/profile' },
      { method: 'GET' as const, url: '/api/v1/me/onboarding' },
      { method: 'PATCH' as const, url: '/api/v1/me/onboarding', payload: { major: 'Physics' } },
      { method: 'POST' as const, url: '/api/v1/me/onboarding/complete', payload: {} },
    ]) {
      const response = await app.inject({ ...request, headers: auth });
      assert.equal(response.statusCode, expected, response.body);
    }
  }
  const organizer = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'pending-organizer@example.com', name: 'Pending Organizer', password, role: 'organizer' } });
  assert.equal(organizer.statusCode, 503, organizer.body);
  assert.equal(profileWrites(provider.calls).length, 0);
  assert.equal(provider.calls.some(call => call.url.pathname === '/auth/v1/signup'), false);
});

test('invalid login, provider failures, and logout use fixed safe errors without leaking upstream bodies', async t => {
  const { app, provider } = await fixture(t);
  provider.state.invalidLogin = true;
  const invalid = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'student@example.com', password } });
  assert.equal(invalid.statusCode, 401, invalid.body);
  assert.equal(invalid.body.includes('RAW_PROVIDER_SECRET'), false);
  assert.equal(invalid.body.includes('JWT_PRIVATE_9281'), false);
  provider.state.profileFailure = true;
  const failure = await app.inject({ url: '/api/v1/me/profile', headers });
  assert.ok(failure.statusCode >= 500, failure.body);
  for (const sensitive of ['RAW_PROVIDER_SECRET', 'JWT_PRIVATE_9281', 'student-jwt', publishableKey]) assert.equal(failure.body.includes(sensitive), false);
  provider.state.profileFailure = false;
  const loggedOut = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers });
  assert.equal(loggedOut.statusCode, 204, loggedOut.body);
  const logout = provider.calls.find(call => call.url.pathname === '/auth/v1/logout')!;
  assert.equal(logout.headers.get('authorization'), 'Bearer student-jwt');
  assert.equal(logout.url.searchParams.get('scope'), 'local');
  // Supabase logout does not guarantee an already-issued access JWT expires
  // immediately. The backend must defer verification to Auth, not fake expiry.
  provider.state.authFailure = true;
  const revoked = await app.inject({ url: '/api/v1/auth/me', headers });
  assert.equal(revoked.statusCode, 401, revoked.body);
});

test('missing resume services or another student PDF cannot satisfy the current student file requirement', async t => {
  for (const withResumeService of [false, true]) {
    const { app, provider, savePdf } = await fixture(t, withResumeService);
    provider.profiles.set(studentId, profileRow(studentId, { onboarding_completed_at: createdAt }));
    await savePdf(otherStudentId);
    const snapshot = await app.inject({ url: '/api/v1/me/onboarding', headers });
    assert.equal(snapshot.statusCode, 200, snapshot.body);
    assert.equal(snapshot.json().resume, null);
    assert.equal(snapshot.json().onboarding.status, 'in_progress');
    assert.equal(snapshot.json().onboarding.completedAt, null);
    assert.deepEqual(snapshot.json().onboarding.missingRequiredFields, ['resume']);
    assert.equal(snapshot.json().onboarding.recommendedFields.includes('resume'), false);
    const complete = await app.inject({ method: 'POST', url: '/api/v1/me/onboarding/complete', headers, payload: {} });
    assert.equal(complete.statusCode, 400, complete.body);
    assert.equal(profileWrites(provider.calls).length, 0);
  }
});
