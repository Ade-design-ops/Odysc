export type Role = 'student' | 'organizer';
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}
export const academicYears = ['first_year', 'second_year', 'third_year', 'fourth_year', 'fifth_year_plus', 'graduate', 'other'] as const;
export type AcademicYear = typeof academicYears[number];
export interface Profile {
  major: string;
  academicYear: AcademicYear | null;
  graduationYear: number | null;
  bio: string;
  interests: string[];
  skills: string[];
  experience: string;
  goals: string[];
}
export const emptyProfile = (): Profile => ({ major: '', academicYear: null, graduationYear: null, bio: '', interests: [], skills: [], experience: '', goals: [] });
export interface ResumeInfo {
  id: string;
  fileName: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
  pageCount: number;
  textStatus: 'available' | 'unavailable';
  uploadedAt: string;
}
export interface StudentResume {
  studentId: string;
  info: ResumeInfo;
  bytes: Uint8Array;
  text: string;
}
export interface StudentOnboarding {
  startedAt: string | null;
  completedAt: string | null;
}
export interface Question {
  id: string;
  prompt: string;
  required: boolean;
  maxLength: number;
}
export interface Club {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  contactEmail: string;
  websiteUrl: string | null;
  instagramUrl: string | null;
  applicationDeadline: string | null;
  acceptingApplications: boolean;
  questions: Question[];
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface ClubEvent {
  id: string;
  clubId: string;
  title: string;
  description: string;
  kind: 'info_session' | 'mixer' | 'workshop' | 'other';
  startsAt: string;
  endsAt: string;
  locationName: string;
  address: string;
  latitude: number;
  longitude: number;
  isDemo: boolean;
}
export interface SavedAnswer {
  id: string;
  studentId: string;
  question: string;
  answer: string;
  updatedAt: string;
}
export type ApplicationStatus = 'draft' | 'submitted' | 'reviewing' | 'accepted' | 'rejected';
export interface Application {
  id: string;
  studentId: string;
  clubId: string;
  answers: Record<string, string>;
  status: ApplicationStatus;
  profileSnapshot: Profile | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
