import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { assertOwner, requireUser } from './auth.js';
import type { Store } from './db.js';
import { HttpError } from './errors.js';
import type { Club, ClubEvent, Question } from './models.js';

const text = (maxLength: number, minLength = 1) => Type.String({ minLength, maxLength });
const dateTime = Type.String({ format: 'date-time', maxLength: 40 });
const webUrl = Type.String({ format: 'uri', pattern: '^https?://', maxLength: 2048 });
const nullableUrl = Type.Union([webUrl, Type.Null()]);
const clubParams = Type.Object({ clubId: text(160) });
const eventParams = Type.Object({ eventId: text(160) });
const questionSchema = Type.Object({
  id: Type.String({ pattern: '^[a-zA-Z0-9_-]+$', maxLength: 80, minLength: 1 }),
  prompt: text(1000),
  required: Type.Optional(Type.Boolean({ default: true })),
  maxLength: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000, default: 2000 })),
}, { additionalProperties: false });
const clubProperties = {
  slug: Type.Optional(Type.String({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 120 })),
  name: text(160),
  description: text(10000),
  category: text(80),
  tags: Type.Optional(Type.Array(text(80), { maxItems: 30, uniqueItems: true })),
  contactEmail: Type.String({ format: 'email', maxLength: 254 }),
  websiteUrl: Type.Optional(nullableUrl),
  instagramUrl: Type.Optional(nullableUrl),
  applicationDeadline: Type.Optional(Type.Union([dateTime, Type.Null()])),
  acceptingApplications: Type.Optional(Type.Boolean()),
  questions: Type.Optional(Type.Array(questionSchema, { maxItems: 20 })),
};
const createClubSchema = Type.Object(clubProperties, { additionalProperties: false });
const updateClubSchema = Type.Partial(createClubSchema, { minProperties: 1 });
const eventSchema = Type.Object({
  title: text(200),
  description: Type.Optional(text(10000, 0)),
  kind: Type.Union([Type.Literal('info_session'), Type.Literal('mixer'), Type.Literal('workshop'), Type.Literal('other')]),
  startsAt: dateTime,
  endsAt: dateTime,
  locationName: text(200),
  address: text(500),
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
}, { additionalProperties: false });
const updateEventSchema = Type.Partial(eventSchema, { minProperties: 1 });

function normalizeQuestions(questions: Static<typeof questionSchema>[]): Question[] {
  if (new Set(questions.map(question => question.id)).size !== questions.length) {
    throw new HttpError(400, 'Question IDs must be unique within a club.');
  }
  for (const question of questions) {
    if (!question.prompt.trim()) throw new HttpError(400, 'Question prompts cannot be blank.');
  }
  return questions.map(question => ({
    ...question,
    prompt: question.prompt.trim(),
    required: question.required ?? true,
    maxLength: question.maxLength ?? 2000,
  }));
}

function checkClubText(club: Pick<Club, 'name' | 'description' | 'category'>) {
  if (!club.name.trim() || !club.description.trim() || !club.category.trim()) {
    throw new HttpError(400, 'Club name, description, and category cannot be blank.');
  }
}

export function eventWithDirections(event: ClubEvent) {
  const destination = `${event.latitude},${event.longitude}`;
  return {
    ...event,
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`,
  };
}

function checkEvent(event: ClubEvent) {
  if (!event.title.trim() || !event.locationName.trim() || !event.address.trim()) {
    throw new HttpError(400, 'Event title, location, and address cannot be blank.');
  }
  if (new Date(event.endsAt).getTime() <= new Date(event.startsAt).getTime()) {
    throw new HttpError(400, 'Event end time must be after its start time.');
  }
}

function calendarText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function calendarDate(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// RFC 5545 folds at 75 octets; a continuation begins with one space.
function foldCalendarLine(line: string): string {
  const parts: string[] = [];
  let part = '';
  for (const character of line) {
    if (Buffer.byteLength(part + character, 'utf8') > 75) {
      parts.push(part);
      part = ' ';
    }
    part += character;
  }
  parts.push(part);
  return parts.join('\r\n');
}

export function eventCalendar(event: ClubEvent): string {
  const description = event.isDemo
    ? `DEMO EVENT: fictional fixture; location and schedule are unverified.\n${event.description}`
    : event.description;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//odysc//Campus events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${calendarText(event.id)}@odysc.local`,
    `DTSTAMP:${calendarDate(new Date().toISOString())}`,
    `DTSTART:${calendarDate(event.startsAt)}`,
    `DTEND:${calendarDate(event.endsAt)}`,
    `SUMMARY:${calendarText(event.title)}`,
    `DESCRIPTION:${calendarText(description)}`,
    `LOCATION:${calendarText(`${event.locationName}, ${event.address}`)}`,
    `URL:${eventWithDirections(event).directionsUrl}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${calendarText(`Reminder: ${event.title}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(foldCalendarLine).join('\r\n') + '\r\n';
}

export async function registerCatalog(app: FastifyInstance, store: Store): Promise<void> {
  app.get<{ Querystring: { q?: string; category?: string } }>('/api/v1/clubs', {
    schema: {
      tags: ['Clubs'], summary: 'Browse and search club pages',
      querystring: Type.Object({ q: Type.Optional(text(200, 0)), category: Type.Optional(text(80)) }, { additionalProperties: false }),
    },
  }, request => {
    const query = request.query.q?.trim().toLocaleLowerCase();
    const category = request.query.category?.toLocaleLowerCase();
    const clubs = store.listClubs().filter(club => {
      const searchable = `${club.name} ${club.description} ${club.category} ${club.tags.join(' ')}`.toLocaleLowerCase();
      return (!query || searchable.includes(query)) && (!category || club.category.toLocaleLowerCase() === category);
    });
    return { clubs };
  });

  app.get<{ Params: { clubId: string } }>('/api/v1/clubs/:clubId', {
    schema: { tags: ['Clubs'], summary: 'Get a club page, questions, contacts, and events', params: clubParams },
  }, request => {
    const club = store.getClub(request.params.clubId);
    if (!club) throw new HttpError(404, 'Club not found.');
    return { club, events: store.listEvents(club.id).map(eventWithDirections) };
  });

  app.post<{ Body: Static<typeof createClubSchema> }>('/api/v1/clubs', {
    schema: { tags: ['Clubs'], summary: 'Create a club owned by the current organizer', body: createClubSchema, security: [{ bearerAuth: [] }] },
  }, (request, reply) => {
    const user = requireUser(store, request, 'organizer');
    const body = request.body;
    const id = randomUUID();
    const generatedSlug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'club';
    const slug = body.slug ?? `${generatedSlug}-${id.slice(0, 8)}`;
    if (store.getClub(slug)) throw new HttpError(409, 'This club slug is already in use.');
    const now = new Date().toISOString();
    const club: Club = {
      id, ownerId: user.id, slug,
      name: body.name.trim(), description: body.description.trim(), category: body.category.trim(),
      tags: body.tags ?? [], contactEmail: body.contactEmail,
      websiteUrl: body.websiteUrl ?? null, instagramUrl: body.instagramUrl ?? null,
      applicationDeadline: body.applicationDeadline ? new Date(body.applicationDeadline).toISOString() : null,
      acceptingApplications: body.acceptingApplications ?? true,
      questions: normalizeQuestions(body.questions ?? []),
      isDemo: false, createdAt: now, updatedAt: now,
    };
    checkClubText(club);
    store.saveClub(club);
    return reply.code(201).send({ club });
  });

  app.patch<{ Params: { clubId: string }; Body: Static<typeof updateClubSchema> }>('/api/v1/clubs/:clubId', {
    schema: { tags: ['Clubs'], summary: 'Edit your club and its application questions', params: clubParams, body: updateClubSchema, security: [{ bearerAuth: [] }] },
  }, request => {
    const { club: existing } = assertOwner(store, request, request.params.clubId);
    const body = request.body;
    if (body.slug && body.slug !== existing.slug && store.getClub(body.slug)) {
      throw new HttpError(409, 'This club slug is already in use.');
    }
    const club: Club = {
      ...existing, ...body,
      questions: body.questions ? normalizeQuestions(body.questions) : existing.questions,
      applicationDeadline: body.applicationDeadline === undefined ? existing.applicationDeadline
        : body.applicationDeadline === null ? null : new Date(body.applicationDeadline).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    checkClubText(club);
    store.saveClub(club);
    return { club };
  });

  app.get<{ Querystring: { clubId?: string; from?: string; to?: string } }>('/api/v1/events', {
    schema: {
      tags: ['Events'], summary: 'List club events with walking directions and map coordinates',
      querystring: Type.Object({ clubId: Type.Optional(text(160)), from: Type.Optional(dateTime), to: Type.Optional(dateTime) }, { additionalProperties: false }),
    },
  }, request => {
    const { clubId, from, to } = request.query;
    if (from && to && new Date(from).getTime() > new Date(to).getTime()) throw new HttpError(400, 'from must be before to.');
    const club = clubId ? store.getClub(clubId) : undefined;
    if (clubId && !club) throw new HttpError(404, 'Club not found.');
    const fromTime = from ? new Date(from).getTime() : -Infinity;
    const toTime = to ? new Date(to).getTime() : Infinity;
    return {
      events: store.listEvents(club?.id).filter(event => {
        const start = new Date(event.startsAt).getTime();
        return start >= fromTime && start <= toTime;
      }).map(eventWithDirections),
    };
  });

  app.get<{ Params: { eventId: string } }>('/api/v1/events/:eventId/calendar', {
    schema: { tags: ['Events'], summary: 'Download an event calendar file with a 30-minute reminder', params: eventParams },
  }, (request, reply) => {
    const event = store.getEvent(request.params.eventId);
    if (!event) throw new HttpError(404, 'Event not found.');
    return reply.type('text/calendar; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="odysc-${event.id.replace(/[^a-zA-Z0-9_-]/g, '')}.ics"`)
      .send(eventCalendar(event));
  });

  app.post<{ Params: { clubId: string }; Body: Static<typeof eventSchema> }>('/api/v1/clubs/:clubId/events', {
    schema: { tags: ['Events'], summary: 'Create an event for your club', params: clubParams, body: eventSchema, security: [{ bearerAuth: [] }] },
  }, (request, reply) => {
    const { club } = assertOwner(store, request, request.params.clubId);
    const event: ClubEvent = {
      ...request.body,
      description: request.body.description ?? '',
      startsAt: new Date(request.body.startsAt).toISOString(),
      endsAt: new Date(request.body.endsAt).toISOString(),
      id: randomUUID(), clubId: club.id, isDemo: club.isDemo,
    };
    checkEvent(event);
    store.saveEvent(event);
    return reply.code(201).send({ event: eventWithDirections(event) });
  });

  app.patch<{ Params: { eventId: string }; Body: Static<typeof updateEventSchema> }>('/api/v1/events/:eventId', {
    schema: { tags: ['Events'], summary: 'Edit an event owned by your club', params: eventParams, body: updateEventSchema, security: [{ bearerAuth: [] }] },
  }, request => {
    const existing = store.getEvent(request.params.eventId);
    if (!existing) throw new HttpError(404, 'Event not found.');
    assertOwner(store, request, existing.clubId);
    const event: ClubEvent = {
      ...existing, ...request.body,
      startsAt: request.body.startsAt ? new Date(request.body.startsAt).toISOString() : existing.startsAt,
      endsAt: request.body.endsAt ? new Date(request.body.endsAt).toISOString() : existing.endsAt,
    };
    checkEvent(event);
    store.saveEvent(event);
    return { event: eventWithDirections(event) };
  });

  app.get('/api/v1/me/bookmarks', {
    schema: { tags: ['Reminders'], summary: 'List clubs bookmarked by the current student', security: [{ bearerAuth: [] }] },
  }, request => {
    const user = requireUser(store, request, 'student');
    const ids = new Set(store.bookmarkedClubIds(user.id));
    return { clubs: store.listClubs().filter(club => ids.has(club.id)) };
  });

  app.put<{ Params: { clubId: string }; Body: { bookmarked: boolean } }>('/api/v1/me/bookmarks/:clubId', {
    schema: {
      tags: ['Reminders'], summary: 'Bookmark or unbookmark a club to track its upcoming dates', params: clubParams,
      body: Type.Object({ bookmarked: Type.Boolean() }, { additionalProperties: false }), security: [{ bearerAuth: [] }],
    },
  }, request => {
    const user = requireUser(store, request, 'student');
    const club = store.getClub(request.params.clubId);
    if (!club) throw new HttpError(404, 'Club not found.');
    store.setBookmark(user.id, club.id, request.body.bookmarked);
    return { clubId: club.id, bookmarked: request.body.bookmarked };
  });

  app.get<{ Querystring: { days?: number } }>('/api/v1/me/reminders', {
    schema: {
      tags: ['Reminders'], summary: 'Upcoming deadlines and events for bookmarked clubs; in-app only',
      querystring: Type.Object({ days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90, default: 14 })) }, { additionalProperties: false }),
      security: [{ bearerAuth: [] }],
    },
  }, request => {
    const user = requireUser(store, request, 'student');
    const now = Date.now();
    const end = now + (request.query.days ?? 14) * 24 * 60 * 60 * 1000;
    const ids = new Set(store.bookmarkedClubIds(user.id));
    const clubs = store.listClubs().filter(club => ids.has(club.id));
    const names = new Map(clubs.map(club => [club.id, club.name]));
    type Reminder = { id: string; type: 'deadline' | 'event'; clubId: string; clubName: string; title: string; dueAt: string; isDemo: boolean; eventId?: string; directionsUrl?: string };
    const reminders: Reminder[] = [];
    for (const club of clubs) {
      if (!club.acceptingApplications || !club.applicationDeadline) continue;
      const due = new Date(club.applicationDeadline).getTime();
      if (due >= now && due <= end) reminders.push({
        id: `deadline-${club.id}`, type: 'deadline', clubId: club.id, clubName: club.name,
        title: `${club.name} application deadline`, dueAt: club.applicationDeadline, isDemo: club.isDemo,
      });
    }
    for (const event of store.listEvents()) {
      const due = new Date(event.startsAt).getTime();
      if (ids.has(event.clubId) && due >= now && due <= end) reminders.push({
        id: `event-${event.id}`, type: 'event', clubId: event.clubId, clubName: names.get(event.clubId) ?? '',
        title: event.title, dueAt: event.startsAt, eventId: event.id,
        directionsUrl: eventWithDirections(event).directionsUrl, isDemo: event.isDemo,
      });
    }
    reminders.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    return { reminders, window: { from: new Date(now).toISOString(), to: new Date(end).toISOString() }, delivery: 'in_app' };
  });
}
