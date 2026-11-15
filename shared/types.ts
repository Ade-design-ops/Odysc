// OdySC shared contract — frontend, backend and AI all build against these shapes.
// Change a type? Post in Discord first, then edit here.

export type Category = "Engineering" | "Business" | "Service" | "Arts" | "Culture" | "Tech";

export interface Student {
  id: string;
  name: string; // legal first + last, from sign-up
  preferredName?: string;
  pronouns?: string;
  email: string; // must be @usc.edu
  uscId?: string; // 10-digit USC ID — used only to verify enrollment, never shown to clubs
  gradTerm?: string; // e.g. "Spring 2029"
  major: string;
  year: number; // 1–4
  skills: string[];
  interests: string[];
  experiences: string[];
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
  selectivity: "Open" | "Selective";
  acceptanceRate?: number; // 0–1, demo data
  hoursPerWeek: string;
  dues: string;
  deadline: string; // ISO date
  contacts: Contact[];
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
  verifiedStudent: boolean; // USC ID checked against enrollment at sign-up
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
  verified?: boolean; // matched the club's officer roster, or approved by a club admin
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

/** How an interview happens. Video formats get a meeting link; in person gets a room. */
export type InterviewFormat = "zoom" | "teams" | "meet" | "in-person";

/** A club invites an applicant to interview by offering times; the student books one. */
export interface Interview {
  applicationId: string;
  clubId: string;
  format: InterviewFormat;
  slots: string[]; // ISO start times the club offered
  durationMin: number;
  link?: string; // video: created when the student books (Zoom/Teams API) or pasted by the club
  buildingCode?: string; // in person
  room?: string;
  note?: string; // what to bring, who they'll meet
  booked?: string; // the slot the student picked
  invitedAt: string;
}
