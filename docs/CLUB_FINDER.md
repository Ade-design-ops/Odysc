# Student club-finder chat

The teammate's `club-finder.patch` on `club-searcher-chatbot-dave` supplied the new floating widget and Claude recommendation helper. The connected version uses the existing signed-in student and private PDF instead of a second onboarding questionnaire or temporary file upload.

## Setup

Keep these server-only settings in `backend/.env`:

```dotenv
ANTHROPIC_API_KEY=your-local-key
CLUB_FINDER_MODEL=claude-sonnet-5-5
```

Restart the backend after changing environment variables. Never place the key in client code, `VITE_*` settings, Git, or chat. `OPENAI_API_KEY` configures the older optional extraction/match-card enhancement; it does not configure this Claude chat.

The finder does not call the model just because a page opens. A student explicitly chooses **Find my clubs** or sends a follow-up. Without an Anthropic key, the finder reports `503 AI_NOT_CONFIGURED` with a retry action. It does not substitute fabricated AI answers.

## Student flow

1. Sign in as a confirmed USC student and finish name, major, year, interests, and the required PDF upload in Profile.
2. Open the floating club finder. It shows the saved profile context and résumé filename. Incomplete profiles link back to Profile.
3. Choose **Find my clubs**. Pending profile edits are saved before requesting recommendations.
4. Review up to five catalog clubs, fit labels, and explanations; club names open the actual `/search/:slug` pages.
5. Ask follow-up questions or start a fresh search. Account/PDF/profile changes discard old conversation context and pending answers.

## Browser API

`POST /api/club-finder`

```json
{"resumeId":"expected-current-pdf-uuid","history":[]}
```

Follow-up history is at most 20 alternating `assistant`/`user` turns, starting with the assistant and ending with the student's new message. Each content value is bounded to 2,000 characters. The initial request uses an empty history. `resumeId` is a consistency hint, never an authorization claim.

The shared transport sends the HttpOnly cookie and `X-Odysc-Actor` guard. The backend authenticates the actual USC identity, checks student mode, required profile fields, and the student's own saved PDF. It loads current catalog/settings itself. Client-supplied profiles, files, student IDs, and résumé summaries are rejected.

A successful response is:

```json
{"reply":"Here are clubs to explore.","matches":[{"clubId":"real-directory-id","name":"Server-selected club name","reason":"A connection to your interests and experience.","fit":"strong"}]}
```

Claude is asked for native JSON-schema output; the server then independently validates the response with Zod. Only real directory IDs survive, duplicates are removed, names come from the catalog, and at most five matches return. This validates club identity, not every generated explanation. AI suggestions are informational; they do not submit applications or decide eligibility.

Responses use `Cache-Control: private, no-store`. Missing PDFs return `400 RESUME_REQUIRED`, incomplete basic fields return `400 MISSING_ONBOARDING_FIELDS`, an outdated/replaced PDF returns `409 RESUME_CHANGED`, and nonstudent contexts return `403 STUDENT_ACCESS_REQUIRED`. Standard cookie origin/actor checks apply. Provider configuration, timeout, and malformed/service failures use sanitized 503/504/502 errors. Requests are rate limited like the other browser AI endpoints.

## Data and integration limits

For each explicit search or follow-up, the backend sends the student's **saved PDF bytes**, major, interests, skills, chat history, and club catalog to Anthropic. The PDF can contain contact details even though separate account email/name/USC-ID fields are not added to the prompt. The widget explains this before the first search. There is no browser PDF/base64 upload, localStorage transcript, client-controlled résumé summary, or cross-student file lookup. Chat state stays in memory and clears on account changes.

PDF storage and extraction remain in the existing private backend directory. The chat does not change uploaded files or silently apply profile suggestions. Existing numeric recommendation cards continue through `/api/ai/match`; the new conversation uses qualitative fit labels instead of inventing numeric confidence scores.

Automated tests mock Anthropic with synthetic PDF data. On November 15, 2026, the configured local Anthropic key passed an initial live request using a generated PDF and the actual 650-club catalog: five verified club matches returned in about six seconds. Follow-up transport and UI behavior are covered with mocks; broader live recommendation quality remains to be evaluated. No real student résumé was used for the smoke test.
