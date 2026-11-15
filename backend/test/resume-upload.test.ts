import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { Store } from '../src/db.js';
import { seedDemo } from '../src/seed.js';
import { MAX_RESUME_BYTES, MAX_RESUME_PAGES } from '../src/resume.js';
import { pdfFixture } from './fixtures/pdf.js';

type AuthHeaders = { authorization: string };
interface FormPart {
  name: string;
  bytes: Uint8Array;
  fileName?: string;
  mimeType?: string;
}

function multipart(parts: FormPart[]) {
  const boundary = 'odysc-resume-integration-boundary';
  const buffers: Buffer[] = [];
  for (const part of parts) {
    const disposition = `Content-Disposition: form-data; name="${part.name}"${part.fileName === undefined ? '' : `; filename="${part.fileName}"`}`;
    buffers.push(Buffer.from(`--${boundary}\r\n${disposition}\r\n${part.mimeType ? `Content-Type: ${part.mimeType}\r\n` : ''}\r\n`));
    buffers.push(Buffer.from(part.bytes));
    buffers.push(Buffer.from('\r\n'));
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, payload: Buffer.concat(buffers) };
}

async function upload(app: FastifyInstance, headers: AuthHeaders | undefined, parts: FormPart[]) {
  const form = multipart(parts);
  return app.inject({ method: 'POST', url: '/api/v1/me/resume', headers: { ...headers, 'content-type': form.contentType }, payload: form.payload });
}

function pdfPart(bytes = pdfFixture(), fileName = 'student-resume.pdf'): FormPart {
  return { name: 'resume', fileName, mimeType: 'application/pdf', bytes };
}

async function fixture(t: TestContext) {
  const store = new Store(':memory:');
  const app = await buildApp({ store, logger: false, rateLimit: false, ai: { apiKey: '' } });
  t.after(async () => { await app.close(); store.close(); });
  await seedDemo(store);
  return { app, store };
}

async function login(app: FastifyInstance, email = 'student@example.com'): Promise<AuthHeaders> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'DemoPass123!' } });
  assert.equal(response.statusCode, 200, response.body);
  return { authorization: `Bearer ${response.json().accessToken}` };
}

async function register(app: FastifyInstance, email: string): Promise<AuthHeaders> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email, name: 'A New Trojan', role: 'student', password: 'DemoPass123!' } });
  assert.equal(response.statusCode, 201, response.body);
  return { authorization: `Bearer ${response.json().accessToken}` };
}

test('PDF upload and replacement preserve exact private downloads and return only metadata in onboarding', async t => {
  const { app } = await fixture(t);
  const headers = await login(app);
  const profileBefore = (await app.inject({ url: '/api/v1/me/profile', headers })).json().profile;
  const original = pdfFixture({ text: 'PRIVATE_RESUME_TEXT_9281 - Python and robotics', paddingBytes: 150_000 });
  assert.ok(original.byteLength > 128 * 1024, 'exercise multipart above the default JSON body limit');
  const created = await upload(app, headers, [pdfPart(original)]);
  assert.equal(created.statusCode, 201, created.body);
  const info = created.json().resume;
  assert.equal(info.mimeType, 'application/pdf');
  assert.equal(info.sizeBytes, original.byteLength);
  assert.equal(info.pageCount, 1);
  assert.equal(info.textStatus, 'available');
  const downloaded = await app.inject({ url: '/api/v1/me/resume', headers });
  assert.equal(downloaded.statusCode, 200, downloaded.body);
  assert.equal(downloaded.headers['content-type'], 'application/pdf');
  assert.equal(downloaded.headers['cache-control'], 'private, no-store');
  assert.equal(downloaded.headers['x-content-type-options'], 'nosniff');
  assert.match(downloaded.headers['content-disposition']!, /^attachment;/);
  assert.deepEqual(downloaded.rawPayload, Buffer.from(original));
  const onboarding = await app.inject({ url: '/api/v1/me/onboarding', headers });
  assert.equal(onboarding.statusCode, 200, onboarding.body);
  assert.deepEqual(onboarding.json().resume, info);
  assert.equal(onboarding.body.includes('PRIVATE_RESUME_TEXT_9281'), false);
  assert.equal('bytes' in onboarding.json().resume, false);
  assert.equal('text' in onboarding.json().resume, false);
  assert.deepEqual(onboarding.json().profile, profileBefore, 'upload must preserve entered profile fields');
  const replacement = pdfFixture({ text: 'An updated campus project résumé.' });
  const replaced = await upload(app, headers, [pdfPart(replacement, 'student draft (revised).pdf')]);
  assert.equal(replaced.statusCode, 201, replaced.body);
  assert.notEqual(replaced.json().resume.id, info.id);
  assert.equal(replaced.json().resume.fileName, 'student draft (revised).pdf');
  assert.equal(replaced.json().resume.sizeBytes, replacement.byteLength);
  const redownloaded = await app.inject({ url: '/api/v1/me/resume', headers });
  assert.deepEqual(redownloaded.rawPayload, Buffer.from(replacement));
  assert.match(redownloaded.headers['content-disposition']!, /student%20draft%20%28revised%29\.pdf/);
});

test('resume endpoints require student authentication and never expose another student upload', async t => {
  const { app } = await fixture(t);
  const owner = await login(app);
  const organizer = await login(app, 'organizer@example.com');
  const second = await register(app, 'other-resume-owner@example.com');
  assert.equal((await upload(app, owner, [pdfPart()])).statusCode, 201);
  for (const [headers, statusCode] of [[undefined, 401], [organizer, 403]] as const) {
    assert.equal((await upload(app, headers, [pdfPart()])).statusCode, statusCode);
    assert.equal((await app.inject({ url: '/api/v1/me/resume', headers })).statusCode, statusCode);
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/me/resume', headers })).statusCode, statusCode);
  }
  assert.equal((await app.inject({ url: '/api/v1/me/resume', headers: second })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/v1/me/resume?studentId=student-demo', headers: second })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/v1/me/onboarding', headers: second })).json().resume, null);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/me/resume', headers: second })).statusCode, 404);
  const secondPdf = pdfFixture({ text: 'Different private resume.' });
  assert.equal((await upload(app, second, [pdfPart(secondPdf)])).statusCode, 201);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/resume', headers: second })).rawPayload, Buffer.from(secondPdf));
  assert.notDeepEqual((await app.inject({ url: '/api/v1/me/resume', headers: owner })).rawPayload, Buffer.from(secondPdf));
});

test('resume remains optional and deleting a textless PDF preserves completed onboarding', async t => {
  const { app } = await fixture(t);
  const headers = await register(app, 'optional-resume@example.com');
  const patch = await app.inject({ method: 'PATCH', url: '/api/v1/me/onboarding', headers, payload: { academicYear: 'first_year', major: 'Undeclared', interests: ['Still exploring'] } });
  assert.equal(patch.statusCode, 200, patch.body);
  const completed = await app.inject({ method: 'POST', url: '/api/v1/me/onboarding/complete', headers, payload: {} });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json().onboarding.status, 'completed');
  assert.equal(completed.json().resume, null);
  const created = await upload(app, headers, [pdfPart(pdfFixture({ text: '' }))]);
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().resume.textStatus, 'unavailable');
  assert.match(created.json().notice, /add interests and skills manually/);
  const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/me/resume', headers });
  assert.equal(deleted.statusCode, 204, deleted.body);
  assert.equal((await app.inject({ url: '/api/v1/me/resume', headers })).statusCode, 404);
  const after = await app.inject({ url: '/api/v1/me/onboarding', headers });
  assert.equal(after.json().resume, null);
  assert.equal(after.json().onboarding.status, 'completed');
  assert.equal(after.json().onboarding.completedAt, completed.json().onboarding.completedAt);
  assert.deepEqual(after.json().onboarding.missingRequiredFields, []);
  assert.ok(after.json().onboarding.recommendedFields.includes('resume'));
  assert.deepEqual(after.json().profile, completed.json().profile);
});

test('invalid MIME, extension, header, malformed, oversized, and over-page PDFs preserve the last valid resume', async t => {
  const { app } = await fixture(t);
  const headers = await login(app);
  const previous = pdfFixture({ text: 'Preserve this reviewed resume.' });
  const original = await upload(app, headers, [pdfPart(previous)]);
  assert.equal(original.statusCode, 201, original.body);
  const tooLarge = new Uint8Array(MAX_RESUME_BYTES + 1);
  tooLarge.set(Buffer.from('%PDF-1.7'));
  const invalid: Array<{ part: FormPart; statusCode: number }> = [
    { part: { ...pdfPart(), mimeType: 'text/plain' }, statusCode: 400 },
    { part: pdfPart(pdfFixture(), 'resume.txt'), statusCode: 400 },
    { part: pdfPart(new Uint8Array(Buffer.from('not a PDF'))), statusCode: 400 },
    { part: pdfPart(new Uint8Array(Buffer.from('%PDF-1.7\nnot a valid document'))), statusCode: 422 },
    { part: pdfPart(tooLarge), statusCode: 413 },
    { part: pdfPart(pdfFixture({ pageCount: MAX_RESUME_PAGES + 1 })), statusCode: 422 },
  ];
  for (const { part, statusCode } of invalid) {
    const response = await upload(app, headers, [part]);
    assert.equal(response.statusCode, statusCode, response.body);
    assert.ok(response.json().error.code);
    assert.deepEqual((await app.inject({ url: '/api/v1/me/resume', headers })).rawPayload, Buffer.from(previous));
    assert.equal((await app.inject({ url: '/api/v1/me/onboarding', headers })).json().resume.id, original.json().resume.id);
  }
});

test('wrong multipart fields, extra form data, and multiple files fail without partially saving', async t => {
  const { app } = await fixture(t);
  const headers = await login(app);
  const cases = [
    [{ ...pdfPart(), name: 'document' }],
    [pdfPart(), { name: 'major', bytes: new Uint8Array(Buffer.from('Computer Science')) }],
    [pdfPart(), pdfPart(pdfFixture({ text: 'Second file' }), 'second.pdf')],
    [{ name: 'resume', bytes: new Uint8Array(Buffer.from('not a file')) }],
  ];
  for (const parts of cases) {
    const response = await upload(app, headers, parts);
    assert.ok(response.statusCode >= 400 && response.statusCode < 500, response.body);
    assert.equal((await app.inject({ url: '/api/v1/me/resume', headers })).statusCode, 404);
    assert.equal((await app.inject({ url: '/api/v1/me/onboarding', headers })).json().resume, null);
  }
  const previous = pdfFixture({ text: 'A valid prior resume.' });
  assert.equal((await upload(app, headers, [pdfPart(previous)])).statusCode, 201);
  const failedReplacement = await upload(app, headers, [pdfPart(), pdfPart()]);
  assert.ok(failedReplacement.statusCode >= 400 && failedReplacement.statusCode < 500, failedReplacement.body);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/resume', headers })).rawPayload, Buffer.from(previous));
});

test('resume text improves local club matches without saving profile fields, answers, or applications, and deletion removes its influence', async t => {
  const { app } = await fixture(t);
  const headers = await register(app, 'resume-matching@example.com');
  const profileBefore = (await app.inject({ url: '/api/v1/me/profile', headers })).json().profile;
  const baseline = await app.inject({ method: 'POST', url: '/api/v1/me/matches', headers });
  assert.equal(baseline.statusCode, 200, baseline.body);
  assert.equal(baseline.json().mode, 'local');
  assert.ok(baseline.json().matches.every((match: { score: number }) => match.score === 0));
  const created = await upload(app, headers, [pdfPart(pdfFixture({ text: 'I built robotics projects using engineering, Python, and prototyping.' }))]);
  assert.equal(created.statusCode, 201, created.body);
  const withResume = await app.inject({ method: 'POST', url: '/api/v1/me/matches', headers });
  assert.equal(withResume.statusCode, 200, withResume.body);
  const makers = withResume.json().matches.find((match: { clubId: string }) => match.clubId === 'club-demo-makers');
  assert.ok(makers.score > 0);
  assert.equal(withResume.json().matches[0].clubId, 'club-demo-makers');
  assert.deepEqual((await app.inject({ url: '/api/v1/me/profile', headers })).json().profile, profileBefore);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/answers', headers })).json().answers, []);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/applications', headers })).json().applications, []);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/me/resume', headers })).statusCode, 204);
  const afterDeletion = await app.inject({ method: 'POST', url: '/api/v1/me/matches', headers });
  assert.ok(afterDeletion.json().matches.every((match: { score: number }) => match.score === 0));
});
