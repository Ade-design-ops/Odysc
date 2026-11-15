import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify, { type FastifyError } from 'fastify';
import { AUTH_COOKIE_NAMES } from '../src/auth-cookies.js';
import { HttpError } from '../src/errors.js';
import type { ResumeFiles } from '../src/resume-files.js';
import type { SupabaseCatalogService } from '../src/supabase-catalog.js';
import { registerSupabaseFeatures } from '../src/supabase-features.js';
import { registerSupabaseStudent } from '../src/supabase-student.js';
import { SupabaseGateway, type SupabaseOptions } from '../src/supabase.js';
import { WebAuthService } from '../src/web-auth.js';

const projectUrl = 'https://cfrkamtsphdlowuiuarn.supabase.co';
const publicOrigin = 'http://localhost:3001';
const password = 'Unit-test-password123!';
const uscEmail = 'student@usc.edu';
const confirmedAt = '2026-11-14T12:00:00.000Z';
type JsonObject = Record<string, unknown>;
interface ProviderCall { url: URL; method: string; body: JsonObject | null }
const lookalikes = ['student@notusc.edu', 'student@usc.edu.example', 'student@alumni.usc.edu', 'student@gmail.com'];

function authUser(changes: JsonObject = {}): JsonObject {
  return {
    id: '11111111-1111-4111-8111-111111111111', email: uscEmail, created_at: confirmedAt,
    email_confirmed_at: confirmedAt, app_metadata: { role: 'student' }, user_metadata: { name: 'Test Student', role: 'student' },
    ...changes,
  };
}

function mockProvider() {
  const state = { user: authUser(), signupRequiresConfirmation: true, fileCalls: 0, catalogCalls: 0 };
  const calls: ProviderCall[] = [];
  const unexpected: string[] = [];
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const session = () => ({ access_token: 'unit-test-token', refresh_token: 'unit-test-refresh', token_type: 'bearer', expires_in: 3600, user: state.user });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.origin, projectUrl);
    assert.equal(new Headers(init?.headers).get('apikey'), 'test-publishable-key');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as JsonObject : null;
    calls.push({ url, method, body });
    if (url.pathname === '/auth/v1/signup' && method === 'POST') return json(state.signupRequiresConfirmation ? state.user : session());
    if (url.pathname === '/auth/v1/token' && method === 'POST') return json(session());
    if (url.pathname === '/auth/v1/user' && method === 'GET') return json(state.user);
    if (url.pathname === '/auth/v1/user' && method === 'PUT') return json(state.user);
    if (url.pathname === '/auth/v1/recover' || url.pathname === '/auth/v1/resend') return json({});
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/student_profiles' && method === 'GET') return json([]);
    unexpected.push(`${method} ${url.pathname}`);
    return json({ message: 'Unexpected mocked endpoint.' }, 500);
  };
  return { calls, state, fetch, unexpected };
}

function jar() {
  const cookies = new Map<string, string>();
  return {
    take(response: { headers: { 'set-cookie'?: string | string[] } }) {
      const header = response.headers['set-cookie'];
      for (const line of header ? Array.isArray(header) ? header : [header] : []) {
        const pair = line.split(';')[0]!;
        const separator = pair.indexOf('=');
        const name = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        if (!value || /(?:^|;)\s*max-age=0(?:;|$)/iu.test(line)) cookies.delete(name);
        else cookies.set(name, value);
      }
    },
    header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    has: (name: string) => cookies.has(name),
  };
}

async function fixture(t: TestContext, studentEmailDomain: string | undefined = 'usc.edu') {
  const provider = mockProvider();
  const options: SupabaseOptions = { url: projectUrl, publishableKey: 'test-publishable-key', fetch: provider.fetch, ...(studentEmailDomain === undefined ? {} : { studentEmailDomain }) };
  const gateway = new SupabaseGateway(options);
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error.validation) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Check the entered values.' } });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
  });
  const webAuth = new WebAuthService(gateway, { publicOrigin, cookieSecret: 'unit-test-cookie-secret-with-at-least-32-characters' });
  webAuth.attachSession(app);
  webAuth.registerRoutes(app);
  await registerSupabaseStudent(app, options, {}, { webAuth });
  const files = {
    async get() { provider.state.fileCalls += 1; return null; },
    async getText() { provider.state.fileCalls += 1; return ''; },
    async delete() { provider.state.fileCalls += 1; return false; },
    async save() { provider.state.fileCalls += 1; },
  } as unknown as ResumeFiles;
  const catalog = { async listClubs() { provider.state.catalogCalls += 1; return []; } } as unknown as SupabaseCatalogService;
  await registerSupabaseFeatures(app, gateway, files, catalog);
  t.after(async () => { await app.close(); assert.deepEqual(provider.unexpected, []); });
  return { app, provider, gateway, jar: jar() };
}

const registration = (email = uscEmail) => ({ email, password, name: 'Test Student', role: 'student' });
const bearer = { authorization: 'Bearer unit-test-token' };
const privateCalls = (calls: ProviderCall[]) => calls.filter(call => call.url.pathname.startsWith('/rest/'));
const assertError = (response: { statusCode: number; body: string; json(): { error: { code: string } } }, status: number, code: string) => {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.json().error.code, code);
};

test('USC policy is the default and only explicit blank configuration disables it', () => {
  const defaults = { url: projectUrl, publishableKey: 'test-publishable-key' };
  for (const options of [defaults, { ...defaults, studentEmailDomain: undefined }]) {
    const gateway = new SupabaseGateway(options);
    assert.equal(gateway.studentUser(authUser()).email, uscEmail);
    assert.throws(() => gateway.studentUser(authUser({ email: 'demo@example.com' })), error => error instanceof HttpError && error.code === 'STUDENT_EMAIL_NOT_ALLOWED');
    assert.throws(() => gateway.studentUser(authUser({ email_confirmed_at: null })), error => error instanceof HttpError && error.code === 'EMAIL_CONFIRMATION_REQUIRED');
  }
  for (const studentEmailDomain of ['', '   ']) {
    const gateway = new SupabaseGateway({ ...defaults, studentEmailDomain });
    assert.equal(gateway.studentUser(authUser({ email: 'demo@example.com', email_confirmed_at: null })).email, 'demo@example.com');
  }
  const gateway = new SupabaseGateway({ ...defaults, studentEmailDomain: '  USC.EDU  ' });
  assert.doesNotThrow(() => gateway.assertStudentEmail('STUDENT@USC.EDU'));
  for (const studentEmailDomain of ['gmail.com', '*.usc.edu', 'alumni.usc.edu', 'https://usc.edu']) {
    assert.throws(() => new SupabaseGateway({ ...defaults, studentEmailDomain }), /usc\.edu|STUDENT_EMAIL_DOMAIN/iu);
  }
});

test('configured USC registration and login reject lookalike domains before contacting Supabase', async t => {
  const { app, provider } = await fixture(t);
  for (const email of lookalikes) {
    for (const [url, payload] of [
      ['/api/v1/auth/register', registration(email)],
      ['/api/v1/auth/login', { email, password }],
    ] as const) {
      const response = await app.inject({ method: 'POST', url, payload });
      assertError(response, 403, 'STUDENT_EMAIL_NOT_ALLOWED');
      assert.equal(response.headers['set-cookie'], undefined, 'rejected addresses do not start a browser auth flow');
    }
  }
  assert.equal(provider.calls.length, 0);
});

test('uppercase USC emails are accepted and normalized on provider requests', async t => {
  const { app, provider } = await fixture(t, '  USC.EDU  ');
  const email = 'STUDENT@USC.EDU';
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: registration(email) });
  assert.equal(signup.statusCode, 201, signup.body);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  assert.equal(login.statusCode, 200, login.body);
  for (const call of provider.calls.filter(call => ['/auth/v1/signup', '/auth/v1/token'].includes(call.url.pathname))) {
    assert.equal(call.body?.email, uscEmail);
  }
});

test('unconfirmed USC signup may await email verification but cannot establish a student session', async t => {
  const { app, provider, jar } = await fixture(t);
  provider.state.user = authUser({ email_confirmed_at: null });
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: registration() });
  assert.equal(signup.statusCode, 201, signup.body);
  assert.equal(signup.json().accessToken, null);
  assert.equal(signup.json().requiresEmailConfirmation, true);
  jar.take(signup);
  assert.equal(jar.has(AUTH_COOKIE_NAMES.session), false);
  assert.equal(privateCalls(provider.calls).length, 0);
  const current = await app.inject({ url: '/api/v1/auth/me', headers: bearer });
  assertError(current, 401, 'EMAIL_CONFIRMATION_REQUIRED');
  provider.state.signupRequiresConfirmation = false;
  const invalidSession = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: registration() });
  assertError(invalidSession, 401, 'EMAIL_CONFIRMATION_REQUIRED');
  const invalidJar = jarForResponse(invalidSession);
  assert.equal(invalidJar.has(AUTH_COOKIE_NAMES.session), false);
});

function jarForResponse(response: { headers: { 'set-cookie'?: string | string[] } }) {
  const result = jar();
  result.take(response);
  return result;
}

test('USC access requires Supabase email_confirmed_at rather than metadata or confirmed_at claims', async t => {
  const { app, provider, gateway } = await fixture(t);
  for (const email_confirmed_at of [undefined, null, '', 'not-a-date']) {
    provider.state.user = authUser({ email_confirmed_at, confirmed_at: confirmedAt, user_metadata: { name: 'Test Student', role: 'student', email_verified: true } });
    assert.throws(() => gateway.studentUser(provider.state.user), error => error instanceof HttpError && error.statusCode === 401 && error.code === 'EMAIL_CONFIRMATION_REQUIRED');
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: uscEmail, password } });
    assertError(login, 401, 'EMAIL_CONFIRMATION_REQUIRED');
    assert.equal(jarForResponse(login).has(AUTH_COOKIE_NAMES.session), false);
  }
  assert.equal(privateCalls(provider.calls).length, 0);
});

test('verified provider identities must still have an exact USC email even when login input is USC', async t => {
  const { app, provider } = await fixture(t);
  for (const email of lookalikes) {
    provider.state.user = authUser({ email });
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: uscEmail, password } });
    assertError(response, 403, 'STUDENT_EMAIL_NOT_ALLOWED');
    assert.equal(jarForResponse(response).has(AUTH_COOKIE_NAMES.session), false);
    const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: registration() });
    assertError(signup, 403, 'STUDENT_EMAIL_NOT_ALLOWED');
    assert.equal(jarForResponse(signup).has(AUTH_COOKIE_NAMES.session), false, 'awaiting confirmation never bypasses the provider email-domain check');
  }
  assert.equal(privateCalls(provider.calls).length, 0);
});

test('private profile and resume routes reject non-USC bearer identities before any private-data access', async t => {
  const { app, provider } = await fixture(t);
  provider.state.user = authUser({ email: 'student@usc.edu.example' });
  for (const [method, url, payload] of [
    ['GET', '/api/v1/me/profile', undefined],
    ['GET', '/api/v1/me/onboarding', undefined],
    ['PATCH', '/api/v1/me/onboarding', { major: 'Physics' }],
    ['GET', '/api/v1/me/resume', undefined],
    ['DELETE', '/api/v1/me/resume', undefined],
    ['POST', '/api/v1/me/matches', {}],
  ] as const) {
    const response = await app.inject({ method, url, headers: bearer, ...(payload === undefined ? {} : { payload }) });
    assertError(response, 403, 'STUDENT_EMAIL_NOT_ALLOWED');
  }
  assert.equal(privateCalls(provider.calls).length, 0);
  assert.equal(provider.state.fileCalls, 0);
  assert.equal(provider.state.catalogCalls, 0);
});

test('recovery and confirmation-resend reject non-USC addresses before sending email requests', async t => {
  const { app, provider } = await fixture(t);
  for (const url of ['/api/v1/auth/forgot-password', '/api/v1/auth/resend-confirmation']) {
    for (const email of lookalikes) {
      const response = await app.inject({ method: 'POST', url, payload: { email } });
      assertError(response, 403, 'STUDENT_EMAIL_NOT_ALLOWED');
      assert.equal(response.headers['set-cookie'], undefined);
    }
    const allowed = await app.inject({ method: 'POST', url, payload: { email: 'STUDENT@USC.EDU' } });
    assert.equal(allowed.statusCode, 200, allowed.body);
  }
  assert.equal(provider.calls.length, 2);
  assert.ok(provider.calls.every(call => call.body?.email === uscEmail));
});

test('unconfirmed USC callback identities cannot become normal or recovery sessions', async t => {
  const { app, provider } = await fixture(t);
  provider.state.user = authUser({ email_confirmed_at: null, user_metadata: { name: 'Test Student', email_verified: true, role: 'student' } });
  for (const [url, payload] of [
    ['/api/v1/auth/register', registration()],
    ['/api/v1/auth/forgot-password', { email: uscEmail }],
  ] as const) {
    const pending = jarForResponse(await app.inject({ method: 'POST', url, payload }));
    const callback = await app.inject({ url: '/auth/callback?code=unit-test-code', headers: { cookie: pending.header() } });
    assert.equal(callback.statusCode, 303, callback.body);
    assert.equal(callback.headers.location, '/auth/error?reason=invalid_link');
    const result = jarForResponse(callback);
    assert.equal(result.has(AUTH_COOKIE_NAMES.session), false);
    assert.equal(result.has(AUTH_COOKIE_NAMES.recovery), false);
  }
  assert.equal(privateCalls(provider.calls).length, 0);
});

test('previously issued browser and recovery cookies are rechecked when provider email eligibility changes', async t => {
  const { app, provider, jar } = await fixture(t);
  jar.take(await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: uscEmail, password } }));
  provider.state.user = authUser({ email: 'changed@example.com' });
  const profile = await app.inject({ url: '/api/v1/me/profile', headers: { cookie: jar.header() } });
  assert.equal(profile.statusCode, 401, profile.body);
  const session = await app.inject({ url: '/api/v1/auth/session', headers: { cookie: jar.header() } });
  assert.deepEqual(session.json(), { authenticated: false });
  assert.equal(privateCalls(provider.calls).length, 1, 'only the original eligible login may read a profile');

  provider.state.user = authUser();
  const recoveryJar = jarForResponse(await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: uscEmail } }));
  recoveryJar.take(await app.inject({ url: '/auth/callback?code=unit-test-code', headers: { cookie: recoveryJar.header() } }));
  assert.ok(recoveryJar.has(AUTH_COOKIE_NAMES.recovery));
  provider.state.user = authUser({ email_confirmed_at: null });
  const valid = await app.inject({ url: '/api/v1/auth/recovery-session', headers: { cookie: recoveryJar.header() } });
  assert.deepEqual(valid.json(), { valid: false });
  const reset = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', headers: { origin: publicOrigin, cookie: recoveryJar.header() }, payload: { password } });
  assertError(reset, 401, 'RECOVERY_SESSION_REQUIRED');
  assert.equal(provider.calls.filter(call => call.url.pathname === '/auth/v1/user' && call.method === 'PUT').length, 0);
});

test('disabled policy keeps the existing demo flow and student-only role restrictions', async t => {
  const { app, provider } = await fixture(t, '');
  provider.state.user = authUser({ email: 'demo@example.com', email_confirmed_at: null });
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'demo@example.com', password } });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().user.email, 'demo@example.com');
  provider.state.user = authUser({ app_metadata: { role: 'organizer' }, user_metadata: { name: 'Organizer', role: 'student' } });
  const rejected = await app.inject({ url: '/api/v1/me/profile', headers: bearer });
  assertError(rejected, 403, 'FORBIDDEN');
});
