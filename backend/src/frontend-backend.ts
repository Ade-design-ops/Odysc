import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { parseProfile, matchClubs, type AiOptions } from "./ai.js";
import { HttpError } from "./errors.js";
import { clubFinderSchema, recommendClubs, type ClubFinderOptions } from "./club-finder.js";
import { parseResumePdf, MAX_RESUME_BYTES } from "./resume.js";
import { ResumeFiles } from "./resume-files.js";
import { SupabaseGateway } from "./supabase.js";
import type { SupabaseCatalogService } from "./supabase-catalog.js";
import { WebAuthService } from "./web-auth.js";
import { FrontendStore } from "./frontend-store.js";
import { BUILDINGS } from "./campus-buildings.js";
import {
  clubSettingsSchema,
  emailSchema,
  emptyWorkspace,
  frontendClub,
  idSchema,
  interviewSchema,
  studentPatchSchema,
  submitSchema,
  validated,
  workspacePatchSchema,
  type Actor,
} from "./frontend-models.js";
export interface FrontendBackendOptions {
  gateway: SupabaseGateway;
  webAuth: WebAuthService;
  catalog: SupabaseCatalogService;
  resumeFiles: ResumeFiles;
  ai?: AiOptions;
  clubFinder?: ClubFinderOptions;
  dbUrl: string;
  caFile: string;
  store?: FrontendStore;
}
const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
    as: z.enum(["student", "officer"]).optional(),
  })
  .strict();
const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: emailSchema,
    password: z.string().min(10).max(128),
    role: z.enum(["student", "officer"]),
    clubId: idSchema.optional(),
    officerRole: z.string().trim().min(1).max(100).optional(),
    preferredName: z.string().trim().max(100).optional(),
    pronouns: z.string().trim().max(80).optional(),
    uscId: z
      .string()
      .regex(/^(?:\d{10})?$/)
      .optional(),
    year: z.number().int().min(0).max(7).optional(),
    gradTerm: z.string().trim().max(40).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.role !== "officer" || Boolean(input.clubId && input.officerRole),
    "Choose your club and officer role.",
  );
const providerSession = z
  .object({
    user: z.unknown().optional(),
    access_token: z.string().min(1).optional(),
  })
  .passthrough();
const uuid = z.string().uuid();
// Keep published locations within the buildings supported by the campus map.
const eventFields = {
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["Info session", "Mixer", "Workshop", "Coffee chat"]),
  start: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(5).max(1440),
  buildingCode: z.string().trim().min(1).max(30).refine(
    (code) => Object.hasOwn(BUILDINGS, code),
    "Choose a verified USC campus building.",
  ),
  room: z.string().trim().min(1).max(100),
};
const createEventSchema = z.object({ clubId: idSchema, ...eventFields }).strict();
const updateEventSchema = z.object(eventFields).partial().strict().refine(
  (patch) => Object.keys(patch).length > 0,
  "Send at least one event field to update.",
);
const secured = { schema: { tags: ["Frontend integration"] } };
const limited = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
/** Compatibility contract for the existing client; all identity comes from Supabase. */
export async function registerFrontendBackend(
  app: FastifyInstance,
  options: FrontendBackendOptions,
): Promise<FrontendStore> {
  const { gateway, webAuth, catalog, resumeFiles, ai = {} } = options;
  const store =
    options.store ??
    new FrontendStore({ dbUrl: options.dbUrl, caFile: options.caFile });
  app.addHook("onClose", () => store.close());
  async function actor(request: FastifyRequest): Promise<Actor> {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ") || header.length > 16391)
      throw new HttpError(401, "Sign in to continue.", "UNAUTHORIZED");
    const identity = await gateway.getIdentity(header.slice(7));
    const expectedActor = request.headers["x-odysc-actor"];
    const cookieMutation =
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      /(?:^|;\s*)odysc_session=/.test(request.headers.cookie ?? "");
    if (cookieMutation && expectedActor === undefined)
      throw new HttpError(
        409,
        "Reload your session before saving changes.",
        "SESSION_CHANGED",
      );
    if (expectedActor !== undefined && expectedActor !== identity.user.id)
      throw new HttpError(
        409,
        "Your account changed in another tab. Reload before continuing.",
        "SESSION_CHANGED",
      );
    return identity;
  }
  async function withResume(
    identity: Actor,
    session: Awaited<ReturnType<FrontendStore["getSession"]>>,
  ) {
    return { ...session, resume: await resumeFiles.getInfo(identity.user.id) ?? null };
  }
  async function requireResume(identity: Actor) {
    if (!await resumeFiles.getInfo(identity.user.id))
      throw new HttpError(
        400,
        "Upload your PDF résumé before completing onboarding or getting club recommendations.",
        "RESUME_REQUIRED",
      );
  }
  app.get("/api/session", secured, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!request.headers.authorization)
      return {
        account: null,
        profile: null,
        workspace: emptyWorkspace(),
        organization: null,
        resume: null,
      };
    const identity = await actor(request);
    return withResume(identity, await store.getSession(identity));
  });
  app.post("/api/auth/register", limited, async (request, reply) => {
    const input = validated(registerSchema, request.body);
    if (input.role === "officer" && !(await catalog.getClub(input.clubId!)))
      throw new HttpError(
        400,
        "Choose a club from the USC directory.",
        "INVALID_CLUB",
      );
    gateway.assertStudentEmail(input.email);
    const flow = webAuth.beginFlow(reply, "signup", input.email);
    const response = await gateway.request(
      `/auth/v1/signup?redirect_to=${encodeURIComponent(flow.redirectTo)}`,
      {
        method: "POST",
        body: {
          email: input.email,
          password: input.password,
          data: { name: input.name, role: "student" },
          code_challenge: flow.code_challenge,
          code_challenge_method: flow.code_challenge_method,
        },
      },
    );
    const session = validated(providerSession, response);
    const user = gateway.studentUser(session.user ?? response, {
      allowUnconfirmed: !session.access_token,
    });
    await store.recordSignup(user, input);
    if (!session.access_token)
      return reply.code(201).send({ requiresEmailConfirmation: true });
    webAuth.setSession(reply, response);
    const identity = { user, token: session.access_token };
    const context = await withResume(
      identity,
      await store.getSession(identity, input.role),
    );
    return reply
      .code(201)
      .send({ requiresEmailConfirmation: false, session: context });
  });
  app.post("/api/auth/login", limited, async (request, reply) => {
    const input = validated(loginSchema, request.body);
    gateway.assertStudentEmail(input.email);
    const response = await gateway.request(
      "/auth/v1/token?grant_type=password",
      {
        method: "POST",
        body: { email: input.email, password: input.password },
      },
    );
    const session = validated(providerSession, response);
    if (!session.access_token)
      throw new HttpError(
        401,
        "Confirm your email before signing in.",
        "EMAIL_CONFIRMATION_REQUIRED",
      );
    const identity = await gateway.getIdentity(session.access_token);
    // Do not establish a cookie when the requested officer context is unauthorized.
    const context = await withResume(
      identity,
      await store.getSession(identity, input.as ?? "student"),
    );
    webAuth.setSession(reply, response);
    return context;
  });
  app.post("/api/auth/logout", secured, async (request, reply) => {
    const identity = await actor(request);
    await gateway.request("/auth/v1/logout?scope=local", {
      method: "POST",
      token: identity.token,
    });
    webAuth.clearSession(reply);
    return reply.code(204).send();
  });
  app.get("/api/me", secured, async (request) =>
    store.getProfile(await actor(request)),
  );
  app.patch("/api/me", secured, async (request) =>
    store.saveProfile(
      await actor(request),
      validated(studentPatchSchema, request.body),
    ),
  );
  app.post("/api/me/complete", secured, async (request) => {
    const identity = await actor(request);
    validated(z.object({}).strict(), request.body ?? {});
    await requireResume(identity);
    return store.saveProfile(identity, {}, true);
  });
  app.get("/api/me/resume/status", secured, async (request, reply) => {
    const identity = await actor(request);
    reply.header("Cache-Control", "private, no-store");
    return { resume: await resumeFiles.getInfo(identity.user.id) ?? null };
  });
  app.get("/api/workspace", secured, async (request) =>
    store.getWorkspace(await actor(request)),
  );
  app.patch("/api/workspace", secured, async (request) =>
    store.saveWorkspace(
      await actor(request),
      validated(workspacePatchSchema, request.body),
    ),
  );
  app.get("/api/clubs", secured, async () => {
    const [clubs, settings] = await Promise.all([
      catalog.listClubs(),
      store.clubSettings(),
    ]);
    return clubs.map((club) => frontendClub(club, settings[club.id]));
  });
  app.get("/api/events", secured, async () => store.events());
  app.post("/api/events", secured, async (request, reply) => {
    const identity = await actor(request);
    const body = validated(createEventSchema, request.body);
    const event = await store.createEvent(identity, body);
    return reply.code(201).send(event);
  });
  app.patch<{ Params: { eventId: string } }>(
    "/api/events/:eventId",
    secured,
    async (request) => {
      const identity = await actor(request);
      return store.updateEvent(
        identity,
        validated(uuid, request.params.eventId),
        validated(updateEventSchema, request.body),
      );
    },
  );
  app.post("/api/club-finder", { ...secured, ...limited }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const identity = await actor(request);
    const body = validated(clubFinderSchema, request.body ?? {});
    const session = await store.getSession(identity);
    if (session.account?.role !== "student")
      throw new HttpError(403, "Switch to your student account to find clubs.", "STUDENT_ACCESS_REQUIRED");
    const profile = session.profile;
    const resume = await resumeFiles.get(identity.user.id);
    if (!resume)
      throw new HttpError(400, "Upload your résumé PDF in Profile before finding clubs.", "RESUME_REQUIRED");
    if (body.resumeId && body.resumeId !== resume.info.id)
      throw new HttpError(409, "Your résumé changed. Reload your profile and try again.", "RESUME_CHANGED");
    if (!profile?.name.trim() || !profile.major.trim() || profile.year <= 0 || !profile.interests.some(interest => interest.trim()))
      throw new HttpError(400, "Finish your name, major, year, and interests in Profile before finding clubs.", "MISSING_ONBOARDING_FIELDS");
    const [clubs, settings] = await Promise.all([catalog.listClubs(), store.clubSettings()]);
    const result = await recommendClubs({
      profile: {
        major: profile.major,
        interests: profile.interests,
        skills: profile.skills.join("; "),
      },
      resume: { fileName: resume.info.fileName, mediaType: "application/pdf", data: Buffer.from(resume.bytes).toString("base64") },
      history: body.history,
    }, clubs.map(club => {
      const page = frontendClub(club, settings[club.id]);
      return {
        id: club.id, name: page.name, category: page.category, tags: club.tags, description: page.description,
        ...(page.selectivity === "Unknown" ? {} : { selectivity: page.selectivity }),
        ...(page.deadline ? { nextRecruitingStep: `Applications due ${page.deadline}` } : {}),
      };
    }), options.clubFinder);
    // Never show a response grounded in a PDF that was replaced or removed while the AI was running.
    if ((await resumeFiles.getInfo(identity.user.id))?.id !== resume.info.id)
      throw new HttpError(409, "Your résumé changed. Start a new search with your current PDF.", "RESUME_CHANGED");
    return result;
  });
  app.post("/api/ai/match", { ...secured, ...limited }, async (request) => {
    const identity = await actor(request);
    const body = validated(
      z.object({ studentId: z.string().optional() }).strict(),
      request.body ?? {},
    );
    if (body.studentId && body.studentId !== identity.user.id)
      throw new HttpError(403, "Match only your own profile.", "FORBIDDEN");
    await requireResume(identity);
    const [profile, clubs, text] = await Promise.all([
      store.getProfile(identity),
      catalog.listClubs(),
      resumeFiles.getText(identity.user.id),
    ]);
    const result = await matchClubs(
      {
        major: profile.major,
        bio: profile.bio ?? "",
        interests: profile.interests,
        skills: profile.skills,
        experience: profile.experiences.join("\n"),
        goals: profile.goals,
        resumeText: text,
      },
      clubs,
      ai,
    );
    return result.matches
      .slice(0, 20)
      .map((match) => ({ ...match, score: match.score / 100 }));
  });
  app.post(
    "/api/ai/parse-resume",
    { ...secured, ...limited },
    async (request, reply) => {
      const identity = await actor(request);
      if (!request.isMultipart())
        throw new HttpError(
          400,
          "Upload the actual PDF as multipart field resume; a filename alone cannot be read.",
          "RESUME_UPLOAD_REQUIRED",
        );
      let upload:
        | {
            bytes: Buffer;
            name: string;
          }
        | undefined;
      for await (const part of request.parts({
        limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_RESUME_BYTES },
      })) {
        if (part.type !== "file")
          throw new HttpError(
            400,
            "Send a PDF under the resume field.",
            "INVALID_RESUME",
          );
        const bytes = await part.toBuffer();
        if (
          part.fieldname !== "resume" ||
          part.mimetype !== "application/pdf" ||
          !part.filename.toLowerCase().endsWith(".pdf")
        )
          throw new HttpError(400, "Choose a PDF résumé.", "INVALID_RESUME");
        upload = {
          bytes,
          name:
            part.filename
              .split(/[\\/]/)
              .pop()!
              .replace(/[\x00-\x1f\x7f]/g, "")
              .slice(0, 200) || "resume.pdf",
        };
      }
      if (!upload)
        throw new HttpError(
          400,
          "Choose a PDF to upload.",
          "RESUME_UPLOAD_REQUIRED",
        );
      const parsed = await parseResumePdf(upload.bytes);
      await gateway.getIdentity(identity.token);
      const info = {
        id: randomUUID(),
        fileName: upload.name,
        mimeType: "application/pdf" as const,
        sizeBytes: upload.bytes.length,
        pageCount: parsed.pageCount,
        textStatus: parsed.textStatus,
        uploadedAt: new Date().toISOString(),
      };
      await resumeFiles.save({
        studentId: identity.user.id,
        info,
        bytes: upload.bytes,
        text: parsed.text,
      });
      const extracted = await parseProfile(parsed.text, ai);
      const current = await store.getProfile(identity);
      return reply
        .code(201)
        .send({
          major: extracted.profile.major,
          year: current.year,
          skills: extracted.profile.skills,
          interests: extracted.profile.interests,
          experiences: extracted.profile.experience
            ? [extracted.profile.experience]
            : [],
          resume: info,
          needsReview: true,
          mode: extracted.mode,
          notice:
            parsed.textStatus === "unavailable"
              ? "PDF saved. No readable text was found; enter profile details manually."
              : extracted.notice,
        });
    },
  );
  app.get("/api/me/resume", secured, async (request, reply) => {
    const identity = await actor(request);
    const resume = await resumeFiles.get(identity.user.id);
    if (!resume)
      throw new HttpError(404, "No résumé has been uploaded.", "NOT_FOUND");
    return reply
      .type("application/pdf")
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `attachment; filename="resume.pdf"`)
      .send(Buffer.from(resume.bytes));
  });
  app.get("/api/applications/mine", secured, async (request) =>
    store.applications(await actor(request)),
  );
  app.post("/api/applications", secured, async (request, reply) =>
    reply
      .code(201)
      .send(
        await store.submit(
          await actor(request),
          validated(submitSchema, request.body),
        ),
      ),
  );
  app.get<{
    Params: {
      clubId: string;
    };
  }>("/api/clubs/:clubId/applicants", secured, async (request) =>
    store.applicants(
      await actor(request),
      validated(idSchema, request.params.clubId),
    ),
  );
  app.post("/api/ai/summarize", { ...secured, ...limited }, async (request) =>
    store.summarize(
      await actor(request),
      validated(z.object({ applicationId: uuid }).strict(), request.body)
        .applicationId,
    ),
  );
  app.get("/api/organizer/state", secured, async (request) =>
    store.getOrganization(await actor(request)),
  );
  app.post("/api/organizer/request", secured, async (request) => {
    const input = validated(
      z
        .object({
          clubId: idSchema,
          officerRole: z.string().trim().min(1).max(100),
        })
        .strict(),
      request.body,
    );
    const identity = await actor(request);
    return withResume(
      identity,
      await store.requestMembership(identity, input.clubId, input.officerRole),
    );
  });
  app.post<{
    Params: {
      clubId: string;
    };
  }>("/api/clubs/:clubId/team/invite", secured, async (request) =>
    store.invite(
      await actor(request),
      validated(idSchema, request.params.clubId),
      validated(
        z
          .object({
            email: emailSchema,
            name: z.string().trim().min(1).max(100),
            officerRole: z.string().trim().min(1).max(100),
          })
          .strict(),
        request.body,
      ),
    ),
  );
  app.post<{
    Params: {
      clubId: string;
    };
  }>("/api/clubs/:clubId/team/approve", secured, async (request) =>
    store.approve(
      await actor(request),
      validated(idSchema, request.params.clubId),
      validated(z.object({ email: emailSchema }).strict(), request.body).email,
    ),
  );
  app.post<{ Params: { clubId: string } }>(
    "/api/clubs/:clubId/team/promote",
    secured,
    async (request) => store.promoteMember(
      await actor(request),
      validated(idSchema, request.params.clubId),
      validated(z.object({ email: emailSchema }).strict(), request.body).email,
    ),
  );
  app.delete<{
    Params: {
      clubId: string;
      email: string;
    };
  }>("/api/clubs/:clubId/team/:email", secured, async (request) =>
    store.removeMember(
      await actor(request),
      validated(idSchema, request.params.clubId),
      validated(emailSchema, request.params.email),
    ),
  );
  app.patch<{
    Params: {
      clubId: string;
    };
  }>("/api/clubs/:clubId/settings", secured, async (request) =>
    store.updateSettings(
      await actor(request),
      validated(idSchema, request.params.clubId),
      validated(clubSettingsSchema, request.body),
    ),
  );
  app.post<{
    Params: {
      id: string;
    };
  }>("/api/applications/:id/review", secured, async (request) =>
    store.saveReview(
      await actor(request),
      validated(uuid, request.params.id),
      validated(
        z
          .object({
            scores: z
              .record(
                z.string().min(1).max(100),
                z.number().int().min(1).max(5),
              )
              .refine(
                (value) =>
                  Object.keys(value).length > 0 &&
                  Object.keys(value).length <= 20,
              ),
          })
          .strict(),
        request.body,
      ).scores,
    ),
  );
  app.post<{
    Params: {
      id: string;
    };
  }>("/api/applications/:id/decision", secured, async (request) =>
    store.decide(
      await actor(request),
      validated(uuid, request.params.id),
      validated(
        z
          .object({ decision: z.enum(["advance", "decline", "accept"]) })
          .strict(),
        request.body,
      ).decision,
    ),
  );
  app.post("/api/interviews", secured, async (request) =>
    store.schedule(
      await actor(request),
      validated(interviewSchema, request.body),
    ),
  );
  app.post<{
    Params: {
      id: string;
    };
  }>("/api/interviews/:id/book", secured, async (request) =>
    store.book(
      await actor(request),
      validated(uuid, request.params.id),
      validated(
        z
          .object({ slot: z.string().datetime({ offset: true }).nullable() })
          .strict(),
        request.body,
      ).slot,
    ),
  );
  return store;
}
