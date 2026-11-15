import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { Store } from '../src/db.js';
import { seedDemo } from '../src/seed.js';

async function fixture(t: TestContext) {
  const store = new Store(':memory:');
  const app = await buildApp({ store, logger: false, rateLimit: false, ai: { apiKey: '' } });
  t.after(async () => { await app.close(); store.close(); });
  await seedDemo(store);
  return { store, app };
}

async function login(app: FastifyInstance, email: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'DemoPass123!' } });
  assert.equal(response.statusCode, 200, response.body);
  return { authorization: `Bearer ${response.json().accessToken}` };
}

test('public club and event directory supports filters, slugs, and map directions', async t => {
  const { app } = await fixture(t);
  const all = await app.inject('/api/v1/clubs');
  assert.equal(all.statusCode, 200, all.body);
  assert.equal(all.json().clubs.length, 4);
  assert.ok(all.json().clubs.every((club: { isDemo: boolean }) => club.isDemo));
  const search = await app.inject('/api/v1/clubs?q=python');
  assert.equal(search.statusCode, 200, search.body);
  assert.deepEqual(search.json().clubs.map((club: { id: string }) => club.id), ['club-demo-makers']);
  const category = await app.inject('/api/v1/clubs?category=creative');
  assert.deepEqual(category.json().clubs.map((club: { id: string }) => club.id), ['club-demo-design']);
  const missing = await app.inject('/api/v1/clubs?q=no-such-organization-123');
  assert.deepEqual(missing.json().clubs, []);
  const detail = await app.inject('/api/v1/clubs/demo-campus-makers');
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().club.id, 'club-demo-makers');
  assert.equal(detail.json().events.length, 1);
  assert.match(detail.json().events[0].directionsUrl, /^https:\/\/www\.google\.com\/maps\/dir\//);
  assert.equal(typeof detail.json().events[0].latitude, 'number');
  const events = await app.inject('/api/v1/events?clubId=demo-campus-makers');
  assert.equal(events.json().events.length, 1);
  assert.equal(events.json().events[0].clubId, 'club-demo-makers');
  assert.equal((await app.inject('/api/v1/clubs/nonexistent')).statusCode, 404);
});

test('catalog mutations enforce organizer role and ownership for both clubs and events', async t => {
  const { app } = await fixture(t);
  const student = await login(app, 'student@example.com');
  const owner = await login(app, 'organizer@example.com');
  const register = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { email: 'other-organizer@example.com', name: 'Other organizer', role: 'organizer', password: 'AnotherPass123!' },
  });
  assert.equal(register.statusCode, 201, register.body);
  const other = { authorization: `Bearer ${register.json().accessToken}` };
  const eventPayload = {
    title: 'New event', kind: 'workshop', startsAt: '2030-01-20T12:00:00Z', endsAt: '2030-01-20T13:00:00Z',
    locationName: 'Sample location', address: 'Sample address', latitude: 34.02, longitude: -118.28,
  };
  for (const headers of [student, other]) {
    const patchClub = await app.inject({ method: 'PATCH', url: '/api/v1/clubs/club-demo-makers', headers, payload: { name: 'Unauthorized rename' } });
    assert.equal(patchClub.statusCode, 403, patchClub.body);
    const createEvent = await app.inject({ method: 'POST', url: '/api/v1/clubs/club-demo-makers/events', headers, payload: eventPayload });
    assert.equal(createEvent.statusCode, 403, createEvent.body);
    const patchEvent = await app.inject({ method: 'PATCH', url: '/api/v1/events/event-demo-1', headers, payload: { title: 'Unauthorized event rename' } });
    assert.equal(patchEvent.statusCode, 403, patchEvent.body);
  }
  const create = await app.inject({ method: 'POST', url: '/api/v1/clubs/club-demo-makers/events', headers: owner, payload: eventPayload });
  assert.equal(create.statusCode, 201, create.body);
  assert.equal(create.json().event.clubId, 'club-demo-makers');
  assert.equal(create.json().event.isDemo, true);
  const update = await app.inject({ method: 'PATCH', url: '/api/v1/clubs/club-demo-makers', headers: owner, payload: { description: 'Edited by the owner.' } });
  assert.equal(update.statusCode, 200, update.body);
  assert.equal(update.json().club.description, 'Edited by the owner.');
});

test('catalog rejects unsafe URLs, invalid date ranges, duplicate question IDs, and immutable fields', async t => {
  const { app } = await fixture(t);
  const headers = await login(app, 'organizer@example.com');
  for (const payload of [
    { websiteUrl: 'javascript:alert(1)' },
    { instagramUrl: 'file:///etc/passwd' },
    { ownerId: 'student-demo' },
    { isDemo: false },
    { name: '   ' },
    { questions: [{ id: 'same', prompt: 'Question one' }, { id: 'same', prompt: 'Question two' }] },
  ]) {
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/clubs/club-demo-makers', headers, payload });
    assert.equal(response.statusCode, 400, response.body);
  }
  const dateRange = await app.inject('/api/v1/events?from=2030-01-03T00%3A00%3A00Z&to=2030-01-01T00%3A00%3A00Z');
  assert.equal(dateRange.statusCode, 400, dateRange.body);
  const invalidDate = await app.inject('/api/v1/events?from=not-a-date');
  assert.equal(invalidDate.statusCode, 400, invalidDate.body);
  const backwards = await app.inject({
    method: 'PATCH', url: '/api/v1/events/event-demo-1', headers,
    payload: { startsAt: '2030-01-21T00:00:00Z', endsAt: '2030-01-20T00:00:00Z' },
  });
  assert.equal(backwards.statusCode, 400, backwards.body);
});

test('student bookmark reminders exclude past and unbookmarked dates and honor the requested window', async t => {
  const { app, store } = await fixture(t);
  const headers = await login(app, 'student@example.com');
  const initial = await app.inject({ url: '/api/v1/me/reminders', headers });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().delivery, 'in_app');
  assert.equal(initial.json().reminders.length, 2);
  assert.ok(initial.json().reminders.every((reminder: { clubId: string }) => reminder.clubId === 'club-demo-makers'));
  const club = store.getClub('club-demo-makers')!;
  store.saveClub({ ...club, applicationDeadline: new Date(Date.now() - 86400000).toISOString() });
  const event = store.getEvent('event-demo-1')!;
  store.saveEvent({ ...event, startsAt: new Date(Date.now() - 7200000).toISOString(), endsAt: new Date(Date.now() - 3600000).toISOString() });
  const past = await app.inject({ url: '/api/v1/me/reminders', headers });
  assert.deepEqual(past.json().reminders, []);
  const bookmark = await app.inject({ method: 'PUT', url: '/api/v1/me/bookmarks/club-demo-design', headers, payload: { bookmarked: true } });
  assert.equal(bookmark.statusCode, 200, bookmark.body);
  const short = await app.inject({ url: '/api/v1/me/reminders?days=1', headers });
  assert.deepEqual(short.json().reminders, []);
  const full = await app.inject({ url: '/api/v1/me/reminders?days=14', headers });
  assert.equal(full.json().reminders.length, 2);
  assert.ok(full.json().reminders.every((reminder: { clubId: string }) => reminder.clubId === 'club-demo-design'));
  const remove = await app.inject({ method: 'PUT', url: '/api/v1/me/bookmarks/club-demo-design', headers, payload: { bookmarked: false } });
  assert.equal(remove.statusCode, 200, remove.body);
  assert.deepEqual((await app.inject({ url: '/api/v1/me/reminders', headers })).json().reminders, []);
});

test('event calendar uses UTC, CRLF, escaped content, UTF-8 line folding, and a local reminder', async t => {
  const { app, store } = await fixture(t);
  const event = store.getEvent('event-demo-1')!;
  store.saveEvent({
    ...event,
    title: 'Welcome, makers; \\ tools\nBEGIN:VTODO',
    description: '漢'.repeat(100),
    startsAt: '2030-01-20T12:00:00.000Z', endsAt: '2030-01-20T13:00:00.000Z',
  });
  const response = await app.inject('/api/v1/events/event-demo-1/calendar');
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers['content-type']!, /^text\/calendar/);
  assert.match(response.headers['content-disposition']!, /attachment; filename=/);
  assert.equal(response.body.replace(/\r\n/g, '').includes('\n'), false);
  assert.ok(response.body.endsWith('END:VCALENDAR\r\n'));
  assert.ok(response.body.includes('DTSTART:20300120T120000Z\r\n'));
  assert.ok(response.body.includes('DTEND:20300120T130000Z\r\n'));
  assert.ok(response.body.includes('TRIGGER:-PT30M\r\n'));
  assert.ok(response.body.includes('ACTION:DISPLAY\r\n'));
  assert.equal(response.body.includes('\r\nBEGIN:VTODO'), false);
  const unfolded = response.body.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:Welcome\\, makers\\; \\\\ tools\\nBEGIN:VTODO\r\n'));
  assert.ok(unfolded.includes('DEMO EVENT: fictional fixture'));
  for (const line of response.body.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
});

test('seeding twice preserves edited data and does not duplicate fixture records', async t => {
  const { store } = await fixture(t);
  const profile = { ...store.getProfile('student-demo'), bio: 'An edited student profile.' };
  store.saveProfile('student-demo', profile);
  const club = store.getClub('club-demo-makers')!;
  store.saveClub({ ...club, name: 'Owner renamed this demo club' });
  const event = store.getEvent('event-demo-1')!;
  store.saveEvent({ ...event, title: 'Owner edited this demo event' });
  await seedDemo(store);
  assert.equal(store.listClubs().length, 4);
  assert.equal(store.listEvents().length, 4);
  assert.equal(store.listAnswers('student-demo').length, 2);
  assert.deepEqual(store.getProfile('student-demo'), profile);
  assert.equal(store.getClub('club-demo-makers')!.name, 'Owner renamed this demo club');
  assert.equal(store.getEvent('event-demo-1')!.title, 'Owner edited this demo event');
});
