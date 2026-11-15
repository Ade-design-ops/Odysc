import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { HttpError } from '../src/errors.js';
import {
  directoryWebsite, mapDirectoryClub, MAX_DIRECTORY_ROWS, parseDirectoryTags,
  registerSupabaseCatalog, type CatalogQuery, type CatalogRow,
} from '../src/supabase-catalog.js';

const dbUrl = 'postgresql://postgres.cfrkamtsphdlowuiuarn:test-only-password@aws-0-us-west-1.pooler.supabase.com:5432/postgres';
const sample: CatalogRow = {
  id: '9007199254740993', name: '  Campus Builders  ', category: '  Engineering  ',
  website: 'www.example.edu/builders', tags: '["Robotics", "Community service", "robotics"]',
};

async function fixture(t: TestContext, query: CatalogQuery) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof HttpError ? error.statusCode : (error as { statusCode?: number }).statusCode ?? 500;
    reply.code(status).send({ error: { message: (error as Error).message } });
  });
  const service = await registerSupabaseCatalog(app, { dbUrl, caFile: 'unused-in-query-injection-tests', query });
  t.after(async () => { await app.close(); await service.close(); });
  return { app, service };
}

test('directory mapping preserves bigint IDs and marks unavailable club fields honestly', () => {
  const club = mapDirectoryClub(sample);
  assert.equal(club.id, '9007199254740993');
  assert.equal(club.slug, 'usc-club-9007199254740993');
  assert.equal(club.name, 'Campus Builders');
  assert.equal(club.category, 'Engineering');
  assert.deepEqual(club.tags, ['Robotics', 'Community service']);
  assert.equal(club.websiteUrl, 'https://www.example.edu/builders');
  assert.equal(club.isDemo, false);
  assert.equal(club.acceptingApplications, false);
  assert.equal(club.ownerId, '');
  assert.equal(club.contactEmail, '');
  assert.equal(club.description, '');
  assert.equal(club.createdAt, '');
  assert.equal(club.updatedAt, '');
  assert.equal(club.applicationDeadline, null);
  assert.deepEqual(club.questions, []);
});

test('directory tags decode clear formats and retain multiword phrases', () => {
  assert.deepEqual(parseDirectoryTags(null), []);
  assert.deepEqual(parseDirectoryTags('  '), []);
  assert.deepEqual(parseDirectoryTags('Community service'), ['Community service']);
  assert.deepEqual(parseDirectoryTags('Music; Community service|Music\nDesign,design'), ['Music', 'Community service', 'Design']);
  assert.deepEqual(parseDirectoryTags('["Arts, music", "Career skills", "career SKILLS", " "]'), ['Arts, music', 'Career skills']);
});

test('directory website handling permits clear web links and rejects unsafe or ambiguous values', () => {
  assert.equal(directoryWebsite(null), null);
  assert.equal(directoryWebsite('  https://example.edu/club  '), 'https://example.edu/club');
  assert.equal(directoryWebsite('http://example.edu'), 'http://example.edu/');
  assert.equal(directoryWebsite('example.edu/club'), 'https://example.edu/club');
  for (const value of ['javascript:alert(1)', 'file:///tmp/secrets', 'ftp://example.edu/file', 'not a website', 'https://example.edu https://other.edu', 'https://user:password@example.edu/']) {
    assert.equal(directoryWebsite(value), null, value);
  }
});

test('public directory request filters are passed as SQL values to a bounded fixed SELECT', async t => {
  const calls: { sql: string; values?: readonly unknown[] }[] = [];
  const { app, service } = await fixture(t, async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [sample] };
  });
  const response = await app.inject('/api/v1/clubs?q=%27%3BDELETE%20FROM%20public.clubs%3B--&category=Engineering');
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().clubs[0].id, sample.id);
  assert.equal(response.json().limit, MAX_DIRECTORY_ROWS);
  assert.deepEqual(calls[0]!.values, ["';DELETE FROM public.clubs;--", 'Engineering']);
  assert.equal(calls[0]!.sql.includes("';DELETE"), false);
  assert.match(calls[0]!.sql, /FROM public\.clubs/);
  assert.match(calls[0]!.sql, /club_id::text/);
  assert.match(calls[0]!.sql, /LIMIT 2000/);
  assert.equal(calls[0]!.sql.includes('*'), false);
  assert.equal(calls[0]!.sql.includes('student_mock'), false);
  const clubs = await service.listClubs();
  assert.equal(clubs[0]!.name, 'Campus Builders');
  assert.deepEqual(calls[1]!.values, ['', '']);
  const tooLong = await app.inject(`/api/v1/clubs?q=${'a'.repeat(201)}`);
  assert.equal(tooLong.statusCode, 400, tooLong.body);
});

test('club details accept IDs and stable slugs without precision loss or fabricated events', async t => {
  const values: unknown[] = [];
  const { app, service } = await fixture(t, async (_sql, params) => {
    values.push(params?.[0]);
    return { rows: [sample] };
  });
  for (const id of [sample.id, `usc-club-${sample.id}`]) {
    const response = await app.inject(`/api/v1/clubs/${id}`);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().club.id, sample.id);
    assert.deepEqual(response.json().events, []);
    assert.match(response.json().notice, /not available/);
  }
  assert.deepEqual(values, [sample.id, sample.id]);
  const events = await app.inject('/api/v1/events');
  assert.equal(events.statusCode, 200, events.body);
  assert.deepEqual(events.json().events, []);
  assert.equal(await service.getClub('99999999999999999999999999'), undefined);
  assert.equal(await service.getClub('1;drop-table'), undefined);
  assert.equal(values.length, 2);
});

test('missing clubs return 404 and database errors return a safe 503 without connection details', async t => {
  let fail = false;
  const { app } = await fixture(t, async () => {
    if (fail) throw new Error('Connection failed: postgres://private-user:secret-password@private-host');
    return { rows: [] };
  });
  const missing = await app.inject('/api/v1/clubs/42');
  assert.equal(missing.statusCode, 404, missing.body);
  fail = true;
  for (const url of ['/api/v1/clubs', '/api/v1/clubs/42']) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.body.includes('secret-password'), false);
    assert.equal(response.body.includes('private-host'), false);
    assert.match(response.json().error.message, /temporarily unavailable/);
  }
});

test('catalog refuses incorrect projects and a missing CA path before any query executes', async t => {
  const app = Fastify();
  t.after(() => app.close());
  let calls = 0;
  const query: CatalogQuery = async () => { calls++; return { rows: [] }; };
  for (const options of [
    { dbUrl: 'postgresql://user:secret@unrelated.example.com/postgres', caFile: 'test-ca', query },
    { dbUrl, caFile: '', query },
    { dbUrl: dbUrl.replace('.cfrkamtsphdlowuiuarn:', '.another-project:'), caFile: 'test-ca', query },
  ]) {
    await assert.rejects(registerSupabaseCatalog(app, options), error => {
      assert.match((error as Error).message, /valid project database URL and CA certificate path/);
      assert.equal((error as Error).message.includes('secret'), false);
      return true;
    });
  }
  assert.equal(calls, 0);
});

test('catalog service shutdown is idempotent and closed queries cannot access the database', async t => {
  let calls = 0;
  const { service } = await fixture(t, async () => { calls++; return { rows: [] }; });
  await service.close();
  await service.close();
  await assert.rejects(service.listClubs(), /temporarily unavailable/);
  await assert.rejects(service.getClub('42'), /temporarily unavailable/);
  assert.equal(calls, 0);
});
