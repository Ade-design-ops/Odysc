# Supabase data handoff

Supabase is the shared runtime for Auth, student profiles, club discovery, and the connected frontend's personal/organization workflows. The approved [student onboarding](../backend/supabase/student-onboarding.sql), [USC email](../backend/supabase/usc-email-access.sql), and [shared workflows](../backend/supabase/shared-workflows.sql) migrations are applied. The USC signup hook rejects non-USC signups. Existing `clubs` and AI-only `student_mock` records remain separate.

## Data ownership and access

| Data or operation | Current path |
| --- | --- |
| Identity/session | Supabase Auth; server verification and encrypted HttpOnly browser cookies |
| Profile basics | `student_profiles`; four own-row policies plus a restrictive confirmed-USC policy; native user-JWT Data API and authorized frontend service transactions |
| Club directory | Existing `clubs`; parameterized reads through the backend's verified TLS connection |
| Personal state/extras | `odysc_student_workspaces`; own club list, drafts, in-app reminder/calendar preferences, and optional profile extras |
| Officer permissions | `odysc_club_memberships`; pending/invited/active membership, administrator or reviewer access |
| Club metadata/events | `odysc_club_settings`, `odysc_club_events`; authorized administrator changes |
| Applications/answer memory | `odysc_applications`, `odysc_answer_bank`; reviewed snapshots and exact remembered answers after explicit consent |
| Reviews/interviews | `odysc_reviews`, `odysc_interviews`; active-member review access, administrator decisions/offers, owner bookings |
| AI test students | Existing `student_mock`; never used as live identities |
| Private PDFs | Backend filesystem `data/resumes`; authenticated private endpoints, not Supabase Storage |

The eight `odysc_*` workflow tables have RLS enabled and no browser grants for `anon`, `authenticated`, or `PUBLIC`. Browser requests cannot write directly through the Data API. The server uses the pinned-project, verified-TLS PostgreSQL connection and parameterized transactions. Each private operation rechecks the current confirmed USC identity and explicit ownership or active club membership; administrator actions additionally check administrator access. Do not treat cached state, a supplied student ID, or a requested role as authority.

The initial NSBE administrator for real club ID `36288` was linked with explicit user authorization. No first-signup administrator shortcut exists, and other officer signups/requests remain pending until approved. Supabase identity remains a student identity; officer context comes from membership records.

Optional preferred name, pronouns, USC ID, and graduation term are stored in the personal workspace. A USC ID does not verify enrollment and is omitted from an application unless the club has a stated reason and the student explicitly consents. No private identity/credential values belong in project documentation.

## Runtime and frontend

Keep `DATABASE_BACKEND=supabase` and the private `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_DB_CA_FILE`, and stable `AUTH_COOKIE_SECRET` configuration. `RESUME_DIRECTORY` defaults to `./data/resumes`; `DATABASE_PATH` applies only to explicit SQLite mode. There is no automatic SQLite fallback or startup migration.

TLS verifies certificate and hostname. The supplied public CA is stored locally at ignored `data/certs/supabase-root.crt`; containers must mount it read-only and point `SUPABASE_DB_CA_FILE` to its container path. See [the Docker example](../README.md#docker).

The React frontend is connected to `/api/*` through its Vite proxy from localhost:5173 to backend port 3001. Its state, applications, officer reviews, and bookings persist through the shared service. The older native `/api/v1/*` API remains available, including some legacy 503 placeholders; those are not the browser's shared workflow implementation. See [SHARED_WORKFLOWS.md](SHARED_WORKFLOWS.md) and [the browser contract](../shared/api.md).

Browser requests include `credentials:'include'` and private requests include `X-Odysc-Actor` as a cross-tab consistency guard. Passwords/tokens stay out of browser storage. Workspace version checks prevent silent conflicting saves. Server-owned statuses, teams, reviews, and remembered answers cannot be patched through personal state.

## Auth and outstanding external checks

Confirmed exact `@usc.edu` accounts are required. The backend defaults to `STUDENT_EMAIL_DOMAIN=usc.edu`; an explicit blank is only a backend isolated-test opt-out and does not disable shared RLS or the signup hook. The old non-USC demo cannot access student features. New signup/reset passwords require 10–128 characters; sign-in lets Supabase verify existing nonempty passwords.

Keep global email confirmation enabled. The allowlisted callback remains `http://localhost:3001/auth/callback`; with hash routing, the local frontend origin is `http://localhost:5173`. Confirmation/recovery use a pending PKCE cookie and links must open in the requesting browser. See [authentication setup](AUTHENTICATION.md).

Live USC sign-in/profile persistence and non-USC rejection were verified separately. A manually auto-confirmed demo account does not prove inbox delivery. Real signup/confirmation/reset email delivery, SMTP configuration, and deployed origins/redirect URLs still need a real inbox and hosting walkthrough.

Interview offers and booking records persist, but video calls need a real manually supplied HTTPS link. Zoom/Teams OAuth and automatic meeting creation are not connected. Booking/invitation/reminder notification email/SMS is not claimed; those states are in-app. Matching may use heuristic fallback, and applicant summaries use submitted source text.

## Private PDF storage and operators

PDFs are optional, limited to 5 MiB and 10 pages, with local extraction and no OCR. Files and private metadata remain in `data/resumes`; use one backend instance with a persistent volume until private shared object storage is integrated. Upload suggestions require review and do not silently replace a profile or submit an application.

From `backend`, `npm run inspect:supabase` inspects metadata only. `npm run usc:status` and `npm run usc:verify` inspect/verify USC policy; the verification fixtures roll back. Workflow schema status can be checked with `node --env-file=.env scripts/shared-workflows.mjs --status`. Keep credentials private and do not reapply an already-installed workflow migration; its operator script refuses existing tables for review.

Preserve source club IDs and names, keep AI test data separate, and represent unknown facts as unavailable until authorized club administrators provide them. Do not reshape the original directory merely to imitate old mock records. See [the schema review](SUPABASE_SCHEMA_REVIEW.md).
