import { readFileSync } from "node:fs";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { HttpError } from "./errors.js";
import type { StoredStudentProfile } from "./supabase.js";
import {
  applicationModel,
  clubSettingsSchema,
  emptyWorkspace,
  frontendStudent,
  iso,
  sourceSummary,
  teamMember,
  yearNames,
  type Actor,
  type ApplicationRow,
  type FrontendOrganization,
  type FrontendSession,
  type FrontendStudent,
  type FrontendWorkspace,
  type MembershipRow,
  type WorkspaceRow,
} from "./frontend-models.js";
export interface SqlConnection {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    rows: T[];
    rowCount?: number | null;
  }>;
}
export interface FrontendDatabase extends SqlConnection {
  transaction<T>(action: (connection: SqlConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export interface FrontendStoreOptions {
  dbUrl: string;
  caFile: string;
  database?: FrontendDatabase;
  now?: () => number;
}
export interface FrontendEventInput {
  clubId: string;
  title: string;
  kind: string;
  start: string;
  durationMin: number;
  buildingCode: string;
  room: string;
}
const campusDateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function campusDate(timestamp: number) {
  const parts = Object.fromEntries(
    campusDateFormat.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const forbidden = () =>
  new HttpError(
    403,
    "An approved officer account is required for this club.",
    "CLUB_ACCESS_REQUIRED",
  );
const notFound = () =>
  new HttpError(404, "The requested record was not found.", "NOT_FOUND");
const conflict = (message: string) => new HttpError(409, message, "CONFLICT");
const membershipColumns =
  "id::text,club_id::text,user_id::text,email,full_name,officer_role,access,status";
const applicationColumns =
  "id::text,student_id::text,club_id::text,status,answers,profile_snapshot,share_usc_id,submitted_at,created_at";
const officerApplicationColumns = applicationColumns
  .split(",")
  .map((column) => `a.${column}`)
  .join(",");
function database(options: FrontendStoreOptions): FrontendDatabase {
  if (options.database) return options.database;
  let configuration;
  let ca: string;
  try {
    const url = new URL(options.dbUrl);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const ref = "cfrkamtsphdlowuiuarn";
    const port = Number(url.port || 5432);
    const validHost =
      url.hostname === `db.${ref}.supabase.co` ||
      (url.hostname.endsWith(".pooler.supabase.com") &&
        user.endsWith(`.${ref}`));
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !validHost ||
      !user ||
      !password ||
      !options.caFile ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error();
    ca = readFileSync(options.caFile, "utf8");
    configuration = {
      host: url.hostname,
      port,
      user,
      password,
      database: decodeURIComponent(url.pathname.slice(1)) || "postgres",
    };
  } catch {
    throw new Error(
      "Shared workflows require the verified Supabase database connection and root CA.",
    );
  }
  const pool = new Pool({
    ...configuration,
    ssl: { ca, rejectUnauthorized: true },
    max: 3,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
    statement_timeout: 10000,
    query_timeout: 12000,
    application_name: "odysc-shared-workflows",
    options:
      "-c search_path=pg_catalog -c statement_timeout=10000 -c lock_timeout=3000",
  });
  pool.on("error", () => {});
  const connection = (client: Pool | PoolClient): SqlConnection => ({
    query: async <T extends QueryResultRow>(
      sql: string,
      values?: readonly unknown[],
    ) => {
      const result = await client.query<T>(
        sql,
        values ? [...values] : undefined,
      );
      return { rows: result.rows, rowCount: result.rowCount };
    },
  });
  return {
    ...connection(pool),
    async transaction<T>(action: (connection: SqlConnection) => Promise<T>) {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query("BEGIN");
        const result = await action(connection(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
        throw error;
      } finally {
        client.release(discard);
      }
    },
    close: () => pool.end(),
  };
}
export class FrontendStore {
  private readonly db: FrontendDatabase;
  private readonly now: () => number;
  constructor(options: FrontendStoreOptions) {
    this.db = database(options);
    this.now = options.now ?? Date.now;
  }
  close() {
    return this.db.close();
  }
  private async safe<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const code = (
        error as {
          code?: string;
        }
      )?.code;
      if (code === "23505")
        throw conflict(
          "This record already exists. Reload to see the latest state.",
        );
      if (["23503", "23514", "22P02"].includes(code ?? ""))
        throw new HttpError(
          400,
          "The submitted details are not valid.",
          "INVALID_DETAILS",
        );
      if (code === "42P01" || code === "42703")
        throw new HttpError(
          503,
          "Shared workflows are awaiting the database migration.",
          "WORKFLOW_SCHEMA_NOT_READY",
        );
      throw new HttpError(
        503,
        "The shared workspace is temporarily unavailable. Please try again.",
        "WORKFLOW_UNAVAILABLE",
      );
    }
  }
  private actor<T>(
    actor: Actor,
    action: (q: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return this.safe(() =>
      this.db.transaction(async (q) => {
        const check = await q.query(
          "SELECT id FROM auth.users WHERE id=$1::uuid AND lower(email)=lower($2::text) AND email ~* '^[^@[:space:]]+@usc[.]edu$' AND email_confirmed_at IS NOT NULL FOR SHARE",
          [actor.user.id, actor.user.email],
        );
        if (!check.rows.length)
          throw new HttpError(
            401,
            "Confirm your current USC email and sign in again.",
            "EMAIL_CONFIRMATION_REQUIRED",
          );
        return action(q);
      }),
    );
  }
  private async workspaceRow(
    q: SqlConnection,
    actor: Actor,
    lock = false,
  ): Promise<WorkspaceRow> {
    await q.query(
      "INSERT INTO public.odysc_student_workspaces(user_id) VALUES($1::uuid) ON CONFLICT(user_id) DO NOTHING",
      [actor.user.id],
    );
    return (
      await q.query<WorkspaceRow>(
        `SELECT user_id::text,version,data FROM public.odysc_student_workspaces WHERE user_id=$1::uuid${lock ? " FOR UPDATE" : ""}`,
        [actor.user.id],
      )
    ).rows[0]!;
  }
  private async profile(
    q: SqlConnection,
    actor: Actor,
    state?: WorkspaceRow,
  ): Promise<FrontendStudent> {
    const workspace = state ?? (await this.workspaceRow(q, actor));
    const result = await q.query<StoredStudentProfile>(
      "SELECT * FROM public.student_profiles WHERE user_id=$1::uuid",
      [actor.user.id],
    );
    const extras = (
      workspace.data.profileExtras &&
      typeof workspace.data.profileExtras === "object"
        ? workspace.data.profileExtras
        : {}
    ) as Record<string, unknown>;
    const student = frontendStudent(actor.user, result.rows[0] ?? null, extras);
    const initial = workspace.data.initialProfile as
      | Partial<FrontendStudent>
      | undefined;
    return result.rows.length || !initial
      ? student
      : { ...student, ...initial, id: actor.user.id, email: actor.user.email };
  }
  private async memberships(
    q: SqlConnection,
    actor: Actor,
  ): Promise<MembershipRow[]> {
    await q.query(
      "UPDATE public.odysc_club_memberships SET user_id=$1::uuid,status='active',updated_at=now() WHERE email=lower($2::text) AND status='invited' AND user_id IS NULL",
      [actor.user.id, actor.user.email],
    );
    return (
      await q.query<MembershipRow>(
        `SELECT ${membershipColumns} FROM public.odysc_club_memberships WHERE user_id=$1::uuid AND email=lower($2::text) ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,created_at`,
        [actor.user.id, actor.user.email],
      )
    ).rows;
  }
  private async member(
    q: SqlConnection,
    actor: Actor,
    clubId: string,
    admin = false,
  ): Promise<MembershipRow> {
    const row = (
      await q.query<MembershipRow>(
        `SELECT ${membershipColumns} FROM public.odysc_club_memberships WHERE club_id=$1::bigint AND user_id=$2::uuid AND email=lower($3::text) AND status='active'`,
        [clubId, actor.user.id, actor.user.email],
      )
    ).rows[0];
    if (!row || (admin && row.access !== "admin")) throw forbidden();
    return row;
  }
  private async lockClub(q: SqlConnection, clubId: string) {
    if (
      !(
        await q.query(
          "SELECT club_id FROM public.clubs WHERE club_id=$1::bigint FOR UPDATE",
          [clubId],
        )
      ).rows.length
    )
      throw notFound();
  }
  private async settings(
    q: SqlConnection,
    clubId: string,
  ): Promise<Record<string, unknown>> {
    return (
      (
        await q.query<{
          data: Record<string, unknown>;
        }>(
          "SELECT data FROM public.odysc_club_settings WHERE club_id=$1::bigint",
          [clubId],
        )
      ).rows[0]?.data ?? {}
    );
  }
  private async interviews(
    q: SqlConnection,
    mode: "student" | "club",
    id: string,
  ) {
    const result = await q.query(
      `SELECT i.application_id::text,i.club_id::text,i.format,i.slots,i.duration_min,i.link,i.building_code,i.room,i.note,i.booked_at,i.invited_at FROM public.odysc_interviews i JOIN public.odysc_applications a ON a.id=i.application_id WHERE ${mode === "student" ? "a.student_id=$1::uuid" : "i.club_id=$1::bigint"}`,
      [id],
    );
    return Object.fromEntries(
      result.rows.map((row) => [
        row.application_id,
        {
          applicationId: row.application_id,
          clubId: row.club_id,
          format: row.format,
          slots: (row.slots as (string | Date)[]).map(iso),
          durationMin: row.duration_min,
          ...(row.link ? { link: row.link } : {}),
          ...(row.building_code ? { buildingCode: row.building_code } : {}),
          ...(row.room ? { room: row.room } : {}),
          ...(row.note ? { note: row.note } : {}),
          ...(row.booked_at ? { booked: iso(row.booked_at) } : {}),
          invitedAt: iso(row.invited_at),
        },
      ]),
    ) as FrontendWorkspace["interviews"];
  }
  private async workspace(
    q: SqlConnection,
    actor: Actor,
    row?: WorkspaceRow,
  ): Promise<FrontendWorkspace> {
    const state = row ?? (await this.workspaceRow(q, actor));
    const base = emptyWorkspace();
    for (const key of [
      "myClubs",
      "drafts",
      "reminders",
      "seenUnlock",
      "calAdded",
      "personal",
      "calColors",
      "calHidden",
    ] as const)
      if (state.data[key] !== undefined)
        (base as unknown as Record<string, unknown>)[key] = state.data[key];
    base.version = state.version;
    const apps = await q.query<ApplicationRow>(
      `SELECT ${applicationColumns} FROM public.odysc_applications WHERE student_id=$1::uuid ORDER BY submitted_at DESC`,
      [actor.user.id],
    );
    for (const app of apps.rows) {
      base.apps[app.club_id] = {
        status: app.status,
        submittedAt: iso(app.submitted_at),
        sharedUscId: app.share_usc_id,
      };
      base.applicationIds[app.club_id] = app.id;
    }
    base.answerBank = (
      await q.query<{
        id: string;
        prompt: string;
        answer: string;
        club_id: string;
      }>(
        "SELECT id::text,prompt,answer,club_id::text FROM public.odysc_answer_bank WHERE student_id=$1::uuid ORDER BY created_at DESC",
        [actor.user.id],
      )
    ).rows.map((item) => ({
      id: item.id,
      prompt: item.prompt,
      text: item.answer,
      fromClubId: item.club_id,
    }));
    base.interviews = await this.interviews(q, "student", actor.user.id);
    return base;
  }
  private async organization(
    q: SqlConnection,
    actor: Actor,
    membership: MembershipRow,
  ): Promise<FrontendOrganization> {
    const base: FrontendOrganization = {
      myMembership: teamMember(membership),
      teams: {},
      scores: {},
      decisions: {},
      clubSettings: {},
      interviews: {},
    };
    if (membership.status !== "active") {
      base.teams[membership.club_id] = [teamMember(membership)];
      return base;
    }
    base.teams[membership.club_id] = (
      await q.query<MembershipRow>(
        `SELECT ${membershipColumns} FROM public.odysc_club_memberships WHERE club_id=$1::bigint ORDER BY created_at`,
        [membership.club_id],
      )
    ).rows.map(teamMember);
    base.clubSettings[membership.club_id] = await this.settings(
      q,
      membership.club_id,
    );
    const reviews = await q.query<{
      application_id: string;
      email: string;
      scores: Record<string, number>;
      decision: "advance" | "decline" | "accept" | null;
      application_status: ApplicationRow["status"];
    }>(
      "SELECT r.application_id::text,COALESCE(m.email,'Former reviewer ' || pg_catalog.substr(r.reviewer_id::text,1,8)) AS email,r.scores,r.decision,a.status AS application_status FROM public.odysc_reviews r JOIN public.odysc_applications a ON a.id=r.application_id LEFT JOIN public.odysc_club_memberships m ON m.user_id=r.reviewer_id AND m.club_id=a.club_id AND m.status='active' WHERE a.club_id=$1::bigint ORDER BY r.updated_at",
      [membership.club_id],
    );
    for (const review of reviews.rows) {
      (base.scores[review.application_id] ??= {})[review.email] = review.scores;
      // Reviewer score updates must not resurrect a historical decision.
      const decision = review.application_status === "accepted" ? "accept"
        : review.application_status === "rejected" ? "decline"
        : review.application_status === "interview" ? "advance" : undefined;
      if (decision) base.decisions[review.application_id] = decision;
    }
    base.interviews = await this.interviews(q, "club", membership.club_id);
    return base;
  }
  private async session(
    q: SqlConnection,
    actor: Actor,
    requested?: "student" | "officer",
  ): Promise<FrontendSession> {
    const state = await this.workspaceRow(q, actor);
    const members = await this.memberships(q, actor);
    const mode =
      requested ?? (state.data.lastMode === "officer" ? "officer" : "student");
    const membership = members[0];
    if (requested === "officer" && !membership)
      throw new HttpError(
        403,
        "Request club officer access first. An approved club administrator must approve it.",
        "OFFICER_MEMBERSHIP_REQUIRED",
      );
    const officer = mode === "officer" && membership;
    const profile = await this.profile(q, actor, state);
    return {
      account: officer
        ? {
            role: "officer",
            name: profile.name || membership.full_name,
            email: actor.user.email,
            clubId: membership.club_id,
            officerRole: membership.officer_role,
            verified: membership.status === "active",
          }
        : { role: "student", name: profile.name, email: actor.user.email },
      profile,
      workspace: await this.workspace(q, actor, state),
      organization: officer
        ? await this.organization(q, actor, membership)
        : null,
    };
  }
  getSession(actor: Actor, requested?: "student" | "officer") {
    return this.actor(actor, async (q) => {
      if (requested) {
        const state = await this.workspaceRow(q, actor, true);
        await q.query(
          "UPDATE public.odysc_student_workspaces SET data=$2::jsonb,version=version+1,updated_at=now() WHERE user_id=$1::uuid",
          [
            actor.user.id,
            JSON.stringify({ ...state.data, lastMode: requested }),
          ],
        );
      }
      return this.session(q, actor, requested);
    });
  }
  getProfile(actor: Actor) {
    return this.actor(actor, (q) => this.profile(q, actor));
  }
  async recordSignup(
    user: {
      id: string;
      email: string;
      name: string;
    },
    input: Record<string, unknown>,
  ) {
    return this.safe(() =>
      this.db.transaction(async (q) => {
        // Confirm a real newly created identity; duplicate signups may return an obfuscated ID.
        const check = await q.query(
          "SELECT id FROM auth.users WHERE id=$1::uuid AND lower(email)=lower($2::text) AND created_at > now()-interval '2 minutes'",
          [user.id, user.email],
        );
        if (!check.rows.length) return;
        const extras = Object.fromEntries(
          ["preferredName", "pronouns", "uscId", "gradTerm"]
            .filter((key) => typeof input[key] === "string")
            .map((key) => [key, input[key]]),
        );
        const initial = {
          name: user.name,
          year: input.year ?? 0,
          major: "",
          skills: [],
          interests: [],
          experiences: [],
        };
        const inserted = await q.query(
          "INSERT INTO public.odysc_student_workspaces(user_id,data) VALUES($1::uuid,$2::jsonb) ON CONFLICT(user_id) DO NOTHING RETURNING user_id",
          [
            user.id,
            JSON.stringify({
              profileExtras: extras,
              initialProfile: initial,
              lastMode: input.role === "officer" ? "officer" : "student",
            }),
          ],
        );
        if (inserted.rows.length && input.role === "officer" && input.clubId) {
          await this.lockClub(q, String(input.clubId));
          await q.query(
            "INSERT INTO public.odysc_club_memberships(club_id,user_id,email,full_name,officer_role,access,status) VALUES($1::bigint,$2::uuid,lower($3::text),$4,$5,'reviewer','pending') ON CONFLICT(club_id,email) DO NOTHING",
            [
              input.clubId,
              user.id,
              user.email,
              user.name,
              input.officerRole || "Officer",
            ],
          );
        }
      }),
    );
  }
  saveProfile(actor: Actor, patch: Record<string, unknown>, complete = false) {
    return this.actor(actor, async (q) => {
      const state = await this.workspaceRow(q, actor, true);
      const current = await this.profile(q, actor, state);
      const updated = {
        ...current,
        ...patch,
        id: actor.user.id,
        email: actor.user.email,
      } as FrontendStudent;
      if (!updated.name.trim())
        throw new HttpError(
          400,
          "Add your name before saving.",
          "MISSING_ONBOARDING_FIELDS",
        );
      const basics = Boolean(
        updated.name.trim() &&
          updated.year > 0 &&
          updated.major.trim() &&
          updated.interests.length,
      );
      if (complete && !basics)
        throw new HttpError(
          400,
          "Complete your name, year, major, and at least one interest.",
          "MISSING_ONBOARDING_FIELDS",
        );
      const prior = await q.query<StoredStudentProfile>(
        "SELECT * FROM public.student_profiles WHERE user_id=$1::uuid",
        [actor.user.id],
      );
      const finishedAt = basics
        ? complete
          ? new Date().toISOString()
          : (prior.rows[0]?.onboarding_completed_at ?? null)
        : null;
      await q.query(
        `INSERT INTO public.student_profiles(user_id,full_name,academic_year,graduation_year,major,interests,goals,bio,skills,experience,onboarding_completed_at) VALUES($1::uuid,$2,$3,$4,$5,$6::varchar[],$7::varchar[],$8,$9::varchar[],$10,$11::timestamptz) ON CONFLICT(user_id) DO UPDATE SET full_name=EXCLUDED.full_name,academic_year=EXCLUDED.academic_year,graduation_year=EXCLUDED.graduation_year,major=EXCLUDED.major,interests=EXCLUDED.interests,goals=EXCLUDED.goals,bio=EXCLUDED.bio,skills=EXCLUDED.skills,experience=EXCLUDED.experience,onboarding_completed_at=EXCLUDED.onboarding_completed_at,updated_at=now()`,
        [
          actor.user.id,
          updated.name.trim(),
          yearNames[updated.year] ?? null,
          prior.rows[0]?.graduation_year ?? null,
          updated.major.trim(),
          updated.interests,
          updated.goals ?? [],
          updated.bio ?? "",
          updated.skills,
          updated.experiences.join("\n"),
          finishedAt,
        ],
      );
      const extras = Object.fromEntries(
        ["preferredName", "pronouns", "uscId", "gradTerm"]
          .filter(
            (key) =>
              typeof (updated as unknown as Record<string, unknown>)[key] ===
              "string",
          )
          .map((key) => [
            key,
            (updated as unknown as Record<string, unknown>)[key],
          ]),
      );
      const { initialProfile: _initial, ...data } = state.data;
      // Profile extras are server-owned and merged under the row lock. The workspace
      // version tracks editable personal workspace fields, not independent profile saves.
      await q.query(
        "UPDATE public.odysc_student_workspaces SET data=$2::jsonb,updated_at=now() WHERE user_id=$1::uuid",
        [actor.user.id, JSON.stringify({ ...data, profileExtras: extras })],
      );
      return this.profile(q, actor);
    });
  }
  getWorkspace(actor: Actor) {
    return this.actor(actor, (q) => this.workspace(q, actor));
  }
  saveWorkspace(actor: Actor, patch: Record<string, unknown>) {
    return this.actor(actor, async (q) => {
      const current = await this.workspaceRow(q, actor, true);
      if (
        patch.expectedVersion !== undefined &&
        patch.expectedVersion !== current.version
      )
        throw conflict(
          "Your workspace changed in another tab. Reload before saving again.",
        );
      const { expectedVersion: _expected, ...changes } = patch;
      await q.query(
        "UPDATE public.odysc_student_workspaces SET data=$2::jsonb,version=version+1,updated_at=now() WHERE user_id=$1::uuid",
        [actor.user.id, JSON.stringify({ ...current.data, ...changes })],
      );
      return this.workspace(q, actor);
    });
  }
  clubSettings() {
    return this.safe(async () =>
      Object.fromEntries(
        (
          await this.db.query<{
            club_id: string;
            data: Record<string, unknown>;
          }>("SELECT club_id::text,data FROM public.odysc_club_settings")
        ).rows.map((row) => [row.club_id, row.data]),
      ),
    );
  }
  events() {
    return this.safe(async () =>
      (
        await this.db.query(
          "SELECT id::text,club_id::text,title,kind,starts_at,duration_min,building_code,room FROM public.odysc_club_events ORDER BY starts_at LIMIT 2000",
        )
      ).rows.map((row) => ({
        id: row.id,
        clubId: row.club_id,
        title: row.title,
        kind: row.kind,
        start: iso(row.starts_at),
        durationMin: row.duration_min,
        buildingCode: row.building_code,
        room: row.room,
      })),
    );
  }
  applications(actor: Actor) {
    return this.actor(actor, async (q) =>
      (
        await q.query<ApplicationRow>(
          `SELECT ${applicationColumns} FROM public.odysc_applications WHERE student_id=$1::uuid ORDER BY submitted_at DESC`,
          [actor.user.id],
        )
      ).rows.map(applicationModel),
    );
  }
  submit(
    actor: Actor,
    input: {
      clubId: string;
      answers: {
        questionId: string;
        text: string;
      }[];
      shareUscId?: boolean;
      rememberAnswers?: boolean;
    },
  ) {
    return this.actor(actor, async (q) => {
      await this.lockClub(q, input.clubId);
      const config = clubSettingsSchema.parse(
        await this.settings(q, input.clubId),
      );
      const now = this.now();
      if (
        config.deadline &&
        (config.deadline.length === 10
          ? campusDate(now) > config.deadline
          : Date.parse(config.deadline) < now)
      )
        throw new HttpError(
          409,
          "The application deadline has passed.",
          "APPLICATION_CLOSED",
        );
      const profile = await this.profile(q, actor);
      if (
        !profile.name.trim() ||
        !profile.year ||
        !profile.major.trim() ||
        !profile.interests.length
      )
        throw new HttpError(
          400,
          "Complete your name, year, major, and interests before applying.",
          "MISSING_ONBOARDING_FIELDS",
        );
      const questions = config.questions ?? [];
      const incoming = new Map(
        input.answers.map((answer) => [answer.questionId, answer.text]),
      );
      if (
        incoming.size !== input.answers.length ||
        input.answers.some(
          (answer) =>
            !questions.some((question) => question.id === answer.questionId),
        )
      )
        throw new HttpError(
          400,
          "The application questions changed. Reload before submitting.",
          "INVALID_ANSWERS",
        );
      const answers = questions.map((question) => {
        const text = incoming.get(question.id)?.trim() ?? "";
        if (!text)
          throw new HttpError(
            400,
            "Answer every application question before submitting.",
            "MISSING_ANSWERS",
          );
        if (question.maxWords && text.split(/\s+/).length > question.maxWords)
          throw new HttpError(
            400,
            "An answer is over the word limit.",
            "ANSWER_TOO_LONG",
          );
        return { questionId: question.id, prompt: question.prompt, text };
      });
      const shareId = Boolean(
        config.requiresUscId && config.uscIdReason?.trim() && input.shareUscId,
      );
      if (
        config.requiresUscId &&
        ((config.uscIdReason?.trim().length ?? 0) < 15 ||
          !shareId ||
          !profile.uscId)
      )
        throw new HttpError(
          400,
          "This club requires a USC ID and your explicit consent to share it.",
          "USC_ID_CONSENT_REQUIRED",
        );
      const { uscId: _private, ...publicProfile } = profile;
      const snapshot = shareId ? profile : publicProfile;
      const app = (
        await q.query<ApplicationRow>(
          `INSERT INTO public.odysc_applications(student_id,club_id,answers,profile_snapshot,share_usc_id) VALUES($1::uuid,$2::bigint,$3::jsonb,$4::jsonb,$5) RETURNING ${applicationColumns}`,
          [
            actor.user.id,
            input.clubId,
            JSON.stringify(answers),
            JSON.stringify(snapshot),
            shareId,
          ],
        )
      ).rows[0]!;
      if (input.rememberAnswers)
        for (const answer of answers)
          await q.query(
            "INSERT INTO public.odysc_answer_bank(student_id,application_id,club_id,prompt,answer) VALUES($1::uuid,$2::uuid,$3::bigint,$4,$5) ON CONFLICT(application_id,prompt) DO NOTHING",
            [actor.user.id, app.id, input.clubId, answer.prompt, answer.text],
          );
      return {
        application: applicationModel(app),
        workspace: await this.workspace(q, actor),
      };
    });
  }
  requestMembership(actor: Actor, clubId: string, officerRole: string) {
    return this.actor(actor, async (q) => {
      await this.lockClub(q, clubId);
      const profile = await this.profile(q, actor);
      await q.query(
        "INSERT INTO public.odysc_club_memberships(club_id,user_id,email,full_name,officer_role,access,status) VALUES($1::bigint,$2::uuid,lower($3::text),$4,$5,'reviewer','pending') ON CONFLICT(club_id,email) DO NOTHING",
        [
          clubId,
          actor.user.id,
          actor.user.email,
          profile.name || actor.user.name || "Club officer",
          officerRole,
        ],
      );
      const state = await this.workspaceRow(q, actor, true);
      await q.query(
        "UPDATE public.odysc_student_workspaces SET data=$2::jsonb,version=version+1,updated_at=now() WHERE user_id=$1::uuid",
        [actor.user.id, JSON.stringify({ ...state.data, lastMode: "officer" })],
      );
      return this.session(q, actor, "officer");
    });
  }
  getOrganization(actor: Actor) {
    return this.actor(actor, async (q) => {
      const membership = (await this.memberships(q, actor))[0];
      if (!membership) throw forbidden();
      return this.organization(q, actor, membership);
    });
  }
  private async appForOfficer(
    q: SqlConnection,
    actor: Actor,
    applicationId: string,
    admin = false,
  ) {
    const app = (
      await q.query<ApplicationRow>(
        `SELECT ${officerApplicationColumns} FROM public.odysc_applications a JOIN public.odysc_club_memberships m ON m.club_id=a.club_id WHERE a.id=$1::uuid AND m.user_id=$2::uuid AND m.email=lower($3::text) AND m.status='active' AND (NOT $4::boolean OR m.access='admin') FOR UPDATE OF a`,
        [applicationId, actor.user.id, actor.user.email, admin],
      )
    ).rows[0];
    if (!app) throw notFound();
    return app;
  }
  applicants(actor: Actor, clubId: string) {
    return this.actor(actor, async (q) => {
      await this.member(q, actor, clubId);
      return (
        await q.query<ApplicationRow>(
          `SELECT ${applicationColumns} FROM public.odysc_applications WHERE club_id=$1::bigint ORDER BY submitted_at`,
          [clubId],
        )
      ).rows.map((app) => ({
        applicationId: app.id,
        ...app.profile_snapshot,
        status: app.status,
        // Email ownership is not proof of current university enrollment.
        verifiedStudent: false,
        verifiedUscEmail: true,
        submittedAt: iso(app.submitted_at),
        answers: app.answers.map((answer) => ({
          prompt: answer.prompt,
          text: answer.text,
        })),
        summary: sourceSummary(app.profile_snapshot, app.answers),
      }));
    });
  }
  summarize(actor: Actor, id: string) {
    return this.actor(actor, async (q) => {
      const app = await this.appForOfficer(q, actor, id);
      return sourceSummary(app.profile_snapshot, app.answers);
    });
  }
  saveReview(actor: Actor, id: string, scores: Record<string, number>) {
    return this.actor(actor, async (q) => {
      const app = await this.appForOfficer(q, actor, id);
      await q.query(
        "INSERT INTO public.odysc_reviews(application_id,reviewer_id,scores) VALUES($1::uuid,$2::uuid,$3::jsonb) ON CONFLICT(application_id,reviewer_id) DO UPDATE SET scores=EXCLUDED.scores,updated_at=now()",
        [id, actor.user.id, JSON.stringify(scores)],
      );
      return this.organization(
        q,
        actor,
        await this.member(q, actor, app.club_id),
      );
    });
  }
  decide(actor: Actor, id: string, decision: "advance" | "decline" | "accept") {
    return this.actor(actor, async (q) => {
      const app = await this.appForOfficer(q, actor, id, true);
      const next =
        decision === "advance"
          ? "interview"
          : decision === "accept"
            ? "accepted"
            : "rejected";
      if (["accepted", "rejected"].includes(app.status) && app.status !== next)
        throw conflict("This application has a final decision.");
      await q.query(
        "UPDATE public.odysc_applications SET status=$2,updated_at=now() WHERE id=$1::uuid",
        [id, next],
      );
      if (next === "accepted" || next === "rejected")
        await q.query(
          "UPDATE public.odysc_interviews SET booked_at=NULL WHERE application_id=$1::uuid",
          [id],
        );
      await q.query(
        "INSERT INTO public.odysc_reviews(application_id,reviewer_id,scores,decision) VALUES($1::uuid,$2::uuid,'{}'::jsonb,$3) ON CONFLICT(application_id,reviewer_id) DO UPDATE SET decision=EXCLUDED.decision,updated_at=now()",
        [id, actor.user.id, decision],
      );
      return this.organization(
        q,
        actor,
        await this.member(q, actor, app.club_id, true),
      );
    });
  }
  invite(
    actor: Actor,
    clubId: string,
    input: {
      email: string;
      name: string;
      officerRole: string;
    },
  ) {
    return this.actor(actor, async (q) => {
      await this.lockClub(q, clubId);
      await this.member(q, actor, clubId, true);
      await q.query(
        "INSERT INTO public.odysc_club_memberships(club_id,email,full_name,officer_role,access,status) VALUES($1::bigint,$2,$3,$4,'reviewer','invited')",
        [clubId, input.email, input.name, input.officerRole],
      );
      return this.organization(
        q,
        actor,
        await this.member(q, actor, clubId, true),
      );
    });
  }
  approve(actor: Actor, clubId: string, email: string) {
    return this.actor(actor, async (q) => {
      await this.lockClub(q, clubId);
      await this.member(q, actor, clubId, true);
      if (
        !(
          await q.query(
            "UPDATE public.odysc_club_memberships SET status='active',updated_at=now() WHERE club_id=$1::bigint AND email=$2 AND status='pending' RETURNING id",
            [clubId, email],
          )
        ).rows.length
      )
        throw notFound();
      return this.organization(
        q,
        actor,
        await this.member(q, actor, clubId, true),
      );
    });
  }
  removeMember(actor: Actor, clubId: string, email: string) {
    return this.actor(actor, async (q) => {
      await this.lockClub(q, clubId);
      await this.member(q, actor, clubId, true);
      const row = (
        await q.query<MembershipRow>(
          `SELECT ${membershipColumns} FROM public.odysc_club_memberships WHERE club_id=$1::bigint AND email=$2 FOR UPDATE`,
          [clubId, email],
        )
      ).rows[0];
      if (!row) throw notFound();
      if (row.user_id === actor.user.id)
        throw conflict("Ask another administrator to remove your membership.");
      if (row.access === "admin" && row.status === "active") {
        const usableAdmins = await q.query<{ id: string }>(
          "SELECT m.id::text FROM public.odysc_club_memberships m JOIN auth.users u ON u.id=m.user_id AND lower(u.email)=m.email AND u.email_confirmed_at IS NOT NULL AND u.email ~* '^[^@[:space:]]+@usc[.]edu$' WHERE m.club_id=$1::bigint AND m.access='admin' AND m.status='active'",
          [clubId],
        );
        if (usableAdmins.rows.some(admin => admin.id === row.id) && usableAdmins.rows.length <= 1)
          throw conflict("A club must retain at least one usable active administrator.");
      }
      await q.query(
        "DELETE FROM public.odysc_club_memberships WHERE id=$1::uuid",
        [row.id],
      );
      return this.organization(
        q,
        actor,
        await this.member(q, actor, clubId, true),
      );
    });
  }
  updateSettings(actor: Actor, clubId: string, patch: Record<string, unknown>) {
    return this.actor(actor, async (q) => {
      await this.lockClub(q, clubId);
      await this.member(q, actor, clubId, true);
      const next = clubSettingsSchema.parse({
        ...(await this.settings(q, clubId)),
        ...patch,
      });
      if (next.requiresUscId && (next.uscIdReason?.trim().length ?? 0) < 15)
        throw new HttpError(
          400,
          "Explain why the club needs USC IDs in at least 15 characters.",
          "USC_ID_REASON_REQUIRED",
        );
      if (next.zoomConnected || next.teamsConnected)
        throw new HttpError(
          503,
          "Automatic Zoom/Teams connections are not configured. Paste an existing meeting link when scheduling.",
          "MEETING_PROVIDER_NOT_CONFIGURED",
        );
      await q.query(
        "INSERT INTO public.odysc_club_settings(club_id,data,updated_by) VALUES($1::bigint,$2::jsonb,$3::uuid) ON CONFLICT(club_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=now()",
        [clubId, JSON.stringify(next), actor.user.id],
      );
      return this.organization(
        q,
        actor,
        await this.member(q, actor, clubId, true),
      );
    });
  }
  schedule(
    actor: Actor,
    input: {
      applicationId: string;
      format: string;
      slots: string[];
      durationMin: number;
      link?: string;
      buildingCode?: string;
      room?: string;
      note?: string;
    },
  ) {
    return this.actor(actor, async (q) => {
      const app = await this.appForOfficer(q, actor, input.applicationId, true);
      if (["accepted", "rejected"].includes(app.status))
        throw conflict("This application already has a final decision.");
      await this.lockClub(q, app.club_id);
      await q.query(
        `INSERT INTO public.odysc_interviews(application_id,club_id,format,slots,duration_min,link,building_code,room,note,updated_by) VALUES($1::uuid,$2::bigint,$3,$4::timestamptz[],$5,$6,$7,$8,$9,$10::uuid) ON CONFLICT(application_id) DO UPDATE SET format=EXCLUDED.format,slots=EXCLUDED.slots,duration_min=EXCLUDED.duration_min,link=EXCLUDED.link,building_code=EXCLUDED.building_code,room=EXCLUDED.room,note=EXCLUDED.note,booked_at=NULL,invited_at=now(),updated_by=EXCLUDED.updated_by`,
        [
          input.applicationId,
          app.club_id,
          input.format,
          input.slots,
          input.durationMin,
          input.link ?? null,
          input.buildingCode ?? null,
          input.room ?? null,
          input.note ?? null,
          actor.user.id,
        ],
      );
      await q.query(
        "UPDATE public.odysc_applications SET status='interview',updated_at=now() WHERE id=$1::uuid",
        [app.id],
      );
      await q.query(
        "INSERT INTO public.odysc_reviews(application_id,reviewer_id,scores,decision) VALUES($1::uuid,$2::uuid,'{}'::jsonb,'advance') ON CONFLICT(application_id,reviewer_id) DO UPDATE SET decision='advance',updated_at=now()",
        [app.id, actor.user.id],
      );
      return this.organization(
        q,
        actor,
        await this.member(q, actor, app.club_id, true),
      );
    });
  }
  book(actor: Actor, id: string, slot: string | null) {
    return this.actor(actor, async (q) => {
      const app = (
        await q.query<ApplicationRow>(
          `SELECT ${applicationColumns} FROM public.odysc_applications WHERE id=$1::uuid AND student_id=$2::uuid FOR UPDATE`,
          [id, actor.user.id],
        )
      ).rows[0];
      if (!app) throw notFound();
      await this.lockClub(q, app.club_id);
      const interview = (
        await q.query(
          "SELECT slots,club_id::text,duration_min FROM public.odysc_interviews WHERE application_id=$1::uuid FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!interview) throw notFound();
      if (slot) {
        if (app.status !== "interview")
          throw conflict(
            "This application is no longer awaiting an interview.",
          );
        if (
          !(interview.slots as (string | Date)[]).some(
            (value) => (value instanceof Date ? value.getTime() : Date.parse(value)) === Date.parse(slot),
          ) ||
          Date.parse(slot) <= Date.now()
        )
          throw new HttpError(
            400,
            "Choose one of the offered future times.",
            "INVALID_INTERVIEW_SLOT",
          );
        const collision = await q.query(
          "SELECT i.application_id FROM public.odysc_interviews i JOIN public.odysc_applications a ON a.id=i.application_id WHERE i.club_id=$1::bigint AND i.application_id<>$2::uuid AND a.status='interview' AND i.booked_at IS NOT NULL AND tstzrange(i.booked_at,i.booked_at+i.duration_min*interval '1 minute','[)') && tstzrange($3::timestamptz,$3::timestamptz+$4::integer*interval '1 minute','[)')",
          [interview.club_id, id, slot, interview.duration_min],
        );
        if (collision.rows.length)
          throw conflict("That time was just booked. Choose another time.");
      }
      await q.query(
        "UPDATE public.odysc_interviews SET booked_at=$2::timestamptz WHERE application_id=$1::uuid",
        [id, slot],
      );
      return this.workspace(q, actor);
    });
  }
  createEvent(
    actor: Actor,
    input: FrontendEventInput,
  ) {
    return this.actor(actor, async (q) => {
      await this.member(q, actor, input.clubId, true);
      const result = await q.query(
        "INSERT INTO public.odysc_club_events(club_id,title,kind,starts_at,duration_min,building_code,room,created_by) VALUES($1::bigint,$2,$3,$4::timestamptz,$5,$6,$7,$8::uuid) RETURNING id::text",
        [
          input.clubId,
          input.title,
          input.kind,
          input.start,
          input.durationMin,
          input.buildingCode,
          input.room,
          actor.user.id,
        ],
      );
      return { id: result.rows[0]!.id, ...input };
    });
  }
  updateEvent(
    actor: Actor,
    eventId: string,
    patch: Partial<Omit<FrontendEventInput, "clubId">>,
  ) {
    return this.actor(actor, async (q) => {
      // Event details are public, but membership is checked before acquiring or
      // changing an event row. The club lock serializes membership revocation.
      const existing = await q.query<{ club_id: string }>(
        "SELECT club_id::text FROM public.odysc_club_events WHERE id=$1::uuid",
        [eventId],
      );
      const event = existing.rows[0];
      if (!event) throw notFound();
      await this.lockClub(q, event.club_id);
      await this.member(q, actor, event.club_id, true);
      const result = await q.query(
        "UPDATE public.odysc_club_events SET title=COALESCE($2::text,title),kind=COALESCE($3::text,kind),starts_at=COALESCE($4::timestamptz,starts_at),duration_min=COALESCE($5::smallint,duration_min),building_code=COALESCE($6::text,building_code),room=COALESCE($7::text,room) WHERE id=$1::uuid AND club_id=$8::bigint RETURNING id::text,club_id::text,title,kind,starts_at,duration_min,building_code,room",
        [
          eventId,
          patch.title ?? null,
          patch.kind ?? null,
          patch.start ?? null,
          patch.durationMin ?? null,
          patch.buildingCode ?? null,
          patch.room ?? null,
          event.club_id,
        ],
      );
      const updated = result.rows[0];
      if (!updated) throw notFound();
      return {
        id: updated.id,
        clubId: updated.club_id,
        title: updated.title,
        kind: updated.kind,
        start: iso(updated.starts_at),
        durationMin: updated.duration_min,
        buildingCode: updated.building_code,
        room: updated.room,
      };
    });
  }
}
