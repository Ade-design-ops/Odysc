# odysc

A React/Vite frontend connected to a TypeScript/Fastify backend for USC student onboarding, club discovery, applications, and organization review. The default runtime uses **Supabase Auth** and shared PostgreSQL data. SQLite is an explicit isolated demo/test mode.

The student onboarding, USC email, and eight shared-workflow tables have been applied to the shared project. The active signup hook rejects non-USC addresses. Existing `clubs` and AI-only `student_mock` data remain separate. See [the schema review](docs/SUPABASE_SCHEMA_REVIEW.md), [Supabase handoff](docs/SUPABASE_HANDOFF.md), and [shared workflow contract](docs/SHARED_WORKFLOWS.md).

## Run the shared backend

Use Node.js **24 or newer**. Keep the existing configured backend `.env`; if setting up a new checkout, copy `.env.example` and fill its Supabase settings through the team's private credential channel.

```sh
cd backend
npm install
npm run dev
```

The default `DATABASE_BACKEND=supabase` requires the project URL, publishable key, server-side database connection URL, and verified TLS CA file. Database credentials stay on the backend. The frontend workflows use parameterized database transactions with verified Auth identity and explicit ownership/membership checks; native profile routes also retain user-scoped Data API access.

In a second terminal, start the frontend:

```sh
cd client
npm install
npm run dev
```

- App: [http://localhost:5173](http://localhost:5173)
- Backend: [http://localhost:3001](http://localhost:3001)
- Interactive docs: [http://localhost:3001/docs](http://localhost:3001/docs)
- OpenAPI: [http://localhost:3001/openapi.json](http://localhost:3001/openapi.json)
- Health: [http://localhost:3001/health](http://localhost:3001/health)

The frontend now calls the real `/api/*` workflows through its Vite proxy to port 3001. Mock account/profile storage is not used for authentication. Signup, sign-in, confirmation/resend, and password recovery screens are connected to the backend. Keep global email confirmation enabled. See [frontend integration](docs/FRONTEND_INTEGRATION.md) and [authentication setup](docs/AUTHENTICATION.md).

The local fixture credentials shown later are not Supabase accounts and have not been created in the shared Auth project.

## Connected features

- Supabase-backed student sign-in, onboarding drafts, completion, and editable profiles for confirmed `@usc.edu` accounts.
- Student signup, confirmation/resend, and password recovery/reset APIs, with private browser session cookies.
- Required onboarding: name, academic year, major, at least one interest, and a successfully uploaded private PDF résumé.
- Optional goals, bio, skills, and experience details. Required résumé PDFs support private upload/download/replacement/deletion; deleting the PDF makes onboarding incomplete.
- Shared USC club catalog and individual club pages.
- Student club-finder chat using the saved résumé/profile and real catalog, with Claude when `ANTHROPIC_API_KEY` is configured. See [setup and data flow](docs/CLUB_FINDER.md).
- Pasted-background parsing and profile-based club matching, including optional extracted resume text.
- Persisted club lists, drafts, calendar preferences/personal events, and in-app reminder preferences.
- Real application snapshots and optional answer memory after explicit consent.
- Pending officer requests, administrator approval, authorized team management, reviewer scores, and administrator decisions.
- Persisted interview offers/bookings and authorized club event/settings endpoints.

Resume uploads accept PDFs up to **5 MiB and 10 pages**. Files and their private metadata currently live in the backend's `data/resumes` directory, not Supabase Storage or SQLite. Use one backend instance and persistent storage for that directory. Text extraction happens locally, preserves entered profile fields, and does not perform OCR. Scanned PDFs can be saved; readable extracted text is not required. The PDF itself is required before onboarding completion and club recommendations.

The [student onboarding handoff](docs/STUDENT_ONBOARDING.md) defines Basics → Interests → Résumé and optional details → Finish. A confirmed USC account can use student or officer context; officer permissions come from approved club membership, not a self-selected role. An initial NSBE administrator for club `36288` was bootstrapped with explicit authorization. Other officer requests require approval.

Existing extraction and numeric match cards use OpenAI when configured and local rules otherwise. The new [club-finder chat](docs/CLUB_FINDER.md) uses Claude and requires its own Anthropic key; it sends the saved PDF plus profile and conversation only on an explicit search/follow-up. Results require review and never automatically submit an application. With OpenAI enabled, relevant profile text, extracted resume text, and club data are sent to OpenAI. Those requests use structured output and `store:false`; see the [official Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Remaining external integrations

The connected frontend uses the real `/api/*` application, organization, workspace, and calendar routes backed by the new shared tables. Some older `/api/v1/*` application/organization placeholders still return **503 `FEATURE_NOT_CONNECTED`**; they are separate contracts and are not the frontend's shared workflow implementation.

Interview offers and bookings persist, but video meetings require an existing real HTTPS link. Zoom/Teams OAuth, automatic meeting creation, notification email/SMS, university SSO/enrollment verification, and shared PDF object storage remain unimplemented. Reminder preferences are stored in-app; they do not schedule external messages. Real Auth inbox delivery and deployed redirect URLs still need testing. Matching may use heuristic fallback; applicant summaries are source-grounded extracts, not automated admissions decisions.

The frontend engineer owns maps and hologram visuals once event data is available. The AI engineer owns parsing, matching, and answer selection; the backend developer owns access rules, API contracts, shared-data integration, and lifecycle wiring. See [the team guide](docs/HACKATHON.md).

## Configuration and integration

Use `backend/.env.example` as the configuration reference:

| Variable | Purpose |
| --- | --- |
| `DATABASE_BACKEND` | Defaults to `supabase`; `sqlite` explicitly selects the local scaffold |
| `SUPABASE_URL` | Shared project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Project publishable key for Auth and user-scoped Data API requests |
| `STUDENT_EMAIL_DOMAIN` | Defaults to `usc.edu`; confirmed USC email is required. Explicit blank disables only backend checks for isolated tests, not shared Supabase rules. |
| `SUPABASE_DB_URL` | Server-only verified database connection for club reads and authorized workflow transactions |
| `SUPABASE_DB_CA_FILE` | Local path to the public root CA used for verified database TLS |
| `RESUME_DIRECTORY` | Private filesystem storage; defaults to `./data/resumes` |
| `ANTHROPIC_API_KEY` | Server-only Claude key for student-triggered club-finder chat |
| `CLUB_FINDER_MODEL` | Claude model for the finder; default `claude-sonnet-5-5` |
| `AUTH_PUBLIC_ORIGIN` | Backend origin for email callbacks; local default `http://localhost:3001` |
| `AUTH_FRONTEND_ORIGIN` | Frontend origin after verification; local default `http://localhost:5173` |
| `AUTH_FRONTEND_ROUTING` | `hash` for the current Vite HashRouter; `history` supports ordinary path routes |
| `AUTH_COOKIE_SECRET` | Stable private random value of at least 32 characters; required in production |
| `DATABASE_PATH` | SQLite file path; local mode only |

`DEMO_STUDENT_EMAIL` and `DEMO_STUDENT_PASSWORD` are optional operator-only live-check credentials for an actual Supabase test user. They do not create a user and are not required frontend configuration. Keep them private.

USC email restrictions are active in the backend and shared Supabase project as of November 14, 2026. The old non-USC demo account is blocked; no accounts were deleted. A confirmed USC demo account passed live sign-in, onboarding draft save/readback, and sign-out checks. See [USC email access](docs/USC_EMAIL_ACCESS.md); email confirmation establishes mailbox access, not current student enrollment, and the manually auto-confirmed demo does not verify inbox delivery.

Set `CORS_ORIGINS` to the actual frontend origin; local defaults are ports 3000 and 5173. `HOST` defaults to `127.0.0.1`, and `PORT` to `3001`. Optional `OPENAI_API_KEY` stays on the backend; `OPENAI_MODEL` defaults to `gpt-4o-mini`. Keep `SEED_DEMO` disabled in Supabase mode.

The connected browser uses `/api/*` routes and the existing native API remains under `/api/v1/*`. Requests use HttpOnly session cookies and `credentials:'include'`. Private frontend requests also carry `X-Odysc-Actor` as a cross-tab consistency guard; the server still authenticates and authorizes the actual session. Passwords and tokens are not stored in browser storage. See [the browser contract](shared/api.md) and [API.md](docs/API.md).

## Verify and build

```sh
cd backend
npm run typecheck
npm test
npm run build
npm start
```

Tests use an isolated SQLite store where appropriate; they do not change the default shared runtime mode.

From `backend`, operator checks for the active USC rules require `psql` on `PATH`, the private backend connection settings, and the verified TLS CA:

```sh
npm run usc:status
npm run usc:verify
```

The verification command uses temporary test fixtures and rolls back its database changes. Actual frontend signup/confirmation and password recovery through a real inbox remain to be tested; Supabase's default sender limits recipients and volume. See [authentication setup](docs/AUTHENTICATION.md).

## Optional local demo mode

For isolated development with fictional fixtures, explicitly select SQLite:

```sh
cd backend
DATABASE_BACKEND=sqlite npm run seed
DATABASE_BACKEND=sqlite npm run dev
```

Only this local mode uses `student@example.com` and `organizer@example.com`, with password `DemoPass123!`. Its clubs, events, deadlines, and contacts are fictional fixtures. `DATABASE_PATH` controls its SQLite file. This is a disposable local scaffold, not a second shared team database or a fallback when Supabase fails.

## Docker

From the repository root, with the Supabase environment already configured and the public CA saved locally:

```sh
docker build -t odysc-backend ./backend
docker volume create odysc-data
docker run --rm -p 3001:3001 -e HOST=0.0.0.0 \
  --env-file backend/.env \
  -e DATABASE_BACKEND=supabase \
  -e SUPABASE_DB_CA_FILE=/app/certs/supabase-root.crt \
  -v "$PWD/backend/data/certs/supabase-root.crt:/app/certs/supabase-root.crt:ro" \
  -v odysc-data:/app/data \
  odysc-backend
```

The database CA is mounted read-only, and the data volume preserves private resume files. Student profiles remain centralized in Supabase. Keep credentials in the local environment or hosting secret store, and run one backend instance while resume storage remains local.
