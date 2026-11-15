# OdySC — frontend

React + Vite + TypeScript. White-first USC theme (cardinal `#990000`, gold `#FFCC00`).

## Run it

```bash
cd client
npm install
npm run dev        # http://localhost:5173 (also works in Replit's preview)
```

## How it flows (Common App style)

Features reveal themselves as the student goes deeper. Nothing is dumped on the first screen.

| Tab | What it shows |
|---|---|
| Dashboard `#/` | New user: only "build your profile". After that: what's next (unfinished apps by deadline) and upcoming events for your clubs |
| Profile `#/profile` | Sections with checkmarks + resume autofill. Finishing it **unlocks recommendations**. "Saved answers" appears after your first submission |
| Club Search `#/search` | Search, category filters, "Open to everyone", **+ Add** to your list. "Recommended for you" only after the profile is done |
| Club page `#/search/:slug` | About, facts, add button; events (with hologram map), contacts and questions tucked into expandable rows |
| My Clubs `#/my-clubs/:slug` | Your list on the left; each club in 3 steps: Overview → Questions → Review & submit. Answer reuse appears inside Questions; status timeline + Free Agent appear after submitting |
| Club view `#/org` | Officer side: blind review, AI summary + evidence, prompt-injection flag, rubric, decisions |

Demo helpers: footer **Reset demo** clears everything; after submitting, "Demo · simulate the club's decision" shows Interview / Accepted / Free Agent.

## Plugging in the backend

Everything goes through `src/api.ts`. Set `USE_MOCKS = false` once `server/` serves the
endpoints in `shared/api.md` — no page code changes. Vite proxies `/api` to `localhost:3000`.

## Where things live

- `src/components/Hologram.tsx`: isometric campus map. Add buildings to `BUILDINGS` (grid coords).
- `src/components/ui.tsx`: nav, club monograms (unique pattern per club), cards, toast.
- `src/data/mock.ts`: demo data. Contacts and stats are placeholders.
- `src/util.ts`: `similarity()` is a stand-in for the AI's embedding search; `TODAY` is pinned to Nov 14 for the demo.
