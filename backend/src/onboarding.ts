import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth.js';
import { Store } from './db.js';
import { HttpError } from './errors.js';
import type { User } from './models.js';
import { academicYearSchema, normalizeProfile, tagList } from './profile.js';
import { MAX_RESUME_BYTES, parseResumePdf } from './resume.js';
import { onboardingFields } from './onboarding-fields.js';

const secured = { tags: ['Student onboarding'], security: [{ bearerAuth: [] }] };
const patchBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' })),
  academicYear: Type.Optional(academicYearSchema),
  major: Type.Optional(Type.String({ maxLength: 150 })),
  interests: Type.Optional(tagList(20)),
  goals: Type.Optional(tagList(10, 300)),
  bio: Type.Optional(Type.String({ maxLength: 1500 })),
  skills: Type.Optional(tagList(30)),
}, { additionalProperties: false, minProperties: 1 });

export { onboardingFields } from './onboarding-fields.js';

function onboardingSnapshot(store: Store, user: User) {
  const profile = store.getProfile(user.id);
  const resume = store.getResumeInfo(user.id) ?? null;
  const saved = store.getOnboarding(user.id);
  const missingRequiredFields = [
    ...(!user.name.trim() ? ['name'] : []),
    ...(!profile.academicYear ? ['academicYear'] : []),
    ...(!profile.major.trim() ? ['major'] : []),
    ...(!profile.interests.some(interest => interest.trim()) ? ['interests'] : []),
    ...(!resume ? ['resume'] : []),
  ];
  const completedAt = missingRequiredFields.length === 0 ? saved.completedAt : null;
  const hasDraft = Boolean(saved.startedAt || resume || profile.major || profile.academicYear || profile.interests.length || profile.goals.length || profile.bio || profile.skills.length || profile.experience);
  return {
    user, profile, resume,
    onboarding: {
      status: completedAt ? 'completed' : hasDraft ? 'in_progress' : 'not_started',
      completedAt,
      missingRequiredFields,
      recommendedFields: [
        ...(!profile.goals.length ? ['goals'] : []),
        ...(!profile.bio ? ['bio'] : []), ...(!profile.skills.length ? ['skills'] : []),
      ],
    },
    fields: onboardingFields,
  };
}

export async function registerOnboarding(app: FastifyInstance, store: Store) {
  app.get('/api/v1/me/onboarding', {
    schema: { ...secured, summary: 'Read your student onboarding draft, requirements, and optional-field guidance' },
  }, request => onboardingSnapshot(store, requireUser(store, request, 'student')));

  app.patch<{ Body: Static<typeof patchBody> }>('/api/v1/me/onboarding', {
    schema: { ...secured, summary: 'Save part of your student onboarding; omitted fields are preserved', body: patchBody },
  }, request => {
    const user = requireUser(store, request, 'student');
    const { name, ...changes } = request.body;
    const updatedUser = { ...user, ...(name === undefined ? {} : { name: name.trim() }) };
    const profile = normalizeProfile({ ...store.getProfile(user.id), ...changes });
    store.transaction(() => {
      const state = store.getOnboarding(user.id);
      store.saveOnboarding(user.id, { ...state, startedAt: state.startedAt ?? new Date().toISOString() });
      store.saveUser(updatedUser);
      store.saveProfile(user.id, profile);
    });
    return onboardingSnapshot(store, updatedUser);
  });

  app.post('/api/v1/me/onboarding/complete', {
    schema: { ...secured, summary: 'Finish student onboarding with the required profile fields and PDF résumé', body: Type.Object({}, { additionalProperties: false }) },
  }, request => {
    const user = requireUser(store, request, 'student');
    const snapshot = onboardingSnapshot(store, user);
    if (snapshot.onboarding.missingRequiredFields.length) {
      throw new HttpError(400, `Complete these required fields first: ${snapshot.onboarding.missingRequiredFields.join(', ')}. Optional details can be added later.`, 'MISSING_ONBOARDING_FIELDS');
    }
    const now = new Date().toISOString();
    const saved = store.getOnboarding(user.id);
    store.saveOnboarding(user.id, { startedAt: saved.startedAt ?? now, completedAt: saved.completedAt ?? now });
    return onboardingSnapshot(store, user);
  });

  app.post('/api/v1/me/resume', {
    schema: {
      ...secured, tags: ['Student résumé'], summary: 'Upload or replace your required private PDF résumé (multipart field: resume)',
      description: 'Send one PDF file under the resume form field using multipart/form-data. Maximum 5 MiB and 10 pages. A saved PDF is required to complete onboarding and get club matches. Uploading does not complete onboarding or overwrite your profile.',
      consumes: ['multipart/form-data'],
    },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = requireUser(store, request, 'student');
    let file: { bytes: Buffer; fileName: string } | undefined;
    for await (const part of request.parts({ limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_RESUME_BYTES } })) {
      if (part.type !== 'file') throw new HttpError(400, 'Send only a PDF file under the resume field.', 'INVALID_RESUME');
      const bytes = await part.toBuffer();
      if (part.fieldname !== 'resume' || part.mimetype !== 'application/pdf' || !part.filename.toLowerCase().endsWith('.pdf')) {
        throw new HttpError(400, 'Choose a PDF résumé and send it under the resume field.', 'INVALID_RESUME');
      }
      const fileName = part.filename.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || 'resume.pdf';
      file = { bytes, fileName };
    }
    if (!file) throw new HttpError(400, 'Choose a PDF résumé to upload.', 'MISSING_RESUME');
    const parsed = await parseResumePdf(file.bytes);
    // A concurrent logout while parsing must not turn into a write after revocation.
    requireUser(store, request, 'student');
    const info = {
      id: randomUUID(), fileName: file.fileName, mimeType: 'application/pdf' as const,
      sizeBytes: file.bytes.byteLength, pageCount: parsed.pageCount,
      textStatus: parsed.textStatus, uploadedAt: new Date().toISOString(),
    };
    store.transaction(() => {
      store.saveResume({ studentId: user.id, info, bytes: file.bytes, text: parsed.text });
      const saved = store.getOnboarding(user.id);
      store.saveOnboarding(user.id, { ...saved, startedAt: saved.startedAt ?? info.uploadedAt });
    });
    return reply.code(201).send({
      resume: info,
      notice: parsed.textStatus === 'unavailable'
        ? 'Your PDF is saved. We could not extract readable text; add interests and skills manually to help with matching.'
        : 'Your PDF is saved. Your profile fields stay as you entered them.',
    });
  });

  app.get('/api/v1/me/resume', {
    schema: { ...secured, tags: ['Student résumé'], summary: 'Download your own private résumé PDF' },
  }, (request, reply) => {
    const user = requireUser(store, request, 'student');
    const resume = store.getResume(user.id);
    if (!resume) throw new HttpError(404, 'You have not uploaded a résumé.', 'NOT_FOUND');
    return reply.type('application/pdf').header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `attachment; filename="resume.pdf"; filename*=UTF-8''${encodeURIComponent(resume.info.fileName).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16)}`)}`)
      .send(Buffer.from(resume.bytes));
  });
  app.delete('/api/v1/me/resume', {
    schema: { ...secured, tags: ['Student résumé'], summary: 'Remove your résumé and mark onboarding incomplete' },
  }, (request, reply) => {
    const user = requireUser(store, request, 'student');
    store.transaction(() => {
      if (!store.deleteResume(user.id)) throw new HttpError(404, 'You have not uploaded a résumé.', 'NOT_FOUND');
      const saved = store.getOnboarding(user.id);
      store.saveOnboarding(user.id, { ...saved, completedAt: null });
    });
    return reply.code(204).send();
  });
}
