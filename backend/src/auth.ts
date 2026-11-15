import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Store } from './db.js';
import { HttpError } from './errors.js';
import { emptyProfile, type Role, type User } from './models.js';

const scryptAsync = promisify(scrypt);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const key = await scryptAsync(password, salt, 64) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}
function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.length > 200) throw new HttpError(401, 'Sign in with a Bearer token.', 'UNAUTHORIZED');
  return header.slice(7);
}
export function requireUser(store: Store, request: FastifyRequest, role?: Role): User {
  const row = store.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?')
    .get(tokenHash(bearer(request)), Date.now()) as { user_id: string } | undefined;
  const user = row ? store.getUser(row.user_id) : undefined;
  if (!user) throw new HttpError(401, 'Your session is missing or expired.', 'UNAUTHORIZED');
  if (role && user.role !== role) throw new HttpError(403, `This action requires a ${role} account.`, 'FORBIDDEN');
  return user;
}
export function assertOwner(store: Store, request: FastifyRequest, clubId: string) {
  const user = requireUser(store, request, 'organizer');
  const club = store.getClub(clubId);
  if (!club) throw new HttpError(404, 'Club not found.', 'NOT_FOUND');
  if (club.ownerId !== user.id) throw new HttpError(403, 'Only this club’s organizer can make that change.', 'FORBIDDEN');
  return { user, club };
}
function createSession(store: Store, user: User) {
  const accessToken = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  store.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  store.db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(tokenHash(accessToken), user.id, expiresAt);
  return { user, accessToken, tokenType: 'Bearer' as const, expiresAt: new Date(expiresAt).toISOString() };
}
const credentials = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  password: Type.String({ minLength: 10, maxLength: 128 }),
}, { additionalProperties: false });
const registration = Type.Object({
  ...credentials.properties,
  name: Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' }),
  role: Type.Union([Type.Literal('student'), Type.Literal('organizer')]),
}, { additionalProperties: false });

export async function registerAuth(app: FastifyInstance, store: Store) {
  app.post<{ Body: Static<typeof registration> }>('/api/v1/auth/register', {
    schema: { tags: ['Auth'], summary: 'Create a prototype account (email is not verified)', body: registration },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const email = request.body.email.toLowerCase();
    if (store.getUserByEmail(email)) throw new HttpError(409, 'An account already exists for this email.', 'CONFLICT');
    const passwordHash = await hashPassword(request.body.password);
    const user: User = { id: randomUUID(), email, name: request.body.name.trim(), role: request.body.role, createdAt: new Date().toISOString() };
    // Recheck after asynchronous hashing so concurrent registration is a clean conflict.
    if (store.getUserByEmail(email)) throw new HttpError(409, 'An account already exists for this email.', 'CONFLICT');
    store.transaction(() => {
      store.insertUser(user, passwordHash);
      if (user.role === 'student') store.saveProfile(user.id, emptyProfile());
    });
    reply.code(201);
    return createSession(store, user);
  });
  app.post<{ Body: Static<typeof credentials> }>('/api/v1/auth/login', {
    schema: { tags: ['Auth'], summary: 'Sign in and receive a Bearer token', body: credentials },
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
  }, async request => {
    const stored = store.getUserByEmail(request.body.email.toLowerCase());
    // Use a real scrypt operation for unknown accounts, too.
    const valid = await verifyPassword(request.body.password, stored?.passwordHash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!stored || !valid) throw new HttpError(401, 'Email or password is incorrect.', 'UNAUTHORIZED');
    const { passwordHash: _passwordHash, ...user } = stored;
    return createSession(store, user);
  });
  app.get('/api/v1/auth/me', { schema: { tags: ['Auth'], security: [{ bearerAuth: [] }] } }, request => ({ user: requireUser(store, request) }));
  app.post('/api/v1/auth/logout', { schema: { tags: ['Auth'], security: [{ bearerAuth: [] }] } }, (request, reply) => {
    requireUser(store, request);
    store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(bearer(request)));
    return reply.code(204).send();
  });
}
