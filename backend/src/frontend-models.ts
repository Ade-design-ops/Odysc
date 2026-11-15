import { z } from "zod";
import { HttpError } from "./errors.js";
import type { Club as DirectoryClub, User } from "./models.js";
import type { StoredStudentProfile } from "./supabase.js";
export interface FrontendStudent {
  id: string;
  name: string;
  email: string;
  preferredName?: string;
  pronouns?: string;
  uscId?: string;
  gradTerm?: string;
  major: string;
  year: number;
  skills: string[];
  interests: string[];
  experiences: string[];
  goals?: string[];
  bio?: string;
}
export interface FrontendAccount {
  role: "student" | "officer";
  name: string;
  email: string;
  clubId?: string;
  officerRole?: string;
  verified?: boolean;
}
export interface FrontendTeamMember {
  email: string;
  name: string;
  officerRole: string;
  access: "admin" | "reviewer";
  status: "active" | "pending" | "invited";
}
export interface FrontendInterview {
  applicationId: string;
  clubId: string;
  format: "zoom" | "teams" | "meet" | "in-person";
  slots: string[];
  durationMin: number;
  link?: string;
  buildingCode?: string;
  room?: string;
  note?: string;
  booked?: string;
  invitedAt: string;
}
export interface FrontendSummary {
  summary: string;
  evidence: string[];
  injectionFlag: boolean;
}
export interface FrontendApplication {
  id: string;
  studentId: string;
  clubId: string;
  status: "draft" | "submitted" | "interview" | "accepted" | "rejected";
  submittedAt?: string;
  answers: {
    questionId: string;
    text: string;
  }[];
}
export interface FrontendClub {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  category: string;
  tagline: string;
  description: string;
  selectivity: "Open" | "Selective" | "Unknown";
  acceptanceRate?: number;
  hoursPerWeek: string;
  dues: string;
  deadline: string;
  contacts: {
    role: string;
    name: string;
    email: string;
    instagram?: string;
    officeHours?: string;
  }[];
  requiresUscId?: boolean;
  uscIdReason?: string;
  zoomConnected?: boolean;
  teamsConnected?: boolean;
  questions: {
    id: string;
    prompt: string;
    maxWords?: number;
  }[];
  websiteUrl?: string | null;
}
export interface FrontendWorkspace {
  version: number;
  myClubs: string[];
  drafts: Record<string, Record<string, string>>;
  apps: Record<
    string,
    {
      status: FrontendApplication["status"];
      submittedAt?: string;
      sharedUscId?: boolean;
    }
  >;
  applicationIds: Record<string, string>;
  answerBank: {
    id: string;
    prompt: string;
    text: string;
    fromClubId: string;
  }[];
  reminders: string[];
  seenUnlock: boolean;
  calAdded: string[];
  personal: {
    id: string;
    title: string;
    start: string;
    durationMin: number;
    location?: string;
  }[];
  calColors: Record<string, string>;
  calHidden: string[];
  interviews: Record<string, FrontendInterview>;
}
export interface FrontendOrganization {
  myMembership: FrontendTeamMember | null;
  teams: Record<string, FrontendTeamMember[]>;
  scores: Record<string, Record<string, Record<string, number>>>;
  decisions: Record<string, "advance" | "decline" | "accept">;
  clubSettings: Record<string, Record<string, unknown>>;
  interviews: Record<string, FrontendInterview>;
}
export interface FrontendSession {
  account: FrontendAccount | null;
  profile: FrontendStudent | null;
  workspace: FrontendWorkspace;
  organization: FrontendOrganization | null;
}
export interface Actor {
  user: User;
  token: string;
}
export interface MembershipRow {
  id: string;
  club_id: string;
  user_id: string | null;
  email: string;
  full_name: string;
  officer_role: string;
  access: "admin" | "reviewer";
  status: "active" | "pending" | "invited";
}
export interface ApplicationRow {
  id: string;
  student_id: string;
  club_id: string;
  status: FrontendApplication["status"];
  answers: {
    questionId: string;
    prompt: string;
    text: string;
  }[];
  profile_snapshot: FrontendStudent;
  share_usc_id: boolean;
  submitted_at: string | Date;
  created_at?: string | Date;
}
export interface WorkspaceRow {
  user_id: string;
  version: number;
  data: Record<string, unknown>;
}
export const idSchema = z
  .string()
  .regex(/^-?\d{1,19}$/)
  .refine((value) => {
    try {
      const n = BigInt(value);
      return n >= -9223372036854775808n && n <= 9223372036854775807n;
    } catch {
      return false;
    }
  }, "A club directory ID is required.");
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => value.split("@")[1] === "usc.edu",
    "Use an @usc.edu email.",
  );
const textList = (count: number, size = 100) =>
  z
    .array(z.string().trim().min(1).max(size))
    .max(count)
    .transform((items) => [
      ...new Map(items.map((value) => [value.toLowerCase(), value])).values(),
    ]);
export const studentPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    preferredName: z.string().trim().max(100).optional(),
    pronouns: z.string().trim().max(80).optional(),
    uscId: z
      .string()
      .regex(/^(?:\d{10})?$/)
      .optional(),
    gradTerm: z.string().trim().max(40).optional(),
    major: z.string().trim().max(150).optional(),
    year: z.number().int().min(0).max(7).optional(),
    skills: textList(30).optional(),
    interests: textList(20).optional(),
    experiences: z
      .array(z.string().max(4000))
      .max(30)
      .refine((values) => values.join("\n").length <= 4000)
      .optional(),
    goals: textList(10, 300).optional(),
    bio: z.string().max(1500).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Send at least one profile field.",
  );
export const personalEventSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    start: z.string().datetime({ offset: true }),
    durationMin: z.number().int().min(5).max(1440),
    location: z.string().trim().max(300).optional(),
  })
  .strict();
const keys = z.string().min(1).max(100);
export const workspacePatchSchema = z
  .object({
    expectedVersion: z.number().int().min(0).optional(),
    myClubs: z.array(idSchema).max(650).optional(),
    drafts: z
      .record(idSchema, z.record(keys, z.string().max(20000)))
      .refine(
        (value) =>
          Object.keys(value).length <= 200 &&
          JSON.stringify(value).length <= 100000,
        "Too many drafts.",
      )
      .optional(),
    reminders: z.array(idSchema).max(650).optional(),
    seenUnlock: z.boolean().optional(),
    calAdded: z.array(keys).max(2000).optional(),
    personal: z.array(personalEventSchema).max(500).optional(),
    calColors: z
      .record(keys, z.string().regex(/^#[0-9a-f]{6}$/i))
      .refine((value) => Object.keys(value).length <= 700)
      .optional(),
    calHidden: z.array(keys).max(700).optional(),
  })
  .strict();
export const questionSchema = z
  .object({
    id: z.string().min(1).max(100),
    prompt: z.string().trim().min(1).max(2000),
    maxWords: z.number().int().min(1).max(2000).optional(),
  })
  .strict();
export const clubSettingsSchema = z
  .object({
    requiresUscId: z.boolean().optional(),
    uscIdReason: z.string().trim().max(1000).optional(),
    zoomConnected: z.boolean().optional(),
    teamsConnected: z.boolean().optional(),
    tagline: z.string().trim().max(250).optional(),
    description: z.string().trim().max(10000).optional(),
    selectivity: z.enum(["Open", "Selective", "Unknown"]).optional(),
    acceptanceRate: z.number().min(0).max(1).nullable().optional(),
    hoursPerWeek: z.string().trim().max(100).optional(),
    dues: z.string().trim().max(100).optional(),
    deadline: z
      .union([
        z.literal(""),
        z.string().datetime({ offset: true }),
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      ])
      .refine(
        (value) => !value || (Number.isFinite(Date.parse(value)) && (value.length !== 10 || new Date(value).toISOString().slice(0, 10) === value)),
        "Use a valid deadline.",
      )
      .optional(),
    contacts: z
      .array(
        z
          .object({
            role: z.string().max(100),
            name: z.string().max(100),
            email: z.string().email().max(254),
            instagram: z.string().url().max(500).refine(value => {
              try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
              catch { return false; }
            }, 'Use an HTTPS contact URL without credentials.').optional(),
            officeHours: z.string().max(300).optional(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    questions: z
      .array(questionSchema)
      .max(30)
      .refine(
        (value) => new Set(value.map((item) => item.id)).size === value.length,
        "Question IDs must be unique.",
      )
      .optional(),
  })
  .strict();
/** Read additive stored metadata without relaxing known or nested field validation. */
export function readClubSettings(value: unknown) {
  return clubSettingsSchema.strip().parse(value);
}
export const submitSchema = z
  .object({
    clubId: idSchema,
    answers: z
      .array(
        z
          .object({ questionId: keys, text: z.string().trim().max(20000) })
          .strict(),
      )
      .max(30),
    shareUscId: z.boolean().optional(),
    rememberAnswers: z.boolean().optional(),
  })
  .strict();
export const interviewSchema = z
  .object({
    applicationId: z.string().uuid(),
    format: z.enum(["zoom", "teams", "meet", "in-person"]),
    slots: z
      .array(z.string().datetime({ offset: true }))
      .min(1)
      .max(6),
    durationMin: z.number().int().min(5).max(240),
    link: z.string().url().max(2000).optional(),
    buildingCode: z.string().trim().max(30).optional(),
    room: z.string().trim().max(100).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.format === "in-person" && (!value.buildingCode || !value.room))
      context.addIssue({
        code: "custom",
        message: "Choose a building and room.",
      });
    let validMeetingLink = false;
    try {
      const url = new URL(value.link ?? '');
      validMeetingLink = url.protocol === 'https:' && !url.username && !url.password;
    } catch { /* A malformed URL is a validation failure, never a server error. */ }
    if (value.format !== "in-person" && !validMeetingLink)
      context.addIssue({
        code: "custom",
        message:
          "Paste a real HTTPS meeting link. Automatic video-provider integration is not configured.",
      });
    if (
      new Set(value.slots.map(slot => Date.parse(slot))).size !== value.slots.length ||
      value.slots.some((slot) => Date.parse(slot) <= Date.now())
    )
      context.addIssue({
        code: "custom",
        message: "Offer unique future interview times.",
      });
  });
export function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpError(
      400,
      parsed.error.issues[0]?.message ?? "Check the entered details.",
      "VALIDATION_ERROR",
    );
  return parsed.data;
}
export const yearNames = [
  null,
  "first_year",
  "second_year",
  "third_year",
  "fourth_year",
  "fifth_year_plus",
  "graduate",
  "other",
] as const;
export function frontendStudent(
  user: User,
  row: StoredStudentProfile | null,
  extras: Record<string, unknown> = {},
): FrontendStudent {
  const optional = (key: string) =>
    typeof extras[key] === "string" && extras[key]
      ? { [key]: extras[key] as string }
      : {};
  return {
    id: user.id,
    email: user.email,
    name: row?.full_name || user.name,
    ...optional("preferredName"),
    ...optional("pronouns"),
    ...optional("uscId"),
    ...optional("gradTerm"),
    major: row?.major ?? "",
    year: row?.academic_year ? yearNames.indexOf(row.academic_year) : 0,
    skills: row?.skills ?? [],
    interests: row?.interests ?? [],
    experiences: row?.experience
      ? row.experience.split("\n").filter(Boolean)
      : [],
    goals: row?.goals ?? [],
    bio: row?.bio ?? "",
  };
}
export function emptyWorkspace(): FrontendWorkspace {
  return {
    version: 0,
    myClubs: [],
    drafts: {},
    apps: {},
    applicationIds: {},
    answerBank: [],
    reminders: [],
    seenUnlock: false,
    calAdded: [],
    personal: [],
    calColors: {},
    calHidden: [],
    interviews: {},
  };
}
export function teamMember(row: MembershipRow): FrontendTeamMember {
  return {
    email: row.email,
    name: row.full_name,
    officerRole: row.officer_role,
    access: row.access,
    status: row.status,
  };
}
export const iso = (value: string | Date) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
export function applicationModel(row: ApplicationRow): FrontendApplication {
  return {
    id: row.id,
    studentId: row.student_id,
    clubId: row.club_id,
    status: row.status,
    submittedAt: iso(row.submitted_at),
    answers: row.answers.map(({ questionId, text }) => ({ questionId, text })),
  };
}
export function frontendClub(
  club: DirectoryClub,
  settings: Record<string, unknown> = {},
): FrontendClub {
  const config = readClubSettings(settings);
  const shortName =
    club.name
      .replace(/\b(at|of|the|and|university|southern|california)\b/gi, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 8) || club.name.slice(0, 8);
  return {
    id: club.id,
    slug: club.slug,
    name: club.name,
    shortName,
    category: club.category || "Uncategorized",
    tagline: config.tagline ?? "",
    description: config.description ?? club.description,
    selectivity: config.selectivity ?? "Unknown",
    ...(typeof config.acceptanceRate === "number"
      ? { acceptanceRate: config.acceptanceRate }
      : {}),
    hoursPerWeek: config.hoursPerWeek ?? "",
    dues: config.dues ?? "",
    deadline: config.deadline ?? "",
    contacts: config.contacts ?? [],
    questions: config.questions ?? [],
    requiresUscId: config.requiresUscId ?? false,
    uscIdReason: config.uscIdReason ?? "",
    zoomConnected: false,
    teamsConnected: false,
    websiteUrl: club.websiteUrl,
  };
}
export function sourceSummary(
  student: FrontendStudent,
  answers: {
    prompt: string;
    text: string;
  }[],
): FrontendSummary {
  const text = answers.map((answer) => answer.text).join("\n");
  const evidence = [
    ...student.experiences,
    ...answers.map((answer) => answer.text),
  ]
    .filter(Boolean)
    .map((value) => value.slice(0, 500))
    .slice(0, 3);
  return {
    summary: [
      student.major && `Major: ${student.major}.`,
      student.skills.length && `Reported skills: ${student.skills.join(", ")}.`,
      `Submitted ${answers.filter((answer) => answer.text).length} written response(s).`,
    ]
      .filter(Boolean)
      .join(" "),
    evidence,
    injectionFlag:
      /ignore (all |your )?(previous|prior) instructions|system prompt|rate this applicant/i.test(
        text,
      ),
  };
}
