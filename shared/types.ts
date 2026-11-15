// OdySC shared contract — frontend, backend and AI all build against these shapes.

// The live USC directory has categories beyond the original demo filters.
export type Category = string;

export interface Student {
  id: string;
  name: string; // legal first + last, from sign-up
  preferredName?: string;
  pronouns?: string;
  email: string; // must be @usc.edu
  uscId?: string; // Optional private profile data; not proof of enrollment.
  gradTerm?: string; // e.g. "Spring 2029"
  major: string;
  year: number; // 0 = unset; 1–4 undergraduate, 5 fifth year+, 6 graduate, 7 other
  skills: string[];
  interests: string[];
  experiences: string[];
  bio?: string;
  goals?: string[];
}

export interface Contact {
  role: string; // e.g. "Membership Chair"
  name: string;
  email: string;
  instagram?: string;
  officeHours?: string;
}

export interface ClubEvent {
  id: string;
  clubId: string;
  title: string;
  kind: "Info session" | "Mixer" | "Workshop" | "Coffee chat";
  start: string; // ISO datetime
  durationMin: number;
  buildingCode: string; // matches a building in the campus map
  room: string;
}

export interface Question {
  id: string;
  prompt: string;
  maxWords?: number;
}

export interface Club {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  category: Category;
  tagline: string;
  description: string;
  selectivity: "Open" | "Selective" | "Unknown";
  acceptanceRate?: number; // 0–1, only when a source provides it
  hoursPerWeek: string;
  dues: string;
  deadline: string; // ISO date
  acceptingApplications?: boolean;
  contacts: Contact[];
  websiteUrl?: string | null;
  /** Off by default. A club can ask for USC IDs only with a stated reason; students consent per application. */
  requiresUscId?: boolean;
  uscIdReason?: string;
  /** Video providers the club connected for interviews (OAuth in a real deployment). */
  zoomConnected?: boolean;
  teamsConnected?: boolean;
  questions: Question[];
}

export type AppStatus = "draft" | "submitted" | "interview" | "accepted" | "rejected";

export interface Answer {
  questionId: string;
  text: string;
}

export interface Application {
  id: string;
  studentId: string;
  clubId: string;
  status: AppStatus;
  submittedAt?: string;
  answers: Answer[];
}

export interface AnswerBankEntry {
  id: string;
  prompt: string;
  text: string;
  fromClubId: string;
}

export interface Match {
  clubId: string;
  score: number; // 0–1
  reasons: string[];
}

export interface Summary {
  summary: string;
  evidence: string[];
  injectionFlag: boolean;
}

export interface Applicant {
  applicationId: string;
  name: string;
  preferredName?: string;
  email: string; // what clubs use to contact applicants
  verifiedStudent: boolean; // Legacy enrollment flag; false without university verification.
  verifiedUscEmail?: boolean; // Provider-confirmed USC mailbox, not enrollment status.
  pronouns?: string;
  major: string;
  year: number;
  gradTerm?: string;
  skills?: string[];
  interests?: string[];
  experiences?: string[];
  submittedAt?: string;
  /** Present only if the club requires USC IDs and this student consented. */
  uscId?: string;
  answers: { prompt: string; text: string }[];
  summary: Summary;
}

/** Who can have an account. */
export type Role = "student" | "officer" | "admin";

export interface Account {
  role: Role;
  name: string;
  email: string;
  // officers only
  clubId?: string;
  officerRole?: string;
  verified?: boolean; // Active club membership approved by an authorized admin.
}

/** One person on a club's e-board inside OdySC. */
export interface TeamMember {
  email: string;
  name: string;
  officerRole: string;
  access: "admin" | "reviewer"; // admins approve officers, invite reviewers, change settings, decide
  status: "active" | "pending" | "invited"; // pending = asked to join, waiting on an admin
}

/** A student's own calendar entry. */
export interface PersonalEvent {
  id: string;
  title: string;
  start: string; // ISO datetime
  durationMin: number;
  location?: string;
}

/** How an interview happens. Video links are supplied by the organizer. */
export type InterviewFormat = "zoom" | "teams" | "meet" | "in-person";

/** A club invites an applicant to interview by offering times; the student books one. */
export interface Interview {
  applicationId: string;
  clubId: string;
  format: InterviewFormat;
  slots: string[]; // ISO start times the club offered
  durationMin: number;
  link?: string; // An actual organizer-supplied meeting URL, never a generated placeholder.
  buildingCode?: string; // in person
  room?: string;
  note?: string; // what to bring, who they'll meet
  booked?: string; // the slot the student picked
  invitedAt: string;
}
