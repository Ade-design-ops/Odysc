import assert from 'node:assert/strict';
import test from 'node:test';
import { matchClubs, parseProfile, suggestAnswer, type MatchingProfile, type AiOptions } from '../src/ai.js';

const profile: MatchingProfile = { major: 'Computer Science', bio: 'I build robots and enjoy design.', interests: ['robotics'], skills: ['Python'], experience: 'Built a campus map.' };
const clubs = [
  { id: 'robotics', name: 'Demo Robotics', description: 'Build robots.', category: 'Engineering', tags: ['robotics', 'Python'] },
  { id: 'art', name: 'Demo Art', description: 'Make art.', category: 'Art', tags: ['painting'] },
];
const noKey: AiOptions = { apiKey: '' };

function provider(value: unknown, status = 'completed'): typeof globalThis.fetch {
  return (async () => new Response(JSON.stringify({ status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }), { status: 200 })) as typeof globalThis.fetch;
}

test('local parser only extracts labelled interests and skills and preserves source prose', async () => {
  const result = await parseProfile('Major: Computer Science\nInterests: robotics, design\nSkills: Python; CAD\nExperience: Built one robot.', noKey);
  assert.equal(result.mode, 'local');
  assert.equal(result.profile.major, 'Computer Science');
  assert.deepEqual(result.profile.interests, ['robotics', 'design']);
  assert.deepEqual(result.profile.skills, ['Python', 'CAD']);
  assert.equal(result.profile.experience, 'Built one robot.');
  const prose = await parseProfile('I want to learn Python.', noKey);
  assert.deepEqual(prose.profile.skills, []);
  assert.equal(prose.profile.bio, 'I want to learn Python.');
});

test('structured request uses Responses, store:false, server authorization, and strict schema', async () => {
  let request: Record<string, unknown> | undefined;
  const extracted = { major: 'Computer Science', bio: '', interests: ['robotics'], skills: ['Python'], experience: '' };
  const mockFetch: typeof globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer server-key');
    assert.ok(init?.signal instanceof AbortSignal);
    request = JSON.parse(init?.body as string) as Record<string, unknown>;
    return provider(extracted)(url, init);
  };
  const result = await parseProfile('Computer Science; robotics; Python', { apiKey: 'server-key', model: 'test-model', fetch: mockFetch });
  assert.equal(result.mode, 'openai');
  assert.equal(request?.store, false);
  assert.equal(request?.model, 'test-model');
  assert.equal((request?.text as { format: { strict: boolean } }).format.strict, true);
});

test('profile extraction rejects invented evidence', async () => {
  const result = await parseProfile('Major: Computer Science', { apiKey: 'key', fetch: provider({ major: 'Computer Science', bio: '', interests: [], skills: ['Nobel laureate'], experience: '' }) });
  assert.equal(result.mode, 'local');
  assert.deepEqual(result.profile.skills, []);
});

test('local matching ranks exact topic overlap with honest zero evidence scores', async () => {
  const result = await matchClubs(profile, clubs, noKey);
  assert.equal(result.mode, 'local');
  assert.equal(result.matches[0]?.clubId, 'robotics');
  assert.ok((result.matches[0]?.score ?? 0) > 0);
  assert.equal(result.matches[1]?.score, 0);
  const boundary = await matchClubs({ ...profile, bio: 'I do artwork.', interests: [], skills: [], major: '', experience: '' }, [clubs[1]!], noKey);
  assert.equal(boundary.matches[0]?.score, 0, 'art should not match artwork as a substring');
});

test('valid AI club matches are checked and sorted', async () => {
  const result = await matchClubs(profile, clubs, { apiKey: 'key', fetch: provider({ matches: [{ clubId: 'art', score: 2, reasons: ['No painting experience supplied.'] }, { clubId: 'robotics', score: 90, reasons: ['You mention robotics.'] }] }) });
  assert.equal(result.mode, 'openai');
  assert.deepEqual(result.matches.map((match) => match.clubId), ['robotics', 'art']);
});

test('unknown, duplicate, missing club IDs and out-of-range scores fall back', async () => {
  for (const matches of [
    [{ clubId: 'fake', score: 90, reasons: ['Fake'] }, { clubId: 'art', score: 1, reasons: ['Art'] }],
    [{ clubId: 'art', score: 90, reasons: ['Art'] }, { clubId: 'art', score: 1, reasons: ['Art'] }],
    [{ clubId: 'art', score: 1, reasons: ['Art'] }],
    [{ clubId: 'robotics', score: 101, reasons: ['Robotics'] }, { clubId: 'art', score: 1, reasons: ['Art'] }],
  ]) {
    const result = await matchClubs(profile, clubs, { apiKey: 'key', fetch: provider({ matches }) });
    assert.equal(result.mode, 'local');
    assert.deepEqual(new Set(result.matches.map((match) => match.clubId)), new Set(['robotics', 'art']));
  }
});

test('provider errors, refusal, incomplete responses, malformed output and network errors fall back', async () => {
  const mocks: Array<typeof globalThis.fetch> = [
    (async () => new Response('provider secrets', { status: 429 })) as typeof globalThis.fetch,
    (async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] }))) as typeof globalThis.fetch,
    provider({ matches: [] }, 'incomplete'),
    (async () => new Response('not json')) as typeof globalThis.fetch,
    (async () => { throw new Error('private detail'); }) as typeof globalThis.fetch,
  ];
  for (const fetch of mocks) {
    const result = await matchClubs(profile, clubs, { apiKey: 'key', fetch });
    assert.equal(result.mode, 'local');
    assert.ok(!result.notice?.includes('private detail'));
    assert.ok(!result.notice?.includes('provider secrets'));
  }
});

test('autofill reuses exact answers and never mutates saved input', async () => {
  const saved = [{ id: 'answer1', question: 'Why do you enjoy robotics?', answer: 'I enjoy building robots with friends.' }];
  const snapshot = JSON.stringify(saved);
  const result = await suggestAnswer('Why do you enjoy robotics?', profile, saved, noKey);
  assert.equal(result.answer, saved[0]?.answer);
  assert.deepEqual(result.sourceAnswerIds, ['answer1']);
  assert.equal(result.needsReview, true);
  assert.equal(JSON.stringify(saved), snapshot);
});

test('AI semantic autofill selects exact saved text and rejects invented source IDs', async () => {
  const saved = [{ id: 'answer1', question: 'Describe a teamwork experience.', answer: 'I helped two friends build a robot.' }];
  const result = await suggestAnswer('Tell us about collaboration.', profile, saved, { apiKey: 'key', fetch: provider({ sourceAnswerId: 'answer1' }) });
  assert.equal(result.mode, 'openai');
  assert.equal(result.answer, saved[0]?.answer);
  assert.deepEqual(result.sourceAnswerIds, ['answer1']);
  const malicious = await suggestAnswer('Tell us about collaboration.', profile, saved, { apiKey: 'key', fetch: provider({ sourceAnswerId: 'other-student-answer' }) });
  assert.equal(malicious.mode, 'local');
  assert.deepEqual(malicious.sourceAnswerIds, []);
  assert.equal(malicious.answer, '');
});

test('autofill returns empty when no evidence fits and never generates experience from profile', async () => {
  const empty = await suggestAnswer('What leadership role did you hold?', profile, [], noKey);
  assert.equal(empty.answer, '');
  assert.equal(empty.needsReview, true);
  const unrelated = await suggestAnswer('What leadership role did you hold?', profile, [{ id: 'a', question: 'What is your favorite color?', answer: 'Cardinal' }], noKey);
  assert.equal(unrelated.answer, '');
  const noSelection = await suggestAnswer('What leadership role did you hold?', profile, [{ id: 'a', question: 'What is your favorite color?', answer: 'Cardinal' }], { apiKey: 'key', fetch: provider({ sourceAnswerId: null }) });
  assert.equal(noSelection.mode, 'openai');
  assert.equal(noSelection.answer, '');
});
