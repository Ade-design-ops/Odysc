# Prototype audit — November 15, 2026

The local prototype was checked through its student and NSBE administrator flows, its browser API, and the shared Supabase database. The audit's functional corrections are included with this report.

## Verification results

- **147 automated tests passed**, with no failures or skips.
- Backend TypeScript build and frontend production build passed.
- **20 live shared-workflow groups passed** using actual PostgreSQL store operations. Synthetic users, profiles, memberships, applications, settings, reviews, bookings, and events were rolled back.
- Live USC profile ownership and access-policy verification passed with rolled-back fixtures.
- Browser walkthroughs checked profile autosave and completion, tags, actual PDF upload, suggestion review/keep/apply, directory search and filters, add/remove club, application overview/questions/review/edit, calendar navigation/agenda/visibility, event selection/removal, map controls, account menus, USC email validation, recovery safeguards, and officer tabs/forms.
- A real `.ics` download was checked for calendar structure, correct UTC event time, escaping, and 75-byte folded lines. Import into third-party calendar applications was not tested.
- No browser console errors were captured during the walkthrough.
- Existing profile values, club list, drafts, calendar selections/preferences, personal events, and PDF state were compared with a private pre-test snapshot and restored. Actual application decisions and club memberships were preserved.
- No stylesheet, AuthScene, HomeBand, or photo asset changed. The built CSS remains `index-DBY9zGoV.css`.

Tests do not establish real email delivery or external provider integration. Changes affecting other people's permissions and application outcomes were exercised with rollback-only fixtures rather than altering actual memberships or decisions.

## Current feature inventory

| Feature | Current availability and verification |
| --- | --- |
| USC sign-in/sign-out | Working with confirmed USC accounts, encrypted HttpOnly sessions, and server-side ownership/club permissions. Live browser and API checks passed. |
| Signup and email recovery | Screens, USC validation, confirmation/resend, callback handling, reset-session protections, and backend calls exist. Successful confirmation/reset through an actual inbox remains unverified. The existing demo account was manually confirmed. |
| Student onboarding | Required name, year, major, and interests; optional skills, goals, bio, experience, preferred name, pronouns, graduation term, USC ID, and PDF. Draft saves and explicit completion work. |
| PDF upload and suggestions | Actual private PDFs up to 5 MiB/10 pages, text extraction, reviewed suggestions, keep/apply controls, and refreshed matching evidence. No OCR. The current instance has no AI provider key and uses conservative local extraction; labeled text produces better suggestions. |
| Club directory | 650 shared clubs, search/category/membership filters, club pages, add/remove My Clubs, and truthful empty/unknown fields. Missing deadlines, contacts, and recruitment details are not invented. |
| Recommendations | Profile/resume-based matching is implemented, but currently uses local heuristic rules. General model-powered matching has not been exercised with a configured provider. Scores are relevance indicators, not acceptance probabilities. |
| Common applications | Draft answers, profile review, submission, immutable snapshots, status tracking, duplicate prevention, deadline/question checks, explicit USC-ID consent, and opt-in saved-answer reuse are implemented. Zero-question submissions are prototype interest records. Club questions/deadlines must be configured separately because the editing screen is missing. |
| Officer review | Approved club membership, applicant selection, blind display, rubric scores/team averages, source-grounded summaries, and administrator decisions work. Final accepted/rejected outcomes are intentional final states; unsupported Undo controls were removed. |
| Team membership | Pending officer requests at initial registration, administrator reviewer invitations/approval/removal, and permission restrictions are implemented. Invitations are records inside Odysc, not emails. First-admin setup remains an operator task. |
| Club events | Administrators publish info sessions, mixers, workshops, and coffee chats with time/building/room; students view them and add them to calendars. Publishing was verified end-to-end in the previous event walkthrough; current API/database/form checks pass. No event edit/delete screen or endpoint exists yet. |
| Interviews | Administrators offer slots with an existing video-meeting link or in-person location; students book/change/cancel slots. Booking conflicts, ownership, final-decision restrictions, and booking reset on invitation edits are checked. Automatic meeting creation is not connected. |
| Student calendar | Personal events, month/agenda views, event add/remove, calendar visibility/colors, overflow-day agenda, and ICS downloads are implemented. Personal-event storage and preferences were exercised in live rollback checks; browser validation and representative controls were exercised directly. |
| Campus maps | Interactive 2D/3D building maps, re-center controls, and Google/Apple Maps links. Online 2D/3D/re-center controls passed. This is a map view, not AR navigation or a hologram. |
| Deadline reminders | A preference can be saved when a deadline exists. Automatic email, push, and SMS delivery are not implemented. Exported calendar files contain calendar alarms. |

## Corrections made during this audit

- Removed impossible final-decision Undo actions and stale interview controls; exposed the canonical applicant status and refreshed applicant lists.
- Hid identity-bearing summaries/evidence during blind review, and corrected misleading applicant-count wording.
- Fixed zero-question progress values, stale upcoming events, inaccurate empty states, and year labels.
- Added pending/duplicate-submit protection and preserved form input on failures; required the reviewer name expected by the API.
- Made logout failures leave cookie/UI state consistent and rejected old private responses after an account change.
- Refreshed public club/event data during polling and refreshed match evidence after PDF uploads.
- Aligned date-only deadlines with the USC/Pacific campus day, including daylight saving time; timestamp deadlines retain exact expiry.
- Corrected PDF retry/basic-extraction feedback and reminder wording.
- Fixed calendar overflow/date/grid issues, safe ICS text/folding, and map actions before loading.
- Fixed the HashRouter skip link and labeled the mobile account menu, including Escape behavior.

## Features still needed

1. Verified email delivery setup and a real signup-confirmation/password-reset inbox walkthrough.
2. A club application/page editor for questions, deadlines, contacts, and other recruitment information. Backend settings support exists; current Settings exposes only USC-ID requests and provider placeholders.
3. Odysc-wide officer verification, a trusted officer roster connection if USC provides one, admin promotion/transfer screens, and multi-club officer switching.
4. An existing-student screen for requesting officer access. The backend request endpoint exists; selecting officer during an existing student's repeated signup is not a complete conversion flow.
5. Event editing/cancellation/deletion.
6. A configured AI provider or the AI teammate's production service, with live model evaluation. Current local extraction/matching and extractive summaries are prototype behavior.
7. Scheduled reminder and invitation/booking notification delivery.
8. Zoom/Teams/Meet OAuth and automatic meeting creation.
9. Resume download/delete controls in Profile, persistent shared file storage for multiple backend instances, and OCR if needed. Own-PDF download/delete backend routes already exist.
10. A public deployment and matching HTTPS authentication redirects. The running URL remains local to this computer.

See [frontend integration](FRONTEND_INTEGRATION.md), [shared workflows](SHARED_WORKFLOWS.md), and [dependency review](DEPENDENCY_REVIEW.md) for setup, contracts, and the separately tracked dependency findings.
