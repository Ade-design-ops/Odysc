import { Worker } from 'node:worker_threads';
import { HttpError } from './errors.js';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const MAX_RESUME_PAGES = 10;
const MAX_RESUME_TEXT_LENGTH = 20_000;
const PARSE_TIMEOUT_MS = 10_000;

export interface ParsedResumePdf {
  text: string;
  pageCount: number;
  textStatus: 'available' | 'unavailable';
}

// This source is static application code. Uploaded bytes are passed as data,
// never interpolated into JavaScript. An eval worker avoids a TS loader or
// development-versus-build path dependency for the isolated parser.
const parserWorker = String.raw`
const { parentPort, workerData } = require('node:worker_threads');

// Text extraction needs no network resources, external fonts, or image rendering.
globalThis.fetch = async () => { throw new Error('External resources are disabled.'); };

(async () => {
  let pdf;
  let result;
  try {
    const { getDocumentProxy } = await import(workerData.moduleUrl);
    pdf = await getDocumentProxy(workerData.bytes, {
      isEvalSupported: false,
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      useWasm: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      maxImageSize: 1_000_000,
      cMapUrl: undefined,
      standardFontDataUrl: undefined,
      wasmUrl: undefined,
      verbosity: 0,
    });
    const pageCount = pdf.numPages;
    if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('Invalid page count.');
    if (pageCount > workerData.maxPages) {
      const error = new Error('Too many pages.');
      error.code = 'RESUME_PAGE_LIMIT';
      throw error;
    }
    let text = '';
    // Read sequentially and stop once enough text is collected. Do not fan out
    // all pages or decode images merely to decide whether text is available.
    for (let pageNumber = 1; pageNumber <= pageCount && text.length < workerData.maxTextLength; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .filter(item => typeof item.str === 'string')
        .map(item => item.str + (item.hasEOL ? '\n' : ' '))
        .join('')
        .replace(/\u0000/g, '')
        .trim();
      if (pageText) text += (text ? '\n\n' : '') + pageText;
      text = text.slice(0, workerData.maxTextLength);
      page.cleanup();
    }
    text = text.trim();
    result = { ok: true, text, pageCount, textStatus: text ? 'available' : 'unavailable' };
  } catch (error) {
    const code = error && error.code === 'RESUME_PAGE_LIMIT'
      ? 'RESUME_PAGE_LIMIT'
      : error && error.name === 'PasswordException'
        ? 'RESUME_PASSWORD_PROTECTED'
        : 'INVALID_RESUME_PDF';
    // Provider/parser exception messages may include document data. Return only
    // a fixed code to the API process.
    result = { ok: false, code };
  } finally {
    // Cleanup may complete synchronously. Await its result without assuming it
    // has a .catch method, and finish cleanup before the API terminates us.
    try { if (pdf) await pdf.destroy(); } catch {}
  }
  parentPort.postMessage(result);
})();
`;

function parseError(code: string): HttpError {
  switch (code) {
    case 'RESUME_PAGE_LIMIT':
      return new HttpError(422, `Upload a résumé with at most ${MAX_RESUME_PAGES} pages.`, code);
    case 'RESUME_PASSWORD_PROTECTED':
      return new HttpError(422, 'This PDF is password protected. Upload an unlocked copy.', code);
    case 'RESUME_PARSE_TIMEOUT':
      return new HttpError(422, 'This PDF took too long to read. Try a simpler PDF.', code);
    default:
      return new HttpError(422, 'This PDF could not be read. Upload a different PDF.', 'INVALID_RESUME_PDF');
  }
}

export async function parseResumePdf(bytes: Uint8Array): Promise<ParsedResumePdf> {
  if (bytes.byteLength > MAX_RESUME_BYTES) {
    throw new HttpError(413, 'Upload a PDF no larger than 5 MiB.', 'RESUME_TOO_LARGE');
  }
  if (bytes.length < 8 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d) {
    throw new HttpError(400, 'Upload a PDF file.', 'INVALID_RESUME_FILE');
  }
  // Transfer a copy so the caller can still privately store the original PDF.
  const copy = Uint8Array.from(bytes);
  return new Promise<ParsedResumePdf>((resolve, reject) => {
    const worker = new Worker(parserWorker, {
      eval: true,
      execArgv: [],
      workerData: {
        bytes: copy,
        moduleUrl: import.meta.resolve('unpdf'),
        maxPages: MAX_RESUME_PAGES,
        maxTextLength: MAX_RESUME_TEXT_LENGTH,
      },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error: HttpError | null, value?: ParsedResumePdf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const settle = () => error ? reject(error) : resolve(value!);
      // Success, parser errors, crashes, and timeout all terminate the worker
      // before the request settles; no parser continues in the background.
      void worker.terminate().then(settle, settle);
    };
    const timer = setTimeout(() => finish(parseError('RESUME_PARSE_TIMEOUT')), PARSE_TIMEOUT_MS);
    worker.once('message', (message: unknown) => {
      if (!message || typeof message !== 'object') return finish(parseError('INVALID_RESUME_PDF'));
      const result = message as Record<string, unknown>;
      if (result.ok !== true) return finish(parseError(typeof result.code === 'string' ? result.code : 'INVALID_RESUME_PDF'));
      if (typeof result.text !== 'string' || result.text.length > MAX_RESUME_TEXT_LENGTH
        || !Number.isInteger(result.pageCount) || (result.pageCount as number) < 1 || (result.pageCount as number) > MAX_RESUME_PAGES
        || (result.textStatus !== 'available' && result.textStatus !== 'unavailable')) {
        return finish(parseError('INVALID_RESUME_PDF'));
      }
      finish(null, { text: result.text, pageCount: result.pageCount as number, textStatus: result.textStatus });
    });
    worker.once('error', () => finish(parseError('INVALID_RESUME_PDF')));
    worker.once('exit', () => { if (!settled) finish(parseError('INVALID_RESUME_PDF')); });
  });
}
