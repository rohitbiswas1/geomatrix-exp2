# GEOMATRIX

### AI-Powered Land Acquisition Intelligence for Government Infrastructure

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Google Maps](https://img.shields.io/badge/Google%20Maps-GIS-4285F4?logo=googlemaps&logoColor=white)](https://developers.google.com/maps)
[![Gemini](https://img.shields.io/badge/Google%20Gemini-AI-8E75B2)](https://ai.google.dev/)

> **GEOMATRIX** is a GIS-enabled, AI-assisted decision-support platform for monitoring land acquisition, identifying project risks, predicting delays, and helping infrastructure teams intervene earlier.

---

## Live Demo

🚀 **Live Application:** https://geomatrix-exp2.vercel.app/login

Open the deployed GEOMATRIX application to explore the Command Center, project management, GIS risk map, analytics, alerts, reports, data management, and model intelligence features.

> **Note:** Some features depend on the production API, database, model services, and configured Google/Gemini credentials.

---

## Overview

Land acquisition is a critical dependency for large infrastructure programs. Delays can arise from objections, compensation, legal cases, rehabilitation and resettlement, incomplete documentation, and pending clearances.

GEOMATRIX brings these signals into a single platform so users can:

- Register and manage infrastructure projects.
- Track land acquisition stages and supporting information.
- Visualize projects geographically on an interactive risk map.
- Monitor critical, high, medium, and low risk categories.
- Validate project records before prediction.
- Run ML-based risk and delay analysis.
- Generate explainable risk factors and recommendations.
- Ingest project data from CSV files.
- Monitor alerts, model status, and operational health.
- Use Gemini-powered explanations where enabled.

The application is built as a **Next.js web application backed by FastAPI, PostgreSQL, and a Python ML pipeline**.

---

## Key Capabilities

### Command Center

The command center provides a portfolio-level operational view, including:

- Total project count
- Completion indicators
- At-risk projects
- Open interventions
- Risk distribution
- Acquisition pipeline stages
- Recent projects
- AI insights
- Platform health

Dashboard data is intended to come from the live API/database rather than hard-coded presentation values.

### Project Management

Projects can store information including:

- Project code and name
- State and district
- Authority
- Project type
- Description
- Current acquisition stage
- Land required and acquired
- Affected families
- Compensation status
- Objection count
- Legal case count
- R&R status
- Environmental clearance
- Forest clearance
- CRZ status
- Documentation completeness

Projects can also be validated and sent through the prediction workflow.

### GIS Risk Map

GEOMATRIX includes an interactive GIS experience for spatial project oversight.

The map layer supports:

- Project locations
- Risk-level visualization
- State and risk filters
- Project search
- GeoJSON-backed map data
- Google Maps JavaScript API integration

### AI / ML Risk Intelligence

The Python backend contains modules for:

- Feature preparation
- Model training
- Prediction
- Evaluation
- Feature-level explanations

The intended workflow is:

```text
Project Data
    ↓
Validation & Feature Preparation
    ↓
ML Model
    ↓
Risk Score / Risk Level
    ↓
Delay Probability
    ↓
Explanation & Recommendations
    ↓
Early Intervention
```

### Alerts & Decision Support

The platform provides project alerts and summary information so teams can focus attention on records requiring intervention.

### Data Ingestion

Project information can be uploaded through CSV ingestion endpoints. The backend tracks ingestion results, saved/skipped records, errors, and processing status.

### Model Intelligence

The model section exposes training-data information, model status, training operations, and model-run information.

### Gemini Explanations

Where configured, GEOMATRIX can use Google Gemini through the application’s AI explanation flow to turn structured project/prediction information into a human-readable explanation.

---

## Architecture

```text
                         ┌──────────────────────────┐
                         │       GEOMATRIX UI       │
                         │  Next.js + React + TS    │
                         └────────────┬─────────────┘
                                      │
                              REST / HTTP APIs
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
          ┌─────────▼─────────┐              ┌─────────▼─────────┐
          │  Next.js API / UI │              │   FastAPI Backend │
          │  Route Handlers   │              │     Python API    │
          └─────────┬─────────┘              └─────────┬─────────┘
                    │                                   │
                    │                         ┌─────────┼─────────┐
                    │                         │         │         │
                    │                    PostgreSQL   ML      Gemini
                    │                         │         │         │
                    └─────────────────────────┴─────────┴─────────┘
                                      │
                               GIS / GeoJSON
                                      │
                                Google Maps
```

### Application layers

**Frontend**
- Next.js
- React
- TypeScript
- Recharts
- Lucide icons
- Global responsive styling
- Google Maps integration

**Backend**
- FastAPI
- SQLAlchemy/Pydantic-based Python services
- REST endpoints for projects, alerts, map data, ingestion, authentication, and ML

**Data & ML**
- PostgreSQL for persistent project/application data
- Python ML modules for feature engineering, training, prediction, evaluation, and explanation
- Prisma schema for the Node-side data model

**Deployment**
- Vercel for the Next.js application
- Render for the FastAPI service
- PostgreSQL as the production database

---

## Main Routes

### Frontend

| Route | Purpose |
| --- | --- |
| `/login` | Authentication entry |
| `/dashboard` | Command Center |
| `/projects` | Project register and filtering |
| `/projects/[id]` | Project details and risk information |
| `/map` | GIS risk map |
| `/alerts` | Alerts and acknowledgement workflow |
| `/analytics` | Project and risk analytics |
| `/reports` | Report generation and export |
| `/data` | Data management and upload workflow |
| `/model` | Model intelligence and training |

### FastAPI

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Service health |
| `GET /api/projects` | List projects |
| `POST /api/projects` | Create a project |
| `GET /api/projects/{project_id}` | Read a project |
| `PATCH /api/projects/{project_id}` | Update a project |
| `GET /api/projects/dashboard-summary` | Dashboard metrics |
| `GET /api/projects/{project_id}/validate` | Validate project |
| `POST /api/projects/{project_id}/predict-risk` | Run risk prediction |
| `GET /api/projects/{project_id}/explain` | Get prediction explanation |
| `GET /api/alerts` | List alerts |
| `GET /api/alerts/summary` | Alert summary |
| `GET /api/map/geojson` | Map GeoJSON |
| `GET /api/map/summary` | Map summary |
| `GET /api/model/status` | Model status |
| `GET /api/model/training-data` | Training data summary |
| `POST /api/model/train` | Train model |
| `POST /api/ingest/upload` | Upload/import CSV data |
| `GET /api/ingest/log` | Ingestion history |
| `POST /api/gemini/explain` | AI explanation |

For the complete route inventory, see [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md).

---

## Repository Structure

```text
geomatrix-exp2/
├── app/                         # Next.js pages and API route handlers
│   ├── dashboard/               # Command Center
│   ├── projects/                # Project register and project details
│   ├── map/                     # GIS experience
│   ├── alerts/                  # Alerts
│   ├── analytics/               # Analytics
│   ├── reports/                 # Reporting
│   ├── data/                    # Data management
│   ├── model/                   # Model intelligence
│   └── api/                     # Next.js API routes
│
├── components/                  # Shared React components
├── lib/                         # API client and utility modules
│
├── geomatrix_v2/                # FastAPI + ML backend
│   ├── routers/                 # API routers
│   ├── ml/                      # ML feature/train/predict/explain code
│   ├── tests/                   # Python tests
│   ├── sample_data/             # Sample datasets
│   ├── model_artifacts/         # Model metadata/artifacts
│   └── main.py                  # FastAPI application
│
├── api/                         # Deployment entrypoint
├── prisma/                      # Prisma schema
├── public/                      # Static frontend assets
├── .env.example                 # Environment variable template
├── vercel.json                  # Vercel configuration
├── render.yaml                  # Render configuration
├── DEPLOYMENT.md                # Deployment notes
├── PROJECT_STRUCTURE.md         # Detailed project map
└── package.json                 # Node scripts and dependencies
```

---

## Getting Started

### Prerequisites

Install:

- Node.js 20+ recommended
- npm
- Python 3.12.x recommended for the current Render environment
- PostgreSQL for production/local database usage
- A Google Cloud project for Maps and optional OAuth
- Google Gemini credentials if AI explanations are enabled

### 1. Clone the repository

```bash
git clone https://github.com/rohitbiswas1/geomatrix-exp2.git
cd geomatrix-exp2
```

### 2. Install frontend dependencies

```bash
npm install
```

### 3. Configure environment variables

Start from:

```bash
cp .env.example .env.local
```

Configure the values required for your environment.

For a deployed architecture, the important API settings are:

```env
NEXT_PUBLIC_API_URL=https://<your-render-service>.onrender.com
MODEL_API_URL=https://<your-render-service>.onrender.com
NEXT_PUBLIC_APP_URL=https://<your-vercel-app>.vercel.app
```

For the Render service, configure:

```env
DATABASE_URL=<postgres-connection-string>
FRONTEND_URL=https://<your-vercel-app>.vercel.app
CORS_ORIGINS=https://<your-vercel-app>.vercel.app
```

Never commit production credentials or `.env.local`.

### 4. Run the Next.js application

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### 5. Run the FastAPI backend

Install Python dependencies:

```bash
pip install -r geomatrix_v2/requirements.txt
```

Then run FastAPI from a suitable Python environment/configuration for the repository. The health endpoint is:

```text
GET /health
```

### 6. Run tests

```bash
pytest
```

### 7. Validate a production build

```bash
npm run lint
npm run build
npm start
```

---

## Environment Variables

The project includes an [.env.example](.env.example) template.

Common variables include:

| Variable | Used for |
| --- | --- |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser Google Maps integration |
| `GOOGLE_MAPS_API_KEY` | Server-side Maps usage where applicable |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Browser Google OAuth client ID |
| `GOOGLE_CLIENT_ID` | Server-side OAuth |
| `GOOGLE_CLIENT_SECRET` | Server-side OAuth secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback |
| `GEMINI_API_KEY` | Gemini API |
| `DATABASE_URL` | PostgreSQL connection |
| `NEXTAUTH_SECRET` | NextAuth/session secret where configured |
| `AUTH_SECRET` | Application authentication secret |
| `NEXT_PUBLIC_APP_URL` | Public application URL |
| `MODEL_API_URL` | Backend/model API URL |
| `NEXT_PUBLIC_API_URL` | Browser API base URL |
| `FRONTEND_URL` | Backend frontend origin |
| `CORS_ORIGINS` | Backend CORS allowlist |
| `DEMO_MODE` | Backend demo-mode control |
| `NEXT_PUBLIC_DEMO_MODE` | Frontend demo-mode control |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | Google authentication toggle |

**Security:** never place private keys, OAuth secrets, database passwords, or production credentials in source control.

---

## Data and Prediction Workflow

A typical project lifecycle is:

```text
1. Register Project
       ↓
2. Validate Required Data
       ↓
3. Track Acquisition Stage
       ↓
4. Ingest / Update Project Data
       ↓
5. Generate Features
       ↓
6. Run ML Risk Prediction
       ↓
7. Produce Explanation
       ↓
8. Generate Recommendations
       ↓
9. Create / Review Alerts
       ↓
10. Monitor on Command Center + GIS Map
```

The system is designed to keep model outputs distinguishable from unverified or unavailable information. A missing prediction, untrained model, or incomplete dataset should not be represented as a fabricated result.

---

## API Example

### Dashboard summary

Request:

```http
GET /api/projects/dashboard-summary
```

Example response shape:

```json
{
  "total_projects": 10,
  "critical_count": 0,
  "high_count": 0,
  "medium_count": 0,
  "low_count": 0,
  "total_land_ha": 0,
  "total_families": 0,
  "avg_risk_score": 0,
  "alerts_open": 0,
  "data_available": true,
  "message": "10 projects loaded from database."
}
```

The exact values depend on the connected database and current records.

---

## Testing Strategy

### Frontend

Use:

```bash
npm run lint
npm run build
```

Then manually verify:

- Login
- Dashboard
- Project creation/editing
- Project detail
- GIS map
- Alerts
- Analytics
- Reports
- Data upload
- Model dashboard

### Backend

Verify:

```text
GET /health
```

Then exercise key API groups:

- Projects
- Alerts
- Map
- Ingestion
- Model
- Authentication
- Gemini explanation

Python tests are located under:

```text
geomatrix_v2/tests/
```

---

## Deployment

### Frontend — Vercel

Connect the repository to Vercel as a Next.js application.

Set production environment variables including:

```env
NEXT_PUBLIC_API_URL=https://<render-service>.onrender.com
MODEL_API_URL=https://<render-service>.onrender.com
NEXT_PUBLIC_APP_URL=https://<vercel-app>.vercel.app
```

After changing `NEXT_PUBLIC_*` values, create a new deployment so the updated values are included in the frontend build.

### Backend — Render

Deploy the FastAPI service using the included Render configuration.

Configure:

```env
DATABASE_URL=<production-postgresql-url>
FRONTEND_URL=https://<vercel-app>.vercel.app
CORS_ORIGINS=https://<vercel-app>.vercel.app
GEMINI_API_KEY=<optional>
```

Verify:

```text
https://<render-service>.onrender.com/health
```

returns an HTTP 200 health response before troubleshooting frontend API access.

For expanded deployment notes, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Security Notes

- Keep production credentials in Vercel/Render environment variables or another secret manager.
- Do not commit `.env.local`.
- Restrict Google Maps API keys to the required APIs and production origins.
- Restrict OAuth credentials to the expected redirect URIs.
- Use a strong, unique authentication secret.
- Do not expose database credentials in client-side variables.
- Avoid exposing private Gemini credentials through browser code.

---

## Documentation

- [Project Structure](PROJECT_STRUCTURE.md)
- [Deployment Guide](DEPLOYMENT.md)
- [.env.example](.env.example)

---

## Project Status

GEOMATRIX is an actively developed prototype / application for AI-assisted land acquisition intelligence. The codebase currently contains the main dashboard, project management, GIS, alerting, analytics, reporting, data ingestion, model intelligence, authentication integration, and Python ML backend components.

Live service endpoints and deployed features depend on the environment configuration and the current state of the connected database/model artifacts.

---

## License

No explicit open-source license is currently declared in this repository. Unless a license is added, the repository should be treated according to the default rights granted by copyright law.


### Session and data-integrity update

Browser API calls now use authenticated same-origin routes backed by FastAPI.
Google sign-in issues revocable database sessions; browser storage flags are no
longer trusted. Follow the [authentication and real-data upgrade](DEPLOYMENT.md#authentication-and-real-data-upgrade)
for the required Google client ID, application origin, allowed-account settings,
and historical-data re-import/retraining steps. Older training records and model
artifacts are excluded until their original source data is re-imported.


### Email/password accounts

The login page supports separate password accounts and verified Google identities.
The email address is the password account's sign-in ID; registration also takes a
name and a 12–128 character password. Registration signs the new account in.
Passwords are salted and derived with PBKDF2-HMAC-SHA256 (600,000 iterations),
never stored or returned in plaintext. Google and password identities are not
linked automatically by email. Email verification and password recovery are not
configured; use a password manager. Workspaces with `AUTH_ALLOWED_EMAILS` require
verified Google sign-in, since password registration does not verify email ownership.

Accounts, sessions, and atomic attempt counters live in the backend SQL database.
On Render, configure a persistent PostgreSQL `DATABASE_URL` before enabling password
accounts. Registration/login refuse the ephemeral SQLite fallback on Render so a
redeploy cannot silently erase new accounts. `postgres://` and `postgresql://`
provider URLs are normalized to the installed psycopg3 driver. New tables are
created by the existing startup migration, with no changes to existing Google
sessions or project records. Keep the database URL only in Render's server-side
environment. The frontend proxies credentials through same-origin routes and
sets a Secure, HttpOnly, SameSite=Lax session cookie.

Validation: `pytest -q` in `geomatrix_v2`, `npm run test:api`, and
`node --test tests/login-ui.test.mjs` against the isolated login test server in CI.

Preview authentication: `MODEL_API_URL` must point to the correct backend. Set
`NEXT_PUBLIC_GOOGLE_SIGN_IN_URL` to the canonical live login URL when a preview
origin is not registered with Google. Set `NEXT_PUBLIC_PASSWORD_AUTH_ENABLED=false`
while the preview backend has no persistent account storage; the interface explains
that Google should be used and does not accept unusable password submissions.
Remove this override after connecting PostgreSQL and deploying the account API.
