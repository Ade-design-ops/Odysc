# Student authentication handoff

The backend implements signup, email confirmation/resend, sign-in, session cookies, and password recovery/reset. The frontend developer owns all screens. Run `npm run dev` from `backend`; the API is at `http://localhost:3001/api/v1` and interactive documentation is at `/docs`.

## URLs and configuration

| Setting | Local value | Purpose |
| --- | --- | --- |
| `AUTH_PUBLIC_ORIGIN` | `http://localhost:3001` | Backend that verifies email links |
| Supabase Redirect URLs entry | `http://localhost:3001/auth/callback` | Allowlisted backend callback |
| `AUTH_FRONTEND_ORIGIN` | `http://localhost:5173` | Current Vite frontend destination after verification |
| `AUTH_FRONTEND_ROUTING` | `hash` | Matches the frontend's HashRouter URLs |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Explicit frontend origins allowed to call the backend |
| `AUTH_COOKIE_SECRET` | Private random value of at least 32 characters | Encrypts browser sessions and pending email flows |

Keep the callback in Supabase pointed to the backend on port 3001. The current frontend runs on port 5173 with HashRouter, so use `AUTH_FRONTEND_ORIGIN=http://localhost:5173` and `AUTH_FRONTEND_ROUTING=hash`. Restart the backend after environment changes. The current checkout has a generated local cookie secret. Keep it stable between restarts; changing it invalidates browser sessions and pending email flows. Production requires this secret explicitly.

In Supabase Authentication, keep the Email provider and **Confirm email** enabled. Preserve the default confirmation and recovery templates' `{{ .ConfirmationURL }}` links: replacing the link with the site root skips verification. Keep existing redirect allowlist entries.

## Frontend screens and requests

| Frontend screen | API behavior |
| --- | --- |
| Signup | `POST /auth/register` with `{name,email,password,role:'student'}`. Show check-email when `requiresEmailConfirmation:true`; otherwise open the student area. |
| Check email | Explain that the link must open in the same browser; offer `POST /auth/resend-confirmation` with `{email}`. |
| Sign in | `POST /auth/login` with `{email,password}`. On success, open the student area. |
| Forgot password | `POST /auth/forgot-password` with `{email}`. Always display the returned generic notice; it does not disclose whether an account exists. |
| `/#/reset-password` | First `GET /auth/recovery-session`; enable the form only when `{valid:true}`. Confirm matching passwords in the UI, then `POST /auth/reset-password` with `{password}`. On success, navigate to sign-in. |
| `/#/auth/error` | Show a safe message for `reason=expired_link`, `invalid_link`, or `missing_flow`; offer resend/reset requests. Never render query parameters as HTML. |
| `/#/profile` | Check `GET /auth/session`; if authenticated, load `/me/onboarding`. |
| Sign out | `POST /auth/logout`, then return to sign-in. |

Paths in the table omit `/api/v1`. New signup and reset passwords are 10–128 characters. Sign-in accepts an existing nonempty password and relies on Supabase to verify it. Use the confirmed USC demo account for rehearsal; the old non-USC demo account is blocked. Website signup creates additional USC students. Organizer onboarding remains separate.

USC email restrictions are active as of November 14, 2026. The backend defaults to `STUDENT_EMAIL_DOMAIN=usc.edu`, the shared restrictive profile policy is applied, and the Before User Created hook rejects direct non-USC signups. Access requires Supabase's provider-owned email confirmation field; editable metadata is not proof. No accounts were deleted. See [USC email access](USC_EMAIL_ACCESS.md). Explicitly blanking the backend setting is only an isolated-test opt-out and does not disable the shared rules.

Every browser API request must use `credentials:'include'`, including signup and recovery requests, because the backend sets the PKCE flow cookie there:

```js
const response = await fetch('http://localhost:3001/api/v1/auth/register', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, email, password, role: 'student' }),
});
const data = await response.json();
if (!response.ok) throw new Error(data.error?.message || 'Please try again.');
// Show check-email if data.requiresEmailConfirmation; otherwise open the student area.
```

The backend alone handles `/auth/callback`. It exchanges the one-time code, checks the pending browser flow and student identity, then redirects to a fixed route on `AUTH_FRONTEND_ORIGIN`. In `hash` mode: signup → `/#/profile?welcome=1`, recovery → `/#/reset-password`, failure → `/#/auth/error?reason=...`. In `history` mode the original destinations remain `/student?welcome=1`, `/reset-password`, and `/auth/error?reason=...`. The frontend does not parse Supabase tokens from URLs. Arbitrary return URLs are not accepted. The pushed frontend still needs the missing auth states and API wiring; see [the integration review](FRONTEND_INTEGRATION.md).

## Email delivery and manual verification

Supabase's built-in sender currently delivers only to project organization team member addresses and allows two emails per hour for the whole project. Configure custom SMTP in Supabase before supporting ordinary student addresses. SMTP credentials belong in Supabase's dashboard, not the frontend. See [Supabase's SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).

With the frontend running and a permitted recipient, test signup → inbox link → student onboarding, then forgot-password → inbox link → reset → sign-in with the new password. Open links in the same browser that requested them. Starting another email flow replaces the pending one; use the most recent email. Expired links, cleared cookies, and links opened in another browser must offer a new request. Email scanners can consume one-time links.

Live checks passed for the USC demo account's sign-in, own onboarding read, draft save/readback, and sign-out. The draft remains incomplete for frontend onboarding. A direct non-USC Supabase signup was rejected by the active hook. Live database verification passed own-profile CRUD, isolation, and denial checks for non-USC, unconfirmed, anonymous, and stale-email-token identities; its fixtures were rolled back.

Automated auth tests mock Supabase and do not send real emails or change live passwords. The demo account was manually auto-confirmed, so those checks do not prove inbox delivery. Actual frontend signup/confirmation and password recovery through a real inbox remain deferred until the frontend is ready.

## Session and deployment behavior

Access/refresh tokens stay in encrypted **HttpOnly**, **SameSite=Lax** cookies, with **Secure** on HTTPS. Use `/auth/session` to check browser identity without returning tokens. The existing JSON bearer-token API contract remains available for non-browser clients; frontend code should avoid storing tokens or passwords in browser storage.

Recovery has a separate 15-minute cookie: an ordinary login cannot authorize the password-reset endpoint. After a successful password change, the backend clears browser cookies and asks Supabase to revoke the recovery session. Supabase remains the password store. Cookie-based writes require a trusted Origin; callback query strings are omitted from normal request logs and auth responses are not cached.

For deployment, set both origins to their actual HTTPS values and add the backend's exact `/auth/callback` URL to Supabase's redirect allowlist. Match `CORS_ORIGINS` to the frontend. Prefer same-origin or same-site hosting; unrelated frontend/API domains require a deliberate cookie design change. Every backend instance must share the same cookie secret. Private resume files still require one backend instance with persistent storage.
