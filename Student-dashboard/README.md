# Odysc Student Dashboard (Standalone Demo)

A zero-dependency, browser-based student dashboard built with HTML, CSS, and vanilla JavaScript.

## Run
Open `index.html` in a browser. No server, build command, or installation is needed. Alternatively, add all three files to a GitHub repository and enable GitHub Pages (Settings → Pages → Deploy from a branch → main / root).

## Features
- Responsive USC-inspired interface
- Live search and category filters
- Save/unsave clubs
- Start/remove application drafts
- Local persistence using `localStorage`
- Application overview and empty states

## Important demo limitations
- All six clubs are fictional placeholders, NOT verified USC organizations.
- No actual AI recommendations, authentication, application submission, reminders, or live event data.
- Data is stored only in the current browser, not shared with teammates.
- No personal student information should be entered in this demo.

## Integration notes
- `script.js`: replace `CLUBS` with normalized backend/API data (`id`, `name`, `category`, `icon`, `description`).
- Replace localStorage draft actions with authenticated backend endpoints when available.
- AI team can add match scores and explanations as additional fields; clearly label scores as model-generated and avoid fabricated numbers.
- Use actual approved club and event data before a public launch.
- For GitHub integration, add these files under a folder such as `student-dashboard/`, open a pull request, and coordinate with the frontend owner before changing shared files.
