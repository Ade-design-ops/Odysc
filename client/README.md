# OdySC frontend

React + Vite + TypeScript, connected to the shared Fastify/Supabase backend. The USC theme is preserved. `src/api.ts` uses live requests (`USE_MOCKS=false`); browser-local demo accounts no longer establish authentication.

## Run locally

Use Node 24+. Start the configured backend first:

```sh
cd backend
npm install
npm run dev
```

From the repository root, in another terminal:

```sh
cd client
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to `http://127.0.0.1:3001`. The backend requires private Supabase settings; no database credentials or AI keys belong in frontend configuration. The shared migrations have already been applied to the team's project.

## Current flows

- USC email/password signup, confirmation/resend, sign-in, and password recovery/reset.
- Server-backed profile editing and explicit completion; only name, year, major, and interests are required.
- Real PDF upload and reviewed extraction suggestions; PDF remains optional.
- Shared directory, club matching, saved club list/drafts, real application submission and status.
- Optional answer memory after submission consent, private USC ID sharing only with a stated club reason and student consent.
- Personal calendar preferences/events and in-app reminder preferences saved to the server.
- Pending officer requests, approved team/admin permissions, applicant review, scores, decisions, and interview offers/bookings.

The explicitly authorized initial NSBE administrator is linked to real club ID `36288`. Other club access requires approval; choosing an officer tab does not grant authority. A confirmed USC email or optional USC ID does not prove current enrollment.

## Sessions and API

`src/api.ts` sends HttpOnly cookies and a private-request `X-Odysc-Actor` consistency header. `src/store.tsx` hydrates from `/api/session`, queues profile/workspace mutations, handles stale sessions, and resets state when accounts change. Tokens and passwords are not saved in browser storage.

See [shared/api.md](../shared/api.md) for browser routes and [shared workflows](../docs/SHARED_WORKFLOWS.md) for the complete contract. The browser uses `/api/*`; some older native `/api/v1/*` application/organization paths remain 503 placeholders and are not its implementation.

HashRouter routes include `/#/signin`, `/#/signup`, `/#/profile`, `/#/search`, `/#/my-clubs`, `/#/calendar`, `/#/org`, `/#/check-email`, `/#/forgot-password`, `/#/reset-password`, and `/#/auth/error`. The allowlisted Supabase callback belongs to the backend at `http://localhost:3001/auth/callback`, which redirects to the correct frontend hash route.

## Verification and limits

```sh
cd client
npm run build
```

Unknown directory facts are shown as unavailable. Matching may use heuristic fallback, and applicant summaries use submitted source text. Calendar/reminder preferences are in-app records, not scheduled notification emails. Video interviews require a real manually supplied HTTPS link; Zoom/Teams OAuth and automatic meeting creation are not connected. Real Auth email delivery/SMTP and deployed redirects remain untested. PDF files still require persistent backend storage and one backend instance.

Useful files: `src/api.ts` (transport), `src/store.tsx` (server state), `src/pages/AuthFlows.tsx` (email-link flows), `src/components/CampusMap.tsx` and `src/data/buildings.ts` (campus map), `src/data/reference.ts` (static labels/colors), and `src/styles.css` (existing visual design). `src/data/mock.ts` remains historical fixture data, not the live data source.
