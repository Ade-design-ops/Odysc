import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { HttpError } from './errors.js';
import type { ResumeInfo, StudentResume } from './models.js';
import { MAX_RESUME_BYTES, MAX_RESUME_PAGES } from './resume.js';

const uuid = z.string().uuid();
const generatedFile = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/u;
const temporaryFile = /^[0-9a-f-]{36}\.json\.tmp$/u;
const infoSchema = z.object({
  id: uuid, fileName: z.string().min(1).max(200), mimeType: z.literal('application/pdf'),
  sizeBytes: z.number().int().min(0).max(MAX_RESUME_BYTES),
  pageCount: z.number().int().min(1).max(MAX_RESUME_PAGES),
  textStatus: z.enum(['available', 'unavailable']), uploadedAt: z.string().datetime(),
}).strict();
const metadataSchema = z.object({
  studentId: uuid, info: infoSchema, text: z.string().max(20_000),
  pdfFile: z.string().regex(generatedFile),
}).strict();
type Metadata = z.infer<typeof metadataSchema>;

// Shared across instances in the same API process. Reads hold the same queue
// as writes so cleanup cannot remove a PDF while a reader is opening it.
const queues = new Map<string, Promise<void>>();
function missing(error: unknown) { return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'; }
function unreadable() { return new Error('Private résumé data could not be read.'); }

/** Private files for the single-process prototype; never mount this root as static content. */
export class ResumeFiles {
  readonly rootPath: string;
  constructor(rootPath = './data/resumes') { this.rootPath = resolve(rootPath); }

  private userId(value: string): string {
    const parsed = uuid.safeParse(value);
    if (!parsed.success) throw new HttpError(400, 'A valid student identifier is required.', 'INVALID_STUDENT_ID');
    return parsed.data.toLowerCase();
  }

  private async locked<T>(userId: string, operation: (directory: string) => Promise<T>): Promise<T> {
    const directory = join(this.rootPath, userId);
    const previous = queues.get(directory) ?? Promise.resolve();
    const result = previous.then(() => operation(directory));
    const tail = result.then(() => {}, () => {});
    queues.set(directory, tail);
    try { return await result; }
    finally { if (queues.get(directory) === tail) queues.delete(directory); }
  }

  private async metadata(directory: string, userId: string): Promise<Metadata | undefined> {
    const path = join(directory, 'current.json');
    let content: string;
    try {
      if ((await stat(path)).size > 128 * 1024) throw unreadable();
      content = await readFile(path, 'utf8');
    } catch (error) { if (missing(error)) return undefined; throw unreadable(); }
    try {
      const result = metadataSchema.parse(JSON.parse(content));
      if (result.studentId !== userId || (result.info.textStatus === 'available') !== Boolean(result.text.trim())) throw unreadable();
      return result;
    } catch { throw unreadable(); }
  }

  async get(userId: string): Promise<StudentResume | undefined> {
    const id = this.userId(userId);
    return this.locked(id, async directory => {
      const data = await this.metadata(directory, id);
      if (!data) return undefined;
      let bytes: Uint8Array;
      try {
        const path = join(directory, data.pdfFile);
        if ((await stat(path)).size !== data.info.sizeBytes) throw unreadable();
        bytes = new Uint8Array(await readFile(path));
      } catch { throw unreadable(); }
      return { studentId: id, info: data.info, text: data.text, bytes };
    });
  }

  async getInfo(userId: string): Promise<ResumeInfo | undefined> {
    const id = this.userId(userId);
    return this.locked(id, async directory => (await this.metadata(directory, id))?.info);
  }

  async getText(userId: string): Promise<string | undefined> {
    const id = this.userId(userId);
    return this.locked(id, async directory => (await this.metadata(directory, id))?.text);
  }

  async save(resume: StudentResume): Promise<void> {
    const id = this.userId(resume.studentId);
    const parsedInfo = infoSchema.safeParse(resume.info);
    if (!parsedInfo.success || !(resume.bytes instanceof Uint8Array)
      || parsedInfo.data.sizeBytes !== resume.bytes.byteLength
      || typeof resume.text !== 'string' || resume.text.length > 20_000
      || (parsedInfo.data.textStatus === 'available') !== Boolean(resume.text.trim())) {
      throw new HttpError(400, 'Résumé metadata does not match the uploaded file.', 'INVALID_RESUME_METADATA');
    }
    // Snapshot before queuing; a caller mutating its upload cannot alter this save.
    const bytes = Uint8Array.from(resume.bytes);
    const info = parsedInfo.data;
    const text = resume.text;
    return this.locked(id, async directory => {
      await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
      await chmod(this.rootPath, 0o700);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      await this.metadata(directory, id); // Do not silently overwrite corrupt stored state.
      const version = randomUUID();
      const pdfFile = `${version}.pdf`;
      const temporary = `${version}.json.tmp`;
      let committed = false;
      try {
        await writeFile(join(directory, pdfFile), bytes, { flag: 'wx', mode: 0o600 });
        await writeFile(join(directory, temporary), JSON.stringify({ studentId: id, info, text, pdfFile }), { flag: 'wx', mode: 0o600 });
        // The committed index always names an already-written, complete PDF.
        await rename(join(directory, temporary), join(directory, 'current.json'));
        committed = true;
        for (const file of await readdir(directory)) {
          if ((generatedFile.test(file) && file !== pdfFile) || temporaryFile.test(file)) {
            await rm(join(directory, file), { force: true });
          }
        }
      } finally {
        if (!committed) {
          await Promise.all([
            rm(join(directory, pdfFile), { force: true }).catch(() => {}),
            rm(join(directory, temporary), { force: true }).catch(() => {}),
          ]);
        }
      }
    });
  }

  async delete(userId: string): Promise<boolean> {
    const id = this.userId(userId);
    return this.locked(id, async directory => {
      let existed = false;
      try { await stat(join(directory, 'current.json')); existed = true; }
      catch (error) { if (!missing(error)) throw unreadable(); }
      // Remove only this UUID directory, including abandoned temporary versions.
      await rm(directory, { recursive: true, force: true });
      return existed;
    });
  }
}
