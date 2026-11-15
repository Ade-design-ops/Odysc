# Student onboarding handoff

Build the student experience around **Basics → Interests → Résumé and optional details → Finish**. This handoff covers frontend screens and the connected student data contract. Supabase Auth identifies the student, and `student_profiles` centrally stores onboarding/profile data. Its approved table and owner-access policies have been applied. Other account onboarding remains a teammate's scope.

Students finish with a name, academic year, major, one interest, and a successfully uploaded résumé PDF. Goals, short bio, skills, and experience details remain optional. The saved PDF provides background for club recommendations; no prior club experience is required.

The backend now supports student signup, sign-in, confirmation/resend, and password recovery. The frontend teammate owns the screens and connects them to these APIs. See [the account integration guide](AUTHENTICATION.md) for endpoint contracts, frontend routes, and Supabase redirect and delivery requirements.

## 1. Basics

**Heading:** “Let's start with you”

**Supporting copy:** “A few details help us suggest clubs you may want to explore.”

| Field | Required | Label | Helper text | Placeholder |
| --- | --- | --- | --- | --- |
| `name` | Yes | Full name | “Use the name you would like clubs to see on your applications.” | “Jordan Lee” |
| `academicYear` | Yes | Year of study | “Tell us where you are in your studies.” | “Select your year” |
| `major` | Yes | Major | “Undeclared is welcome. You can update this later.” | “Computer Science, Business, Undeclared…” |

Preload the account's name when available. Keep major as free text so students do not need an exact directory label.

Use these academic year labels and values:

| Label | Value |
| --- | --- |
| First year | `first_year` |
| Second year | `second_year` |
| Third year | `third_year` |
| Fourth year | `fourth_year` |
| Fifth year or beyond | `fifth_year_plus` |
| Graduate student | `graduate` |
| Other | `other` |

**Primary button:** “Continue”

## 2. Interests

**Heading:** “What are you interested in?”

**Supporting copy:** “Pick at least one. You can explore something familiar or try something new.”

**Label:** “What are you interested in?”

**Helper:** “Choose at least one interest to help us find clubs to explore. Still figuring it out? Choose Still exploring.”

**Custom entry placeholder:** “Add an interest”

Use selectable chips and allow custom entries, up to 20 interests of 100 characters each. The backend suggests Technology, Design, Music, Community service, Sports, Entrepreneurship, and Still exploring. These are suggestions, not a fixed enum. Do not ask students to rate their experience.

**Primary button:** “Continue”

**Secondary button:** “Back”

## 3. Résumé and optional details

**Heading:** “Your résumé and background”

**Supporting copy:** “Upload your résumé PDF to help us suggest clubs. You can optionally add goals, a bio, and skills.”

| Field | Label | Helper text | Placeholder or suggested input |
| --- | --- | --- | --- |
| Resume | “Résumé (required)” | “Upload a PDF before finishing onboarding and receiving club recommendations.” | “Upload PDF” button; show the server-confirmed saved filename after upload. |
| `goals` | “What would you like to get out of joining a club? (optional)” | “Optional. Share what you hope to find so we can look for relevant opportunities.” | “Make friends”, “Explore interests”, “Develop career skills”, “Serve the community”, “Try leadership” |
| `bio` | “A little about you (optional)” | “Optional. A few sentences can help introduce you when you apply. No previous club experience needed.” | “I'm interested in design and would love to meet people who enjoy building things.” |
| `skills` | “Skills you would like to share (optional)” | “Optional. Add things you know or enjoy doing, such as coding, writing, organizing, or public speaking.” | “Add a skill” |

Goals and skills are editable lists of strings, not enums. Allow up to 10 goals of 300 characters each and 30 skills of 100 characters each. The bio limit is 1,500 characters. Show the resume limit near the file input: PDF only, up to 5 MiB and 10 pages. The PDF is required before finishing. Goals, bio, skills, and experience details are optional and do not block completion.

For a saved resume, offer “View”, “Replace”, and “Remove”. If text could not be extracted, use the backend notice or: **“We couldn't read text from this PDF. You can still finish or add details yourself.”** Scanned PDFs are accepted; the prototype does not perform OCR. A failed upload leaves entered profile details intact and does not satisfy the PDF requirement. A failed replacement retains the previous valid PDF. AI suggestion failure after a durable upload can be recovered through the résumé status endpoint; students can keep their manually entered details.

**Primary button:** “Review and finish”

**Secondary action:** “Skip optional details” (available once the PDF is saved)

**Back button:** “Back”

“Skip optional details” goes to the finish screen only after the required PDF and basics are saved. Preload the saved résumé status on re-entry; skipping optional text must not erase existing profile data or the PDF.

## 4. Finish

**Heading:** “Ready to explore?”

**Supporting copy:** “Check your details, then start discovering clubs.”

Show a short review of the required fields with an “Edit” action. Show optional information only when provided; avoid a list of missing fields or a completion score. All profile details remain editable later.

**Primary button:** “Save and explore clubs”

**Back button:** “Back”

After a successful save: **“Your profile is saved. Start exploring clubs.”** A quiet note can say: “You can add or update details in your profile anytime.” Navigate only after the backend confirms success.

## Validation and states

- Name missing: “Add the name you'd like to use.”
- Academic year missing: “Choose your year at USC.”
- Major missing: “Add your major or enter Undeclared.”
- No interests: “Choose or add at least one interest.”
- No saved résumé: “Upload your résumé as a PDF before finishing onboarding.”
- List limit: “You can add up to 20 interests / 10 goals / 30 skills.” Use the limit for the relevant field.
- Saving: “Saving your profile…” Keep entered values visible.
- Save failure: Display the backend's field or request error and allow retry without losing the form.

Use visible labels, keyboard-operable chips, clear selected states, and text-based error messages associated with each field. Optional fields should say “optional” in their labels. Only optional text fields may be skipped; the PDF requirement remains visible.

## Backend contract

All routes below require an authenticated student and use `/api/v1` as the prefix. Browser clients can use encrypted HttpOnly session cookies and `credentials:'include'`; API clients can still supply the student's Supabase access token as a bearer token. `name` maps to the shared profile's `full_name`; academic year maps to `academic_year`. The API retains its camelCase fields and reusable profile shape.

Connect the frontend signup screen to `POST /auth/register`. Keep global email confirmation enabled; when registration returns `accessToken:null` and `requiresEmailConfirmation:true`, show a check-email state before protected onboarding. Confirmation and recovery links must open in the same browser that requested them because PKCE uses a pending-flow cookie. The current HashRouter frontend receives successful confirmation at `/#/profile` and verified recovery at `/#/reset-password`; configure `AUTH_FRONTEND_ORIGIN=http://localhost:5173` and `AUTH_FRONTEND_ROUTING=hash` locally. The manually created demo account remains usable; SQLite fixture accounts are separate. Live profile save/readback passed against the shared project. Actual inbox delivery remains unverified.

| Method and path | Purpose |
| --- | --- |
| `GET /me/onboarding` | Load `{user,profile,resume,onboarding,fields}` for the form. |
| `PATCH /me/onboarding` | Save a partial draft containing any of `name`, `academicYear`, `major`, `interests`, `goals`, `bio`, or `skills`; returns the same envelope. |
| `POST /me/onboarding/complete` | Send `{}` to finish after required fields are saved; returns the same envelope. |
| `POST /me/resume` | Upload or replace a PDF using multipart field `resume`; maximum 5 MiB and 10 pages; `201 {resume,notice}`. |
| `GET /me/resume` | Download this student's private PDF; returns file content, not JSON. |
| `DELETE /me/resume` | Remove the resume; `204`, no response body. |

Drafts may have `academicYear:null`, `major:''`, and `interests:[]`. A supplied name must be nonblank. Completion requires a name, selected academic year, nonblank major, at least one interest, and a saved private résumé PDF. Goals, bio, skills, and experience details never block completion. Save changes with `PATCH` before requesting completion. Do not turn missing optional fields into required client validation.

`resume` in the onboarding envelope is `null` or private metadata:

```ts
type ResumeMetadata = {
  id: string;
  fileName: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
  pageCount: number;
  textStatus: 'available' | 'unavailable';
  uploadedAt: string;
};
```

Upload separately from the JSON draft request. Let the browser set the multipart boundary:

```ts
const form = new FormData();
form.append('resume', selectedFile);
const response = await fetch(`${API_BASE}/me/resume`, {
  method: 'POST',
  credentials: 'include',
  body: form,
});
```

Do not set `Content-Type` manually for this request. Use the same cookie credentials for “View”, or attach the bearer header if using the token API. Revoke temporary browser object URLs when finished displaying the PDF. Browser mutations must come from an allowed origin; keep frontend and backend on the same site for cookie authentication. Shared runtime stores private PDFs and metadata in the backend's `data/resumes` filesystem directory; it does not use SQLite or Supabase Storage for files. Use a persistent backend volume and one instance until private shared Storage is integrated. Student profile data is already centralized in Supabase.

The `onboarding` value is:

```ts
type OnboardingState = {
  status: 'not_started' | 'in_progress' | 'completed';
  completedAt: string | null;
  missingRequiredFields: string[];
  recommendedFields: string[];
};
```

Use `missingRequiredFields` to identify completion blockers. `recommendedFields` lists optional context and must not disable finishing or appear as an error. Saving valid basics alone does not mark onboarding complete; the explicit complete request does. If required information is cleared or the résumé is deleted, onboarding becomes incomplete again. Existing profiles without a saved PDF are incomplete without resetting their entered data.

`fields` is an array of metadata objects with `{key,label,type,required,helperText}`. Depending on the field, it also supplies `maxLength`, `minItems`, `maxItems`, `maxItemLength`, `suggestions`, `options:[{value,label}]`, or file constraints `accept`, `maxBytes`, and `maxPages`. Use this server metadata for labels, choices, and limits to prevent frontend drift. Append an “optional” indicator when `required:false`; screen headings and button copy can follow this guide.

The backend currently supports this student onboarding flow. Other account onboarding remains the teammate's workstream. PDF upload is private and does not overwrite profile fields, complete onboarding, or submit an application. The PDF is required for onboarding and recommendations. Extracted text is included when readable; scanned PDFs are accepted without OCR and students can enter profile details manually.

## Connected browser state

The React app uses the `/api/*` contract in [shared/api.md](../shared/api.md). Authenticated session responses include the current student’s private `resume: ResumeInfo|null`; `GET /api/me/resume/status` refreshes that status without returning the file. `POST /api/ai/parse-resume` returns the saved metadata after a valid multipart upload. Profile progress includes the PDF as the fifth required item. A selected filename is never treated as a saved upload, and `POST /api/me/complete` rejects a missing own PDF with `400 RESUME_REQUIRED`. Résumé metadata does not become an editable profile field or an applicant-visible attachment.

The connected [club-finder chat](CLUB_FINDER.md) reuses this required saved PDF and profile. It sends the saved PDF plus major, interests, skills, and conversation to Claude on an explicit student search/follow-up; it does not ask for another upload or overwrite onboarding fields. Server-only Anthropic configuration is separate from the optional OpenAI parsing/match-card enhancement.
