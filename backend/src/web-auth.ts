import { createHash, randomBytes } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AUTH_COOKIE_NAMES, AuthCookieService } from './auth-cookies.js';
import { HttpError } from './errors.js';
import { SupabaseGateway } from './supabase.js';
import type { User } from './models.js';

export interface WebAuthOptions {
  publicOrigin: string;
  frontendOrigin?: string;
  frontendRouting?: 'history' | 'hash';
  cookieSecret: string;
  allowedOrigins?: string[];
  now?: () => number;
}

const FLOW_SECONDS = 3600;
const RECOVERY_SECONDS = 15 * 60;
const SESSION_SECONDS = 30 * 24 * 3600;
const flowSchema = z.object({
  purpose: z.enum(['signup', 'recovery']), verifier: z.string().regex(/^[\w-]{43,128}$/),
  email: z.string().email(), expiresAt: z.number().finite(),
});
const storedSessionSchema = z.object({
  accessToken: z.string().min(1).max(16_384), refreshToken: z.string().min(1).max(16_384).optional(),
  expiresAt: z.number().finite(), expires: z.number().finite(),
});
const providerSessionSchema = z.object({
  access_token: z.string().min(1).max(16_384), refresh_token: z.string().min(1).max(16_384).optional(),
  expires_at: z.number().positive().optional(), expires_in: z.number().positive().optional(), user: z.unknown(),
}).passthrough();
type Flow = z.infer<typeof flowSchema>;
type StoredSession = z.infer<typeof storedSessionSchema>;
const emailBody = Type.Object({ email: Type.String({ format: 'email', maxLength: 254 }) }, { additionalProperties: false });
const passwordBody = Type.Object({ password: Type.String({ minLength: 10, maxLength: 128 }) }, { additionalProperties: false });
const authWrites = new Set([
  '/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/auth/forgot-password', '/api/v1/auth/resend-confirmation', '/api/v1/auth/reset-password',
  '/api/auth/register', '/api/auth/login', '/api/auth/forgot-password', '/api/auth/resend-confirmation', '/api/auth/reset-password',
]);

function validatedOrigin(value: string, setting: string): string {
  const origin = new URL(value);
  if (origin.username || origin.password || origin.search || origin.hash || !['', '/'].includes(origin.pathname)
    || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new Error(`${setting} must be an HTTPS origin, or localhost for development.`);
  }
  return origin.origin;
}

export class WebAuthService {
  private readonly cookies: AuthCookieService;
  private readonly now: () => number;
  private readonly origin: string;
  private readonly frontendOrigin: string;
  private readonly frontendRouting: 'history' | 'hash';
  private readonly allowedOrigins: Set<string>;
  private readonly identities = new WeakMap<FastifyRequest, { user: User; token: string }>();
  private readonly refreshing = new Map<string, Promise<StoredSession>>();

  constructor(private readonly gateway: SupabaseGateway, options: WebAuthOptions) {
    this.origin = validatedOrigin(options.publicOrigin, 'AUTH_PUBLIC_ORIGIN');
    this.frontendOrigin = options.frontendOrigin === undefined ? '' : validatedOrigin(options.frontendOrigin, 'AUTH_FRONTEND_ORIGIN');
    if (options.frontendRouting !== undefined && !['history', 'hash'].includes(options.frontendRouting)) {
      throw new Error('AUTH_FRONTEND_ROUTING must be history or hash.');
    }
    this.frontendRouting = options.frontendRouting ?? 'history';
    this.allowedOrigins = new Set([this.origin, ...(this.frontendOrigin ? [this.frontendOrigin] : []), ...(options.allowedOrigins ?? []).map(value => new URL(value).origin)]);
    this.cookies = new AuthCookieService(options.cookieSecret, new URL(this.origin).protocol === 'https:');
    this.now = options.now ?? Date.now;
  }

  private frontendDestination(destination: 'signup' | 'recovery' | 'error', reason: 'expired_link' | 'invalid_link' | 'missing_flow' = 'invalid_link'): string {
    const hash = this.frontendRouting === 'hash';
    const path = destination === 'signup' ? `${hash ? '/profile' : '/student'}?welcome=1`
      : destination === 'recovery' ? '/reset-password' : `/auth/error?reason=${reason}`;
    return `${this.frontendOrigin}${hash ? '/#' : ''}${path}`;
  }

  beginFlow(reply: FastifyReply, purpose: Flow['purpose'], email: string) {
    this.gateway.assertStudentEmail(email);
    return this.saveFlow(reply, { purpose, email: email.toLowerCase(), verifier: randomBytes(32).toString('base64url'), expiresAt: this.now() + FLOW_SECONDS * 1000 });
  }

  private saveFlow(reply: FastifyReply, flow: Flow) {
    this.cookies.write(reply, AUTH_COOKIE_NAMES.flow, flow, Math.ceil((flow.expiresAt - this.now()) / 1000));
    return { code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'), code_challenge_method: 's256' as const, redirectTo: `${this.origin}/auth/callback` };
  }

  private readFlow(request: FastifyRequest): Flow | null {
    const parsed = flowSchema.safeParse(this.cookies.read(request, AUTH_COOKIE_NAMES.flow));
    return parsed.success ? parsed.data : null;
  }

  setSession(reply: FastifyReply, response: unknown): void {
    const stored = this.providerSession(response, SESSION_SECONDS);
    this.writeSession(reply, stored);
    this.cookies.clear(reply, AUTH_COOKIE_NAMES.recovery);
  }

  clearSession(reply: FastifyReply): void {
    for (const name of Object.values(AUTH_COOKIE_NAMES)) this.cookies.clear(reply, name);
  }

  private providerSession(response: unknown, lifetime: number): StoredSession {
    const result = providerSessionSchema.safeParse(response);
    if (!result.success) throw new HttpError(502, 'Supabase returned an invalid sign-in response.', 'SUPABASE_RESPONSE_ERROR');
    this.gateway.studentUser(result.data.user);
    const expiresAt = result.data.expires_at ? result.data.expires_at * 1000 : this.now() + (result.data.expires_in ?? 3600) * 1000;
    return {
      accessToken: result.data.access_token, ...(result.data.refresh_token ? { refreshToken: result.data.refresh_token } : {}),
      expiresAt, expires: this.now() + lifetime * 1000,
    };
  }

  private writeSession(reply: FastifyReply, stored: StoredSession): void {
    const expiration = stored.refreshToken ? stored.expires : Math.min(stored.expires, stored.expiresAt);
    this.cookies.write(reply, AUTH_COOKIE_NAMES.session, stored, Math.ceil((expiration - this.now()) / 1000));
  }

  private requireOrigin(request: FastifyRequest, requirePresent: boolean): void {
    const value = request.headers.origin;
    if ((!value && requirePresent) || (value && !this.allowedOrigins.has(value))) {
      throw new HttpError(403, 'Send this request from the Odysc website.', 'ORIGIN_NOT_ALLOWED');
    }
  }

  attachSession(app: FastifyInstance): void {
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0]!;
      if (path.startsWith('/api/v1/auth/') || path.startsWith('/api/auth/') || path === '/api/session' || path === '/auth/callback') {
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      }
      if (!path.startsWith('/api/')) return;
      const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      const explicitBearer = request.headers.authorization !== undefined;
      if (write && authWrites.has(path) && !explicitBearer) this.requireOrigin(request, false);
      if (explicitBearer) return;
      const parsed = storedSessionSchema.safeParse(this.cookies.read(request, AUTH_COOKIE_NAMES.session));
      if (!parsed.success) return;
      let stored = parsed.data;
      if (stored.expires <= this.now()) {
        this.cookies.clear(reply, AUTH_COOKIE_NAMES.session);
        return;
      }
      if (write) this.requireOrigin(request, true);
      try {
        let refreshed = false;
        if (stored.expiresAt <= this.now()) {
          if (!stored.refreshToken) {
            this.cookies.clear(reply, AUTH_COOKIE_NAMES.session);
            return;
          }
          const refreshToken = stored.refreshToken;
          let pending = this.refreshing.get(refreshToken);
          if (!pending) {
            pending = this.gateway.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } })
              .then(value => this.providerSession(value, SESSION_SECONDS));
            this.refreshing.set(refreshToken, pending);
          }
          try { stored = await pending; } finally { if (this.refreshing.get(refreshToken) === pending) this.refreshing.delete(refreshToken); }
          refreshed = true;
        }
        const identity = await this.gateway.getIdentity(stored.accessToken);
        if (refreshed) this.writeSession(reply, stored);
        this.identities.set(request, identity);
        request.headers.authorization = `Bearer ${identity.token}`;
      } catch (error) {
        if (!(error instanceof HttpError) || ![400, 401, 403].includes(error.statusCode)) throw error;
        this.cookies.clear(reply, AUTH_COOKIE_NAMES.session);
      }
    });
  }

  registerRoutes(app: FastifyInstance): void {
    app.get('/api/v1/auth/session', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      let identity = this.identities.get(request);
      if (!identity && request.headers.authorization?.startsWith('Bearer ')) {
        try { identity = await this.gateway.getIdentity(request.headers.authorization.slice(7)); }
        catch (error) { if (!(error instanceof HttpError) || ![401, 403].includes(error.statusCode)) throw error; }
      }
      return identity ? { authenticated: true, user: identity.user } : { authenticated: false };
    });

    app.get<{ Querystring: { code?: string; error?: string; error_code?: string } }>('/auth/callback', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const flow = this.readFlow(request);
      this.cookies.clear(reply, AUTH_COOKIE_NAMES.flow);
      const fail = (reason: 'expired_link' | 'invalid_link' | 'missing_flow') => reply.code(303).redirect(this.frontendDestination('error', reason));
      if (!flow) return fail('missing_flow');
      if (flow.expiresAt <= this.now() || request.query.error_code === 'otp_expired') return fail('expired_link');
      if (request.query.error || typeof request.query.code !== 'string' || !request.query.code || request.query.code.length > 4096) return fail('invalid_link');
      try {
        const response = await this.gateway.request('/auth/v1/token?grant_type=pkce', {
          method: 'POST', body: { auth_code: request.query.code, code_verifier: flow.verifier },
        });
        const stored = this.providerSession(response, flow.purpose === 'recovery' ? RECOVERY_SECONDS : SESSION_SECONDS);
        const identity = await this.gateway.getIdentity(stored.accessToken);
        if (identity.user.email.toLowerCase() !== flow.email) return fail('invalid_link');
        if (flow.purpose === 'recovery') {
          this.clearSession(reply);
          this.cookies.write(reply, AUTH_COOKIE_NAMES.recovery, { accessToken: stored.accessToken, expiresAt: Math.min(stored.expiresAt, stored.expires) }, RECOVERY_SECONDS);
          return reply.code(303).redirect(this.frontendDestination('recovery'));
        }
        this.setSession(reply, response);
        return reply.code(303).redirect(this.frontendDestination('signup'));
      } catch {
        return fail('invalid_link');
      }
    });

    app.post<{ Body: Static<typeof emailBody> }>('/api/v1/auth/forgot-password', {
      schema: { tags: ['Auth'], body: emailBody }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const email = request.body.email.toLowerCase();
      const { redirectTo, ...pkce } = this.beginFlow(reply, 'recovery', email);
      try { await this.gateway.request(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email, ...pkce } }); }
      catch (error) {
        // Neither existing accounts nor missing accounts are disclosed by this endpoint.
        if (!(error instanceof HttpError) || ![400, 404, 409].includes(error.statusCode)) throw error;
      }
      return { message: 'If an account exists for that email, a password reset link has been sent.' };
    });

    app.post<{ Body: Static<typeof emailBody> }>('/api/v1/auth/resend-confirmation', {
      schema: { tags: ['Auth'], body: emailBody }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const email = request.body.email.toLowerCase();
      this.gateway.assertStudentEmail(email);
      const previous = this.readFlow(request);
      const pkce = previous?.purpose === 'signup' && previous.email === email && previous.expiresAt > this.now()
        ? this.saveFlow(reply, { ...previous, expiresAt: this.now() + FLOW_SECONDS * 1000 }) : this.beginFlow(reply, 'signup', email);
      const { redirectTo, ...challenge } = pkce;
      try { await this.gateway.request(`/auth/v1/resend?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email, type: 'signup', ...challenge } }); }
      catch (error) { if (!(error instanceof HttpError) || ![400, 404, 409].includes(error.statusCode)) throw error; }
      return { message: 'If confirmation is still needed, a new email has been sent.' };
    });

    app.get('/api/v1/auth/recovery-session', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return { valid: Boolean(await this.recoveryIdentity(request, reply)) };
    });
    app.post<{ Body: Static<typeof passwordBody> }>('/api/v1/auth/reset-password', {
      schema: { tags: ['Auth'], body: passwordBody }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      this.requireOrigin(request, true);
      const recovery = await this.recoveryIdentity(request, reply);
      if (!recovery) throw new HttpError(401, 'Request a new password reset link, then open it in this browser.', 'RECOVERY_SESSION_REQUIRED');
      await this.gateway.request('/auth/v1/user', { method: 'PUT', token: recovery.token, body: { password: request.body.password } });
      this.clearSession(reply);
      try { await this.gateway.request('/auth/v1/logout?scope=local', { method: 'POST', token: recovery.token }); } catch { /* Password change succeeded; expiry and cleared cookies close this flow locally. */ }
      return { message: 'Password updated. Sign in with your new password.' };
    });
  }

  private async recoveryIdentity(request: FastifyRequest, reply: FastifyReply): Promise<{ user: User; token: string } | null> {
    const recovery = z.object({ accessToken: z.string().min(1).max(16_384), expiresAt: z.number().finite() }).safeParse(this.cookies.read(request, AUTH_COOKIE_NAMES.recovery));
    if (!recovery.success || recovery.data.expiresAt <= this.now()) {
      this.cookies.clear(reply, AUTH_COOKIE_NAMES.recovery);
      return null;
    }
    try { return await this.gateway.getIdentity(recovery.data.accessToken); }
    catch (error) {
      if (!(error instanceof HttpError) || ![400, 401, 403].includes(error.statusCode)) throw error;
      this.cookies.clear(reply, AUTH_COOKIE_NAMES.recovery);
      return null;
    }
  }
}
