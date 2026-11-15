import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { HttpError } from '../src/errors.js';
import type { StudentResume } from '../src/models.js';
import { ResumeFiles } from '../src/resume-files.js';

const studentId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

function resume(student = studentId, text = 'Python campus project'): StudentResume {
  const bytes = new Uint8Array(Buffer.from(`%PDF-1.7\n${text}\n%%EOF`));
  return {
    studentId: student, bytes, text,
    info: { id: randomUUID(), fileName: 'private résumé.pdf', mimeType: 'application/pdf', sizeBytes: bytes.byteLength, pageCount: 1, textStatus: text ? 'available' : 'unavailable', uploadedAt: new Date().toISOString() },
  };
}

async function fixture(t: TestContext) {
  const temporary = await mkdtemp(join(tmpdir(), 'odysc-resume-files-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'private-resumes');
  return { root, temporary, files: new ResumeFiles(root) };
}

test('private resumes persist across store instances with exact PDF bytes, metadata, and text', async t => {
  const { root, files } = await fixture(t);
  assert.equal(await files.get(studentId), undefined);
  assert.equal(await files.getInfo(studentId), undefined);
  assert.equal(await files.getText(studentId), undefined);
  const saved = resume();
  await files.save(saved);
  const restarted = new ResumeFiles(root);
  assert.deepEqual(await restarted.get(studentId), saved);
  assert.deepEqual(await restarted.getInfo(studentId), saved.info);
  assert.equal(await restarted.getText(studentId), saved.text);
  const names = await readdir(join(root, studentId));
  assert.equal(names.length, 2);
  assert.ok(names.includes('current.json'));
  assert.equal(names.filter(name => name.endsWith('.pdf')).length, 1);
  if (process.platform !== 'win32') {
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, studentId))).mode & 0o777, 0o700);
    for (const name of names) assert.equal((await stat(join(root, studentId, name))).mode & 0o777, 0o600);
  }
});

test('replacement keeps one live PDF pair and a rejected save leaves the previous version intact', async t => {
  const { root, files } = await fixture(t);
  const first = resume();
  await files.save(first);
  const replacement = resume(studentId, 'A replacement project with different bytes.');
  replacement.info.fileName = '../../outside.pdf'; // Display metadata never supplies an on-disk path.
  await files.save(replacement);
  assert.deepEqual(await files.get(studentId), replacement);
  assert.equal((await readdir(join(root, studentId))).length, 2);
  await assert.rejects(stat(join(root, 'outside.pdf')), { code: 'ENOENT' });
  const invalid = resume(studentId, 'An invalid replacement');
  invalid.info.sizeBytes++;
  await assert.rejects(files.save(invalid), (error: unknown) => error instanceof HttpError && error.code === 'INVALID_RESUME_METADATA');
  assert.deepEqual(await files.get(studentId), replacement);
  assert.equal((await readdir(join(root, studentId))).length, 2);
});

test('student IDs isolate files and deletion removes only the requested private directory', async t => {
  const { root, files } = await fixture(t);
  const first = resume();
  const second = resume(otherId, 'Other student private résumé');
  await Promise.all([files.save(first), files.save(second)]);
  assert.deepEqual(await files.get(studentId), first);
  assert.deepEqual(await files.get(otherId), second);
  assert.equal(await files.delete(studentId), true);
  assert.equal(await files.get(studentId), undefined);
  assert.equal(await files.getInfo(studentId), undefined);
  assert.equal(await files.getText(studentId), undefined);
  assert.equal(await files.delete(studentId), false);
  await assert.rejects(stat(join(root, studentId)), { code: 'ENOENT' });
  assert.deepEqual(await new ResumeFiles(root).get(otherId), second);
});

test('invalid IDs cannot escape the configured root through any operation', async t => {
  const { root, temporary, files } = await fixture(t);
  const sentinel = join(temporary, 'keep.txt');
  await writeFile(sentinel, 'Keep private files outside the résumé root.');
  for (const id of ['../', '../../keep.txt', '/tmp', `${studentId}/../${otherId}`, '', 'not-a-uuid']) {
    for (const operation of [() => files.get(id), () => files.getInfo(id), () => files.getText(id), () => files.delete(id), () => files.save(resume(id))]) {
      await assert.rejects(operation(), (error: unknown) => error instanceof HttpError && error.code === 'INVALID_STUDENT_ID');
    }
  }
  assert.equal(await readFile(sentinel, 'utf8'), 'Keep private files outside the résumé root.');
  await assert.rejects(stat(root), { code: 'ENOENT' });
});

test('concurrent replacements and reads across instances never return mismatched metadata, text, or bytes', async t => {
  const { root, files } = await fixture(t);
  const second = new ResumeFiles(root);
  const expected = Array.from({ length: 12 }, (_, index) => resume(studentId, `Private revision ${index}`));
  const jobs: Promise<unknown>[] = [];
  for (const [index, revision] of expected.entries()) {
    const writer = index % 2 ? files : second;
    jobs.push(writer.save(revision));
    jobs.push(second.get(studentId).then(current => {
      assert.ok(current);
      const source = expected.find(item => item.info.id === current.info.id);
      assert.ok(source);
      assert.deepEqual(current, source);
    }));
  }
  await Promise.all(jobs);
  assert.deepEqual(await files.get(studentId), expected.at(-1));
  const names = await readdir(join(root, studentId));
  assert.equal(names.length, 2);
  assert.equal(names.filter(name => name.endsWith('.pdf')).length, 1);
  assert.equal(names.some(name => name.endsWith('.tmp')), false);
});

test('corrupt metadata, mismatched ownership, and path-bearing PDF pointers fail safely', async t => {
  const { root, files } = await fixture(t);
  await files.save(resume());
  const path = join(root, studentId, 'current.json');
  const original = JSON.parse(await readFile(path, 'utf8'));
  const prototypeKey = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
  for (const value of [{ ...original, studentId: otherId }, { ...original, pdfFile: '../../private.pdf' }, { ...original, info: { ...original.info, sizeBytes: 'not a number' } }, { ...original, ...prototypeKey }]) {
    await writeFile(path, JSON.stringify(value));
    for (const operation of [() => files.get(studentId), () => files.getInfo(studentId), () => files.getText(studentId)]) {
      await assert.rejects(operation(), (error: unknown) => error instanceof Error && error.message === 'Private résumé data could not be read.');
    }
  }
  await writeFile(path, '{"private":"PRIVATE_CONTENT_9281"');
  await assert.rejects(files.get(studentId), { message: 'Private résumé data could not be read.' });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(await files.delete(studentId), true, 'a student can still remove corrupt private storage');
});
