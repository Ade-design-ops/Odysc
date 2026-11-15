import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '../src/errors.js';
import { MAX_RESUME_BYTES, MAX_RESUME_PAGES, parseResumePdf } from '../src/resume.js';

import { pdfFixture } from './fixtures/pdf.js';

function errorCode(code: string, statusCode: number) {
  return (error: unknown): boolean => error instanceof HttpError && error.code === code && error.statusCode === statusCode;
}

test('PDF resume extraction reads text and preserves the original upload bytes', async () => {
  const bytes = pdfFixture();
  const original = Uint8Array.from(bytes);
  const result = await parseResumePdf(bytes);
  assert.equal(result.pageCount, 1);
  assert.equal(result.textStatus, 'available');
  assert.match(result.text, /Alex Trojan/);
  assert.match(result.text, /TypeScript/);
  assert.deepEqual(bytes, original, 'worker transfer must not detach or mutate the upload');
});

test('concurrent PDF workers finish cleanup before returning independent results', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => parseResumePdf(pdfFixture({ text: `Private fixture revision ${index}` }))));
  for (const [index, result] of results.entries()) {
    assert.equal(result.pageCount, 1);
    assert.equal(result.textStatus, 'available');
    assert.equal(result.text, `Private fixture revision ${index}`);
  }
});

test('PDF resume extraction accepts the page limit and bounds extracted text', async () => {
  const atLimit = await parseResumePdf(pdfFixture({ pageCount: MAX_RESUME_PAGES, text: 'Campus project' }));
  assert.equal(atLimit.pageCount, MAX_RESUME_PAGES);
  assert.equal(atLimit.textStatus, 'available');
  assert.equal((atLimit.text.match(/Campus project/gu) ?? []).length, MAX_RESUME_PAGES);
  const long = await parseResumePdf(pdfFixture({ text: 'TypeScript '.repeat(3000) }));
  assert.equal(long.textStatus, 'available');
  assert.ok(long.text.length > 0 && long.text.length <= 20_000);
});

test('PDFs without extractable text satisfy the file requirement without requiring OCR', async () => {
  const result = await parseResumePdf(pdfFixture({ text: '' }));
  assert.deepEqual(result, { text: '', pageCount: 1, textStatus: 'unavailable' });
});

test('non-PDF and empty uploads fail with a clear file error', async () => {
  for (const data of [new Uint8Array(), new Uint8Array(Buffer.from('not a PDF résumé')), new Uint8Array(Buffer.from('%PDF-'))]) {
    await assert.rejects(parseResumePdf(data), errorCode('INVALID_RESUME_FILE', 400));
  }
});

test('oversized and over-page-limit PDFs are rejected without accepting partial parsing', async () => {
  const tooLarge = new Uint8Array(MAX_RESUME_BYTES + 1);
  tooLarge.set(Buffer.from('%PDF-1.7'));
  await assert.rejects(parseResumePdf(tooLarge), errorCode('RESUME_TOO_LARGE', 413));
  await assert.rejects(parseResumePdf(pdfFixture({ pageCount: MAX_RESUME_PAGES + 1 })), errorCode('RESUME_PAGE_LIMIT', 422));
});

test('malformed PDFs fail through a fixed public error without exposing parser details', async () => {
  await assert.rejects(parseResumePdf(new Uint8Array(Buffer.from('%PDF-1.7\nprivate student data\nnot a valid document'))), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, 'INVALID_RESUME_PDF');
    assert.ok(!error.message.includes('private student data'));
    return true;
  });
});

test('password-protected PDFs request an unlocked copy rather than returning unreadable content', async () => {
  await assert.rejects(parseResumePdf(pdfFixture({ encrypted: true })), errorCode('RESUME_PASSWORD_PROTECTED', 422));
});
