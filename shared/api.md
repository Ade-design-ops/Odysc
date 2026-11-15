# OdySC browser API contract

The connected React client calls real backend routes through `client/src/api.ts` with `USE_MOCKS=false`. During development, Vite at `http://localhost:5173` forwards `/api` to backend port 3001. Frontend types live in [types.ts](types.ts); backend validation/permissions remain authoritative.

All browser requests send `credentials:'include'`. Private requests also send `X-Odysc-Actor` with the expected verified user ID held in memory. It detects cross-tab session changes and never grants authority. Tokens/passwords stay out of browser storage. JSON errors use `{error:{code,message}}`; handle `204` without parsing JSON and treat `409 SESSION_CHANGED` as a request to refresh the session.

| Method and path | Body / result |
| --- | --- |
| `GET /api/session` | `{account,profile,workspace,organization,resume}`; `resume` is private saved PDF metadata or null; anonymous account/profile/resume are null |
| `POST /api/auth/register` | Student/officer signup fields, including password → `{requiresEmailConfirmation,session?}` |
| `POST /api/auth/login` | `{email,password,as:'student'|'officer'}` → session context and HttpOnly cookie |
| `POST /api/auth/logout` | `204` |
| `GET /api/me`, `PATCH /api/me` | Flat `Student`; PATCH accepts editable fields only |
| `POST /api/me/complete` | `{}` → student; validates name, year, major, interests and saved own résumé PDF; missing PDF returns `400 RESUME_REQUIRED` |
| `GET /api/workspace`, `PATCH /api/workspace` | Personal workspace; updates may include `expectedVersion` |
| `GET /api/clubs` | Real directory/settings `Club[]` |
| `GET /api/events`, `POST /api/events` | Actual club events; creation requires an active club administrator and returns 201. Browser writes include `X-Odysc-Actor`. |
| `PATCH /api/events/:eventId` | Nonempty partial `{title,kind,start,durationMin,buildingCode,room}` → full persisted `ClubEvent` (200). Active administrator of that event's club required; `id` and `clubId` cannot change. |
| `POST /api/ai/match` | Own optional `{studentId}` → `Match[]`, scores 0–1; another identity is rejected |
| `POST /api/club-finder` | `{history?: FinderTurn[], resumeId?: UUID}` → `{reply,matches:[{clubId,name,reason,fit} ]}`; uses authenticated saved profile/PDF and real catalog; confirmed student context required. See [club-finder contract](../docs/CLUB_FINDER.md). |
| `POST /api/ai/parse-resume` | Actual multipart PDF in field `resume` → suggestions, resume metadata, `needsReview:true` |
| `GET /api/me/resume` | Own private PDF binary |
| `GET /api/me/resume/status` | Private `{resume:ResumeInfo|null}`; authoritative uploaded-PDF status without file contents |
| `GET /api/applications/mine` | Own real submitted applications |
| `POST /api/applications` | `{clubId,answers,shareUscId?,rememberAnswers?}` → `{application,workspace}` |
| `GET /api/clubs/:clubId/applicants` | Active members only; submitted snapshots and source-grounded summaries |
| `GET /api/organizer/state`, `POST /api/organizer/request` | Current officer context, or pending `{clubId,officerRole}` request |
| `POST /api/clubs/:clubId/team/promote` | Active club administrator only; `{email}` → updated organization state. Promotes an existing active, linked member with a current confirmed USC email to administrator. |
| Club team/settings, application reviews/decisions, interview offers/bookings | Authorized shared operations; full paths and shapes in [SHARED_WORKFLOWS.md](../docs/SHARED_WORKFLOWS.md) |
| `POST /api/ai/summarize` | Authorized reviewer `{applicationId}` → grounded `Summary` |

Email confirmation/resend, forgot-password, recovery-session, and reset-password use the existing `/api/v1/auth/*` routes. Signup/reset passwords require 10–128 characters; sign-in lets Supabase verify an existing nonempty password. Exact confirmed USC emails are required. Selecting officer context creates or uses a membership; it does not self-approve access.

Administrator promotion uses `api.promoteMember(clubId, email)` / `promoteMember(email)`. The backend checks the acting administrator and the target's current same-club membership and confirmed USC account; the browser supplies only the target email. Missing members return 404, ineligible targets return `409 MEMBER_NOT_ELIGIBLE`, and unauthorized actors return 403. Promoting an eligible existing administrator is idempotent. The returned organization state becomes authoritative only after success. This operation grants administrator access; it does not transfer ownership, demote anyone, change the officer-role title, or replace the member's existing account/profile. No demotion or ownership-transfer endpoint is provided.

Years 1–7 map to first/second/third/fourth/fifth-plus/graduate/other; 0 is unset. Keep club IDs as strings and application IDs as real server UUIDs. Unknown facts remain unknown, not mock metadata. Submitted answers enter the answer bank only after explicit consent; USC ID is shared only when a club supplies a reason and the student consents.

The eight shared workflow tables are applied. Browser clients have no Data API grants to them; the backend verifies Auth identity and ownership/club permissions in parameterized database transactions. Older native `/api/v1/*` application/organization placeholders still return 503; this browser contract uses the real `/api/*` implementation instead.

No video-provider OAuth, automatic meeting creation, or booking/notification email delivery is claimed. Video offers require a real HTTPS meeting link. Matching may use heuristic fallback, and applicant summaries are source-grounded. Auth inbox delivery/SMTP and deployed callback redirects still require verification. See [frontend integration](../docs/FRONTEND_INTEGRATION.md).

Club administrators publish events from **Club dashboard → Events → Publish event**. The form sends `{clubId,title,kind,start,durationMin,buildingCode,room}`; `start` is an ISO timestamp converted from the device-local date/time shown in the form. Students can find the saved event on the club page and add it to their personal calendar. Personal calendar events remain separate from published club events.

An active administrator can edit an existing event through `api.updateEvent(eventId, patch)` / `updateClubEvent(eventId, patch)`. The PATCH body includes only changed editable fields; `start` remains an ISO timestamp with an offset, and field validation matches creation. Event building codes come from the same [31-building campus catalog](../docs/CAMPUS_BUILDINGS.md) used by the dropdown and map. The server checks the event's persisted club and current membership. Missing events return 404, unauthorized edits return 403, and stale browser actors return 409. Failed edits leave the displayed event unchanged.

Successful edits update the same event row and ID. The client replaces that event in its shared list, so existing RSVP/calendar selections stay attached and show the updated title, time and location. Other signed-in clients receive the updated event through the normal directory refresh/poll. Edits do not clear those selections or send notification emails. Previously downloaded `.ics` files are independent snapshots and must be downloaded/imported again to receive changes.

Student onboarding requires a valid saved private PDF (5 MiB/10 pages) as well as name, year, major, and interests. Goals, bio, skills, and experience details remain optional. AI matching also returns `400 RESUME_REQUIRED` without the current student’s saved PDF. Scanned PDFs are accepted even if text extraction is unavailable. Existing profiles without a PDF stay editable but are incomplete; no profiles are bulk-reset. Uploaded PDFs and their text remain in the existing private backend storage and authenticated résumé endpoints, so this policy does not by itself move files into Supabase Storage or a teammate’s AI service.
