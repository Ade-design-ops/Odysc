import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/** Serve only the compiled public client; uploaded résumés remain outside this root. */
export async function registerStaticSite(app: FastifyInstance, directory: string): Promise<void> {
  const root = resolve(directory);
  await access(resolve(root, 'index.html'));
  await app.register(fastifyStatic, {
    root,
    index: false,
    dotfiles: 'deny',
    serveDotFiles: false,
    cacheControl: false,
    allowedPath: (_path, _root, request) => !/^\/(?:api|auth|docs|health|openapi\.json)(?:[/?]|$)/.test(request.url),
    setHeaders: response => {
      response.header('X-Content-Type-Options', 'nosniff');
      // Revalidate after deployment, including HTML that references versioned assets.
      response.header('Cache-Control', 'public, max-age=0, must-revalidate');
    },
  });
  app.get('/', { schema: { hide: true } }, (_request, reply) => reply.sendFile('index.html'));
}
