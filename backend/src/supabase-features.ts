import { randomUUID } from 'node:crypto';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { matchClubs, type AiOptions } from './ai.js';
import { HttpError } from './errors.js';
import type { ResumeFiles } from './resume-files.js';
import { MAX_RESUME_BYTES, parseResumePdf } from './resume.js';
import { supabaseBearer } from './supabase-student.js';
import { SupabaseGateway, toApiProfile } from './supabase.js';
import type { SupabaseCatalogService } from './supabase-catalog.js';

const secured = { security: [{ bearerAuth: [] }] };
export async function registerSupabaseFeatures(app: FastifyInstance, gateway: SupabaseGateway, files: ResumeFiles, catalog: SupabaseCatalogService, ai: AiOptions = {}) {
  app.post('/api/v1/me/matches', {
    schema: { ...secured, tags: ['Student'], summary: 'Match your saved Supabase profile to the shared club directory' },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async request => {
    const { user, token } = await gateway.getIdentity(supabaseBearer(request));
    if (!await files.getInfo(user.id)) throw new HttpError(400, 'Upload a PDF résumé before getting club matches.', 'RESUME_REQUIRED');
    const row = await gateway.getProfile(token, user.id);
    const resumeText = await files.getText(user.id);
    const clubs = await catalog.listClubs();
    const result = await matchClubs({ ...toApiProfile(row), ...(resumeText ? { resumeText } : {}) }, clubs, ai);
    const byId = new Map(clubs.map(club => [club.id, club]));
    return { ...result, totalClubs: clubs.length, matches: result.matches.slice(0, 20).map(match => ({ ...match, club: byId.get(match.clubId)! })) };
  });

  app.post('/api/v1/me/resume', {
    schema: {
      ...secured, tags: ['Student résumé'], summary: 'Upload or replace your required private PDF résumé',
      description: 'Send one PDF in multipart field resume. Maximum 5 MiB and 10 pages. A saved PDF is required to finish onboarding and get club matches; readable text is not required. Private files persist on the backend volume; profile information is stored in Supabase.',
      consumes: ['multipart/form-data'],
    },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = supabaseBearer(request);
    const { user } = await gateway.getIdentity(token);
    let upload: { bytes: Buffer; fileName: string } | undefined;
    for await (const part of request.parts({ limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_RESUME_BYTES } })) {
      if (part.type !== 'file') throw new HttpError(400, 'Send only a PDF under the resume field.', 'INVALID_RESUME');
      const bytes = await part.toBuffer();
      if (part.fieldname !== 'resume' || part.mimetype !== 'application/pdf' || !part.filename.toLowerCase().endsWith('.pdf')) {
        throw new HttpError(400, 'Choose a PDF résumé and send it under the resume field.', 'INVALID_RESUME');
      }
      const fileName = part.filename.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || 'resume.pdf';
      upload = { bytes, fileName };
    }
    if (!upload) throw new HttpError(400, 'Choose a PDF résumé to upload.', 'MISSING_RESUME');
    const parsed = await parseResumePdf(upload.bytes);
    await gateway.getIdentity(token);
    const info = {
      id: randomUUID(), fileName: upload.fileName, mimeType: 'application/pdf' as const,
      sizeBytes: upload.bytes.byteLength, pageCount: parsed.pageCount, textStatus: parsed.textStatus,
      uploadedAt: new Date().toISOString(),
    };
    await files.save({ studentId: user.id, info, bytes: upload.bytes, text: parsed.text });
    return reply.code(201).send({ resume: info, notice: parsed.textStatus === 'available'
      ? 'Your PDF is saved privately. Your profile fields stay as you entered them.'
      : 'Your PDF is saved. Add interests and skills manually because readable text could not be extracted.' });
  });

  app.get('/api/v1/me/resume', {
    schema: { ...secured, tags: ['Student résumé'], summary: 'Download your own private résumé' },
  }, async (request, reply) => {
    const { user } = await gateway.getIdentity(supabaseBearer(request));
    const resume = await files.get(user.id);
    if (!resume) throw new HttpError(404, 'You have not uploaded a résumé.', 'NOT_FOUND');
    const encodedName = encodeURIComponent(resume.info.fileName).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16)}`);
    return reply.type('application/pdf').header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `attachment; filename="resume.pdf"; filename*=UTF-8''${encodedName}`)
      .send(Buffer.from(resume.bytes));
  });
  app.delete('/api/v1/me/resume', {
    schema: { ...secured, tags: ['Student résumé'], summary: 'Delete your private résumé and mark onboarding incomplete' },
  }, async (request, reply) => {
    const { user, token } = await gateway.getIdentity(supabaseBearer(request));
    if (!await files.getInfo(user.id)) throw new HttpError(404, 'You have not uploaded a résumé.', 'NOT_FOUND');
    await gateway.request(`/rest/v1/student_profiles?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: 'PATCH', token, body: { onboarding_completed_at: null }, headers: { Prefer: 'return=minimal' },
    });
    if (!await files.delete(user.id)) throw new HttpError(404, 'You have not uploaded a résumé.', 'NOT_FOUND');
    return reply.code(204).send();
  });

  // These workflows exist in the explicit local prototype. Returning a clear
  // status is preferable to quietly saving shared-app requests in a local DB.
  const pending: [HTTPMethods | HTTPMethods[], string][] = [
    ['POST', '/api/v1/clubs'], ['PATCH', '/api/v1/clubs/:clubId'],
    ['POST', '/api/v1/clubs/:clubId/events'], ['PATCH', '/api/v1/events/:eventId'],
    ['GET', '/api/v1/events/:eventId/calendar'], ['GET', '/api/v1/organizer/clubs'],
    [['GET', 'POST'], '/api/v1/me/answers'], [['PUT', 'DELETE'], '/api/v1/me/answers/:answerId'],
    ['POST', '/api/v1/me/answers/suggest'], [['GET', 'POST'], '/api/v1/me/applications'],
    [['GET', 'PUT'], '/api/v1/me/applications/:applicationId'], ['POST', '/api/v1/me/applications/:applicationId/submit'],
    ['GET', '/api/v1/clubs/:clubId/applications'], ['PATCH', '/api/v1/applications/:applicationId/status'],
    ['GET', '/api/v1/me/bookmarks'], ['PUT', '/api/v1/me/bookmarks/:clubId'], ['GET', '/api/v1/me/reminders'],
  ];
  for (const [method, url] of pending) app.route({
    method, url,
    schema: { hide: true },
    handler: async () => { throw new HttpError(503, 'This workflow is not connected to the shared Supabase data yet.', 'FEATURE_NOT_CONNECTED'); },
  });
}
