# API and AI handoff

The connected browser uses **`/api/*`** through Vite's proxy to backend port 3001. The native API remains at **`http://localhost:3001/api/v1`** with its original shapes. Both use Supabase Auth and shared data; SQLite requires explicit isolated demo/test selection and is never a shared-data fallback. Private PDFs remain in the backend's persistent `data/resumes` directory.

## Connected browser API

The frontend now calls the real shared workflow service. Its [browser contract](../shared/api.md) and [complete workflow endpoint map](SHARED_WORKFLOWS.md) cover these routes:

| Area | Browser routes |
| --- | --- |
| Account/session | `/api/session`, `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` |
| Profile | `/api/me`, `/api/me/complete`; partial saves accept frontend profile fields and optional extras |
| Personal workspace | `/api/workspace`; server-backed club list, drafts, calendar and in-app reminder preferences |
| Directory/AI | `/api/clubs`, `/api/events`, `/api/ai/match`, multipart `/api/ai/parse-resume`, `/api/ai/summarize`, `/api/club-finder` |
| Applications | `/api/applications`, `/api/applications/mine`, `/api/clubs/:clubId/applicants` |
| Officers/reviews | `/api/organizer/state`, `/api/organizer/request`, club team/settings routes and application review/decision routes |
| Interviews | `/api/interviews`, `/api/interviews/:id/book` |

These use eight applied shared tables. Private browser requests carry cookies and `X-Odysc-Actor`, an expected-user consistency guard; the server still verifies the real actor and ownership/club permissions. `409 SESSION_CHANGED` requires session refresh before saving again. Browser application IDs are server UUIDs, and match scores use 0–1. Native match scores below use 0–100.

Student/officer browser signup uses `/api/auth/register`; officer selection creates a pending membership request and never self-approves access. A verified initial administrator is explicitly linked to NSBE club `36288`. The frontend's email confirmation/recovery pages use the existing `/api/v1/auth/*` email-flow routes. There is no USC SSO or enrollment verification. Interview notifications are in-app records, and real video links must be supplied manually; no external meeting/email delivery is claimed.

Send JSON with `Content-Type: application/json`. Protected routes accept `Authorization: Bearer <Supabase accessToken>` or the backend's HttpOnly browser session cookie. Cookie requests use `credentials:'include'`; mutating browser requests must come from the configured backend/frontend origins. `/health`, `/docs`, and `/openapi.json` are outside the API prefix. `/docs` describes request validation; domain types are defined in [models.ts](../backend/src/models.ts).

## Native `/api/v1` endpoint map

The following table documents the original native contract, not the connected browser shapes. Paths omit `/api/v1`. Student routes use the authenticated Supabase student ID. The frontend does not send a student ID to choose whose profile or resume it accesses.

| Method and path | Access | Body / result |
| --- | --- | --- |
| `POST /auth/register` | Public | `{email,password,name,role:'student'}` → `201 Session`; confirmation may be required |
| `POST /auth/login` | Public | `{email,password}` → `Session` with Supabase JWT |
| `GET /auth/me` | Authenticated | `{user:User}` |
| `POST /auth/logout` | Authenticated | `204`, no response body |
| `GET /auth/session` | Public | Browser session status and user; never returns tokens |
| `POST /auth/resend-confirmation` | Public | `{email}` → generic confirmation notice |
| `POST /auth/forgot-password` | Public | `{email}` → generic recovery notice |
| `GET /auth/recovery-session` | Public | `{valid:boolean}` for the reset screen |
| `POST /auth/reset-password` | Recovery cookie | `{password}` → success; ordinary login tokens cannot authorize this route |
| `GET /clubs?q=&category=` | Public | `{clubs:Club[],limit:2000,notice?:string}`; notice when the cap is reached |
| `GET /clubs/:clubId` | Public | `{club:Club,events:[],notice:string}`; ID or stable `usc-club-<id>` slug |
| `GET /events` | Public | `{events:[],notice:string}`; native placeholder, separate from shared `/api/events` |
| `GET /me/onboarding` | Student | `{user,profile,resume,onboarding,fields}` |
| `PATCH /me/onboarding` | Student | Partial `{name,academicYear,major,interests,goals,bio,skills}` → same envelope; at least one field |
| `POST /me/onboarding/complete` | Student | `{}` → same envelope; required basics and saved own PDF gate completion |
| `POST /me/resume` | Student | Multipart file `resume` → `201 {resume:ResumeInfo,notice:string}`; PDF, 5 MiB, 10 pages |
| `GET /me/resume` | Student | Own private PDF, not JSON |
| `DELETE /me/resume` | Student | `204`, no response body |
| `GET /me/profile` | Student | `{user:User,profile:Profile}` |
| `PUT /me/profile` | Student | Original profile fields + optional `academicYear`/`goals` → `{profile:Profile}` |
| `POST /me/profile/parse` | Student | `{text:string}` → `ParseResult`; does not save |
| `POST /me/matches` | Student | No body needed → `MatchResult`; requires saved own PDF (`400 RESUME_REQUIRED` when absent); extracted text may be unavailable |

The frontend includes signup, sign-in, check-email, and recovery screens. Browser account/session calls use the `/api` routes above; native Auth routes remain available to API clients. New signup and reset passwords must be 10–128 characters. Sign-in accepts an existing nonempty password and lets Supabase verify it, so previously created accounts remain compatible. Keep global email confirmation enabled. A registration result with `accessToken:null`, `expiresAt:null`, and `requiresEmailConfirmation:true` must show the check-email state before protected requests. The backend callback at `/auth/callback` exchanges a one-time code using the original browser's PKCE verifier. Default `hash` routing redirects to `/#/profile`, `/#/reset-password`, or `/#/auth/error`; explicit `history` routing preserves `/student`, `/reset-password`, and `/auth/error`. Open the email link in the same browser that requested it. See [authentication setup](AUTHENTICATION.md). Native `/api/v1/auth/register` still rejects organizer registration with `503 FEATURE_NOT_CONNECTED`; browser officer signup uses `/api/auth/register` and approved membership context instead.

USC email restrictions are active and default to `STUDENT_EMAIL_DOMAIN=usc.edu`. The exact `usc.edu` domain and Supabase's provider-owned email confirmation are required before authenticated access. Other domains receive `403 STUDENT_EMAIL_NOT_ALLOWED`; unconfirmed USC accounts receive `401 EMAIL_CONFIRMATION_REQUIRED`. Signup may still return an unconfirmed user with no session so confirmation can occur. Confirmation callbacks use the existing safe frontend error redirect on failure. The shared signup hook also rejects direct non-USC Auth signups, and the restrictive profile policy protects direct Data API access alongside ownership rules. The old non-USC demo account is blocked. See [USC email access](USC_EMAIL_ACCESS.md). An explicit blank backend setting is an isolated-test opt-out; it does not disable the shared hook or profile policy.

## Native placeholder routes

Some original `/api/v1` application submission/review, organizer, saved-answer, bookmark, and reminder paths still return **HTTP 503 `FEATURE_NOT_CONNECTED`**. The connected frontend uses the applied shared `/api/*` workflows above for those features; it does not call the old local SQLite implementations or use them as fallback.

This includes `/me/applications`, `/clubs/:clubId/applications`, `/applications/:applicationId/status`, `/organizer/clubs`, club/event creation or editing, event calendar download, `/me/answers`, `/me/answers/suggest`, `/me/bookmarks`, and `/me/reminders`. Do not interpret a 503 as a successful empty list. Native event listing remains an empty result with a notice. The browser `/api/events` route reads actual `odysc_club_events` records entered by authorized club administrators; it may legitimately be empty.

## Student response contracts

The native `Club` and `ResumeInfo` use [models.ts](../backend/src/models.ts); browser models are in [shared/types.ts](../shared/types.ts) and [frontend-models.ts](../backend/src/frontend-models.ts). Club IDs remain strings. In the native directory response, unavailable metadata is represented with empty strings, nulls, or empty arrays and `acceptingApplications` is false. Browser club data additionally merges authorized shared settings. Do not present absent contacts, descriptions, application questions, or events as verified facts. Onboarding metadata and exact resume requests are detailed in [STUDENT_ONBOARDING.md](STUDENT_ONBOARDING.md).

```ts
type User = {
  id: string; email: string; name: string;
  role: 'student' | 'organizer'; createdAt: string;
};
type Session = {
  user: User; accessToken: string|null; tokenType: 'Bearer';
  expiresAt: string|null; requiresEmailConfirmation: boolean;
};
type AcademicYear = 'first_year'|'second_year'|'third_year'|'fourth_year'|'fifth_year_plus'|'graduate'|'other';
type Profile = {
  major: string; academicYear: AcademicYear | null; graduationYear: number | null;
  bio: string; interests: string[]; skills: string[]; experience: string; goals: string[];
};
type ParsedProfile = Pick<Profile,'major'|'bio'|'interests'|'skills'|'experience'>;
type ParseResult = {
  mode: 'openai'|'local'; profile: ParsedProfile; needsReview: true; notice?: string;
};
type MatchResult = {
  mode: 'openai'|'local'; totalClubs: number; notice?: string;
  matches: {clubId:string;score:number;reasons:string[];club:Club}[];
};
type OnboardingState = {
  status: 'not_started'|'in_progress'|'completed'; completedAt: string|null;
  missingRequiredFields: string[]; recommendedFields: string[];
};
```

The onboarding envelope includes `user`, `profile`, `resume:ResumeInfo|null`, `onboarding:OnboardingState`, and `fields`, an array of server-defined labels/helpers/types/constraints. Missing optional `recommendedFields` must not block finishing.

## Request and response examples

Sign in with `POST /auth/login`, using the account created in Supabase Auth:

```json
{"email":"<demo student's email>","password":"<demo student's password>"}
```

Use the returned `accessToken` as the bearer token. Observe its expiry and return to sign-in if it is no longer valid. Do not use local fixture credentials against shared runtime.

Save an onboarding draft with `PATCH /me/onboarding`:

```json
{"name":"Jordan Lee","academicYear":"second_year","major":"Undeclared","interests":["Still exploring"]}
```

The response contains the saved `user` and `profile`, optional resume metadata, current onboarding state, and field definitions. After valid basics are saved and a PDF is uploaded, `missingRequiredFields` is empty; status remains in progress until `POST /me/onboarding/complete` with `{}`. Completion sets `status:'completed'` and a `completedAt` timestamp. The résumé PDF is required; goals, bio, and skills remain optional. Deleting the PDF makes onboarding incomplete.

`POST /me/profile/parse` accepts:

```json
{"text":"Major: Computer Science\nSkills: Python"}
```

It returns `ParseResult`; review suggested fields before saving. `PUT /me/profile` requires the original six fields. New `academicYear` and `goals` are optional and preserved when omitted:

```json
{"major":"Computer Science","academicYear":"second_year","graduationYear":2028,"bio":"I build campus tools.","interests":["robotics"],"skills":["Python"],"experience":"Built a class project.","goals":["Meet people"]}
```

The save response is `{profile:Profile}`. A subsequent `POST /me/matches` returns at most 20 matches; relevance scores from 0–100 are not admission probabilities. Matching locally ranks every retrieved directory club, with optional AI reranking of the leading 40 candidates. `totalClubs` counts retrieved clubs, subject to the directory's 2,000-row cap. An uploaded PDF's readable text provides optional context without replacing entered profile fields.

Upload PDFs using `FormData` field `resume`; let the browser set the multipart boundary. A successful upload returns `{resume:ResumeInfo,notice:string}`. Use authenticated binary fetch for PDF download, and do not parse JSON from that file response. See the [onboarding handoff](STUDENT_ONBOARDING.md) for examples and metadata.

## Errors

Errors use one envelope; an unavailable shared feature returns HTTP 503:

```json
{"error":{"code":"FEATURE_NOT_CONNECTED","message":"<feature-specific explanation>"}}
```

Handle `400` validation, `401` sign-in, `403` permission, `404` missing/private records, `409` lifecycle conflicts, `413` oversized uploads, `422` unreadable/password-protected/over-page-limit PDFs, `429` rate limiting, and `503` unavailable shared features. Read `result.error?.message`. Do not parse JSON after `204` responses or PDF downloads. Supabase failures must remain visible rather than silently switching persistence modes.

## AI engineer boundary

The connected [Claude club-finder chat](CLUB_FINDER.md) uses a separate `ANTHROPIC_API_KEY`. Its strict browser request contains history and an optional current-PDF hint; the server supplies the authenticated student's saved PDF/profile/catalog. It returns qualitative fit labels and does not change the existing numeric-match contract. It runs only on an explicit student action.

The backend owns authentication, permitted data access, persistence, and HTTP responses. The AI engineer owns parsing, ranking, and answer selection. The shared browser routes connect PDF parsing, matching, and source-grounded applicant summaries. Exact submitted responses are persisted to the shared answer bank only with explicit consent; native saved-answer selection endpoints remain placeholders. Matching may use heuristic fallback, and summaries do not make admission decisions.

```ts
parseProfile(text: string, options?: AiOptions): Promise<{
  mode:'openai'|'local'; profile:ParsedProfile; notice?:string;
}>
matchClubs(profile: MatchingProfile, clubs: MatchingClub[], options?: AiOptions):
  Promise<{mode:'openai'|'local'; matches:{clubId:string;score:number;reasons:string[]}[]; notice?:string}>
suggestAnswer(question: string, profile: MatchingProfile, savedAnswers: SavedAnswer[], options?: AiOptions):
  Promise<{mode:'openai'|'local';answer:string;sourceAnswerIds:string[];needsReview:true;notice?:string}>
```

`MatchingProfile` contains `major`, `bio`, `interests`, `skills`, and `experience`; `goals:string[]` and `resumeText` are optional. `MatchingClub` contains `id`, `name`, `description`, `category`, and `tags`. AI `SavedAnswer` needs `id`, `question`, and `answer`. The HTTP route adds parsing review flags and enriches matches with full club objects.

Return only supplied club/source IDs, validate scores, preserve provenance, and distinguish local/provider modes. Answer selection preserves exact saved text or returns an empty answer; it does not invent experience. PDF ingestion extracts text locally without OCR. Private Supabase Storage integration remains future work, while student profiles and the club catalog are already shared.
