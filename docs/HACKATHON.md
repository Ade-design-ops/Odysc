# Build and demo guide

The React frontend now uses real shared backend requests for USC account sign-in, onboarding, club discovery/matching, applications, officer review, calendar/workspace state, and interview offers/bookings. The eight workflow tables are applied in Supabase. Existing USC visual styling is preserved.

## Run the app

Use Node 24+ with the existing private backend configuration. Start `npm run dev` from `backend`, and in a second terminal start `npm run dev` from `client`. Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to backend port 3001; no separate port-3000 server is needed.

The browser contract is [shared/api.md](../shared/api.md); [SHARED_WORKFLOWS.md](SHARED_WORKFLOWS.md) lists all shared routes and permissions. Native `/api/v1` routes retain their older shapes and some placeholder 503s; the connected browser uses the real `/api/*` workflows instead.

## Team ownership

| Owner | Focus |
| --- | --- |
| Backend developer | Shared persistence, identity/club permissions, request validation, PDF pipeline, and lifecycle consistency |
| AI engineer | Extraction and matching quality, heuristic/provider behavior, and summaries grounded in submitted source text |
| Frontend engineer | Account/profile/review flows, save/error states, accessibility, and maintaining the existing design |
| Fourth teammate | Integration rehearsal, authorized demo data, project settings, and presentation |

Keep `student_mock` as AI test data. Live identities use Supabase Auth, student basics use `student_profiles`, and the new `odysc_*` tables hold shared workflows. A confirmed USC identity is required. An initial NSBE administrator for club `36288` was bootstrapped with explicit authorization; new officers cannot self-approve access.

## Rehearse the connected story

1. Sign in with a confirmed USC student account and show that a non-USC address is rejected.
2. Save name, year, major, and an interest. Resume, skills, experience, goals, bio, and USC ID are optional; no university enrollment check is claimed.
3. Optionally upload an authorized PDF and review suggested fields before applying them. Reload the profile to show shared persistence.
4. Browse real directory clubs, show unavailable facts honestly, and request matches. Matching may use heuristic fallback; do not call relevance an admission probability.
5. Add a club, save a draft, and submit a reviewed application. Show explicit consent for answer memory and any justified USC ID sharing. A zero-question submission is an Odysc interest record, not an official external club application.
6. Sign in with an approved club officer. Show real applicant snapshots, source-grounded summaries, review scores, and an administrator decision. A pending officer must not see applicants.
7. Offer actual interview times with a real meeting link/location, then book a time from the student's account. Show persistence and conflict errors, not fabricated emails or meetings.
8. Show saved calendar/personal-event/reminder preferences as in-app records. Club events come from authorized shared records and may be empty.

Do not modify someone else's data for rehearsal. Use synthetic or explicitly authorized application/resume content. Keep the club administrator bootstrap separate from public signup; selecting the officer tab is not permission.

## Verify before presenting

Run the backend typecheck, tests, and production build from `backend`; run the frontend production build from `client`. Rehearse with the actual local frontend origin, test student isolation and membership/admin boundaries, and reload after mutations. Check `401`, `403`, `409 SESSION_CHANGED`, version conflicts, invalid PDFs, and server-unavailable states without losing another account's data.

Keep global email confirmation and USC restrictions active, keep the exact backend callback allowlisted, and set `AUTH_FRONTEND_ORIGIN`, `AUTH_FRONTEND_ROUTING`, and `CORS_ORIGINS` for the target environment. Real inbox signup/confirmation/reset and deployed redirects remain untested; manual auto-confirmation is not delivery proof. Supabase's default email sender restricts recipients and volume, so ordinary students need the appropriate SMTP configuration. See [authentication setup](AUTHENTICATION.md).

Persist `data/resumes` and use one backend instance until private shared storage is available. Keep a recorded walkthrough available for network or presentation interruptions.

## External work still deferred

OCR/additional resume formats, university SSO/enrollment verification, Zoom/Teams OAuth, automatic meeting creation, notification email/SMS delivery, private shared PDF storage, and production hosting/redirect verification remain separate work. Do not present local meeting flags as connected video providers or stored reminder preferences as scheduled messages. Applicant summaries are source-grounded; the app does not make admission decisions.
