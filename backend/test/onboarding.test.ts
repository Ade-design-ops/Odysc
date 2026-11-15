import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { Store } from '../src/db.js';
import { pdfFixture } from './fixtures/pdf.js';

const onboardingUrl = '/api/v1/me/onboarding';

async function register(app: FastifyInstance, email: string, role: 'student' | 'organizer' = 'student', name = 'New Student') {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { email, role, name, password: 'OnboardingPass123!' },
  });
  assert.equal(response.statusCode, 201, response.body);
  return { headers: { authorization: `Bearer ${response.json().accessToken}` }, user: response.json().user };
}

async function fixture(t: TestContext) {
  const store = new Store(':memory:');
  const app = await buildApp({ store, logger: false, rateLimit: false, ai: { apiKey: '' } });
  t.after(async () => { await app.close(); store.close(); });
  const student = await register(app, 'new-student@example.com');
  return { store, app, ...student };
}

async function uploadPdf(app: FastifyInstance, headers: { authorization: string }, bytes = pdfFixture({ text: '' })) {
  const boundary = 'onboarding-required-pdf';
  return app.inject({ method: 'POST', url: '/api/v1/me/resume', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="resume.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]) });
}

async function makeComplete(app: FastifyInstance, headers: { authorization: string }) {
  const draft = await app.inject({
    method: 'PATCH', url: onboardingUrl, headers,
    payload: { major: 'Computer Science', academicYear: 'second_year', interests: ['Robotics'] },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  const uploaded = await uploadPdf(app, headers);
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const complete = await app.inject({ method: 'POST', url: `${onboardingUrl}/complete`, headers, payload: {} });
  assert.equal(complete.statusCode, 200, complete.body);
  return complete.json();
}

test('new student onboarding exposes defaults, field guidance, and required progress without a resume', async t => {
  const { app, headers, user } = await fixture(t);
  const response = await app.inject({ url: onboardingUrl, headers });
  assert.equal(response.statusCode, 200, response.body);
  const snapshot = response.json();
  assert.equal(snapshot.user.id, user.id);
  assert.equal(snapshot.user.name, 'New Student');
  assert.equal(snapshot.profile.major, '');
  assert.equal(snapshot.profile.academicYear, null);
  assert.deepEqual(snapshot.profile.interests, []);
  assert.deepEqual(snapshot.profile.goals, []);
  assert.equal(snapshot.resume, null);
  assert.equal(snapshot.onboarding.status, 'not_started');
  assert.equal(snapshot.onboarding.completedAt, null);
  for (const required of ['major', 'academicYear', 'interests', 'resume']) assert.ok(snapshot.onboarding.missingRequiredFields.includes(required));
  for (const optional of ['goals', 'bio', 'skills']) assert.equal(snapshot.onboarding.missingRequiredFields.includes(optional), false);
  assert.ok(Array.isArray(snapshot.onboarding.recommendedFields));
  assert.ok(Array.isArray(snapshot.fields));
  assert.equal(snapshot.fields.find((field: { key: string }) => field.key === 'resume').required, true);
  assert.equal(snapshot.onboarding.recommendedFields.includes('resume'), false);
});

test('partial onboarding drafts trim strings, deduplicate tags, and preserve omitted details', async t => {
  const { app, headers } = await fixture(t);
  const draft = await app.inject({
    method: 'PATCH', url: onboardingUrl, headers,
    payload: {
      name: '  Alex Trojan  ', major: '  Computer Science  ', academicYear: null,
      interests: ['  AI  ', 'ai', ' ', ' Robotics ', 'robotics'],
      skills: [' TypeScript ', 'typescript', ' '],
      goals: [' Meet people ', 'meet PEOPLE', ''], bio: '  I enjoy making useful things.  ',
    },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  const snapshot = draft.json();
  assert.equal(snapshot.user.name, 'Alex Trojan');
  assert.equal(snapshot.profile.major, 'Computer Science');
  assert.deepEqual(snapshot.profile.interests, ['AI', 'Robotics']);
  assert.deepEqual(snapshot.profile.skills, ['TypeScript']);
  assert.deepEqual(snapshot.profile.goals, ['Meet people']);
  assert.equal(snapshot.profile.bio, 'I enjoy making useful things.');
  assert.equal(snapshot.onboarding.status, 'in_progress');
  assert.equal(snapshot.onboarding.completedAt, null);
  const partial = await app.inject({ method: 'PATCH', url: onboardingUrl, headers, payload: { major: '  Data Science  ' } });
  assert.equal(partial.statusCode, 200, partial.body);
  assert.equal(partial.json().profile.major, 'Data Science');
  assert.deepEqual(partial.json().profile.interests, snapshot.profile.interests);
  assert.deepEqual(partial.json().profile.skills, snapshot.profile.skills);
  assert.deepEqual(partial.json().profile.goals, snapshot.profile.goals);
  assert.equal(partial.json().profile.bio, snapshot.profile.bio);
  assert.equal(partial.json().user.name, 'Alex Trojan');
  const me = await app.inject({ url: '/api/v1/auth/me', headers });
  assert.equal(me.json().user.name, 'Alex Trojan');
});

test('completion rejects incomplete required fields and never marks the draft completed', async t => {
  const { app, headers } = await fixture(t);
  let response = await app.inject({ method: 'POST', url: `${onboardingUrl}/complete`, headers, payload: {} });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().error.code, 'MISSING_ONBOARDING_FIELDS');
  const draft = await app.inject({
    method: 'PATCH', url: onboardingUrl, headers,
    payload: { major: ' Computer Science ', academicYear: 'first_year', interests: [] },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  response = await app.inject({ method: 'POST', url: `${onboardingUrl}/complete`, headers, payload: {} });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().error.code, 'MISSING_ONBOARDING_FIELDS');
  const after = await app.inject({ url: onboardingUrl, headers });
  assert.equal(after.json().onboarding.status, 'in_progress');
  assert.equal(after.json().onboarding.completedAt, null);
  assert.ok(after.json().onboarding.missingRequiredFields.includes('interests'));
});

test('required profile fields and a valid PDF complete onboarding without parsed text or optional details', async t => {
  const { app, headers } = await fixture(t);
  const completed = await makeComplete(app, headers);
  assert.equal(completed.onboarding.status, 'completed');
  assert.ok(Number.isFinite(Date.parse(completed.onboarding.completedAt)));
  assert.deepEqual(completed.onboarding.missingRequiredFields, []);
  assert.equal(completed.resume.textStatus, 'unavailable');
  assert.deepEqual(completed.profile.goals, []);
  assert.deepEqual(completed.profile.skills, []);
  assert.equal(completed.profile.bio, '');
  const saved = await app.inject({ url: onboardingUrl, headers });
  assert.equal(saved.json().onboarding.status, 'completed');
  assert.equal(saved.json().onboarding.completedAt, completed.onboarding.completedAt);
  const profile = await app.inject({ url: '/api/v1/me/profile', headers });
  assert.equal(profile.json().profile.academicYear, 'second_year');
  assert.deepEqual(profile.json().profile.interests, ['Robotics']);
});

test('optional edits retain completion and clearing any required profile field invalidates it', async t => {
  const { app, headers } = await fixture(t);
  const completed = await makeComplete(app, headers);
  const optional = await app.inject({
    method: 'PATCH', url: onboardingUrl, headers,
    payload: { bio: 'An optional introduction.', skills: ['Python'], goals: ['Find a community'] },
  });
  assert.equal(optional.statusCode, 200, optional.body);
  assert.equal(optional.json().onboarding.status, 'completed');
  assert.equal(optional.json().onboarding.completedAt, completed.onboarding.completedAt);
  for (const cleared of [{ major: '   ' }, { academicYear: null }, { interests: [] }]) {
    await makeComplete(app, headers);
    const response = await app.inject({ method: 'PATCH', url: onboardingUrl, headers, payload: cleared });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().onboarding.status, 'in_progress');
    assert.equal(response.json().onboarding.completedAt, null);
    assert.ok(response.json().onboarding.missingRequiredFields.length > 0);
    assert.deepEqual(response.json().profile.skills, ['Python']);
    assert.deepEqual(response.json().profile.goals, ['Find a community']);
  }
});

test('onboarding rejects protected metadata, blank names, invalid years, and oversized tag arrays', async t => {
  const { app, headers } = await fixture(t);
  for (const payload of [
    {},
    { studentId: 'someone-else' }, { role: 'organizer' }, { resume: { filename: 'fake.pdf' } },
    { completedAt: '2030-01-01T00:00:00Z' }, { name: '   ' }, { academicYear: 'senior-ish' },
    { interests: Array.from({ length: 21 }, (_, index) => `Interest ${index}`) },
    { skills: Array.from({ length: 31 }, (_, index) => `Skill ${index}`) },
    { goals: Array.from({ length: 11 }, (_, index) => `Goal ${index}`) },
  ]) {
    const response = await app.inject({ method: 'PATCH', url: onboardingUrl, headers, payload });
    assert.equal(response.statusCode, 400, response.body);
  }
  const snapshot = await app.inject({ url: onboardingUrl, headers });
  assert.equal(snapshot.json().user.role, 'student');
  assert.equal(snapshot.json().user.name, 'New Student');
  assert.equal(snapshot.json().onboarding.completedAt, null);
});

test('onboarding requires a student session and keeps separate students isolated', async t => {
  const { app, headers } = await fixture(t);
  const organizer = await register(app, 'onboarding-organizer@example.com', 'organizer', 'Organizer');
  for (const request of [
    { method: 'GET' as const, url: onboardingUrl },
    { method: 'PATCH' as const, url: onboardingUrl, payload: { major: 'Computer Science' } },
    { method: 'POST' as const, url: `${onboardingUrl}/complete`, payload: {} },
  ]) {
    const unauthenticated = await app.inject(request);
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
    const wrongRole = await app.inject({ ...request, headers: organizer.headers });
    assert.equal(wrongRole.statusCode, 403, wrongRole.body);
  }
  const other = await register(app, 'second-student@example.com', 'student', 'Other Student');
  await makeComplete(app, headers);
  const secondSnapshot = await app.inject({ url: onboardingUrl, headers: other.headers });
  assert.equal(secondSnapshot.json().user.name, 'Other Student');
  assert.equal(secondSnapshot.json().profile.major, '');
  assert.equal(secondSnapshot.json().onboarding.status, 'not_started');
  const update = await app.inject({ method: 'PATCH', url: onboardingUrl, headers: other.headers, payload: { major: 'Cinema' } });
  assert.equal(update.statusCode, 200, update.body);
  const firstSnapshot = await app.inject({ url: onboardingUrl, headers });
  assert.equal(firstSnapshot.json().profile.major, 'Computer Science');
  assert.equal(firstSnapshot.json().onboarding.status, 'completed');
});

test('legacy profile data and PUT requests receive new defaults, and clearing interests invalidates onboarding', async t => {
  const { app, headers, store, user } = await fixture(t);
  const legacy = {
    major: 'Physics', graduationYear: 2028, bio: 'An existing profile.',
    interests: ['Astronomy'], skills: ['Python'], experience: 'Built a class project.',
  };
  store.db.prepare('UPDATE profiles SET data=? WHERE student_id=?').run(JSON.stringify(legacy), user.id);
  const snapshot = await app.inject({ url: onboardingUrl, headers });
  assert.equal(snapshot.statusCode, 200, snapshot.body);
  assert.equal(snapshot.json().profile.academicYear, null);
  assert.deepEqual(snapshot.json().profile.goals, []);
  assert.equal(snapshot.json().profile.major, legacy.major);
  const put = await app.inject({ method: 'PUT', url: '/api/v1/me/profile', headers, payload: legacy });
  assert.equal(put.statusCode, 200, put.body);
  assert.equal(put.json().profile.academicYear, null);
  assert.deepEqual(put.json().profile.goals, []);
  await makeComplete(app, headers);
  const goals = await app.inject({ method: 'PATCH', url: onboardingUrl, headers, payload: { goals: ['Meet campus peers'] } });
  assert.equal(goals.statusCode, 200, goals.body);
  const oldPayload = await app.inject({ method: 'PUT', url: '/api/v1/me/profile', headers, payload: legacy });
  assert.equal(oldPayload.statusCode, 200, oldPayload.body);
  assert.equal(oldPayload.json().profile.academicYear, 'second_year');
  assert.deepEqual(oldPayload.json().profile.goals, ['Meet campus peers']);
  const stillComplete = await app.inject({ url: onboardingUrl, headers });
  assert.equal(stillComplete.json().onboarding.status, 'completed');
  const clear = await app.inject({ method: 'PUT', url: '/api/v1/me/profile', headers, payload: { ...legacy, academicYear: 'second_year', goals: [], interests: [] } });
  assert.equal(clear.statusCode, 200, clear.body);
  const after = await app.inject({ url: onboardingUrl, headers });
  assert.equal(after.json().onboarding.status, 'in_progress');
  assert.equal(after.json().onboarding.completedAt, null);
  const unknown = await app.inject({ method: 'PUT', url: '/api/v1/me/profile', headers, payload: { ...legacy, applicationStatus: 'accepted' } });
  assert.equal(unknown.statusCode, 400, unknown.body);
});

test('basics and a failed upload cannot complete onboarding; deleting a valid PDF clears only completion', async t => {
  const { app, headers, store, user } = await fixture(t);
  const draft = await app.inject({ method: 'PATCH', url: onboardingUrl, headers, payload: { major: 'Cinema', academicYear: 'graduate', interests: ['Film'] } });
  assert.equal(draft.statusCode, 200, draft.body);
  assert.deepEqual(draft.json().onboarding.missingRequiredFields, ['resume']);
  const failed = await uploadPdf(app, headers, new Uint8Array(Buffer.from('not a PDF')));
  assert.equal(failed.statusCode, 400, failed.body);
  const blocked = await app.inject({ method: 'POST', url: `${onboardingUrl}/complete`, headers, payload: {} });
  assert.equal(blocked.statusCode, 400, blocked.body);
  assert.equal(blocked.json().error.code, 'MISSING_ONBOARDING_FIELDS');
  assert.match(blocked.json().error.message, /resume/u);
  const completed = await makeComplete(app, headers);
  const profile = completed.profile;
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/me/resume', headers })).statusCode, 204);
  const removed = await app.inject({ url: onboardingUrl, headers });
  assert.equal(removed.json().onboarding.status, 'in_progress');
  assert.equal(removed.json().onboarding.completedAt, null);
  assert.deepEqual(removed.json().onboarding.missingRequiredFields, ['resume']);
  assert.deepEqual(removed.json().profile, profile);
  assert.equal(store.getOnboarding(user.id).completedAt, null);
  assert.equal((await uploadPdf(app, headers)).statusCode, 201);
  const reuploaded = await app.inject({ url: onboardingUrl, headers });
  assert.equal(reuploaded.json().onboarding.status, 'in_progress', 'a new PDF does not restore an old completion timestamp');
});
