import { buildApp } from './app.js';
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  app = await buildApp();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app?.close().catch(() => { process.exitCode = 1; }); });
  }
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1' });
} catch {
  console.error('Could not start the API. Check backend/.env, Supabase connection settings, host, and port; see README.md.');
  await app?.close();
  process.exitCode = 1;
}
