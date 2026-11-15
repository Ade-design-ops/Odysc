import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { api, ApiError, setApiActor } from '../../client/src/api.js';

interface CapturedRequest { url: string; options: RequestInit }
function fixture(t: TestContext, respond: (request: CapturedRequest) => Response | Promise<Response> = () => Response.json({})) {
  const previous = globalThis.fetch;
  const calls: CapturedRequest[] = [];
  globalThis.fetch = async (input, options = {}) => {
    const call = { url: String(input), options };
    calls.push(call);
    assert.equal(options.credentials, 'include', 'every browser request includes its cookie session');
    assert.equal(new Headers(options.headers).has('authorization'), false, 'browser code does not copy JWTs into request state');
    return respond(call);
  };
  t.after(() => { globalThis.fetch = previous; setApiActor(null); });
  return calls;
}
const body = (call: CapturedRequest) => JSON.parse(String(call.options.body));

test('frontend auth uses shared cookie endpoints and preserves existing passwords unchanged', async t => {
  const calls = fixture(t);
  await api.login(' student@usc.edu ', 'ninechars', 'student');
  assert.equal(calls[0]!.url, '/api/auth/login');
  assert.deepEqual(body(calls[0]!), { email: 'student@usc.edu', password: 'ninechars', as: 'student' });
  await api.registerOfficer({ name: 'Test Officer', email: ' officer@usc.edu ', password: 'test-password-123', clubId: '42', officerRole: 'President' });
  assert.equal(calls[1]!.url, '/api/auth/register');
  assert.equal(body(calls[1]!).role, 'officer');
  assert.equal(body(calls[1]!).clubId, '42');
  await api.session();
  assert.equal(calls[2]!.url, '/api/session');
});

test('PDF transport sends actual bytes as multipart data without a manually set boundary', async t => {
  const resume = { id: 'saved-pdf-id', fileName: 'resume.pdf', sizeBytes: 19, pageCount: 1, textStatus: 'available', uploadedAt: '2026-11-15T17:00:00Z' };
  const calls = fixture(t, () => Response.json({ needsReview: true, skills: ['TypeScript'], resume }, { status: 201 }));
  const file = new File(['%PDF-unit-test-only'], 'resume.pdf', { type: 'application/pdf' });
  const result = await api.parseResume(file);
  const sent = calls[0]!;
  assert.equal(sent.url, '/api/ai/parse-resume');
  assert.equal(sent.options.method, 'POST');
  assert.ok(sent.options.body instanceof FormData);
  assert.equal(new Headers(sent.options.headers).has('content-type'), false);
  const uploaded = sent.options.body.get('resume');
  assert.ok(uploaded instanceof File);
  assert.equal(uploaded.name, 'resume.pdf');
  assert.equal(await uploaded.text(), '%PDF-unit-test-only');
  assert.equal(result.needsReview, true, 'parsed suggestions require explicit review');
  assert.deepEqual(result.resume, resume, 'completion uses persisted PDF metadata returned after upload');
});

test('own résumé status is a private cookie request and preserves authoritative absent/present metadata', async t => {
  const actor = '11111111-1111-4111-8111-111111111111';
  const resume = { id: 'saved-pdf-id', fileName: 'resume.pdf', sizeBytes: 1200, pageCount: 1, textStatus: 'unavailable', uploadedAt: '2026-11-15T17:00:00Z' };
  let present = true;
  const calls = fixture(t, request => Response.json(request.url === '/api/session'
    ? { account: { role: 'student', email: 'student@usc.edu', name: 'Test Student' }, profile: { id: actor }, resume, workspace: {}, organization: null }
    : { resume: present ? resume : null }));
  setApiActor(actor);
  assert.deepEqual((await api.session()).resume, resume);
  assert.equal(new Headers(calls[0]!.options.headers).has('x-odysc-actor'), false, 'bootstrap does not assume the previous actor');
  assert.deepEqual((await api.resumeStatus()).resume, resume);
  assert.equal(calls[1]!.url, '/api/me/resume/status');
  assert.equal(calls[1]!.options.method, 'GET');
  assert.equal(new Headers(calls[1]!.options.headers).get('x-odysc-actor'), actor);
  assert.equal(calls[1]!.options.body, undefined, 'the authenticated server chooses whose PDF is inspected');
  present = false;
  assert.equal((await api.resumeStatus()).resume, null, 'deleted or absent PDFs are not inferred from a filename or prior upload');
});

test('completion without a persisted PDF remains a visible server error', async t => {
  const calls = fixture(t, () => Response.json({ error: { code: 'RESUME_REQUIRED', message: 'Upload your résumé PDF before completing onboarding.' } }, { status: 400 }));
  setApiActor('11111111-1111-4111-8111-111111111111');
  await assert.rejects(api.completeProfile(), error => error instanceof ApiError && error.status === 400 && error.code === 'RESUME_REQUIRED');
  assert.equal(calls[0]!.url, '/api/me/complete');
  assert.deepEqual(body(calls[0]!), {}, 'the client cannot claim a résumé by sending profile fields');
});

test('native email recovery endpoints keep their API version and confirmation status', async t => {
  const calls = fixture(t, request => Response.json(request.url.endsWith('recovery-session') ? { valid: false } : { message: 'Check your email.' }));
  await api.forgotPassword(' student@usc.edu ');
  await api.resendConfirmation('student@usc.edu');
  const session = await api.recoverySession();
  await api.resetPassword('test-new-password-123');
  assert.deepEqual(calls.map(call => call.url), [
    '/api/v1/auth/forgot-password', '/api/v1/auth/resend-confirmation',
    '/api/v1/auth/recovery-session', '/api/v1/auth/reset-password',
  ]);
  assert.equal(body(calls[0]!).email, 'student@usc.edu');
  assert.equal(session.valid, false);
});

test('application submission sends consent explicitly and never supplies a student identity', async t => {
  const calls = fixture(t, () => Response.json({ application: { id: 'server-application' }, workspace: {} }));
  await api.submitApplication('42', [{ questionId: 'why', text: 'My own answer.' }]);
  assert.equal(calls[0]!.url, '/api/applications');
  assert.deepEqual(body(calls[0]!), { clubId: '42', answers: [{ questionId: 'why', text: 'My own answer.' }], shareUscId: false, rememberAnswers: false });
  await api.submitApplication('42', [], true, true);
  assert.equal(body(calls[1]!).shareUscId, true);
  assert.equal(body(calls[1]!).rememberAnswers, true);
});

test('server failures remain errors instead of becoming empty data or success states', async t => {
  fixture(t, () => Response.json({ error: { code: 'ORGANIZER_ACCESS_REQUIRED', message: 'An approved club membership is required.' } }, { status: 403 }));
  await assert.rejects(api.applicants('42'), error => error instanceof ApiError && error.status === 403 && error.code === 'ORGANIZER_ACCESS_REQUIRED' && error.message.includes('approved'));
});

test('204 sign-out succeeds without JSON and malformed success payloads fail visibly', async t => {
  const calls = fixture(t, request => request.url.endsWith('/logout') ? new Response(null, { status: 204 }) : new Response('not-json', { status: 200 }));
  assert.equal(await api.logout(), undefined);
  assert.equal(calls[0]!.options.method, 'POST');
  await assert.rejects(api.clubs(), error => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
});

test('organization writes identify resources but leave actor and permissions to the server', async t => {
  const calls = fixture(t);
  await api.setScore('server-application-id', { motivation: 4 });
  await api.inviteMember('42', 'reviewer@usc.edu', 'Test Reviewer', 'Member');
  await api.removeMember('42', 'reviewer@usc.edu');
  assert.deepEqual(body(calls[0]!), { scores: { motivation: 4 } });
  assert.equal(body(calls[0]!).reviewerEmail, undefined);
  assert.equal(calls[2]!.url, '/api/clubs/42/team/reviewer%40usc.edu');
  assert.equal(calls[2]!.options.method, 'DELETE');
});

test('member promotion encodes the club path and sends only the trimmed target email with the actor guard', async t => {
  const organization = { teams: { '36288': [{ email: 'reviewer@usc.edu', access: 'admin', status: 'active' }] }, myMembership: { access: 'admin', status: 'active' } };
  const calls = fixture(t, () => Response.json(organization));
  const actor = '11111111-1111-4111-8111-111111111111';
  setApiActor(actor);
  assert.deepEqual(await api.promoteMember('club/id ?#', ' reviewer@usc.edu '), organization);
  assert.equal(calls[0]!.url, '/api/clubs/club%2Fid%20%3F%23/team/promote');
  assert.equal(calls[0]!.options.method, 'POST');
  assert.deepEqual(body(calls[0]!), { email: 'reviewer@usc.edu' });
  assert.equal(new Headers(calls[0]!.options.headers).get('content-type'), 'application/json');
  assert.equal(new Headers(calls[0]!.options.headers).get('x-odysc-actor'), actor);
});

test('member promotion authorization failures reject instead of fabricating administrator access', async t => {
  fixture(t, () => Response.json({ error: { code: 'ORGANIZER_ACCESS_REQUIRED', message: 'An active club administrator is required.' } }, { status: 403 }));
  setApiActor('11111111-1111-4111-8111-111111111111');
  await assert.rejects(api.promoteMember('36288', 'reviewer@usc.edu'), error => error instanceof ApiError && error.status === 403 && error.code === 'ORGANIZER_ACCESS_REQUIRED');
});

test('private requests pin the expected tab actor without attaching identity hints to public auth', async t => {
  const calls = fixture(t);
  const actor = '11111111-1111-4111-8111-111111111111';
  setApiActor(actor);
  await api.saveProfile({ major: 'Computer Science' });
  await api.logout();
  await api.session();
  await api.login('student@usc.edu', 'existing-password', 'student');
  await api.clubs();
  await api.forgotPassword('student@usc.edu');
  assert.equal(new Headers(calls[0]!.options.headers).get('x-odysc-actor'), actor);
  assert.equal(new Headers(calls[1]!.options.headers).get('x-odysc-actor'), actor);
  for (const call of calls.slice(2)) assert.equal(new Headers(call.options.headers).has('x-odysc-actor'), false);
  setApiActor(null);
  await api.me();
  assert.equal(new Headers(calls.at(-1)!.options.headers).has('x-odysc-actor'), false);
});

test('session-change failures retain only the request actor so late responses can be discarded', async t => {
  fixture(t, () => Response.json({ error: { code: 'SESSION_CHANGED', message: 'Your account changed. Sign in again.' } }, { status: 409 }));
  setApiActor('11111111-1111-4111-8111-111111111111');
  await assert.rejects(api.saveProfile({ major: 'Computer Science' }), error => error instanceof ApiError && error.code === 'SESSION_CHANGED' && error.actorId === '11111111-1111-4111-8111-111111111111');
});

test('event publication posts the real event with the expected actor while event reads remain public', async t => {
  const input = {
    clubId: '36288', title: 'NSBE info session', kind: 'Info session' as const,
    start: '2026-11-15T02:00:00.000Z', durationMin: 60, buildingCode: 'SAL', room: '101',
  };
  const persisted = { ...input, id: 'server-event-id' };
  const calls = fixture(t, request => Response.json(request.options.method === 'POST' ? persisted : [persisted]));
  const actor = '11111111-1111-4111-8111-111111111111';
  setApiActor(actor);
  assert.deepEqual(await api.createEvent(input), persisted);
  assert.equal(calls[0]!.url, '/api/events');
  assert.equal(calls[0]!.options.method, 'POST');
  assert.deepEqual(body(calls[0]!), input);
  assert.equal(new Headers(calls[0]!.options.headers).get('content-type'), 'application/json');
  assert.equal(new Headers(calls[0]!.options.headers).get('x-odysc-actor'), actor);
  assert.deepEqual(await api.events(), [persisted]);
  assert.equal(calls[1]!.url, '/api/events');
  assert.equal(calls[1]!.options.method, 'GET');
  assert.equal(new Headers(calls[1]!.options.headers).has('x-odysc-actor'), false);
});

test('event editing sends only the partial update to an encoded event path with the expected actor', async t => {
  const patch = { title: 'Updated NSBE info session', start: '2026-11-16T02:00:00.000Z', room: '202' };
  const persisted = { id: 'event/id ?#', clubId: '36288', kind: 'Info session', durationMin: 60, buildingCode: 'SAL', ...patch };
  const calls = fixture(t, () => Response.json(persisted));
  const actor = '11111111-1111-4111-8111-111111111111';
  setApiActor(actor);
  assert.deepEqual(await api.updateEvent(persisted.id, patch), persisted);
  assert.equal(calls[0]!.url, '/api/events/event%2Fid%20%3F%23');
  assert.equal(calls[0]!.options.method, 'PATCH');
  assert.deepEqual(body(calls[0]!), patch);
  assert.equal('clubId' in body(calls[0]!), false, 'editing never supplies a replacement club');
  assert.equal('id' in body(calls[0]!), false, 'editing retains the existing event ID');
  assert.equal(new Headers(calls[0]!.options.headers).get('content-type'), 'application/json');
  assert.equal(new Headers(calls[0]!.options.headers).get('x-odysc-actor'), actor);
});

test('event edit authorization failures reject without returning a fabricated updated event', async t => {
  fixture(t, () => Response.json({ error: { code: 'ORGANIZER_ACCESS_REQUIRED', message: 'An active club administrator is required.' } }, { status: 403 }));
  setApiActor('11111111-1111-4111-8111-111111111111');
  await assert.rejects(api.updateEvent('server-event-id', { room: '202' }), error => error instanceof ApiError && error.status === 403 && error.code === 'ORGANIZER_ACCESS_REQUIRED');
});


test('late private responses cannot cross into another signed-in account, including logout', async t => {
  let release!: (response: Response) => void;
  fixture(t, () => new Promise<Response>(resolve => { release = resolve; }));
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  for (const [index, operation] of [() => api.me(), () => api.logout()].entries()) {
    setApiActor(first);
    const pending = operation();
    setApiActor(second);
    release(index ? new Response(null, { status: 204 }) : Response.json({ privateValue: 'first-account-only' }));
    await assert.rejects(pending, error => error instanceof ApiError && error.code === 'SESSION_CHANGED' && error.actorId === first);
  }
});

test('an account change during private JSON parsing discards the old payload', async t => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  fixture(t, () => {
    const response = Response.json({});
    response.json = async () => { setApiActor(second); return { privateValue: 'first-account-only' }; };
    return response;
  });
  setApiActor(first);
  await assert.rejects(api.me(), error => error instanceof ApiError && error.code === 'SESSION_CHANGED' && error.actorId === first);
});

test('club finder sends cookie-authenticated history and a PDF revision hint without copying private profile or document data', async t => {
  const reply = { reply: 'Try this club.', matches: [{ clubId: '1', name: 'USC Robotics Club', reason: 'Robotics projects fit your interests.', fit: 'strong' }] };
  const calls = fixture(t, () => Response.json(reply));
  const actor = '11111111-1111-4111-8111-111111111111';
  const resumeId = '77777777-7777-4777-8777-777777777777';
  setApiActor(actor);
  assert.deepEqual(await api.clubFinder(), reply);
  assert.equal(calls[0]!.url, '/api/club-finder');
  assert.equal(calls[0]!.options.method, 'POST');
  assert.deepEqual(body(calls[0]!), {});
  assert.equal(new Headers(calls[0]!.options.headers).get('x-odysc-actor'), actor);
  await api.clubFinder({ history: [
    { role: 'assistant', content: 'What would you like to try?' },
    { role: 'user', content: 'Robotics projects.' },
  ], resumeId });
  assert.deepEqual(body(calls[1]!), { history: [
    { role: 'assistant', content: 'What would you like to try?' },
    { role: 'user', content: 'Robotics projects.' },
  ], resumeId });
  assert.equal(new Headers(calls[1]!.options.headers).get('content-type'), 'application/json');
  assert.equal(new Headers(calls[1]!.options.headers).get('x-odysc-actor'), actor);
  for (const forbidden of ['profile', 'resume', 'summary', 'studentId', 'clubs']) assert.equal(forbidden in body(calls[1]!), false);
});

test('club finder service and stale-PDF failures stay visible instead of becoming fabricated matches', async t => {
  let status = 503;
  fixture(t, () => Response.json({ error: { code: status === 503 ? 'AI_NOT_CONFIGURED' : 'RESUME_CHANGED', message: 'Club finder is unavailable.' } }, { status }));
  setApiActor('11111111-1111-4111-8111-111111111111');
  await assert.rejects(api.clubFinder(), error => error instanceof ApiError && error.status === 503);
  status = 409;
  await assert.rejects(api.clubFinder(), error => error instanceof ApiError && error.status === 409 && error.code === 'RESUME_CHANGED');
});

test('a late club finder response cannot populate another account conversation', async t => {
  let release!: (response: Response) => void;
  fixture(t, () => new Promise<Response>(resolve => { release = resolve; }));
  const first = '11111111-1111-4111-8111-111111111111';
  setApiActor(first);
  const pending = api.clubFinder();
  setApiActor('22222222-2222-4222-8222-222222222222');
  release(Response.json({ reply: 'Private previous-account reply.', matches: [] }));
  await assert.rejects(pending, error => error instanceof ApiError && error.code === 'SESSION_CHANGED' && error.actorId === first);
});
