# Integration verification — November 14, 2026

The working copy is the original `Odysc` repository. Changes remain uncommitted and unpushed for team review.

## Completed checks

- Backend test suite: **131 passed**, none failed or skipped. Includes browser transport, authentication, ownership, PDF handling, application permissions, and interview regressions.
- Backend TypeScript build and frontend production build pass.
- The frontend stylesheet and shared AuthScene, HomeBand, and photo assets are unchanged from the teammate's frontend commit. The built CSS asset remains `index-DBY9zGoV.css`.
- Live local HTTP checks passed: anonymous directory/session, confirmed USC login, a single HttpOnly session cookie, application readback, stale-account rejection, missing-actor rejection, unrelated-club denial, and logout.
- Live Supabase verification passed **20 workflow groups** using actual store SQL. All synthetic Auth users, profiles, memberships, settings, applications, reviews, interviews, and events were rolled back. Run `cd backend` then `npm run workflow:verify` to repeat; it briefly locks the selected club during the transaction.
- Browser walkthrough passed: student login, profile completion, search across 650 clubs, save NSBE, submit an application, officer login, read that application, save a review score, create a labeled interview offer, student booking, personal calendar save, and persistence after reload.

The existing demo account has one NSBE test application/interview and a clearly labeled personal calendar test entry from the browser walkthrough. The interview note explicitly says it is an integration test and no real meeting is scheduled. No notification email or external meeting was created.

## Personal review

With both development servers running, open [http://localhost:5173](http://localhost:5173) in your browser. Sign in with your saved USC demo credentials. Choose **Students** to inspect profile, clubs, applications, and calendar; sign out and choose **Club officers** to inspect the approved NSBE dashboard. Do not put the saved password in a shared document.

Review the interface and workflows with teammates before committing or pushing. See [frontend integration](FRONTEND_INTEGRATION.md) for startup and callback configuration.

## External services still to verify

Real inbox confirmation/password-reset delivery and deployed callback URLs need the final frontend host and a real email test. Matching may use the documented heuristic fallback; summaries are grounded in submitted text. Reminder preferences are saved in-app, with no scheduled email delivery. Video meeting creation/OAuth is not configured; use an existing meeting link. PDF storage requires a persistent backend volume and one instance. Dependency findings and upstream backports are recorded in [dependency review](DEPENDENCY_REVIEW.md).
