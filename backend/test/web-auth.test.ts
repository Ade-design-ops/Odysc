import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import Fastify, { type FastifyError } from 'fastify';
import { AUTH_COOKIE_NAMES } from '../src/auth-cookies.js';
import { HttpError } from '../src/errors.js';
import { SupabaseGateway } from '../src/supabase.js';
import { registerSupabaseStudent } from '../src/supabase-student.js';
import { WebAuthService } from '../src/web-auth.js';

const projectUrl = 'https://cfrkamtsphdlowuiuarn.supabase.co';
const publicOrigin = 'http://localhost:3001';
const studentId = '11111111-1111-4111-8111-111111111111';
const password = 'Demo-password-only123!';
const studentEmail = 'student@example.com';
const initialTime = Date.UTC(2026, 10, 14, 18, 0, 0);
const privateProviderError = 'PROVIDER_PRIVATE_ERROR_ACCESS_TOKEN';
type ObjectValue = Record<string, unknown>;
interface ProviderCall { url: URL; method: string; headers: Headers; body: ObjectValue | null }

function authUser(email = studentEmail) {
  return { id: studentId, email, created_at: '2026-11-14T12:00:00.000Z', app_metadata: { role: 'student' }, user_metadata: { name: 'Demo Student', role: 'student' } };
}

function mockProvider(now: () => number) {
  const calls: ProviderCall[] = [];
  const unexpected: string[] = [];
  const state = { confirmEmail: true, recoveryFailure: false, callbackFailure: false, email: studentEmail, sessionEmail: studentEmail, passwordUpdates: 0 };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const session = (token: string) => ({ access_token: token, refresh_token: `${token}-refresh-secret`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now() / 1000) + 3600, user: authUser(state.sessionEmail) });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.origin, projectUrl, 'auth calls remain on the configured Supabase project');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('apikey'), 'test-publishable-key');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as ObjectValue : null;
    const token = headers.get('authorization')?.replace(/^Bearer /u, '');
    calls.push({ url, method, headers, body });
    if (url.pathname === '/auth/v1/signup' && method === 'POST') {
      state.email = String(body?.email);
      state.sessionEmail = state.email;
      return json(state.confirmEmail ? authUser(state.email) : session('signup-secret-token'));
    }
    if (url.pathname === '/auth/v1/recover' && method === 'POST') {
      state.email = String(body?.email);
      return state.recoveryFailure ? json({ message: privateProviderError, error_code: 'email_address_invalid' }, 400) : json({});
    }
    if (url.pathname === '/auth/v1/resend' && method === 'POST') {
      state.email = String(body?.email);
      return json({});
    }
    if (url.pathname === '/auth/v1/token' && method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') return json(session('login-secret-token'));
      if (grant === 'refresh_token') return json(session('refreshed-secret-token'));
      if (grant === 'pkce') {
        if (state.callbackFailure) return json({ error_code: 'bad_code_verifier', message: privateProviderError }, 400);
        return json(session(String(body?.auth_code).includes('recovery') ? 'recovery-secret-token' : 'confirmation-secret-token'));
      }
    }
    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      return token ? json(authUser(state.sessionEmail)) : json({ message: privateProviderError }, 401);
    }
    if (url.pathname === '/auth/v1/user' && method === 'PUT') {
      assert.equal(token, 'recovery-secret-token', 'only the dedicated recovery identity changes a password');
      assert.equal(body?.password, password);
      state.passwordUpdates += 1;
      return json(authUser(state.sessionEmail));
    }
    if (url.pathname === '/auth/v1/logout' && method === 'POST') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/student_profiles' && method === 'GET') return json([]);
    unexpected.push(`${method} ${url.pathname}${url.search}`);
    return json({ message: privateProviderError }, 500);
  };
  return { calls, state, unexpected, fetch };
}

function cookieJar() {
  const values = new Map<string, string>();
  return {
    take(response: { headers: { 'set-cookie'?: string | string[] } }) {
      const header = response.headers['set-cookie'];
      for (const line of header ? Array.isArray(header) ? header : [header] : []) {
        const pair = line.split(';')[0]!;
        const separator = pair.indexOf('=');
        const name = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        if (!value || /(?:^|;)\s*max-age=0(?:;|$)/iu.test(line)) values.delete(name);
        else values.set(name, value);
      }
    },
    header: () => [...values].map(([name, value]) => `${name}=${value}`).join('; '),
    has: (name: string) => values.has(name),
    get: (name: string) => values.get(name),
  };
}

async function fixture(t: TestContext, origin = publicOrigin, frontendOrigin?: string, frontendRouting?: 'history' | 'hash') {
  let time = initialTime;
  const provider = mockProvider(() => time);
  const options = { url: projectUrl, publishableKey: 'test-publishable-key', fetch: provider.fetch, studentEmailDomain: '' };
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error.validation) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Check the entered values.' } });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
  });
  const webAuth = new WebAuthService(new SupabaseGateway(options), { publicOrigin: origin, cookieSecret: 'unit-test-only-cookie-secret-32-characters-minimum', now: () => time, ...(frontendOrigin ? { frontendOrigin } : {}), ...(frontendRouting ? { frontendRouting } : {}) });
  webAuth.attachSession(app);
  webAuth.registerRoutes(app);
  await registerSupabaseStudent(app, options, {}, { webAuth });
  t.after(async () => { await app.close(); assert.deepEqual(provider.unexpected, []); });
  return { app, provider, jar: cookieJar(), advance: (milliseconds: number) => { time += milliseconds; } };
}

const signupPayload = { email: studentEmail, password, name: 'Demo Student', role: 'student' };

test('student signup creates a PKCE flow cookie without inventing an authenticated session', async t => {
  const { app, provider, jar } = await fixture(t);
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { origin: publicOrigin }, payload: signupPayload });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().requiresEmailConfirmation, true);
  assert.equal(response.json().accessToken, null);
  assert.equal(response.json().user.email, studentEmail);
  jar.take(response);
  assert.ok(jar.has(AUTH_COOKIE_NAMES.flow));
  assert.equal(jar.has(AUTH_COOKIE_NAMES.session), false);
  const cookies = String(response.headers['set-cookie']);
  assert.match(cookies, /HttpOnly/iu);
  assert.match(cookies, /SameSite=Lax/iu);
  assert.equal(cookies.includes(password), false);
  assert.equal(cookies.includes(studentEmail), false, 'flow details are encrypted');
  const signup = provider.calls.find(call => call.url.pathname === '/auth/v1/signup')!;
  assert.equal(signup.url.searchParams.get('redirect_to'), `${publicOrigin}/auth/callback`);
  assert.equal(signup.body?.code_challenge_method, 's256');
  assert.match(String(signup.body?.code_challenge), /^[A-Za-z\d_-]{43}$/u);
  const session = await app.inject({ url: '/api/v1/auth/session', headers: { cookie: jar.header() } });
  assert.deepEqual(session.json(), { authenticated: false });
});

test('confirmation exchanges the matching verifier and creates an encrypted, HttpOnly browser session', async t => {
  const { app, provider, jar } = await fixture(t, 'https://odysc.example');
  jar.take(await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: signupPayload }));
  const callback = await app.inject({ url: '/auth/callback?code=confirmation-code&next=https://evil.example', headers: { cookie: jar.header() } });
  assert.equal(callback.statusCode, 303, callback.body);
  assert.equal(callback.headers.location, '/student?welcome=1');
  jar.take(callback);
  assert.equal(jar.has(AUTH_COOKIE_NAMES.flow), false);
  assert.ok(jar.has(AUTH_COOKIE_NAMES.session));
  assert.equal(jar.has(AUTH_COOKIE_NAMES.recovery), false);
  assert.match(String(callback.headers['set-cookie']), /Secure/iu);
  assert.equal(String(callback.headers['set-cookie']).includes('confirmation-secret-token'), false);
  const signup = provider.calls.find(call => call.url.pathname === '/auth/v1/signup')!;
  const exchange = provider.calls.find(call => call.url.searchParams.get('grant_type') === 'pkce')!;
  assert.equal(exchange.body?.auth_code, 'confirmation-code');
  assert.equal(createHash('sha256').update(String(exchange.body?.code_verifier)).digest('base64url'), signup.body?.code_challenge);
  const session = await app.inject({ url: '/api/v1/auth/session', headers: { cookie: jar.header() } });
  assert.equal(session.statusCode, 200, session.body);
  assert.equal(session.json().authenticated, true);
  assert.equal(session.json().user.id, studentId);
  assert.equal(session.body.includes('secret-token'), false);
  assert.equal(session.body.includes('refresh-secret'), false);
  const profile = await app.inject({ url: '/api/v1/me/profile', headers: { cookie: jar.header() } });
  assert.equal(profile.statusCode, 200, profile.body);
  assert.equal(profile.json().user.id, studentId);
});

test('login keeps the Bearer API contract while adding an opaque browser session cookie', async t => {
  const { app, jar } = await fixture(t);
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: publicOrigin }, payload: { email: studentEmail, password } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().accessToken, 'login-secret-token');
  assert.equal(response.json().tokenType, 'Bearer');
  const cookieHeaders = response.headers['set-cookie'];
  const cookies = Array.isArray(cookieHeaders) ? cookieHeaders : [String(cookieHeaders)];
  assert.equal(cookies.filter(cookie => cookie.startsWith(`${AUTH_COOKIE_NAMES.session}=`)).length, 1,
    'writing or clearing another cookie must not duplicate the session header');
  jar.take(response);
  assert.ok(jar.has(AUTH_COOKIE_NAMES.session));
  assert.equal(String(response.headers['set-cookie']).includes('login-secret-token'), false);
  const normalSession = await app.inject({ url: '/api/v1/auth/recovery-session', headers: { cookie: jar.header() } });
  assert.deepEqual(normalSession.json(), { valid: false });
  const reset = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', headers: { cookie: jar.header(), origin: publicOrigin }, payload: { password } });
  assert.equal(reset.statusCode, 401, reset.body);
});

test('forgot-password responses remain generic and recovery sessions cannot access student APIs', async t => {
  const { app, provider, jar } = await fixture(t);
  const forgot = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', headers: { origin: publicOrigin }, payload: { email: studentEmail } });
  assert.equal(forgot.statusCode, 200, forgot.body);
  assert.equal(typeof forgot.json().message, 'string');
  jar.take(forgot);
  const recover = provider.calls.find(call => call.url.pathname === '/auth/v1/recover')!;
  assert.equal(recover.url.searchParams.get('redirect_to'), `${publicOrigin}/auth/callback`);
  assert.equal(recover.body?.code_challenge_method, 's256');
  const callback = await app.inject({ url: '/auth/callback?code=recovery-code', headers: { cookie: jar.header() } });
  assert.equal(callback.statusCode, 303, callback.body);
  assert.equal(callback.headers.location, '/reset-password');
  jar.take(callback);
  assert.ok(jar.has(AUTH_COOKIE_NAMES.recovery));
  assert.equal(jar.has(AUTH_COOKIE_NAMES.session), false);
  const valid = await app.inject({ url: '/api/v1/auth/recovery-session', headers: { cookie: jar.header() } });
  assert.deepEqual(valid.json(), { valid: true });
  const profile = await app.inject({ url: '/api/v1/me/profile', headers: { cookie: jar.header() } });
  assert.equal(profile.statusCode, 401, profile.body);
  const reset = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', headers: { cookie: jar.header(), origin: publicOrigin }, payload: { password } });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal(provider.state.passwordUpdates, 1);
  jar.take(reset);
  assert.equal(jar.has(AUTH_COOKIE_NAMES.recovery), false);
  assert.equal(jar.has(AUTH_COOKIE_NAMES.session), false);
  const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', headers: { cookie: jar.header(), origin: publicOrigin }, payload: { password } });
  assert.equal(replay.statusCode, 401, replay.body);
  assert.equal(provider.state.passwordUpdates, 1);

  provider.state.recoveryFailure = true;
  const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', headers: { origin: publicOrigin }, payload: { email: 'unknown@example.com' } });
  assert.equal(unknown.statusCode, 200, unknown.body);
  assert.deepEqual(unknown.json(), forgot.json());
  assert.equal(unknown.body.includes(privateProviderError), false);
});

test('confirmation rejects missing, altered, expired or mismatched flow without unsafe redirects', async t => {
  const { app, provider, jar, advance } = await fixture(t);
  const missing = await app.inject({ url: '/auth/callback?code=confirmation-code&next=https://evil.example' });
  assert.equal(missing.statusCode, 303, missing.body);
  assert.match(String(missing.headers.location), /^\/auth\/error\?reason=/u);
  assert.equal(provider.calls.length, 0);
  jar.take(await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: signupPayload }));
  const corrupted = await app.inject({ url: '/auth/callback?code=confirmation-code', headers: { cookie: `${AUTH_COOKIE_NAMES.flow}=${jar.get(AUTH_COOKIE_NAMES.flow)}corrupted` } });
  assert.equal(corrupted.statusCode, 303, corrupted.body);
  assert.match(String(corrupted.headers.location), /^\/auth\/error\?reason=/u);
  assert.equal(provider.calls.filter(call => call.url.pathname === '/auth/v1/token').length, 0);
  provider.state.sessionEmail = 'different@example.com';
  const mismatched = await app.inject({ url: '/auth/callback?code=confirmation-code', headers: { cookie: jar.header() } });
  assert.equal(mismatched.statusCode, 303, mismatched.body);
  const rejectedCookies = cookieJar();
  rejectedCookies.take(mismatched);
  assert.equal(rejectedCookies.has(AUTH_COOKIE_NAMES.session), false);
  assert.equal(mismatched.body.includes('different@example.com'), false);
  provider.state.sessionEmail = studentEmail;
  advance(61 * 60 * 1000);
  const exchangesBefore = provider.calls.filter(call => call.url.searchParams.get('grant_type') === 'pkce').length;
  const expired = await app.inject({ url: '/auth/callback?code=confirmation-code', headers: { cookie: jar.header() } });
  assert.equal(expired.statusCode, 303, expired.body);
  assert.match(String(expired.headers.location), /^\/auth\/error\?reason=/u);
  assert.equal(provider.calls.filter(call => call.url.searchParams.get('grant_type') === 'pkce').length, exchangesBefore);
});

test('callback errors never expose provider errors or auth codes in redirects', async t => {
  const { app, provider, jar } = await fixture(t);
  jar.take(await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: signupPayload }));
  provider.state.callbackFailure = true;
  const failed = await app.inject({ url: '/auth/callback?code=PRIVATE_CALLBACK_CODE', headers: { cookie: jar.header() } });
  assert.equal(failed.statusCode, 303, failed.body);
  assert.match(String(failed.headers.location), /^\/auth\/error\?reason=/u);
  assert.equal(String(failed.headers.location).includes('PRIVATE_CALLBACK_CODE'), false);
  assert.equal(failed.body.includes(privateProviderError), false);
});

test('cookie sessions require trusted Origin on writes and reject foreign auth requests before provider calls', async t => {
  const { app, provider, jar } = await fixture(t);
  const foreign = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', headers: { origin: 'https://evil.example' }, payload: { email: studentEmail } });
  assert.equal(foreign.statusCode, 403, foreign.body);
  assert.equal(provider.calls.length, 0);
  jar.take(await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: studentEmail, password } }));
  for (const origin of [undefined, 'https://evil.example']) {
    const writesBefore = provider.calls.length;
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers: { cookie: jar.header(), ...(origin ? { origin } : {}) }, payload: { major: 'Physics' } });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(provider.calls.length, writesBefore, 'CSRF rejection happens before identity/database calls');
  }
  const directBearer = await app.inject({ url: '/api/v1/me/profile', headers: { authorization: 'Bearer api-client-secret' } });
  assert.equal(directBearer.statusCode, 200, directBearer.body);
});

test('resend creates a fresh PKCE flow without revealing account existence', async t => {
  const { app, provider, jar } = await fixture(t);
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/resend-confirmation', headers: { origin: publicOrigin }, payload: { email: studentEmail } });
  assert.equal(response.statusCode, 200, response.body);
  jar.take(response);
  assert.ok(jar.has(AUTH_COOKIE_NAMES.flow));
  const resend = provider.calls.find(call => call.url.pathname === '/auth/v1/resend')!;
  assert.equal(resend.body?.type, 'signup');
  assert.equal(resend.body?.code_challenge_method, 's256');
  assert.equal(resend.url.searchParams.get('redirect_to'), `${publicOrigin}/auth/callback`);
  const callback = await app.inject({ url: '/auth/callback?code=confirmation-code', headers: { cookie: jar.header() } });
  assert.equal(callback.statusCode, 303, callback.body);
  assert.equal(callback.headers.location, '/student?welcome=1');
});

test('expired access tokens refresh through HttpOnly sessions without exposing refresh tokens', async t => {
  const { app, provider, jar, advance } = await fixture(t);
  jar.take(await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: studentEmail, password } }));
  advance(61 * 60 * 1000);
  const response = await app.inject({ url: '/api/v1/auth/session', headers: { cookie: jar.header() } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().authenticated, true);
  assert.equal(response.body.includes('secret-token'), false);
  assert.equal(response.body.includes('refresh-secret'), false);
  assert.ok(provider.calls.some(call => call.url.searchParams.get('grant_type') === 'refresh_token'));
  jar.take(response);
  assert.ok(jar.has(AUTH_COOKIE_NAMES.session));
});

test('normal session cookies cannot be renamed into password-recovery cookies', async t => {
  const { app, provider, jar } = await fixture(t);
  jar.take(await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: studentEmail, password } }));
  const renamedCookie = `${AUTH_COOKIE_NAMES.recovery}=${jar.get(AUTH_COOKIE_NAMES.session)}`;
  const recovery = await app.inject({ url: '/api/v1/auth/recovery-session', headers: { cookie: renamedCookie } });
  assert.deepEqual(recovery.json(), { valid: false });
  const reset = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', headers: { cookie: renamedCookie, origin: publicOrigin }, payload: { password } });
  assert.equal(reset.statusCode, 401, reset.body);
  assert.equal(provider.state.passwordUpdates, 0);
});

test('password recovery expires after fifteen minutes and weak passwords never reach Supabase', async t => {
  const { app, provider, jar, advance } = await fixture(t);
  jar.take(await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: studentEmail } }));
  jar.take(await app.inject({ url: '/auth/callback?code=recovery-code', headers: { cookie: jar.header() } }));
  const weak = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', headers: { cookie: jar.header(), origin: publicOrigin }, payload: { password: 'short' } });
  assert.equal(weak.statusCode, 400, weak.body);
  assert.equal(provider.state.passwordUpdates, 0);
  advance(16 * 60 * 1000);
  const recovery = await app.inject({ url: '/api/v1/auth/recovery-session', headers: { cookie: jar.header() } });
  assert.deepEqual(recovery.json(), { valid: false });
  const expired = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', headers: { cookie: jar.header(), origin: publicOrigin }, payload: { password } });
  assert.equal(expired.statusCode, 401, expired.body);
  assert.equal(provider.state.passwordUpdates, 0);
});

test('signup supports projects without required confirmation and logout clears browser cookies', async t => {
  const { app, provider, jar } = await fixture(t);
  provider.state.confirmEmail = false;
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: signupPayload });
  assert.equal(signup.statusCode, 201, signup.body);
  assert.equal(signup.json().requiresEmailConfirmation, false);
  assert.equal(signup.json().accessToken, 'signup-secret-token');
  jar.take(signup);
  assert.ok(jar.has(AUTH_COOKIE_NAMES.session));
  const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: jar.header(), origin: publicOrigin } });
  assert.equal(logout.statusCode, 204, logout.body);
  jar.take(logout);
  assert.equal(jar.header(), '');
  assert.ok(provider.calls.some(call => call.url.pathname === '/auth/v1/logout'));
  const session = await app.inject({ url: '/api/v1/auth/session', headers: { cookie: jar.header() } });
  assert.deepEqual(session.json(), { authenticated: false });
});

test('configured frontend gets only fixed callback destinations while Supabase receives the backend callback', async t => {
  const frontendOrigin = 'http://localhost:3000';
  const { app, provider, jar } = await fixture(t, publicOrigin, frontendOrigin);
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { origin: frontendOrigin }, payload: signupPayload });
  assert.equal(signup.statusCode, 201, signup.body);
  jar.take(signup);
  const signupCall = provider.calls.find(call => call.url.pathname === '/auth/v1/signup')!;
  assert.equal(signupCall.url.searchParams.get('redirect_to'), `${publicOrigin}/auth/callback`);
  const confirmed = await app.inject({ url: '/auth/callback?code=confirmation-code&next=https://evil.example', headers: { cookie: jar.header() } });
  assert.equal(confirmed.statusCode, 303, confirmed.body);
  assert.equal(confirmed.headers.location, `${frontendOrigin}/student?welcome=1`);
  jar.take(confirmed);
  const forgot = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', headers: { origin: frontendOrigin, cookie: jar.header() }, payload: { email: studentEmail } });
  assert.equal(forgot.statusCode, 200, forgot.body);
  jar.take(forgot);
  const recovered = await app.inject({ url: '/auth/callback?code=recovery-code&redirect_to=https://evil.example', headers: { cookie: jar.header() } });
  assert.equal(recovered.statusCode, 303, recovered.body);
  assert.equal(recovered.headers.location, `${frontendOrigin}/reset-password`);
  const missing = await app.inject({ url: '/auth/callback?code=confirmation-code&next=https://evil.example' });
  assert.equal(missing.statusCode, 303, missing.body);
  assert.equal(missing.headers.location, `${frontendOrigin}/auth/error?reason=missing_flow`);
});

test('hash frontend receives fixed profile, recovery, and error routes while PKCE stays on the backend', async t => {
  const frontendOrigin = 'http://localhost:5173';
  const { app, provider, jar } = await fixture(t, publicOrigin, frontendOrigin, 'hash');
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { origin: frontendOrigin }, payload: signupPayload });
  assert.equal(signup.statusCode, 201, signup.body);
  jar.take(signup);
  const signupCall = provider.calls.find(call => call.url.pathname === '/auth/v1/signup')!;
  assert.equal(signupCall.url.searchParams.get('redirect_to'), `${publicOrigin}/auth/callback`);
  const confirmed = await app.inject({ url: '/auth/callback?code=confirmation-code&next=https://evil.example/%23/attacker', headers: { cookie: jar.header() } });
  assert.equal(confirmed.statusCode, 303, confirmed.body);
  assert.equal(confirmed.headers.location, `${frontendOrigin}/#/profile?welcome=1`);
  jar.take(confirmed);
  const forgot = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', headers: { origin: frontendOrigin, cookie: jar.header() }, payload: { email: studentEmail } });
  assert.equal(forgot.statusCode, 200, forgot.body);
  jar.take(forgot);
  const recovered = await app.inject({ url: '/auth/callback?code=recovery-code&redirect_to=https://evil.example', headers: { cookie: jar.header() } });
  assert.equal(recovered.statusCode, 303, recovered.body);
  assert.equal(recovered.headers.location, `${frontendOrigin}/#/reset-password`);
  const missing = await app.inject({ url: '/auth/callback?code=confirmation-code&next=https://evil.example' });
  assert.equal(missing.statusCode, 303, missing.body);
  assert.equal(missing.headers.location, `${frontendOrigin}/#/auth/error?reason=missing_flow`);
});

test('hash routing supports relative destinations and rejects unknown modes or non-origin frontend URLs', async t => {
  const { app } = await fixture(t, publicOrigin, undefined, 'hash');
  const missing = await app.inject({ url: '/auth/callback' });
  assert.equal(missing.headers.location, '/#/auth/error?reason=missing_flow');
  const gateway = new SupabaseGateway({ url: projectUrl, publishableKey: 'test-publishable-key', studentEmailDomain: '' });
  const options = { publicOrigin, cookieSecret: 'unit-test-only-cookie-secret-32-characters-minimum' };
  assert.throws(() => new WebAuthService(gateway, { ...options, frontendRouting: 'query' as 'hash' }), /AUTH_FRONTEND_ROUTING/u);
  assert.throws(() => new WebAuthService(gateway, { ...options, frontendRouting: null as unknown as 'hash' }), /AUTH_FRONTEND_ROUTING/u);
  for (const frontendOrigin of ['http://localhost:5173/#/profile', 'https://frontend.example/path', 'https://user:password@frontend.example', 'https://frontend.example?next=evil']) {
    assert.throws(() => new WebAuthService(gateway, { ...options, frontendOrigin, frontendRouting: 'hash' }), /AUTH_FRONTEND_ORIGIN/u);
  }
});
