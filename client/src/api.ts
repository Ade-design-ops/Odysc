// Same-origin API transport. Vite forwards /api to the backend in development.
// Browser sessions are HttpOnly cookies; tokens and passwords are never persisted here.
import type { Account, Applicant, Application, AnswerBankEntry, AppStatus, Club, ClubEvent, Interview, Match, PersonalEvent, Student, TeamMember } from "../../shared/types";

export const USE_MOCKS = false;
// Consistency only: the server authenticates the cookie and checks all permissions.
// This detects another tab changing the cookie account while this tab has old edits.
let expectedActor: string | null = null;
export function setApiActor(userId: string | null) { expectedActor = userId || null; }
export type Decision = "advance" | "decline" | "accept";
export interface ClubSettings {
  requiresUscId?: boolean;
  uscIdReason?: string;
  zoomConnected?: boolean;
  teamsConnected?: boolean;
}
export interface ClubApplicationState {
  status: AppStatus;
  submittedAt?: string;
  sharedUscId?: boolean;
}
export interface WorkspaceState {
  version: number;
  myClubs: string[];
  drafts: Record<string, Record<string, string>>;
  apps: Record<string, ClubApplicationState>;
  applicationIds: Record<string, string>;
  answerBank: AnswerBankEntry[];
  reminders: string[];
  seenUnlock: boolean;
  calAdded: string[];
  personal: PersonalEvent[];
  calColors: Record<string, string>;
  calHidden: string[];
  interviews: Record<string, Interview>;
}
export type WorkspacePatch = Partial<Pick<WorkspaceState,
  "myClubs" | "drafts" | "reminders" | "seenUnlock" | "calAdded" | "personal" | "calColors" | "calHidden"
>> & { expectedVersion?: number };
export interface OrganizationState {
  teams: Record<string, TeamMember[]>;
  scores: Record<string, Record<string, Record<string, number>>>;
  decisions: Record<string, Decision>;
  clubSettings: Record<string, ClubSettings>;
  interviews: Record<string, Interview>;
  myMembership: TeamMember | null;
  membership?: TeamMember | null;
}
export interface SessionState {
  account: Account | null;
  profile: Student | null;
  workspace: WorkspaceState;
  organization: OrganizationState | null;
}
export interface StudentSignupInfo {
  name: string;
  email: string;
  password: string;
  preferredName?: string;
  pronouns?: string;
  uscId?: string;
  gradTerm?: string;
  year?: number;
}
export interface OfficerSignupInfo {
  name: string;
  email: string;
  password: string;
  clubId: string;
  officerRole: string;
}
export interface RegistrationResult {
  requiresEmailConfirmation: boolean;
  session?: SessionState;
  account?: Account;
}
export interface ResumeInfo {
  id: string;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  textStatus: "available" | "unavailable";
  uploadedAt: string;
}
export interface ParsedResumeResponse {
  major?: string;
  year?: number;
  skills?: string[];
  interests?: string[];
  experiences?: string[];
  resume?: ResumeInfo;
  needsReview: true;
  notice?: string;
  mode?: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly actorId?: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const multipart = body instanceof FormData;
  const publicRequest = (["GET", "HEAD"].includes(method) && ["/session", "/clubs", "/events"].includes(path))
    || ["/auth/login", "/auth/register"].includes(path)
    || path.startsWith("/v1/auth/");
  const actorId = publicRequest ? null : expectedActor;
  const headers: Record<string, string> = {};
  if (body !== undefined && !multipart) headers["Content-Type"] = "application/json";
  if (actorId) headers["X-Odysc-Actor"] = actorId;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError("The server could not be reached. Check your connection and try again.", 0, "NETWORK_ERROR", actorId ?? undefined);
  }
  const assertCurrentActor = () => {
    if (actorId && actorId !== expectedActor) throw new ApiError("Your session changed. Reload before continuing.", 409, "SESSION_CHANGED", actorId);
  };
  assertCurrentActor();
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  assertCurrentActor();
  if (!response.ok) {
    const envelope = data && typeof data === "object" ? data as { error?: { message?: unknown; code?: unknown }; message?: unknown } : {};
    const message = typeof envelope.error?.message === "string" ? envelope.error.message
      : typeof envelope.message === "string" ? envelope.message
      : response.status === 401 ? "Sign in to continue."
      : response.status === 429 ? "Too many requests. Please wait a moment and try again."
      : "The request could not be completed. Please try again.";
    throw new ApiError(message, response.status, typeof envelope.error?.code === "string" ? envelope.error.code : undefined, actorId ?? undefined);
  }
  if (data === null) throw new ApiError("The server returned an unreadable response. Please try again.", 502, "INVALID_RESPONSE", actorId ?? undefined);
  return data as T;
}

export const api = {
  session: () => request<SessionState>("/session"),
  login: (email: string, password: string, as: "student" | "officer") => request<SessionState>("/auth/login", "POST", { email: email.trim(), password, as }),
  registerStudent: (info: StudentSignupInfo) => request<RegistrationResult>("/auth/register", "POST", { ...info, email: info.email.trim(), role: "student" }),
  registerOfficer: (info: OfficerSignupInfo) => request<RegistrationResult>("/auth/register", "POST", { ...info, email: info.email.trim(), role: "officer" }),
  logout: () => request<void>("/auth/logout", "POST"),
  forgotPassword: (email: string) => request<{ message: string }>("/v1/auth/forgot-password", "POST", { email: email.trim() }),
  resendConfirmation: (email: string) => request<{ message: string }>("/v1/auth/resend-confirmation", "POST", { email: email.trim() }),
  recoverySession: () => request<{ valid: boolean }>("/v1/auth/recovery-session"),
  resetPassword: (password: string) => request<{ message: string }>("/v1/auth/reset-password", "POST", { password }),
  me: () => request<Student>("/me"),
  saveProfile: (patch: Partial<Student>) => request<Student>("/me", "PATCH", patch),
  completeProfile: () => request<Student>("/me/complete", "POST", {}),
  workspace: () => request<WorkspaceState>("/workspace"),
  saveWorkspace: (patch: WorkspacePatch) => request<WorkspaceState>("/workspace", "PATCH", patch),
  clubs: () => request<Club[]>("/clubs"),
  events: () => request<ClubEvent[]>("/events"),
  createEvent: (input: Omit<ClubEvent, "id">) => request<ClubEvent>("/events", "POST", input),
  myApplications: () => request<Application[]>("/applications/mine"),
  matches: (_studentId?: string) => request<Match[]>("/ai/match", "POST", {}),
  parseResume: (file: File) => {
    const body = new FormData();
    body.append("resume", file);
    return request<ParsedResumeResponse>("/ai/parse-resume", "POST", body);
  },
  submitApplication: (clubId: string, answers: Application["answers"], shareUscId = false, rememberAnswers = false) =>
    request<{ application: Application; workspace: WorkspaceState }>("/applications", "POST", { clubId, answers, shareUscId, rememberAnswers }),
  applicants: (clubId: string) => request<Applicant[]>(`/clubs/${encodeURIComponent(clubId)}/applicants`),
  organization: () => request<OrganizationState>("/organizer/state"),
  requestOrganization: (clubId: string, officerRole: string) => request<SessionState>("/organizer/request", "POST", { clubId, officerRole }),
  setScore: (applicationId: string, scores: Record<string, number>) => request<OrganizationState>(`/applications/${encodeURIComponent(applicationId)}/review`, "POST", { scores }),
  decide: (applicationId: string, decision: Decision) => request<OrganizationState>(`/applications/${encodeURIComponent(applicationId)}/decision`, "POST", { decision }),
  scheduleInterview: (interview: Omit<Interview, "invitedAt" | "booked" | "clubId">) => request<OrganizationState>("/interviews", "POST", interview),
  bookInterview: (applicationId: string, slot: string | null) => request<WorkspaceState>(`/interviews/${encodeURIComponent(applicationId)}/book`, "POST", { slot }),
  inviteMember: (clubId: string, email: string, name: string, officerRole: string) => request<OrganizationState>(`/clubs/${encodeURIComponent(clubId)}/team/invite`, "POST", { email: email.trim(), name, officerRole }),
  approveMember: (clubId: string, email: string) => request<OrganizationState>(`/clubs/${encodeURIComponent(clubId)}/team/approve`, "POST", { email }),
  removeMember: (clubId: string, email: string) => request<OrganizationState>(`/clubs/${encodeURIComponent(clubId)}/team/${encodeURIComponent(email)}`, "DELETE"),
  setClubSetting: (clubId: string, patch: ClubSettings) => request<OrganizationState>(`/clubs/${encodeURIComponent(clubId)}/settings`, "PATCH", patch),
};
