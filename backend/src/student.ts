import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth.js';
import { matchClubs, parseProfile, suggestAnswer, type AiOptions } from './ai.js';
import { Store } from './db.js';
import { HttpError } from './errors.js';
import type { SavedAnswer } from './models.js';
import { normalizeProfile, profileBody } from './profile.js';

const secured = { security: [{ bearerAuth: [] }], tags: ['Student'] };
const answerBody = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 2000, pattern: '\\S' }),
  answer: Type.String({ minLength: 1, maxLength: 10000, pattern: '\\S' }),
}, { additionalProperties: false });
const answerParams = Type.Object({ answerId: Type.String({ minLength: 1, maxLength: 100 }) });

export async function registerStudent(app: FastifyInstance, store: Store, ai: AiOptions = {}) {
  app.get('/api/v1/me/profile', { schema: { ...secured, summary: 'Read your reusable Common App profile' } }, request => {
    const user = requireUser(store, request, 'student');
    return { user, profile: store.getProfile(user.id) };
  });
  app.put<{ Body: Static<typeof profileBody> }>('/api/v1/me/profile', {
    schema: { ...secured, summary: 'Save a profile after reviewing extracted fields', body: profileBody },
  }, request => {
    const user = requireUser(store, request, 'student');
    const profile = normalizeProfile({ ...store.getProfile(user.id), ...request.body });
    store.saveProfile(user.id, profile);
    return { profile };
  });
  const parseBody = Type.Object({ text: Type.String({ minLength: 1, maxLength: 20000, pattern: '\\S' }) }, { additionalProperties: false });
  app.post<{ Body: Static<typeof parseBody> }>('/api/v1/me/profile/parse', {
    schema: { ...secured, summary: 'Extract a profile from pasted background text; does not save it', body: parseBody },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async request => {
    requireUser(store, request, 'student');
    return { ...await parseProfile(request.body.text, ai), needsReview: true };
  });
  app.post('/api/v1/me/matches', {
    schema: { ...secured, summary: 'Rank clubs against your saved profile; scores are relevance, not acceptance odds' },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async request => {
    const user = requireUser(store, request, 'student');
    const clubs = store.listClubs();
    const resumeText = store.getResumeText(user.id);
    const result = await matchClubs({ ...store.getProfile(user.id), ...(resumeText ? { resumeText } : {}) }, clubs, ai);
    return {
      ...result,
      matches: result.matches.map(match => ({ ...match, club: clubs.find(club => club.id === match.clubId)! })),
    };
  });
  app.get('/api/v1/me/answers', { schema: { ...secured, summary: 'Read your private reusable answer library' } }, request => {
    const user = requireUser(store, request, 'student');
    return { answers: store.listAnswers(user.id) };
  });
  app.post<{ Body: Static<typeof answerBody> }>('/api/v1/me/answers', {
    schema: { ...secured, summary: 'Explicitly save an answer for reuse', body: answerBody },
  }, (request, reply) => {
    const user = requireUser(store, request, 'student');
    const answer: SavedAnswer = { id: randomUUID(), studentId: user.id, ...request.body, updatedAt: new Date().toISOString() };
    store.saveAnswer(answer);
    return reply.code(201).send({ answer });
  });
  app.put<{ Params: Static<typeof answerParams>; Body: Static<typeof answerBody> }>('/api/v1/me/answers/:answerId', {
    schema: { ...secured, params: answerParams, body: answerBody },
  }, request => {
    const user = requireUser(store, request, 'student');
    const existing = store.getAnswer(request.params.answerId);
    if (!existing || existing.studentId !== user.id) throw new HttpError(404, 'Saved answer not found.', 'NOT_FOUND');
    const answer = { ...existing, ...request.body, updatedAt: new Date().toISOString() };
    store.saveAnswer(answer);
    return { answer };
  });
  app.delete<{ Params: Static<typeof answerParams> }>('/api/v1/me/answers/:answerId', {
    schema: { ...secured, params: answerParams },
  }, (request, reply) => {
    const user = requireUser(store, request, 'student');
    if (!store.deleteAnswer(request.params.answerId, user.id)) throw new HttpError(404, 'Saved answer not found.', 'NOT_FOUND');
    return reply.code(204).send();
  });
  const suggestBody = Type.Object({ question: answerBody.properties.question }, { additionalProperties: false });
  app.post<{ Body: Static<typeof suggestBody> }>('/api/v1/me/answers/suggest', {
    schema: { ...secured, summary: 'Select a saved answer to reuse; review is required and nothing is submitted', body: suggestBody },
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
  }, async request => {
    const user = requireUser(store, request, 'student');
    return suggestAnswer(request.body.question, store.getProfile(user.id), store.listAnswers(user.id), ai);
  });
}
