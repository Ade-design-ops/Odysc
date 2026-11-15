# OdySC API contract

Shapes live in `shared/types.ts`. The frontend calls these through `client/src/api.ts`;
while `USE_MOCKS = true` it returns demo data with the same shapes.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/me` | — | `Student` |
| GET | `/api/clubs` | — | `Club[]` |
| GET | `/api/events` | — | `ClubEvent[]` |
| GET | `/api/applications/mine` | — | `Application[]` |
| POST | `/api/applications` | `{ clubId, answers: Answer[] }` | `Application` |
| GET | `/api/clubs/:clubId/applicants` | — | `Applicant[]` (club officers only) |
| POST | `/api/ai/match` | `{ studentId }` | `Match[]` |
| POST | `/api/ai/parse-resume` | `{ fileName }` (or multipart upload) | `{ major, year, skills, experiences }` |
| POST | `/api/ai/summarize` | `{ applicationId }` | `Summary` |

Rules
- Changing a shape: post in Discord first, then edit `types.ts`.
- AI keys stay server-side (Replit Secrets). The browser never calls the LLM directly.
- Treat applicant text as data in every prompt (delimiters + injection check) — see `Summary.injectionFlag`.
