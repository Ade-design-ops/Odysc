# Prototype audit — November 15, 2026

The local prototype was checked through its student and NSBE administrator flows, its browser API, and the shared Supabase database. The audit's functional corrections are included with this report.

## Verification results

- **214 automated tests passed**, with no failures or skips.
- Backend TypeScript build and frontend production build passed.
- Club-finder integration: Claude service and HTTP/transport checks cover authenticated student access, server-selected saved PDF/profile/catalog, changed PDFs, strict input, history, timeout/provider failures, directory-ID filtering, rate limits, and the full 5 MiB boundary. Browser checks use an isolated synthetic student/provider fixture for recommendations, follow-ups, retry, empty results, reset during a pending response, and actual club links. The actual shared app was refreshed and checked for the missing-PDF guard and mobile-nav clearance; public endpoints still returned 650 clubs and the existing event. No console errors were captured. No real résumé was sent to Anthropic. The saved Anthropic key was loaded after a backend restart. A live initial recommendation request using a generated PDF and the 650-club catalog returned five verified club IDs in about six seconds. An initial unvalidated response led to adding Anthropic native JSON output alongside existing Zod checks; the captured retry passed. Live follow-up quality and broader model evaluation remain untested.
- Required-PDF follow-up: browser verification shows 80% progress and an upload action when basic details exist without a saved PDF. Automated HTTP checks cover missing/other-student PDFs, valid uploads, failed replacements, completion/matching rejection, and deletion/reupload behavior. No live profile or résumé was changed for this follow-up.
- Directory compatibility follow-up: an added recruitmentTimeline metadata field no longer crashes the older club/settings readers. The public directory returns 650 clubs and the browser dashboard recovers. Known-field validation stays strict; a before/after hash confirmed shared club settings were unchanged, and the 21 live workflow groups passed with rollback.
- Event-editing follow-up verified prefilled fields, cancellation, required-location validation, location-only saves preserving the exact timestamp/duration, and title/type/date/time/duration saves. Supabase readback and the public event API returned the edited details with the same ID and creator. The dedicated test event was removed afterward.
- **21 live shared-workflow groups passed** using actual PostgreSQL store operations. Synthetic users, profiles, memberships, applications, settings, reviews, bookings, and events were rolled back.
- Live USC profile ownership and access-policy verification passed with rolled-back fixtures.
- Administrator promotion checks cover active confirmed-account eligibility, existing-admin authorization, idempotent retries, preserved officer titles, and reviewer/pending/unconfirmed/other-club denials. The confirmation dialog and cancellation were checked in the browser; synthetic permission changes were rolled back.
- Browser walkthroughs checked profile autosave and completion, tags, actual PDF upload, suggestion review/keep/apply, directory search and filters, add/remove club, application overview/questions/review/edit, calendar navigation/agenda/visibility, event selection/removal, map controls, account menus, USC email validation, recovery safeguards, and officer tabs/forms.
- A real `.ics` download was checked for calendar structure, correct UTC event time, escaping, and 75-byte folded lines. Import into third-party calendar applications was not tested.
- No browser console errors were captured during the walkthrough.
- Existing profile values, club list, drafts, calendar selections/preferences, personal events, and PDF state were compared with a private pre-test snapshot and restored. Actual application decisions and club memberships were preserved.
- Existing `styles.css`, AuthScene, HomeBand, and photo assets are unchanged. The new floating finder has its own scoped `club-finder.css`; the combined built CSS is now `index-CRaQ86cY.css`.

Tests do not establish real email delivery or broad AI recommendation quality. The Claude live smoke test verifies provider connectivity and output compatibility with synthetic data. Changes affecting other people's permissions and application outcomes were exercised with rollback-only fixtures rather than altering actual memberships or decisions.

## Current feature inventory

| Feature | Current availability and verification |
| --- | --- |
| USC sign-in/sign-out | Working with confirmed USC accounts, encrypted HttpOnly sessions, and server-side ownership/club permissions. Live browser and API checks passed. |
| Signup and email recovery | Screens, USC validation, confirmation/resend, callback handling, reset-session protections, and backend calls exist. Successful confirmation/reset through an actual inbox remains unverified. The existing demo account was manually confirmed. |
| Student onboarding | Required name, year, major, interests, and a saved private résumé PDF. Skills, goals, bio, experience details, preferred name, pronouns, graduation term, and USC ID remain optional. Progress and matching require server-confirmed PDF metadata; completion cannot be bypassed by posting a filename. |
| PDF upload and suggestions | Actual private PDFs up to 5 MiB/10 pages, text extraction, reviewed suggestions, keep/apply controls, and refreshed matching evidence. No OCR. The current instance has no OpenAI extraction key and uses conservative local extraction; labeled text produces better suggestions. |
| Club directory | 650 shared clubs, search/category/membership filters, club pages, add/remove My Clubs, and truthful empty/unknown fields. Missing deadlines, contacts, and recruitment details are not invented. |
| Recommendations | Profile/resume-based matching is implemented, but currently uses local heuristic rules. General model-powered matching has not been exercised with a configured provider. Scores are relevance indicators, not acceptance probabilities. |
| Club-finder chat | Connected student-only Claude chat reuses saved PDF/profile and actual catalog, supports follow-ups, retry/start-over and real club links. Runs only after explicit action. Requires `ANTHROPIC_API_KEY`; missing configuration is a visible error. Automated/browser checks use synthetic provider responses. A real Claude initial request with synthetic PDF data and the actual 650-club catalog passed; broader evaluation remains pending. |
| Common applications | Draft answers, profile review, submission, immutable snapshots, status tracking, duplicate prevention, deadline/question checks, explicit USC-ID consent, and opt-in saved-answer reuse are implemented. Zero-question submissions are prototype interest records. Club questions/deadlines must be configured separately because the editing screen is missing. |
| Officer review | Approved club membership, applicant selection, blind display, rubric scores/team averages, source-grounded summaries, and administrator decisions work. Final accepted/rejected outcomes are intentional final states; unsupported Undo controls were removed. |
| Team membership | Pending officer requests at initial registration, administrator reviewer invitations/approval/removal, and admin promotion of active confirmed members are implemented. Promotion includes a permission review dialog and preserves the officer title. Invitations are records inside Odysc, not emails. First-admin setup remains an operator task; demotion/ownership transfer is not implemented. |
| Club events | Administrators publish and edit info sessions, mixers, workshops, and coffee chats, including title, type, date/time, duration, building, and room. Edits update the same event ID so calendar selections stay attached. Prefill/cancel/validation, real save/readback, and changed map destinations passed. Cancellation/deletion is not implemented. Existing downloaded ICS files must be downloaded/imported again after changes. |
| Interviews | Administrators offer slots with an existing video-meeting link or in-person location; students book/change/cancel slots. Booking conflicts, ownership, final-decision restrictions, and booking reset on invitation edits are checked. Automatic meeting creation is not connected. |
| Student calendar | Personal events, month/agenda views, event add/remove, calendar visibility/colors, overflow-day agenda, and ICS downloads are implemented. Personal-event storage and preferences were exercised in live rollback checks; browser validation and representative controls were exercised directly. |
| Campus maps | Interactive 2D/3D building maps, re-center controls, and Google/Apple Maps links. The catalog now includes 31 verified University Park buildings shared by the event dropdown and backend. Geometry checks cover all 31 anchors; rendered checks cover the original eight and representative additions, alongside 2D/3D/re-center controls. The SCA anchor was corrected. This is a map view, not AR navigation or a hologram. |
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
3. Odysc-wide officer verification, a trusted officer roster connection if USC provides one, admin demotion/ownership transfer screens, and multi-club officer switching.
4. An existing-student screen for requesting officer access. The backend request endpoint exists; selecting officer during an existing student's repeated signup is not a complete conversion flow.
5. Event cancellation/deletion.
6. Broader Claude recommendation evaluation and a real-student walkthrough. The key is configured locally and an initial synthetic-PDF live request passed. Existing numeric match cards/extraction retain their optional OpenAI/local behavior; applicant summaries remain extractive. See [club-finder setup](CLUB_FINDER.md).
7. Scheduled reminder and invitation/booking notification delivery.
8. Zoom/Teams/Meet OAuth and automatic meeting creation.
9. Resume download/delete controls in Profile, persistent shared file storage for multiple backend instances, and OCR if needed. Own-PDF download/delete backend routes already exist.
10. A public deployment and matching HTTPS authentication redirects. The running URL remains local to this computer.

See [frontend integration](FRONTEND_INTEGRATION.md), [shared workflows](SHARED_WORKFLOWS.md), and [dependency review](DEPENDENCY_REVIEW.md) for setup, contracts, and the separately tracked dependency findings.
