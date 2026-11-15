import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertOwner, requireUser } from './auth.js';
import { Store } from './db.js';
import { HttpError } from './errors.js';
import type { Application, Club } from './models.js';

const secured = { security: [{ bearerAuth: [] }], tags: ['Applications'] };
const answersSchema = Type.Record(Type.String({ minLength: 1, maxLength: 100 }), Type.String({ maxLength: 10000 }), { maxProperties: 30 });
const params = Type.Object({ applicationId: Type.String({ minLength: 1, maxLength: 100 }) });

function studentApplication(store: Store, request: FastifyRequest, applicationId: string): Application {
  const user = requireUser(store, request, 'student');
  const application = store.getApplication(applicationId);
  if (!application || application.studentId !== user.id) throw new HttpError(404, 'Application not found.', 'NOT_FOUND');
  return application;
}
function assertOpen(club: Club) {
  if (!club.acceptingApplications) throw new HttpError(409, 'This club is not accepting applications.', 'APPLICATIONS_CLOSED');
  if (club.applicationDeadline && Date.parse(club.applicationDeadline) <= Date.now()) throw new HttpError(409, 'The application deadline has passed.', 'DEADLINE_PASSED');
}
function validateAnswers(club: Club, answers: Record<string, string>, submitting: boolean) {
  const allowed = new Map(club.questions.map(question => [question.id, question]));
  for (const [id, answer] of Object.entries(answers)) {
    const question = allowed.get(id);
    if (!question) throw new HttpError(400, `Unknown question: ${id}. Refresh the club’s application form.`, 'INVALID_ANSWERS');
    if (answer.length > question.maxLength) throw new HttpError(400, `Answer to “${question.prompt}” exceeds ${question.maxLength} characters.`, 'INVALID_ANSWERS');
  }
  if (submitting) {
    const missing = club.questions.filter(question => question.required && !answers[question.id]?.trim());
    if (missing.length) throw new HttpError(400, `Complete required questions: ${missing.map(question => question.prompt).join('; ')}`, 'MISSING_ANSWERS');
  }
}

export async function registerApplications(app: FastifyInstance, store: Store) {
  app.get('/api/v1/me/applications', { schema: { ...secured, summary: 'List your applications, including private drafts' } }, request => {
    const user = requireUser(store, request, 'student');
    return { applications: store.listApplications(user.id).map(application => ({ ...application, club: store.getClub(application.clubId) })) };
  });
  const createBody = Type.Object({
    clubId: Type.String({ minLength: 1, maxLength: 150 }),
    answers: Type.Optional(answersSchema),
  }, { additionalProperties: false });
  app.post<{ Body: Static<typeof createBody> }>('/api/v1/me/applications', {
    schema: { ...secured, summary: 'Start one draft per club; also bookmark that club', body: createBody },
  }, (request, reply) => {
    const user = requireUser(store, request, 'student');
    const club = store.getClub(request.body.clubId);
    if (!club) throw new HttpError(404, 'Club not found.', 'NOT_FOUND');
    assertOpen(club);
    const existing = store.listApplications(user.id).find(application => application.clubId === club.id);
    if (existing) throw new HttpError(409, `An application for this club already exists (${existing.id}).`, 'APPLICATION_EXISTS');
    const answers = request.body.answers ?? {};
    validateAnswers(club, answers, false);
    const now = new Date().toISOString();
    const application: Application = { id: randomUUID(), studentId: user.id, clubId: club.id, answers, status: 'draft', profileSnapshot: null, submittedAt: null, createdAt: now, updatedAt: now };
    store.transaction(() => {
      store.saveApplication(application);
      store.setBookmark(user.id, club.id, true);
    });
    return reply.code(201).send({ application });
  });
  app.get<{ Params: Static<typeof params> }>('/api/v1/me/applications/:applicationId', {
    schema: { ...secured, params },
  }, request => ({ application: studentApplication(store, request, request.params.applicationId) }));
  const updateBody = Type.Object({ answers: answersSchema }, { additionalProperties: false });
  app.put<{ Params: Static<typeof params>; Body: Static<typeof updateBody> }>('/api/v1/me/applications/:applicationId', {
    schema: { ...secured, summary: 'Replace the answers in your draft', params, body: updateBody },
  }, request => {
    const application = studentApplication(store, request, request.params.applicationId);
    if (application.status !== 'draft') throw new HttpError(409, 'Submitted applications cannot be edited.', 'APPLICATION_LOCKED');
    const club = store.getClub(application.clubId)!;
    assertOpen(club);
    validateAnswers(club, request.body.answers, false);
    const updated = { ...application, answers: request.body.answers, updatedAt: new Date().toISOString() };
    store.saveApplication(updated);
    return { application: updated };
  });
  const submitBody = Type.Object({ rememberAnswers: Type.Boolean({ default: false }) }, { additionalProperties: false });
  app.post<{ Params: Static<typeof params>; Body: Static<typeof submitBody> }>('/api/v1/me/applications/:applicationId/submit', {
    schema: { ...secured, summary: 'Explicitly submit your draft and optionally save answers for reuse', params, body: submitBody },
  }, request => {
    const application = studentApplication(store, request, request.params.applicationId);
    if (application.status !== 'draft') throw new HttpError(409, 'This application has already been submitted.', 'APPLICATION_LOCKED');
    const club = store.getClub(application.clubId)!;
    assertOpen(club);
    validateAnswers(club, application.answers, true);
    const now = new Date().toISOString();
    const submitted: Application = { ...application, status: 'submitted', profileSnapshot: store.getProfile(application.studentId), submittedAt: now, updatedAt: now };
    store.transaction(() => {
      store.saveApplication(submitted);
      if (request.body.rememberAnswers) {
        const saved = store.listAnswers(application.studentId);
        for (const question of club.questions) {
          const answer = application.answers[question.id]?.trim();
          if (!answer) continue;
          const existing = saved.find(item => item.question.trim().toLowerCase() === question.prompt.trim().toLowerCase());
          store.saveAnswer({ id: existing?.id ?? randomUUID(), studentId: application.studentId, question: question.prompt, answer, updatedAt: now });
        }
      }
    });
    return { application: submitted };
  });
  app.get('/api/v1/organizer/clubs', { schema: { ...secured, tags: ['Organizer'], summary: 'List the clubs you own' } }, request => {
    const user = requireUser(store, request, 'organizer');
    return { clubs: store.listClubs().filter(club => club.ownerId === user.id) };
  });
  const clubParams = Type.Object({ clubId: Type.String({ minLength: 1, maxLength: 150 }) });
  app.get<{ Params: Static<typeof clubParams> }>('/api/v1/clubs/:clubId/applications', {
    schema: { ...secured, tags: ['Organizer'], summary: 'Review submitted applicants to a club you own; drafts stay private', params: clubParams },
  }, request => {
    const { club } = assertOwner(store, request, request.params.clubId);
    return { applications: store.listApplications(undefined, club.id).filter(application => application.status !== 'draft').map(application => {
      const user = store.getUser(application.studentId)!;
      return { ...application, student: { id: user.id, name: user.name, email: user.email } };
    }) };
  });
  const statusBody = Type.Object({ status: Type.Union([Type.Literal('reviewing'), Type.Literal('accepted'), Type.Literal('rejected')]) }, { additionalProperties: false });
  app.patch<{ Params: Static<typeof params>; Body: Static<typeof statusBody> }>('/api/v1/applications/:applicationId/status', {
    schema: { ...secured, tags: ['Organizer'], summary: 'Advance an applicant’s status; final decisions are locked', params, body: statusBody },
  }, request => {
    requireUser(store, request, 'organizer');
    const application = store.getApplication(request.params.applicationId);
    if (!application) throw new HttpError(404, 'Application not found.', 'NOT_FOUND');
    assertOwner(store, request, application.clubId);
    if (application.status === 'draft') throw new HttpError(404, 'Submitted application not found.', 'NOT_FOUND');
    if (application.status === request.body.status) return { application };
    if (['accepted', 'rejected'].includes(application.status)) throw new HttpError(409, 'This application already has a final decision.', 'FINAL_DECISION');
    const updated: Application = { ...application, status: request.body.status, updatedAt: new Date().toISOString() };
    store.saveApplication(updated);
    return { application: updated };
  });
}
