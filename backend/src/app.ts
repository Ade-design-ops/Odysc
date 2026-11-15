import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import { randomBytes } from 'node:crypto';
import type { AiOptions } from './ai.js';
import type { ClubFinderOptions } from './club-finder.js';
import type { Store } from './db.js';
import { HttpError } from './errors.js';
import type { SupabaseOptions } from './supabase.js';
import type { SupabaseCatalogOptions } from './supabase-catalog.js';
import type { ResumeFiles } from './resume-files.js';
import type { WebAuthOptions } from './web-auth.js';
import type { FrontendStore } from './frontend-store.js';

export interface AppOptions {
  store?: Store;
  backend?: 'supabase' | 'sqlite';
  supabase?: SupabaseOptions;
  catalog?: SupabaseCatalogOptions;
  resumeFiles?: ResumeFiles;
  logger?: FastifyServerOptions['logger'];
  rateLimit?: boolean;
  ai?: AiOptions;
  clubFinder?: ClubFinderOptions;
  corsOrigins?: string[];
  webAuth?: WebAuthOptions;
  frontend?: false | { dbUrl?: string; caFile?: string; store?: FrontendStore };
  frontendDistDirectory?: string | false;
}
export async function buildApp(options: AppOptions = {}) {
  const backend = options.store ? 'sqlite' : options.backend ?? process.env.DATABASE_BACKEND ?? 'supabase';
  if (!['supabase', 'sqlite'].includes(backend)) throw new Error('DATABASE_BACKEND must be supabase or sqlite.');
  const app = Fastify({
    logger: options.logger ?? {
      level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
      // Confirmation codes arrive in the callback query string. Never log them.
      serializers: { req: (request: { method: string; url: string }) => ({ method: request.method, url: request.url.split('?')[0] }) },
    },
    bodyLimit: 128 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.validation) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: { code: error.code ?? 'REQUEST_ERROR', message: error.message } });
    }
    // Do not log request bodies, AI payloads, or raw database/provider errors containing user data.
    request.log.error({ errorName: error.name, requestId: request.id }, 'Unhandled request failure');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again.' } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Endpoint not found. See /docs.' } }));
  const corsOrigins = options.corsOrigins ?? (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:5173').split(',').map(origin => origin.trim()).filter(Boolean);
  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Odysc-Actor'],
  });
  if (options.rateLimit !== false) await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });
  await app.register(multipart, { throwFileSizeLimit: true, limits: { files: 1, fields: 0, parts: 1, fileSize: 5 * 1024 * 1024 } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'odysc API', version: '0.1.0', description: `Backend mode: ${backend}. Sign in via /api/v1/auth/login, then use Authorize with the accessToken. Supabase mode stores student profiles in the shared database. SQLite mode is an explicit local demo with fictional fixtures.` },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { persistAuthorization: false } });
  app.get('/health', { schema: { tags: ['System'] } }, () => ({ status: 'ok', service: 'odysc-backend', backend }));
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());
  const frontendDirectory = options.frontendDistDirectory ?? process.env.FRONTEND_DIST_DIRECTORY;
  if (frontendDirectory) {
    const { registerStaticSite } = await import('./static-site.js');
    await registerStaticSite(app, frontendDirectory);
  } else {
    app.get('/', { schema: { hide: true } }, () => ({ name: 'odysc API', docs: '/docs', health: '/health' }));
  }
  if (backend === 'supabase') {
    const configuration = options.supabase ?? {
      url: process.env.SUPABASE_URL ?? '', publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
      studentEmailDomain: process.env.STUDENT_EMAIL_DOMAIN ?? 'usc.edu',
    };
    if (!configuration.url || !configuration.publishableKey) throw new Error('Configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for the Supabase backend.');
    if (process.env.SEED_DEMO === 'true') throw new Error('SEED_DEMO applies only to the explicit SQLite demo.');
    const [{ registerSupabaseStudent }, { registerSupabaseCatalog }, { SupabaseGateway }, { ResumeFiles }, { registerSupabaseFeatures }, { WebAuthService }] = await Promise.all([
      import('./supabase-student.js'), import('./supabase-catalog.js'), import('./supabase.js'),
      import('./resume-files.js'), import('./supabase-features.js'),
      import('./web-auth.js'),
    ]);
    const cookieSecret = options.webAuth?.cookieSecret ?? process.env.AUTH_COOKIE_SECRET
      ?? (process.env.NODE_ENV === 'production' ? '' : randomBytes(32).toString('hex'));
    const frontendRouting = process.env.AUTH_FRONTEND_ROUTING ?? 'hash';
    if (frontendRouting !== 'hash' && frontendRouting !== 'history') throw new Error('AUTH_FRONTEND_ROUTING must be hash or history.');
    const webAuth = new WebAuthService(new SupabaseGateway(configuration), options.webAuth ?? {
      publicOrigin: process.env.AUTH_PUBLIC_ORIGIN ?? `http://localhost:${process.env.PORT ?? '3001'}`,
      frontendOrigin: process.env.AUTH_FRONTEND_ORIGIN ?? 'http://localhost:5173',
      frontendRouting,
      cookieSecret, allowedOrigins: corsOrigins,
    });
    webAuth.attachSession(app);
    webAuth.registerRoutes(app);
    const files = options.resumeFiles ?? new ResumeFiles(process.env.RESUME_DIRECTORY ?? './data/resumes');
    const catalog = await registerSupabaseCatalog(app, options.catalog ?? {
      dbUrl: process.env.SUPABASE_DB_URL ?? '', caFile: process.env.SUPABASE_DB_CA_FILE ?? '',
    });
    app.addHook('onClose', () => catalog.close());
    if (options.frontend !== false) {
      const { registerFrontendBackend } = await import('./frontend-backend.js');
      await registerFrontendBackend(app, {
        gateway: new SupabaseGateway(configuration), webAuth, catalog, resumeFiles: files, ai: options.ai, clubFinder: options.clubFinder,
        dbUrl: options.frontend?.dbUrl ?? process.env.SUPABASE_DB_URL ?? '',
        caFile: options.frontend?.caFile ?? process.env.SUPABASE_DB_CA_FILE ?? '',
        ...(options.frontend?.store ? { store: options.frontend.store } : {}),
      });
    }
    await registerSupabaseStudent(app, configuration, options.ai, { webAuth, getResumeInfo: id => files.getInfo(id).then(info => info ?? null) });
    await registerSupabaseFeatures(app, new SupabaseGateway(configuration), files, catalog, options.ai);
  } else {
    const [{ Store }, { registerAuth }, { registerCatalog }, { registerStudent }, { registerOnboarding }, { registerApplications }] = await Promise.all([
      import('./db.js'), import('./auth.js'), import('./catalog.js'), import('./student.js'), import('./onboarding.js'), import('./applications.js'),
    ]);
    const store = options.store ?? new Store(process.env.DATABASE_PATH);
    if (!options.store) app.addHook('onClose', async () => store.close());
    if (!options.store && process.env.SEED_DEMO === 'true') {
      if (process.env.NODE_ENV === 'production') throw new Error('Startup demo seeding is disabled in production.');
      const { seedDemo } = await import('./seed.js');
      await seedDemo(store);
    }
    await registerAuth(app, store);
    await registerCatalog(app, store);
    await registerStudent(app, store, options.ai);
    await registerOnboarding(app, store);
    await registerApplications(app, store);
  }
  return app;
}
