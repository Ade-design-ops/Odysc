import { hashPassword } from './auth.js';
import type { Store } from './db.js';
import type { Club, ClubEvent } from './models.js';

const DAY = 24 * 60 * 60 * 1000;

/** Explicit opt-in fixtures: these are not real USC organizations or verified campus events. */
export async function seedDemo(store: Store): Promise<{ studentEmail: string; organizerEmail: string; password: string }> {
  const studentEmail = 'student@example.com';
  const organizerEmail = 'organizer@example.com';
  const password = 'DemoPass123!';
  const now = new Date().toISOString();
  const existingStudent = store.getUserByEmail(studentEmail);
  const existingOrganizer = store.getUserByEmail(organizerEmail);
  if (existingStudent && existingStudent.id !== 'student-demo') throw new Error('Demo student email is already used by another account; seed did not overwrite it.');
  if (existingOrganizer && existingOrganizer.id !== 'organizer-demo') throw new Error('Demo organizer email is already used by another account; seed did not overwrite it.');
  if (!existingStudent) store.insertUser({ id: 'student-demo', email: studentEmail, name: 'Alex Trojan (Demo)', role: 'student', createdAt: now }, await hashPassword(password));
  if (!existingOrganizer) store.insertUser({ id: 'organizer-demo', email: organizerEmail, name: 'Sam Organizer (Demo)', role: 'organizer', createdAt: now }, await hashPassword(password));
  if (!existingStudent) store.saveProfile('student-demo', {
    major: 'Computer Science', graduationYear: 2028, academicYear: 'third_year', goals: ['Build campus tools', 'Meet other makers'],
    bio: 'Demo student interested in building useful campus tools and meeting other makers.',
    interests: ['robotics', 'community service', 'design'],
    skills: ['TypeScript', 'Python', 'prototyping'],
    experience: 'Built a study group website with classmates and volunteered at a neighborhood food drive.',
  });
  const fixtures = [
    { id: 'club-demo-makers', slug: 'demo-campus-makers', name: 'Demo Campus Makers', category: 'Technology', tags: ['robotics', 'engineering', 'Python', 'prototyping'], description: 'A fictional demo organization for students who enjoy robotics, engineering, and building useful projects.' },
    { id: 'club-demo-design', slug: 'demo-design-collective', name: 'Demo Design Collective', category: 'Creative', tags: ['design', 'UX', 'prototyping', 'art'], description: 'A fictional demo organization exploring accessible interfaces, visual design, and collaborative creative projects.' },
    { id: 'club-demo-service', slug: 'demo-community-connect', name: 'Demo Community Connect', category: 'Service', tags: ['community service', 'volunteering', 'leadership'], description: 'A fictional demo organization for community service, neighborhood volunteering, and student-led service projects.' },
    { id: 'club-demo-business', slug: 'demo-venture-lab', name: 'Demo Venture Lab', category: 'Business', tags: ['business', 'entrepreneurship', 'startups', 'leadership'], description: 'A fictional demo organization for students practicing entrepreneurship, business strategy, and startup teamwork.' },
  ];
  const seedTime = Date.now();
  for (const [index, fixture] of fixtures.entries()) {
    if (store.getClub(fixture.id)) continue;
    const slugOwner = store.getClub(fixture.slug);
    if (slugOwner) continue; // Preserve user-created content if a demo slug is taken.
    const club: Club = {
      ...fixture, ownerId: 'organizer-demo',
      description: `${fixture.description} DEMO DATA: this is not an official USC organization.`,
      contactEmail: `demo-${index + 1}@example.com`, websiteUrl: null, instagramUrl: null,
      applicationDeadline: new Date(seedTime + (5 + index) * DAY).toISOString(),
      acceptingApplications: true,
      questions: [
        { id: 'why-join', prompt: 'Why would you like to join our organization?', required: true, maxLength: 1500 },
        { id: 'experience', prompt: 'Describe a project or experience you are proud of.', required: true, maxLength: 2000 },
        { id: 'anything-else', prompt: 'Anything else you would like us to know?', required: false, maxLength: 1000 },
      ],
      isDemo: true, createdAt: now, updatedAt: now,
    };
    store.saveClub(club);
  }
  for (const [index, fixture] of fixtures.entries()) {
    const club = store.getClub(fixture.id);
    if (!club || club.ownerId !== 'organizer-demo') continue;
    const id = `event-demo-${index + 1}`;
    if (store.getEvent(id)) continue;
    const start = seedTime + (index + 1) * DAY;
    const event: ClubEvent = {
      id, clubId: club.id, title: `${club.name} demo info session`,
      description: 'Fictional event for the hackathon demo. Schedule, venue, and map coordinates are sample data and have not been verified.',
      kind: 'info_session', startsAt: new Date(start).toISOString(), endsAt: new Date(start + 60 * 60 * 1000).toISOString(),
      locationName: `Demo meeting point ${index + 1} (unverified)`,
      address: 'University Park area, Los Angeles, CA — sample location only',
      latitude: 34.0206 + index * 0.0002, longitude: -118.2854 + index * 0.0002,
      isDemo: true,
    };
    store.saveEvent(event);
  }
  const saved = new Set(store.listAnswers('student-demo').map(answer => answer.id));
  const answers = [
    { id: 'answer-demo-intro', question: 'Why would you like to join our organization?', answer: 'I want to meet other students who enjoy building useful campus tools, learn from their experience, and contribute my TypeScript and Python skills to a team project.' },
    { id: 'answer-demo-experience', question: 'Describe a project or experience you are proud of.', answer: 'I built a study group website with classmates. I helped prototype the interface and write TypeScript so students could find a group for their courses.' },
  ];
  for (const answer of answers) {
    if (!saved.has(answer.id)) store.saveAnswer({ ...answer, studentId: 'student-demo', updatedAt: now });
  }
  if (!existingStudent) store.setBookmark('student-demo', 'club-demo-makers', true);
  return { studentEmail, organizerEmail, password };
}
