import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClubEvent } from '../../shared/types.js';
import { daysUntil, deadlinePassed, eventIcs } from '../../client/src/util.js';

test('date-only winter deadlines stay open until USC midnight, including after UTC rollover', () => {
  const lastMoment = new Date('2026-11-15T07:59:59.999Z');
  assert.equal(daysUntil('2026-11-14', lastMoment), 0);
  assert.equal(deadlinePassed('2026-11-14', lastMoment), false);
  const midnight = new Date('2026-11-15T08:00:00.000Z');
  assert.equal(daysUntil('2026-11-14', midnight), -1);
  assert.equal(deadlinePassed('2026-11-14', midnight), true);
});

test('date-only summer deadlines use USC daylight time rather than a fixed UTC offset', () => {
  const lastMoment = new Date('2026-07-15T06:59:59.999Z');
  assert.equal(daysUntil('2026-07-14', lastMoment), 0);
  assert.equal(deadlinePassed('2026-07-14', lastMoment), false);
  const midnight = new Date('2026-07-15T07:00:00.000Z');
  assert.equal(daysUntil('2026-07-14', midnight), -1);
  assert.equal(deadlinePassed('2026-07-14', midnight), true);
});

test('explicit timestamp deadlines expire at the instant provided, while missing dates remain unknown', () => {
  const deadline = '2026-11-15T04:00:00-08:00';
  assert.equal(deadlinePassed(deadline, new Date('2026-11-15T11:59:59.999Z')), false);
  assert.equal(deadlinePassed(deadline, new Date('2026-11-15T12:00:00.001Z')), true);
  assert.equal(deadlinePassed(''), false);
  assert.equal(deadlinePassed('not-a-date'), false);
});

const event: ClubEvent = {
  id: 'server-event', clubId: '36288', title: 'NSBE information session', kind: 'Info session',
  start: '2026-11-15T02:00:00.000Z', durationMin: 60, buildingCode: 'SAL', room: '101',
};

test('calendar downloads retain text and duration without letting club fields inject calendar properties', () => {
  const ics = eventIcs({
    ...event,
    id: 'id\r\nBEGIN:VEVENT',
    title: 'Welcome, Trojans;\\\nBEGIN:VEVENT ' + '🎓'.repeat(80),
    room: '100, East;\r\nATTENDEE:fake@example.com\u0000',
  }, 'NSBE, USC', new Date('2026-11-14T12:00:00Z'));
  const lines = ics.split('\r\n');
  assert.equal(lines.filter(line => line === 'BEGIN:VEVENT').length, 1);
  assert.equal(lines.filter(line => line === 'END:VEVENT').length, 1);
  assert.equal(lines.some(line => line.startsWith('ATTENDEE:')), false);
  assert.equal(ics.includes('\u0000'), false);
  assert.ok(lines.every(line => Buffer.byteLength(line, 'utf8') <= 75), 'calendar lines fit the UTF-8 byte limit');
  assert.ok(lines.some(line => line.startsWith(' ')), 'long Unicode text is folded');
  const unfolded = ics.replace(/\r\n /g, '');
  assert.equal(unfolded.match(/🎓/gu)?.length, 80, 'folding preserves every Unicode character');
  assert.ok(unfolded.includes('SUMMARY:NSBE\\, USC: Welcome\\, Trojans\\;'));
  assert.ok(unfolded.includes('LOCATION:SAL 100\\, East\\;\\nATTENDEE:fake@example.com\\, USC'));
  assert.ok(unfolded.includes('DTSTART:20261115T020000Z\r\nDTEND:20261115T030000Z'));
  assert.ok(ics.endsWith('\r\n'));
});

test('calendar downloads reject unavailable dates and invalid durations instead of exporting false times', () => {
  assert.throws(() => eventIcs({ ...event, start: 'not-a-date' }, 'NSBE'), /date or duration/);
  for (const durationMin of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => eventIcs({ ...event, durationMin }, 'NSBE'), /date or duration/);
  }
});
