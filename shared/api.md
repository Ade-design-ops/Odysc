# OdySC browser API contract

The connected React client calls real backend routes through `client/src/api.ts` with `USE_MOCKS=false`. During development, Vite at `http://localhost:5173` forwards `/api` to backend port 3001. Frontend types live in [types.ts](types.ts); backend validation/permissions remain authoritative.

All browser requests send `credentials:'include'`. Private requests also send `X-Odysc-Actor` with the expected verified user ID held in memory. It detects cross-tab session changes and never grants authority. Tokens/passwords stay out of browser storage. JSON errors use `{error:{code,message}}`; handle `204` without parsing JSON and treat `409 SESSION_CHANGED` as a request to refresh the session.

| Method and path | Body / result |
| --- | --- |
| `GET /api/session` | `{account,profile,workspace,organization}`; anonymous account/profile are null |
| `POST /api/auth/register` | Student/officer signup fields, including password → `{requiresEmailConfirmation,session?}` |
| `POST /api/auth/login` | `{email,password,as:'student'|'officer'}` → session context and HttpOnly cookie |
| `POST /api/auth/logout` | `204` |
| `GET /api/me`, `PATCH /api/me` | Flat `Student`; PATCH accepts editable fields only |
| `POST /api/me/complete` | `{}` → student; validates name, year, major, interests |
| `GET /api/workspace`, `PATCH /api/workspace` | Personal workspace; updates may include `expectedVersion` |
| `GET /api/clubs` | Real directory/settings `Club[]` |
| `GET /api/events`, `POST /api/events` | Actual club events; creation requires an active club administrator and returns 201. Browser writes include `X-Odysc-Actor`. |
| `POST /api/ai/match` | Own optional `{studentId}` → `Match[]`, scores 0–1; another identity is rejected |
| `POST /api/ai/parse-resume` | Actual multipart PDF in field `resume` → suggestions, resume metadata, `needsReview:true` |
| `GET /api/me/resume` | Own private PDF binary |
| `GET /api/applications/mine` | Own real submitted applications |
| `POST /api/applications` | `{clubId,answers,shareUscId?,rememberAnswers?}` → `{application,workspace}` |
| `GET /api/clubs/:clubId/applicants` | Active members only; submitted snapshots and source-grounded summaries |
| `GET /api/organizer/state`, `POST /api/organizer/request` | Current officer context, or pending `{clubId,officerRole}` request |
| Club team/settings, application reviews/decisions, interview offers/bookings | Authorized shared operations; full paths and shapes in [SHARED_WORKFLOWS.md](../docs/SHARED_WORKFLOWS.md) |
| `POST /api/ai/summarize` | Authorized reviewer `{applicationId}` → grounded `Summary` |

Email confirmation/resend, forgot-password, recovery-session, and reset-password use the existing `/api/v1/auth/*` routes. Signup/reset passwords require 10–128 characters; sign-in lets Supabase verify an existing nonempty password. Exact confirmed USC emails are required. Selecting officer context creates or uses a membership; it does not self-approve access.

Years 1–7 map to first/second/third/fourth/fifth-plus/graduate/other; 0 is unset. Keep club IDs as strings and application IDs as real server UUIDs. Unknown facts remain unknown, not mock metadata. Submitted answers enter the answer bank only after explicit consent; USC ID is shared only when a club supplies a reason and the student consents.

The eight shared workflow tables are applied. Browser clients have no Data API grants to them; the backend verifies Auth identity and ownership/club permissions in parameterized database transactions. Older native `/api/v1/*` application/organization placeholders still return 503; this browser contract uses the real `/api/*` implementation instead.

No video-provider OAuth, automatic meeting creation, or booking/notification email delivery is claimed. Video offers require a real HTTPS meeting link. Matching may use heuristic fallback, and applicant summaries are source-grounded. Auth inbox delivery/SMTP and deployed callback redirects still require verification. See [frontend integration](../docs/FRONTEND_INTEGRATION.md).

Club administrators publish events from **Club dashboard → Events → Publish event**. The form sends `{clubId,title,kind,start,durationMin,buildingCode,room}`; `start` is an ISO timestamp converted from the device-local date/time shown in the form. Students can find the saved event on the club page and add it to their personal calendar. Personal calendar events remain separate from published club events.
