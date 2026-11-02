# Deployment

## Render backend

Create a Render Web Service from this repository. The included `render.yaml` uses
`geomatrix_v2` as the service root and starts FastAPI with the Render-provided
`PORT`.

Set these Render environment variables:

- `DATABASE_URL`: Render PostgreSQL connection string.
- `FRONTEND_URL`: deployed Vercel URL, for example `https://geomatrix.vercel.app`.
- `CORS_ORIGINS`: comma-separated allowed browser origins. Include the Vercel URL
  and any custom domain.
- `GEMINI_API_KEY`: only if Gemini explanations are enabled.

Verify `https://<render-service>.onrender.com/health` returns
`{"status":"ok"}` before configuring Vercel.

## Vercel frontend

Import the repository as a Next.js project. The included `vercel.json` uses
`npm ci` and `npm run build`.

Set these Vercel environment variables for Production, Preview, and Development
as appropriate:

- `MODEL_API_URL`: public Render API URL, without a trailing slash.
- `NEXT_PUBLIC_API_URL`: same public Render API URL. The browser API client uses
  this value so Vercel requests reach FastAPI instead of local/demo Next.js
  routes.
- `NEXT_PUBLIC_APP_URL`: deployed Vercel URL.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: Google OAuth client ID, if Google login is used.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: server-side Google OAuth values,
  if configured.
- `GEMINI_API_KEY`: only if the Vercel-side explanation route is enabled.

After deployment, test `/login`, `/projects`, `/data`, `/model`, and
`/api/model/status`. Never commit `.env.local` or production credentials.


## Authentication and real-data upgrade

Deploy the backend before the frontend. The backend creates an `auth_sessions`
table at startup; existing database users need permission to create it. Sessions
are random opaque tokens stored as SHA-256 digests, expire after eight hours,
and are deleted on logout. No shared signing secret is required.

1. Set `GOOGLE_CLIENT_ID` on Render to the same value as
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on Vercel. Register the Vercel application origin
   in Google Identity Services. Password/demo login remains disabled.
2. Set `MODEL_API_URL` on Vercel to the Render backend URL, and
   `NEXT_PUBLIC_APP_URL` to the exact browser application origin. Browser requests
   use same-origin `/api` endpoints so the HttpOnly, Secure production cookie is
   never sent to a third-party API origin. `NEXT_PUBLIC_API_URL` is supported as
   a server configuration fallback only.
3. Restrict access to project officers by setting comma-separated
   `AUTH_ALLOWED_EMAILS` on Render. If left empty, any verified Google account
   may sign in. All signed-in users share the existing project workspace.
4. Keep the production PostgreSQL `DATABASE_URL` on Render. A local SQLite
   database is for development, not durable Render production storage.
5. Re-import original historical source files, then retrain. Historical rows
   created before this upgrade are version 1 and excluded because missing
   approval flags may have been derived from their labels. Re-importing the same
   source record ID replaces a legacy row with a corrected version 2 row.
   TEST/SYNTHETIC classifications remain excluded. Older model artifacts are
   invalidated; predictions remain unavailable until a new model is trained.

Every domain endpoint now requires `Authorization: Bearer <session>` at the
backend. The Next.js proxy supplies it from the server-only cookie. Direct API
clients can obtain a session via `POST /api/auth/google` with a valid Google ID
token and must protect the returned bearer token. `/health` remains public.

Next.js no longer uses demo arrays or in-memory uploads as a successful fallback.
Backend failures return an error; CRUD, ingestion, and alert acknowledgments use
persistent database operations. CSV and JSON are the backend's supported dataset
formats. Gemini explanations require `GEMINI_API_KEY` on Render.

### Regression verification

```sh
npm ci
npm run typecheck
npm run test:api
npm run build
python -m pip install -r geomatrix_v2/requirements-dev.txt
pytest -q
```

The API tests cover authentication, CSRF origin checks, proxy responses, uploads,
Gemini forwarding, and logout. Python tests use isolated temporary databases and
model directories; Google certificates and credentials are generated locally for
tests, without contacting Google. GitHub Actions runs the complete checks.
