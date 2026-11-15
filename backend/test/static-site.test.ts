import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { buildApp } from '../src/app.js';
import { Store } from '../src/db.js';

async function fixture(t: TestContext) {
  const parent = await mkdtemp(join(tmpdir(), 'odysc-static-'));
  const directory = join(parent, 'public');
  await mkdir(join(directory, 'assets'), { recursive: true });
  await mkdir(join(directory, 'api'), { recursive: true });
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Odysc</title><div id="root"></div>');
  await writeFile(join(directory, 'assets', 'app.js'), 'console.log("Odysc");');
  await writeFile(join(directory, '.env'), 'PRIVATE_VALUE=hidden');
  await writeFile(join(directory, 'api', 'shadow'), 'must never shadow API');
  await writeFile(join(parent, 'private.pdf'), 'private resume');
  const store = new Store(':memory:');
  const app = await buildApp({ store, logger: false, rateLimit: false, frontendDistDirectory: directory });
  t.after(async () => { await app.close(); store.close(); await rm(parent, { recursive: true, force: true }); });
  return { app };
}

test('production serves the built client and preserves API, docs, and health routes', async t => {
  const { app } = await fixture(t);
  const home = await app.inject('/');
  assert.equal(home.statusCode, 200);
  assert.match(home.headers['content-type'] ?? '', /text\/html/);
  assert.match(home.body, /<title>Odysc<\/title>/);
  assert.match(home.headers['cache-control'] ?? '', /must-revalidate/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  const asset = await app.inject('/assets/app.js');
  assert.equal(asset.statusCode, 200);
  assert.match(asset.headers['content-type'] ?? '', /javascript/);
  assert.equal((await app.inject({ method: 'HEAD', url: '/' })).body, '');
  assert.equal((await app.inject('/health')).json().status, 'ok');
  assert.equal((await app.inject('/openapi.json')).statusCode, 200);
  assert.equal((await app.inject('/docs/')).statusCode, 200);
  for (const url of ['/api/missing', '/api/shadow', '/assets/missing.js']) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 404, url);
    assert.equal(response.json().error.code, 'NOT_FOUND');
  }
});

test('production static root cannot expose hidden files or adjacent private résumés', async t => {
  const { app } = await fixture(t);
  for (const url of ['/.env', '/../private.pdf', '/%2e%2e/private.pdf', '/assets/%2e%2e/%2e%2e/private.pdf']) {
    const response = await app.inject(url);
    assert.ok(response.statusCode === 403 || response.statusCode === 404, `${url}: ${response.statusCode}`);
    assert.doesNotMatch(response.body, /PRIVATE_VALUE|private resume/);
  }
});

test('without a frontend directory the existing API root remains available', async t => {
  const store = new Store(':memory:');
  const app = await buildApp({ store, logger: false, rateLimit: false, frontendDistDirectory: false });
  t.after(async () => { await app.close(); store.close(); });
  assert.equal((await app.inject('/')).json().name, 'odysc API');
});
