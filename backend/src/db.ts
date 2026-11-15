import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { emptyProfile, type Application, type Club, type ClubEvent, type Profile, type SavedAnswer, type User, type StudentResume, type StudentOnboarding, type ResumeInfo } from './models.js';

type JsonRow = { data: string };
const decode = <T>(row: unknown): T | undefined => row ? JSON.parse((row as JsonRow).data) as T : undefined;

export class Store {
  readonly db: DatabaseSync;

  constructor(path = './data/odysc.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        student_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS student_onboarding (
        student_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        started_at TEXT, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS student_resumes (
        student_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL, pdf BLOB NOT NULL, extracted_text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS clubs (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_club ON events(club_id);
      CREATE TABLE IF NOT EXISTS saved_answers (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS answers_student ON saved_answers(student_id);
      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id),
        club_id TEXT NOT NULL REFERENCES clubs(id), data TEXT NOT NULL,
        UNIQUE(student_id, club_id)
      );
      CREATE INDEX IF NOT EXISTS applications_club ON applications(club_id);
      CREATE TABLE IF NOT EXISTS bookmarks (
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        PRIMARY KEY(student_id,club_id)
      );
      PRAGMA user_version = 1;
    `);
  }

  close() { this.db.close(); }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  insertUser(user: User, passwordHash: string) {
    this.db.prepare('INSERT INTO users (id,email,password_hash,data) VALUES (?,?,?,?)')
      .run(user.id, user.email, passwordHash, JSON.stringify(user));
  }
  getUser(id: string): User | undefined {
    return decode<User>(this.db.prepare('SELECT data FROM users WHERE id=?').get(id));
  }
  getUserByEmail(email: string): (User & { passwordHash: string }) | undefined {
    const row = this.db.prepare('SELECT data,password_hash FROM users WHERE email=?').get(email) as { data: string; password_hash: string } | undefined;
    return row ? { ...JSON.parse(row.data) as User, passwordHash: row.password_hash } : undefined;
  }
  saveUser(user: User) {
    this.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(user), user.id);
  }
  getProfile(studentId: string): Profile {
    // Existing local profiles predate onboarding; new fields receive safe defaults.
    return { ...emptyProfile(), ...decode<Partial<Profile>>(this.db.prepare('SELECT data FROM profiles WHERE student_id=?').get(studentId)) };
  }
  saveProfile(studentId: string, profile: Profile) {
    this.db.prepare('INSERT INTO profiles (student_id,data) VALUES (?,?) ON CONFLICT(student_id) DO UPDATE SET data=excluded.data')
      .run(studentId, JSON.stringify(profile));
    if (!profile.academicYear || !profile.major.trim() || !profile.interests.some(interest => interest.trim())) {
      this.db.prepare('UPDATE student_onboarding SET completed_at=NULL WHERE student_id=?').run(studentId);
    }
  }
  getOnboarding(studentId: string): StudentOnboarding {
    const row = this.db.prepare('SELECT started_at,completed_at FROM student_onboarding WHERE student_id=?').get(studentId) as { started_at: string | null; completed_at: string | null } | undefined;
    return row ? { startedAt: row.started_at, completedAt: row.completed_at } : { startedAt: null, completedAt: null };
  }
  saveOnboarding(studentId: string, state: StudentOnboarding) {
    this.db.prepare('INSERT INTO student_onboarding (student_id,started_at,completed_at) VALUES (?,?,?) ON CONFLICT(student_id) DO UPDATE SET started_at=excluded.started_at,completed_at=excluded.completed_at')
      .run(studentId, state.startedAt, state.completedAt);
  }
  getResume(studentId: string): StudentResume | undefined {
    const row = this.db.prepare('SELECT data,pdf,extracted_text FROM student_resumes WHERE student_id=?').get(studentId) as { data: string; pdf: Uint8Array; extracted_text: string } | undefined;
    return row ? { studentId, info: JSON.parse(row.data), bytes: row.pdf, text: row.extracted_text } : undefined;
  }
  getResumeInfo(studentId: string): ResumeInfo | undefined {
    return decode<ResumeInfo>(this.db.prepare('SELECT data FROM student_resumes WHERE student_id=?').get(studentId));
  }
  getResumeText(studentId: string): string | undefined {
    const row = this.db.prepare('SELECT extracted_text FROM student_resumes WHERE student_id=?').get(studentId) as { extracted_text: string } | undefined;
    return row?.extracted_text;
  }
  saveResume(resume: StudentResume) {
    this.db.prepare('INSERT INTO student_resumes (student_id,data,pdf,extracted_text) VALUES (?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET data=excluded.data,pdf=excluded.pdf,extracted_text=excluded.extracted_text')
      .run(resume.studentId, JSON.stringify(resume.info), resume.bytes, resume.text);
  }
  deleteResume(studentId: string) {
    return this.db.prepare('DELETE FROM student_resumes WHERE student_id=?').run(studentId).changes;
  }
  listClubs(): Club[] {
    return this.db.prepare('SELECT data FROM clubs ORDER BY rowid DESC').all().map(row => decode<Club>(row)!);
  }
  getClub(idOrSlug: string): Club | undefined {
    return decode<Club>(this.db.prepare('SELECT data FROM clubs WHERE id=? OR slug=?').get(idOrSlug, idOrSlug));
  }
  saveClub(club: Club) {
    this.db.prepare(`INSERT INTO clubs (id,slug,owner_id,data) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,owner_id=excluded.owner_id,data=excluded.data`)
      .run(club.id, club.slug, club.ownerId, JSON.stringify(club));
  }
  listEvents(clubId?: string): ClubEvent[] {
    const rows = clubId
      ? this.db.prepare('SELECT data FROM events WHERE club_id=?').all(clubId)
      : this.db.prepare('SELECT data FROM events').all();
    return rows.map(row => decode<ClubEvent>(row)!).sort((a,b) => a.startsAt.localeCompare(b.startsAt));
  }
  getEvent(id: string): ClubEvent | undefined {
    return decode<ClubEvent>(this.db.prepare('SELECT data FROM events WHERE id=?').get(id));
  }
  saveEvent(event: ClubEvent) {
    this.db.prepare('INSERT INTO events (id,club_id,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(event.id, event.clubId, JSON.stringify(event));
  }
  listAnswers(studentId: string): SavedAnswer[] {
    return this.db.prepare('SELECT data FROM saved_answers WHERE student_id=? ORDER BY rowid DESC').all(studentId)
      .map(row => decode<SavedAnswer>(row)!);
  }
  getAnswer(id: string): SavedAnswer | undefined {
    return decode<SavedAnswer>(this.db.prepare('SELECT data FROM saved_answers WHERE id=?').get(id));
  }
  saveAnswer(answer: SavedAnswer) {
    this.db.prepare('INSERT INTO saved_answers (id,student_id,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(answer.id, answer.studentId, JSON.stringify(answer));
  }
  deleteAnswer(id: string, studentId: string) {
    return this.db.prepare('DELETE FROM saved_answers WHERE id=? AND student_id=?').run(id, studentId).changes;
  }
  listApplications(studentId?: string, clubId?: string): Application[] {
    const rows = studentId
      ? this.db.prepare('SELECT data FROM applications WHERE student_id=?').all(studentId)
      : clubId ? this.db.prepare('SELECT data FROM applications WHERE club_id=?').all(clubId)
        : this.db.prepare('SELECT data FROM applications').all();
    return rows.map(row => decode<Application>(row)!);
  }
  getApplication(id: string): Application | undefined {
    return decode<Application>(this.db.prepare('SELECT data FROM applications WHERE id=?').get(id));
  }
  saveApplication(application: Application) {
    this.db.prepare(`INSERT INTO applications (id,student_id,club_id,data) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data`)
      .run(application.id, application.studentId, application.clubId, JSON.stringify(application));
  }
  bookmarkedClubIds(studentId: string): string[] {
    return this.db.prepare('SELECT club_id FROM bookmarks WHERE student_id=?').all(studentId).map(row => row.club_id as string);
  }
  setBookmark(studentId: string, clubId: string, enabled: boolean) {
    if (enabled) this.db.prepare('INSERT OR IGNORE INTO bookmarks (student_id,club_id) VALUES (?,?)').run(studentId, clubId);
    else this.db.prepare('DELETE FROM bookmarks WHERE student_id=? AND club_id=?').run(studentId, clubId);
  }
}
