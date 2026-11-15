# Deploy the working website

GitHub stores the source. GitHub Pages cannot run this app's Node backend. The root `Dockerfile` builds React and Fastify together and serves the website, `/api/*`, and `/auth/callback` from one HTTPS origin. Existing local Vite development is unchanged. `backend/Dockerfile` remains the separate API-only image.

## Hosting requirements

Use one Node 24 Docker web service with a persistent disk at `/app/data`. The app stores private PDFs and their metadata under `/app/data/resumes`; Supabase contains the shared profiles and workflows. Do not expose this disk as public static content. The new host starts with no local résumé files: existing students must upload again unless the private directory is securely migrated. Do not copy it into the Docker image or Git.

For Render, persistent disks require paid compute and disk charges. Review the current price before choosing a plan. A free ephemeral service can lose required résumés on restart or deploy and does not meet the current storage requirement. No paid service or disk is provisioned by this repository. See [Render persistent disks](https://render.com/docs/disks).

## Render setup

1. Connect the GitHub repository to **New → Web Service**. Select the `main` branch, Docker runtime, repository root as the build context, and root `Dockerfile`. Leave the Docker start command empty to use the image command. Use one instance and health check `/health`.
2. Select a compute plan and attach a persistent disk mounted at `/app/data` after reviewing the charges. Ensure the running `node` user can write the disk.
3. Add the runtime environment variables below in Render's environment settings. Copy private values through the hosting dashboard, never Git or a frontend `VITE_*` variable. The image supplies the non-secret paths and production defaults.
4. Set the three origin values to the exact assigned HTTPS URL, without a trailing slash. Deploy the service.
5. In Supabase → Authentication → URL Configuration, add `https://YOUR-SERVICE.onrender.com/auth/callback` to Redirect URLs while retaining local/team URLs. Set the Site URL to the deployed website if it should be the project's default destination. Keep email confirmation and the USC signup hook enabled.
6. Open `/health`, then the homepage. Test sign-in, saving profile changes, PDF upload, Claude recommendations, and organizer permissions. Test email confirmation and password reset with an address you own before claiming those delivery flows work publicly.

| Environment variable | Value |
| --- | --- |
| `SUPABASE_URL` | Existing shared project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Existing publishable key |
| `SUPABASE_DB_URL` | Private Session pooler Postgres connection string, including the correctly encoded password |
| `AUTH_COOKIE_SECRET` | A stable newly generated random secret of at least 32 characters; keep it between deploys |
| `ANTHROPIC_API_KEY` | Private Claude key for club-finder chat |
| `AUTH_PUBLIC_ORIGIN` | `https://YOUR-SERVICE.onrender.com` |
| `AUTH_FRONTEND_ORIGIN` | The same HTTPS origin |
| `CORS_ORIGINS` | The same HTTPS origin |
| `STUDENT_EMAIL_DOMAIN` | `usc.edu` |

Optional: `OPENAI_API_KEY` and `OPENAI_MODEL` enable the existing extraction/match enhancement. The Claude finder uses `CLUB_FINDER_MODEL` when set. Do not add operator-only demo passwords or the ElevenLabs key to the hosted app; they are not needed to run the product.

The image includes the **public** Supabase Root 2021 CA at `/app/certs/supabase-root.crt`; database TLS verification remains enabled. Its SHA-256 fingerprint is `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`. A different Supabase project/certificate may require replacing this public CA from its dashboard. See [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).

## Verify the production build locally

From the repository root:

```sh
cd client
npm ci
npm run build
cd ../backend
npm ci
npm run build
FRONTEND_DIST_DIRECTORY=../client/dist npm start
```

The existing backend `.env` supplies local secrets. Open `http://localhost:3001/`; keep authentication origins/CORS consistent with the origin used for that test. `FRONTEND_DIST_DIRECTORY` is optional: without it, `/` retains the API's JSON response. The current HashRouter needs no catch-all HTML fallback; missing `/api` routes remain JSON errors. In production, same-origin hosting preserves HttpOnly `SameSite=Lax; Secure` authentication cookies without exposing tokens to browser storage.

To build the full container from the repository root:

```sh
docker build -t odysc .
```

Provide the variables above through the host's secret store and mount persistent storage when running it. The `.dockerignore` excludes local `.env`, résumé data, recordings, dependencies, and build outputs. The image receives no database password or AI key at build time.

Implementation follows the official [Fastify static plugin](https://github.com/fastify/fastify-static), [Render Docker](https://render.com/docs/docker), and [Render environment configuration](https://render.com/docs/configure-environment-variables) documentation.
