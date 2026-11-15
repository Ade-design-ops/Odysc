# Shared frontend workflows

The compatibility API implements the pushed React frontend's account, profile, application, calendar, and club-review data shapes. It uses `/api/*`; the original `/api/v1/*` routes remain available. The additive [shared-workflows.sql](../backend/supabase/shared-workflows.sql) migration has been applied to the shared project with user authorization. It does not modify the existing club directory, AI mock table, student profile ownership policies, or USC signup hook.

## Data and authorization

| Tables | Purpose |
| --- | --- |
| `odysc_student_workspaces` | Own club list, drafts, reminders, calendar entries/preferences, optional private profile extras, and last selected account context |
| `odysc_club_memberships` | Requested, invited, and approved club officer memberships; administrator/reviewer access |
| `odysc_club_settings` | Club-provided questions, deadline, contacts, and optional USC ID requirement/reason |
| `odysc_applications` | One submitted application per student/club, with the reviewed profile/answer snapshot |
| `odysc_answer_bank` | Exact submitted responses remembered only after explicit consent |
| `odysc_reviews` | Each verified reviewer’s scores and administrator decisions |
| `odysc_interviews` | Real offered times, manually supplied meeting/location details, and the student’s booking |
| `odysc_club_events` | Club events entered by authorized administrators |

These new tables have RLS enabled and no grants for `anon`, `authenticated`, or `PUBLIC`. Browser clients cannot write around the HTTP service through Supabase's Data API. The server's verified-TLS, pinned-project PostgreSQL connection performs parameterized operations. Every private transaction rechecks that the Supabase-authenticated actor still owns a confirmed USC email. Club actions additionally require a matching active membership; administrator actions check administrator access. A browser's requested role, student ID, email, scores, and cached state never establish authority.

Student profile basics remain in the existing `student_profiles` table. Optional preferred name, pronouns, USC ID, and graduation term live in the server-only workspace record. A USC ID does **not** verify enrollment. It is excluded from an application unless the club has a stated reason of at least 15 characters and the student explicitly consents for that application.

Supabase identity remains a student identity; officer context comes from the membership table. Selecting “officer” during signup only creates a pending request. An existing approved club administrator must approve it, or a project operator must explicitly bootstrap the initial administrator after verifying the person and club. No first-signup administrator shortcut exists. The initial NSBE administrator was linked with the user's explicit authorization; no other organizations are automatically assigned.

## API contract

All browser requests include `credentials:'include'`. Private requests also send `X-Odysc-Actor` with the verified user ID held in memory; this is a consistency guard against another browser tab changing the shared session cookie, never an authorization source. A stale/missing expected actor on cookie mutations receives `409 SESSION_CHANGED` before any change. Passwords and tokens are never stored in browser storage.

| Method and path | Request / result |
| --- | --- |
| `GET /api/session` | `{account,profile,workspace,organization}`; anonymous account/profile are null |
| `POST /api/auth/register` | `{name,email,password,role:'student'|'officer',clubId?,officerRole?,preferredName?,pronouns?,uscId?,year?,gradTerm?}` → `201 {requiresEmailConfirmation,session?}` |
| `POST /api/auth/login` | `{email,password,as?:'student'|'officer'}` → full session context and HttpOnly cookie |
| `POST /api/auth/logout` | `204`; verifies actor consistency before clearing cookies |
| `GET /api/me` | Flat frontend `Student` |
| `PATCH /api/me` | Editable profile fields only → updated `Student` |
| `POST /api/me/complete` | Requires name, year, major, interests → `Student`; persists explicit onboarding completion |
| `GET /api/workspace` | Personal workspace plus server-derived application IDs/statuses, answer bank, and interviews |
| `PATCH /api/workspace` | Allowed personal fields and optional `expectedVersion` → latest workspace |
| `GET /api/clubs` | Real shared directory plus actual club settings; unknown facts remain unknown |
| `GET /api/events` | Actual shared club events, possibly empty |
| `POST /api/events` | Club administrator only; real event details |
| `POST /api/ai/match` | Own optional `studentId` → matches with scores 0–1; another identity is rejected |
| `POST /api/ai/parse-resume` | Actual multipart PDF in `resume` → extracted suggestions, resume metadata, `needsReview:true` |
| `GET /api/me/resume` | Own private PDF |
| `GET /api/applications/mine` | Own real submitted applications |
| `POST /api/applications` | `{clubId,answers,shareUscId?,rememberAnswers?}` → `201 {application,workspace}` |
| `GET /api/clubs/:clubId/applicants` | Active club member only; actual submitted snapshots and grounded summaries |
| `GET /api/organizer/state` | Current club's membership, team, review scores, decisions, settings, interviews |
| `POST /api/organizer/request` | `{clubId,officerRole}` → pending officer context; no self-approval |
| `POST /api/clubs/:clubId/team/invite` | Administrator only; `{email,name,officerRole}` → organization state |
| `POST /api/clubs/:clubId/team/approve` | Administrator only; `{email}` → organization state |
| `DELETE /api/clubs/:clubId/team/:email` | Administrator only; cannot remove self or the final active administrator |
| `PATCH /api/clubs/:clubId/settings` | Administrator only; validated settings → organization state |
| `POST /api/applications/:id/review` | Active reviewer; `{scores}` → organization state; each score 1–5 |
| `POST /api/applications/:id/decision` | Administrator; `{decision:'advance'|'decline'|'accept'}` → organization state |
| `POST /api/ai/summarize` | Active club reviewer; `{applicationId}` → source-grounded summary/evidence and injection flag |
| `POST /api/interviews` | Administrator; `{applicationId,format,slots,durationMin,link?,buildingCode?,room?,note?}` → organization state |
| `POST /api/interviews/:id/book` | Application owner; `{slot:string|null}` → workspace; rejects unavailable or conflicting times |

Profile years map 1–7 to first/second/third/fourth/fifth-plus/graduate/other; 0 means unset. Match scores are normalized from the native backend's 0–100 to the frontend's 0–1. Actual club IDs are strings throughout. Application IDs are real UUIDs, exposed in `workspace.applicationIds[clubId]`; client-created `me_<clubId>` IDs have no authority.

Workspace application statuses, remembered answers, teams, and reviews are server-derived and cannot be patched through personal state. Workspace updates lock the row and can check `expectedVersion` to reject cross-tab lost updates. Independent profile-extra saves merge under that lock without bumping the personal-workspace revision.

Submission validates the current required basics, question IDs, answers, word limits, current deadline, and USC ID consent. Unknown club deadlines/questions are not invented: a zero-question interest application can be recorded for a directory club. This is an Odysc prototype record, not proof of participation in a club's official recruitment process. Duplicate submissions are rejected. Final decisions cannot be reversed silently, release outstanding bookings, and prevent further interview booking.

## Remaining external integrations

Applicant summaries are deterministic extracts of the submitted profile/answers, with exact source evidence and a prompt-injection warning. They do not invent admission probabilities or qualifications. Resume extraction and club matching use the existing optional AI integration and labeled local fallback.

Interview scheduling and bookings persist in Odysc. Video interviews require an existing real HTTPS meeting link; the service does not fabricate Zoom/Teams/Meet URLs or claim to create meetings. Setting provider connection flags to true returns `503 MEETING_PROVIDER_NOT_CONFIGURED` until real provider OAuth is implemented. Invitations/booking notices are in-app records; no notification email is claimed or sent by these routes. Supabase's separate Auth email sender still needs its own delivery configuration and a real inbox walkthrough.

The old native `/api/v1` placeholder routes for applications, organization writes, saved answers, bookmarks, and reminders still return `503 FEATURE_NOT_CONNECTED`. The connected frontend uses the shared `/api` workflows above. Do not mix the old local SQLite implementations into the shared app, or treat a placeholder 503 as a successful empty result.

## Verification

`backend/test/frontend-backend.test.ts` uses isolated provider/database fixtures. It checks current actor verification, club membership/admin boundaries, private USC ID handling, explicit answer memory, question validation, grounded summaries, actor-change/logout safety, and malformed URL handling. It sends no real emails and never changes live passwords. A separate live integration run must verify officer context and application/booking paths with controlled test data; isolated tests do not prove the actual project configuration.


A repeatable live SQL check is available for project operators:

```sh
cd backend
npm run workflow:verify
```

It uses the configured verified-TLS database connection and actual `FrontendStore` methods. It creates synthetic Auth/profile/membership/application fixtures in one outer transaction and **always rolls back**; expected failures use savepoints so PostgreSQL constraint errors do not invalidate the rest of the check. It defaults to existing club `36288`, or accepts `WORKFLOW_VERIFY_CLUB_ID` for another existing club. The target club row/settings may be briefly locked/overridden inside that rollback transaction, so run it between manual review actions. Existing administrator records are not changed. Output contains fixed check labels and, on failure, a SQL state—not credentials, emails, or row data. This does not send email, test provider OAuth, or prove browser behavior.
