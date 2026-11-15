# Student onboarding handoff

Build the student experience around **Basics → Interests → Optional details → Finish**. This handoff covers frontend screens and the connected student data contract. Supabase Auth identifies the student, and `student_profiles` centrally stores onboarding/profile data. Its approved table and owner-access policies have been applied. Other account onboarding remains a teammate's scope.

Students can finish with a name, academic year, major, and one interest. A resume, goals, short bio, and skills are optional. Show their benefit without blocking progress or implying that students need prior experience.

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

## 3. Optional details

**Heading:** “Add a little more, if you'd like”

**Supporting copy:** “These details can give club suggestions and applications more context. You don't need a resume or previous club experience to get started.”

| Field | Label | Helper text | Placeholder or suggested input |
| --- | --- | --- | --- |
| Resume | “Résumé (optional)” | “Optional. Add your résumé so your background can help with club matches and future applications. You can add one later.” | “Choose PDF” button; show the filename after upload. |
| `goals` | “What would you like to get out of joining a club? (optional)” | “Optional. Share what you hope to find so we can look for relevant opportunities.” | “Make friends”, “Explore interests”, “Develop career skills”, “Serve the community”, “Try leadership” |
| `bio` | “A little about you (optional)” | “Optional. A few sentences can help introduce you when you apply. No previous club experience needed.” | “I'm interested in design and would love to meet people who enjoy building things.” |
| `skills` | “Skills you would like to share (optional)” | “Optional. Add things you know or enjoy doing, such as coding, writing, organizing, or public speaking.” | “Add a skill” |

Goals and skills are editable lists of strings, not enums. Allow up to 10 goals of 300 characters each and 30 skills of 100 characters each. The bio limit is 1,500 characters. Show the resume limit near the file input: PDF only, up to 5 MiB and 10 pages. Every field on this screen is optional; do not require an entry before advancing.

For a saved resume, offer “View”, “Replace”, and “Remove”. If text could not be extracted, use the backend notice or: **“We couldn't read text from this PDF. You can still finish or add details yourself.”** Scanned PDFs are accepted; the prototype does not perform OCR. An optional upload failure should leave the rest of the form intact and keep “Skip for now” available.

**Primary button:** “Review and finish”

**Secondary action:** “Skip for now”

**Back button:** “Back”

“Skip for now” goes directly to the finish screen using the required fields already entered. On re-entry, preload saved details; skipping must not erase information already saved on the profile. If the UI splits these optional fields into separate screens, each optional screen must offer “Skip for now.”

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
- List limit: “You can add up to 20 interests / 10 goals / 30 skills.” Use the limit for the relevant field.
- Saving: “Saving your profile…” Keep entered values visible.
- Save failure: Display the backend's field or request error and allow retry without losing the form.

Use visible labels, keyboard-operable chips, clear selected states, and text-based error messages associated with each field. Optional fields should say “optional” in their labels. Keep “Skip for now” easy to find.

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

Drafts may have `academicYear:null`, `major:''`, and `interests:[]`. A supplied name must be nonblank. Completion requires a name, selected academic year, nonblank major, and at least one interest. Resume, goals, bio, and skills never block completion. Save changes with `PATCH` before requesting completion. Do not turn missing optional fields into required client validation.

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

Use `missingRequiredFields` to identify completion blockers. `recommendedFields` lists optional context and must not disable finishing or appear as an error. Saving valid basics alone does not mark onboarding complete; the explicit complete request does. If required information is later cleared, the returned state requires those basics again.

`fields` is an array of metadata objects with `{key,label,type,required,helperText}`. Depending on the field, it also supplies `maxLength`, `minItems`, `maxItems`, `maxItemLength`, `suggestions`, `options:[{value,label}]`, or file constraints `accept`, `maxBytes`, and `maxPages`. Use this server metadata for labels, choices, and limits to prevent frontend drift. Append an “optional” indicator when `required:false`; screen headings and button copy can follow this guide.

The backend currently supports this student onboarding flow. Other account onboarding remains the teammate's workstream. PDF upload is private and does not overwrite profile fields, complete onboarding, or submit an application. A resume's extracted text is optional context for matching; unreadable text does not block the student.
