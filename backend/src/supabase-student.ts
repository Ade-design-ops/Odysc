import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseProfile, type AiOptions } from './ai.js';
import { HttpError } from './errors.js';
import { onboardingFields } from './onboarding-fields.js';
import { academicYearSchema, normalizeProfile, profileBody, tagList } from './profile.js';
import { SupabaseGateway, missingBasics, profileRow, toApiProfile, type StoredStudentProfile, type SupabaseOptions } from './supabase.js';
import type { ResumeInfo, User } from './models.js';
import type { WebAuthService } from './web-auth.js';

export interface SupabaseStudentServices {
  getResumeInfo?: (userId: string) => Promise<ResumeInfo | null>;
  webAuth?: WebAuthService;
}

const secured = { tags: ['Student onboarding'], security: [{ bearerAuth: [] }] };
const newPassword = Type.String({ minLength: 10, maxLength: 128 });
const credentials = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  // Supabase validates existing credentials. Creation/reset enforce our minimum.
  password: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
const registration = Type.Object({
  ...credentials.properties,
  password: newPassword,
  name: Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' }),
  role: Type.Union([Type.Literal('student'), Type.Literal('organizer')]),
}, { additionalProperties: false });
const patch = Type.Object({
  name: Type.Optional(registration.properties.name), academicYear: Type.Optional(academicYearSchema),
  major: Type.Optional(Type.String({ maxLength: 150 })), interests: Type.Optional(tagList(20)),
  goals: Type.Optional(tagList(10, 300)), bio: Type.Optional(Type.String({ maxLength: 1500 })),
  skills: Type.Optional(tagList(30)),
}, { additionalProperties: false, minProperties: 1 });

export function supabaseBearer(request: FastifyRequest): string {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer ') || value.length > 16_391) throw new HttpError(401, 'Sign in with a Bearer token.', 'UNAUTHORIZED');
  return value.slice(7);
}
const bearer = supabaseBearer;

async function snapshot(user: User, row: StoredStudentProfile | null, services: SupabaseStudentServices) {
  const currentUser = row ? { ...user, name: row.full_name } : user;
  const profile = toApiProfile(row);
  const resume = await services.getResumeInfo?.(currentUser.id) ?? null;
  const missingRequiredFields = [...missingBasics(currentUser, profile), ...(!resume ? ['resume'] : [])];
  const completedAt = missingRequiredFields.length ? null : row?.onboarding_completed_at ?? null;
  return {
    user: currentUser, profile, resume,
    onboarding: {
      status: completedAt ? 'completed' : row || resume ? 'in_progress' : 'not_started', completedAt,
      missingRequiredFields,
      recommendedFields: [...(!profile.goals.length ? ['goals'] : []), ...(!profile.bio ? ['bio'] : []), ...(!profile.skills.length ? ['skills'] : [])],
    },
    fields: onboardingFields,
  };
}

function session(value: unknown, gateway: SupabaseGateway) {
  const envelope = z.object({
    user: z.unknown().optional(), access_token: z.string().min(1).optional(),
    expires_at: z.number().optional(), expires_in: z.number().optional(),
  }).passthrough().safeParse(value);
  if (!envelope.success) throw new HttpError(502, 'Supabase returned an invalid sign-in response.', 'SUPABASE_RESPONSE_ERROR');
  const data = envelope.data;
  const accessToken = data.access_token ?? null;
  const user = gateway.studentUser(data.user ?? value, { allowUnconfirmed: !accessToken });
  const expiry = data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in ?? 3600) * 1000;
  return { user, accessToken, tokenType: 'Bearer' as const, expiresAt: accessToken ? new Date(expiry).toISOString() : null, requiresEmailConfirmation: !accessToken };
}

export async function registerSupabaseStudent(app: FastifyInstance, options: SupabaseOptions, ai: AiOptions = {}, services: SupabaseStudentServices = {}) {
  const gateway = new SupabaseGateway(options);
  async function current(request: FastifyRequest) {
    const identity = await gateway.getIdentity(bearer(request));
    const row = await gateway.getProfile(identity.token, identity.user.id);
    return { ...identity, row, user: row ? { ...identity.user, name: row.full_name } : identity.user };
  }

  app.post<{ Body: Static<typeof registration> }>('/api/v1/auth/register', {
    schema: { tags: ['Auth'], summary: 'Create a student account with Supabase Auth', body: registration },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (request.body.role !== 'student') throw new HttpError(503, 'Organizer onboarding is not connected in this backend mode yet.', 'FEATURE_NOT_CONNECTED');
    gateway.assertStudentEmail(request.body.email);
    const flow = services.webAuth?.beginFlow(reply, 'signup', request.body.email);
    const result = await gateway.request(`/auth/v1/signup${flow ? `?redirect_to=${encodeURIComponent(flow.redirectTo)}` : ''}`, {
      method: 'POST', body: {
        email: request.body.email.toLowerCase(), password: request.body.password, data: { name: request.body.name.trim(), role: 'student' },
        ...(flow ? { code_challenge: flow.code_challenge, code_challenge_method: flow.code_challenge_method } : {}),
      },
    });
    const signedIn = session(result, gateway);
    if (signedIn.accessToken) services.webAuth?.setSession(reply, result);
    return reply.code(201).send(signedIn);
  });
  app.post<{ Body: Static<typeof credentials> }>('/api/v1/auth/login', {
    schema: { tags: ['Auth'], summary: 'Sign in through Supabase Auth', body: credentials },
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    gateway.assertStudentEmail(request.body.email);
    const result = await gateway.request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email: request.body.email.toLowerCase(), password: request.body.password },
    });
    const signedIn = session(result, gateway);
    if (!signedIn.accessToken) throw new HttpError(401, 'Confirm your email before signing in.', 'EMAIL_CONFIRMATION_REQUIRED');
    const row = await gateway.getProfile(signedIn.accessToken, signedIn.user.id);
    services.webAuth?.setSession(reply, result);
    return { ...signedIn, user: row ? { ...signedIn.user, name: row.full_name } : signedIn.user };
  });
  app.get('/api/v1/auth/me', { schema: { ...secured, tags: ['Auth'] } }, async request => ({ user: (await current(request)).user }));
  app.post('/api/v1/auth/logout', { schema: { ...secured, tags: ['Auth'] } }, async (request, reply) => {
    services.webAuth?.clearSession(reply);
    const { token } = await gateway.getIdentity(bearer(request));
    await gateway.request('/auth/v1/logout?scope=local', { method: 'POST', token });
    return reply.code(204).send();
  });

  app.get('/api/v1/me/profile', { schema: { ...secured, summary: 'Read your profile stored in Supabase' } }, async request => {
    const { user, row } = await current(request);
    return { user, profile: toApiProfile(row) };
  });
  app.put<{ Body: Static<typeof profileBody> }>('/api/v1/me/profile', {
    schema: { ...secured, summary: 'Save your reusable profile in Supabase', body: profileBody },
  }, async request => {
    const { user, row, token } = await current(request);
    const updated = normalizeProfile({ ...toApiProfile(row), ...request.body });
    const saved = await gateway.saveProfile(token, profileRow(user, updated, row));
    return { profile: toApiProfile(saved) };
  });
  app.get('/api/v1/me/onboarding', { schema: { ...secured, summary: 'Load student onboarding from Supabase' } }, async request => {
    const { user, row } = await current(request);
    return snapshot(user, row, services);
  });
  app.patch<{ Body: Static<typeof patch> }>('/api/v1/me/onboarding', {
    schema: { ...secured, summary: 'Save part of your onboarding draft in Supabase', body: patch },
  }, async request => {
    const { user, row, token } = await current(request);
    const { name, ...changes } = request.body;
    const updatedUser = { ...user, ...(name === undefined ? {} : { name: name.trim() }) };
    const updatedProfile = normalizeProfile({ ...toApiProfile(row), ...changes });
    const saved = await gateway.saveProfile(token, profileRow(updatedUser, updatedProfile, row));
    return snapshot(updatedUser, saved, services);
  });
  app.post('/api/v1/me/onboarding/complete', {
    schema: { ...secured, summary: 'Complete onboarding with the required profile fields and PDF résumé', body: Type.Object({}, { additionalProperties: false }) },
  }, async request => {
    const { user, row, token } = await current(request);
    const profile = toApiProfile(row);
    const resume = await services.getResumeInfo?.(user.id) ?? null;
    const missing = [...missingBasics(user, profile), ...(!resume ? ['resume'] : [])];
    if (missing.length) throw new HttpError(400, `Complete these required fields first: ${missing.join(', ')}. Optional details can be added later.`, 'MISSING_ONBOARDING_FIELDS');
    const saved = await gateway.saveProfile(token, profileRow(user, profile, row, row?.onboarding_completed_at ?? new Date().toISOString()));
    return snapshot(user, saved, services);
  });
  const parseBody = Type.Object({ text: Type.String({ minLength: 1, maxLength: 20000, pattern: '\\S' }) }, { additionalProperties: false });
  app.post<{ Body: Static<typeof parseBody> }>('/api/v1/me/profile/parse', {
    schema: { ...secured, summary: 'Extract suggested fields for review without saving them', body: parseBody },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async request => {
    await gateway.getIdentity(bearer(request));
    return { ...await parseProfile(request.body.text, ai), needsReview: true };
  });
}
