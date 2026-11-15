import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { Store } from '../src/db.js';
import { seedDemo } from '../src/seed.js';
import { pdfFixture } from './fixtures/pdf.js';

const password = 'DemoPass123!';
const validAnswers = {
  'why-join': 'I want to build useful campus tools with other students.',
  experience: 'I built a study group website with classmates.',
};

async function fixture(t: TestContext) {
  const store = new Store(':memory:');
  const app = await buildApp({ store, logger: false, rateLimit: false, ai: { apiKey: '' } });
  t.after(async () => { await app.close(); store.close(); });
  await seedDemo(store);
  return { app, store };
}

async function login(app: FastifyInstance, email = 'student@example.com') {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  assert.equal(response.statusCode, 200, response.body);
  return { authorization: `Bearer ${response.json().accessToken}` };
}

async function register(app: FastifyInstance, email: string, role: 'student' | 'organizer' = 'student') {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email, name: 'Another Trojan', role, password } });
  assert.equal(response.statusCode, 201, response.body);
  return { headers: { authorization: `Bearer ${response.json().accessToken}` }, user: response.json().user };
}

async function draft(app: FastifyInstance, headers: { authorization: string }, answers = validAnswers, clubId = 'club-demo-makers') {
  const response = await app.inject({ method: 'POST', url: '/api/v1/me/applications', headers, payload: { clubId, answers } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().application;
}

test('auth validates registration, denies wrong credentials, enforces roles, and revokes a logged-out session', async t => {
  const { app } = await fixture(t);
  for (const payload of [
    { email: 'new@example.com', name: 'New Trojan', password, role: 'admin' },
    { email: 'new@example.com', name: '   ', password, role: 'student' },
    { email: 'new@example.com', name: 'New Trojan', password: 'short', role: 'student' },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
    assert.equal(response.statusCode, 400, response.body);
  }
  const { headers, user } = await register(app, 'NewTrojan@Example.com');
  assert.equal(user.email, 'newtrojan@example.com');
  assert.equal(user.role, 'student');
  assert.equal('passwordHash' in user, false);
  const duplicate = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'NEWTROJAN@example.com', name: 'Duplicate', role: 'organizer', password } });
  assert.equal(duplicate.statusCode, 409, duplicate.body);
  for (const email of ['newtrojan@example.com', 'missing@example.com']) {
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'WrongPassword123!' } });
    assert.equal(wrong.statusCode, 401, wrong.body);
    assert.equal(wrong.json().error.message, 'Email or password is incorrect.');
  }
  const again = await login(app, 'NEWTROJAN@example.com');
  assert.equal((await app.inject({ url: '/api/v1/auth/me', headers })).json().user.id, user.id);
  assert.equal((await app.inject('/api/v1/auth/me')).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/v1/organizer/clubs', headers })).statusCode, 403);
  const organizer = await login(app, 'organizer@example.com');
  assert.equal((await app.inject({ url: '/api/v1/me/profile', headers: organizer })).statusCode, 403);
  const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers });
  assert.equal(logout.statusCode, 204, logout.body);
  assert.equal((await app.inject({ url: '/api/v1/auth/me', headers })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: again })).statusCode, 200, 'logging out one session preserves other sessions');
});

test('saved answers and profiles stay private across students, including answer changes and suggestions', async t => {
  const { app } = await fixture(t);
  const first = await login(app);
  const { headers: second } = await register(app, 'second-student@example.com');
  const own = await app.inject({ url: '/api/v1/me/answers', headers: first });
  assert.equal(own.json().answers.length, 2);
  const privateId = own.json().answers[0].id;
  const secondAnswers = await app.inject({ url: '/api/v1/me/answers', headers: second });
  assert.deepEqual(secondAnswers.json().answers, []);
  const suggested = await app.inject({ method: 'POST', url: '/api/v1/me/answers/suggest', headers: second, payload: { question: own.json().answers[0].question } });
  assert.equal(suggested.statusCode, 200, suggested.body);
  assert.equal(suggested.json().answer, '');
  assert.deepEqual(suggested.json().sourceAnswerIds, []);
  const overwrite = await app.inject({ method: 'PUT', url: `/api/v1/me/answers/${privateId}`, headers: second, payload: { question: 'Private?', answer: 'Overwritten' } });
  assert.equal(overwrite.statusCode, 404, overwrite.body);
  const remove = await app.inject({ method: 'DELETE', url: `/api/v1/me/answers/${privateId}`, headers: second });
  assert.equal(remove.statusCode, 404, remove.body);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/answers', headers: first })).json().answers, own.json().answers);
  const firstProfile = (await app.inject({ url: '/api/v1/me/profile', headers: first })).json().profile;
  const secondProfile = (await app.inject({ url: '/api/v1/me/profile', headers: second })).json().profile;
  assert.equal(firstProfile.major, 'Computer Science');
  assert.equal(secondProfile.major, '');
  const created = await app.inject({ method: 'POST', url: '/api/v1/me/answers', headers: second, payload: { question: 'What did you build?', answer: 'A campus app.' } });
  assert.equal(created.statusCode, 201, created.body);
  const ownUpdate = await app.inject({ method: 'PUT', url: `/api/v1/me/answers/${created.json().answer.id}`, headers: second, payload: { question: 'What did you build?', answer: 'A study group app.' } });
  assert.equal(ownUpdate.statusCode, 200, ownUpdate.body);
  assert.equal(ownUpdate.json().answer.answer, 'A study group app.');
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/me/answers/${created.json().answer.id}`, headers: second })).statusCode, 204);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/answers', headers: second })).json().answers, []);
});

test('profile extraction and answer suggestions require review and do not save data', async t => {
  const { app } = await fixture(t);
  const headers = await login(app);
  const before = (await app.inject({ url: '/api/v1/me/profile', headers })).json().profile;
  const savedAnswers = (await app.inject({ url: '/api/v1/me/answers', headers })).json().answers;
  const parsed = await app.inject({ method: 'POST', url: '/api/v1/me/profile/parse', headers, payload: { text: 'Major: Architecture\nSkills: Sketching\nInterests: design' } });
  assert.equal(parsed.statusCode, 200, parsed.body);
  assert.equal(parsed.json().mode, 'local');
  assert.equal(parsed.json().needsReview, true);
  assert.equal(parsed.json().profile.major, 'Architecture');
  assert.deepEqual((await app.inject({ url: '/api/v1/me/profile', headers })).json().profile, before);
  const suggestion = await app.inject({ method: 'POST', url: '/api/v1/me/answers/suggest', headers, payload: { question: savedAnswers[0].question } });
  assert.equal(suggestion.statusCode, 200, suggestion.body);
  assert.equal(suggestion.json().needsReview, true);
  assert.equal(suggestion.json().answer, savedAnswers[0].answer);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/answers', headers })).json().answers, savedAnswers);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/applications', headers })).json().applications, []);
  const boundary = 'native-match-pdf';
  const uploaded = await app.inject({ method: 'POST', url: '/api/v1/me/resume', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="resume.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), Buffer.from(pdfFixture({ text: '' })), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]) });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const matches = await app.inject({ method: 'POST', url: '/api/v1/me/matches', headers });
  assert.equal(matches.statusCode, 200, matches.body);
  assert.equal(matches.json().mode, 'local');
  assert.ok(matches.json().matches.every((match: { clubId: string; club: { id: string } }) => match.clubId === match.club.id));
});

test('drafts stay private and reject duplicate applications, unknown questions, long answers, and missing required answers', async t => {
  const { app } = await fixture(t);
  const student = await login(app);
  const owner = await login(app, 'organizer@example.com');
  const { headers: second } = await register(app, 'private-drafts@example.com');
  for (const answers of [{ unknown: 'Unexpected answer' }, { 'why-join': 'a'.repeat(1501) }]) {
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/me/applications', headers: student, payload: { clubId: 'club-demo-makers', answers } });
    assert.equal(invalid.statusCode, 400, invalid.body);
  }
  const created = await app.inject({ method: 'POST', url: '/api/v1/me/applications', headers: student, payload: { clubId: 'club-demo-makers' } });
  assert.equal(created.statusCode, 201, created.body);
  const application = created.json().application;
  assert.equal(application.status, 'draft');
  assert.equal(application.profileSnapshot, null);
  assert.equal(application.submittedAt, null);
  const duplicate = await app.inject({ method: 'POST', url: '/api/v1/me/applications', headers: student, payload: { clubId: 'club-demo-makers' } });
  assert.equal(duplicate.statusCode, 409, duplicate.body);
  assert.deepEqual((await app.inject({ url: '/api/v1/clubs/club-demo-makers/applications', headers: owner })).json().applications, []);
  assert.equal((await app.inject({ url: `/api/v1/me/applications/${application.id}`, headers: second })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PUT', url: `/api/v1/me/applications/${application.id}`, headers: second, payload: { answers: validAnswers } })).statusCode, 404);
  const missing = await app.inject({ method: 'POST', url: `/api/v1/me/applications/${application.id}/submit`, headers: student, payload: { rememberAnswers: false } });
  assert.equal(missing.statusCode, 400, missing.body);
  assert.equal(missing.json().error.code, 'MISSING_ANSWERS');
  const whitespace = await app.inject({ method: 'PUT', url: `/api/v1/me/applications/${application.id}`, headers: student, payload: { answers: { 'why-join': '   ', experience: '   ' } } });
  assert.equal(whitespace.statusCode, 200, whitespace.body);
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/me/applications/${application.id}/submit`, headers: student, payload: {} })).statusCode, 400);
  assert.deepEqual((await app.inject({ url: '/api/v1/clubs/club-demo-makers/applications', headers: owner })).json().applications, []);
});

test('submission freezes the reviewed profile, defaults to no answer memory, and prevents later edits or duplicate submission', async t => {
  const { app } = await fixture(t);
  const student = await login(app);
  const owner = await login(app, 'organizer@example.com');
  const beforeProfile = (await app.inject({ url: '/api/v1/me/profile', headers: student })).json().profile;
  const beforeAnswers = (await app.inject({ url: '/api/v1/me/answers', headers: student })).json().answers;
  const application = await draft(app, student, { ...validAnswers, experience: 'This answer must not be silently remembered.' });
  const submitted = await app.inject({ method: 'POST', url: `/api/v1/me/applications/${application.id}/submit`, headers: student, payload: {} });
  assert.equal(submitted.statusCode, 200, submitted.body);
  assert.equal(submitted.json().application.status, 'submitted');
  assert.ok(submitted.json().application.submittedAt);
  assert.deepEqual(submitted.json().application.profileSnapshot, beforeProfile);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/answers', headers: student })).json().answers, beforeAnswers);
  const profileEdit = await app.inject({ method: 'PUT', url: '/api/v1/me/profile', headers: student, payload: { ...beforeProfile, major: 'Architecture', bio: 'A later edit.' } });
  assert.equal(profileEdit.statusCode, 200, profileEdit.body);
  const reviewed = await app.inject({ url: '/api/v1/clubs/club-demo-makers/applications', headers: owner });
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  assert.equal(reviewed.json().applications.length, 1);
  assert.deepEqual(reviewed.json().applications[0].profileSnapshot, beforeProfile);
  assert.equal(reviewed.json().applications[0].student.email, 'student@example.com');
  const edit = await app.inject({ method: 'PUT', url: `/api/v1/me/applications/${application.id}`, headers: student, payload: { answers: validAnswers } });
  assert.equal(edit.statusCode, 409, edit.body);
  assert.equal(edit.json().error.code, 'APPLICATION_LOCKED');
  const resubmit = await app.inject({ method: 'POST', url: `/api/v1/me/applications/${application.id}/submit`, headers: student, payload: { rememberAnswers: true } });
  assert.equal(resubmit.statusCode, 409, resubmit.body);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/answers', headers: student })).json().answers, beforeAnswers);
});

test('rememberAnswers only saves nonempty application answers after explicit submission consent', async t => {
  const { app } = await fixture(t);
  const { headers } = await register(app, 'remember-consent@example.com');
  const application = await draft(app, headers, { ...validAnswers, 'anything-else': '   ' });
  assert.deepEqual((await app.inject({ url: '/api/v1/me/answers', headers })).json().answers, []);
  const submitted = await app.inject({ method: 'POST', url: `/api/v1/me/applications/${application.id}/submit`, headers, payload: { rememberAnswers: true } });
  assert.equal(submitted.statusCode, 200, submitted.body);
  const library = (await app.inject({ url: '/api/v1/me/answers', headers })).json().answers;
  assert.equal(library.length, 2);
  assert.deepEqual(new Set(library.map((answer: { answer: string }) => answer.answer)), new Set(Object.values(validAnswers)));
  assert.ok(library.every((answer: { question: string }) => answer.question !== 'Anything else you would like us to know?'));
  const second = await draft(app, headers, { ...validAnswers, experience: 'A newly reviewed project answer.' }, 'club-demo-design');
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/me/applications/${second.id}/submit`, headers, payload: { rememberAnswers: true } })).statusCode, 200);
  const updated = (await app.inject({ url: '/api/v1/me/answers', headers })).json().answers;
  assert.equal(updated.length, 2, 'same saved question is updated instead of duplicated');
  assert.ok(updated.some((answer: { answer: string }) => answer.answer === 'A newly reviewed project answer.'));
});

test('only the owning organizer can review submitted applications and final decisions are immutable', async t => {
  const { app } = await fixture(t);
  const student = await login(app);
  const owner = await login(app, 'organizer@example.com');
  const { headers: other } = await register(app, 'other-reviewer@example.com', 'organizer');
  const application = await draft(app, student);
  const statusUrl = `/api/v1/applications/${application.id}/status`;
  const privateDraft = await app.inject({ method: 'PATCH', url: statusUrl, headers: owner, payload: { status: 'accepted' } });
  assert.equal(privateDraft.statusCode, 404, privateDraft.body);
  assert.equal((await app.inject({ url: '/api/v1/clubs/club-demo-makers/applications', headers: other })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url: statusUrl, headers: other, payload: { status: 'accepted' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/me/applications/${application.id}/submit`, headers: student, payload: { rememberAnswers: false } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: statusUrl, headers: student, payload: { status: 'accepted' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url: statusUrl, headers: other, payload: { status: 'accepted' } })).statusCode, 403);
  const reviewing = await app.inject({ method: 'PATCH', url: statusUrl, headers: owner, payload: { status: 'reviewing' } });
  assert.equal(reviewing.statusCode, 200, reviewing.body);
  assert.equal(reviewing.json().application.status, 'reviewing');
  const accepted = await app.inject({ method: 'PATCH', url: statusUrl, headers: owner, payload: { status: 'accepted' } });
  assert.equal(accepted.statusCode, 200, accepted.body);
  for (const status of ['rejected', 'reviewing']) {
    const changed = await app.inject({ method: 'PATCH', url: statusUrl, headers: owner, payload: { status } });
    assert.equal(changed.statusCode, 409, changed.body);
    assert.equal(changed.json().error.code, 'FINAL_DECISION');
  }
  const repeated = await app.inject({ method: 'PATCH', url: statusUrl, headers: owner, payload: { status: 'accepted' } });
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal((await app.inject({ url: `/api/v1/me/applications/${application.id}`, headers: student })).json().application.status, 'accepted');
});

test('closed recruitment, expired deadlines, and tightened question limits are checked again on submission', async t => {
  const { app, store } = await fixture(t);
  const headers = await login(app);
  const application = await draft(app, headers);
  const original = store.getClub('club-demo-makers')!;
  store.saveClub({ ...original, applicationDeadline: '2000-01-01T00:00:00.000Z' });
  for (const method of ['PUT', 'POST'] as const) {
    const response = await app.inject({ method, url: `/api/v1/me/applications/${application.id}${method === 'POST' ? '/submit' : ''}`, headers, payload: method === 'POST' ? { rememberAnswers: false } : { answers: validAnswers } });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error.code, 'DEADLINE_PASSED');
  }
  const expiredStart = await app.inject({ method: 'POST', url: '/api/v1/me/applications', headers, payload: { clubId: original.id } });
  assert.equal(expiredStart.statusCode, 409, expiredStart.body);
  store.saveClub({ ...original, acceptingApplications: false });
  const closed = await app.inject({ method: 'POST', url: `/api/v1/me/applications/${application.id}/submit`, headers, payload: { rememberAnswers: false } });
  assert.equal(closed.statusCode, 409, closed.body);
  assert.equal(closed.json().error.code, 'APPLICATIONS_CLOSED');
  store.saveClub({ ...original, questions: original.questions.map(question => ({ ...question, maxLength: 10 })) });
  const tooLong = await app.inject({ method: 'POST', url: `/api/v1/me/applications/${application.id}/submit`, headers, payload: { rememberAnswers: false } });
  assert.equal(tooLong.statusCode, 400, tooLong.body);
  assert.equal(tooLong.json().error.code, 'INVALID_ANSWERS');
  assert.equal((await app.inject({ url: `/api/v1/me/applications/${application.id}`, headers })).json().application.status, 'draft');
});
