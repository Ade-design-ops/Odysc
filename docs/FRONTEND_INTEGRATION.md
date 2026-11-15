# Frontend and backend integration

The React/Vite client now uses the real shared backend. `client/src/api.ts` has `USE_MOCKS=false`; requests are not replaced with mock records. The existing USC visual design is retained. See [the browser contract](../shared/api.md) and [shared workflows](SHARED_WORKFLOWS.md) for exact request/response shapes.

## Run both processes

Use Node 24+ and the existing private backend environment. In separate terminals:

```sh
cd backend
npm install
npm run dev
```

```sh
cd client
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite forwards `/api` to `http://127.0.0.1:3001`. There is no port-3000 compatibility server to start. Backend health is at [http://localhost:3001/health](http://localhost:3001/health).

## Connected behavior

| Area | Current implementation |
| --- | --- |
| Accounts | Real USC email/password signup and sign-in, confirmation/resend, recovery/reset screens, and HttpOnly cookie sessions |
| Bootstrap | Session, catalog, and events load with error/retry handling; protected matching waits for the authenticated student |
| Profile | Debounced server saves, explicit completion, optional profile extras, save status/error handling, and per-account state clearing |
| Resume | Actual multipart PDF bytes; private saved file plus extracted suggestions marked for review, without silent profile replacement |
| Directory and matching | Shared club IDs/data, actual settings, unavailable-fact handling, and scores normalized to 0–1 for the client |
| Workspace | Persisted club list, drafts, in-app reminder preferences, personal calendar entries/colors/visibility, and server-derived application state |
| Applications | Reviewed snapshots, deadline/question validation, duplicate prevention, optional USC ID sharing and explicit answer memory |
| Officers | Pending membership requests, active-member review access, administrator team/settings/decision actions, and source-grounded applicant summaries |
| Interviews/events | Persisted offers, real meeting/location details, student booking, and an Events dashboard tab where club administrators publish info sessions, mixers, workshops, and coffee chats |

Eight workflow tables are applied in Supabase. They are server-only with RLS enabled and no browser Data API grants. Backend transactions verify the current confirmed USC identity and enforce actor ownership or active club membership/admin access. Existing `student_profiles` ownership/USC policies remain intact. An explicitly authorized initial administrator was linked to NSBE club `36288`; other clubs are not automatically assigned to new users.

## Transport and account safety

Every browser API request includes `credentials:'include'`. Access/refresh tokens stay in encrypted HttpOnly cookies; passwords and tokens are not persisted in browser storage. Private frontend requests include `X-Odysc-Actor`, the expected user ID held in memory. This detects another tab changing the shared cookie; it never grants authority. `409 SESSION_CHANGED` requires refreshing/signing in before editing again.

Profile/workspace changes are queued, and workspace revisions can reject conflicting cross-tab saves. Application statuses, saved-answer records, team membership, review scores, and decisions are loaded from the server rather than accepted through a personal-workspace patch.

The browser-facing `/api/*` routes use frontend data shapes. The native `/api/v1/*` API remains available with its original shapes. Some native application/organization placeholder routes still return `503 FEATURE_NOT_CONNECTED`; the connected client uses the new shared `/api` implementations. See [API.md](API.md).

## HashRouter and email callbacks

The local backend configuration uses:

```dotenv
AUTH_PUBLIC_ORIGIN=http://localhost:3001
AUTH_FRONTEND_ORIGIN=http://localhost:5173
AUTH_FRONTEND_ROUTING=hash
```

The Supabase redirect allowlist keeps **`http://localhost:3001/auth/callback`**. The backend exchanges the one-time code and sets cookies before redirecting:

| Outcome | Frontend destination |
| --- | --- |
| Signup confirmation | `http://localhost:5173/#/profile?welcome=1` |
| Password recovery | `http://localhost:5173/#/reset-password` |
| Invalid/expired link | `http://localhost:5173/#/auth/error?reason=...` |

The client includes check-email, forgot-password, reset-password, and auth-error states. Open links in the same browser that requested them. New signup/reset passwords require 10–128 characters; Supabase verifies existing nonempty sign-in passwords. Officer selection requests a membership and does not self-approve club access.

## Data and external-service limits

Required onboarding remains name, year, major, and an interest. Resume, goals, bio, skills, experience, and USC ID are optional. A stored USC ID does not verify enrollment and is excluded from applications unless the club provides a reason and the student explicitly consents. Email confirmation establishes mailbox access, not university enrollment or USC SSO.

Unknown directory deadlines, selectivity, rates, and contacts remain unavailable until an authorized club supplies them. Zero-question submissions are Odysc prototype interest records; they do not establish participation in a club's official recruitment process.

Matching can fall back to heuristic rules. Applicant summaries are extracts grounded in submitted profile/answer text. Neither scores nor summaries are admission probabilities or automated decisions. PDF uploads are limited to 5 MiB and 10 pages; private files still need a persistent backend volume and one instance.

Interview bookings persist, but video calls require an existing real HTTPS meeting link. The app does not fabricate video links, create external meetings, or send booking/invitation messages. Auth email delivery/SMTP and deployed redirect URLs remain to be verified through a real inbox and hosting environment. See [authentication setup](AUTHENTICATION.md).
