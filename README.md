# TeamSupportPro

TeamSupportPro is a high-density enterprise staff support application built with React, TypeScript, Tailwind CSS, Motion, Lucide, Recharts, and an Express backend. The app can now be deployed either as a single Railway service that serves both the API and the built frontend, or as a split deployment with the frontend hosted separately.

## Current Scope

- React + Vite frontend
- Node + Express API and auth service
- SQL-backed tickets, comments, attachments, directory data, dashboard trends, and dashboard summary
- Team-scoped queues and reassignment rules in the UI
- Theme customization for light and dark modes
- Dashboard analytics and slide-out ticket details

## Local Development

Install dependencies and start the frontend and backend:

```bash
npm install
npm run dev
```

Create your local environment file from the template:

```bash
copy .env.example .env
```

## Environment Variables

Use [.env.example](.env.example) as the source of truth for required variables.

Frontend-safe variables:

- `VITE_APP_NAME`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_API_BASE_URL`

Backend-only variables:

- `NODE_ENV`
- `SERVER_PORT`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `JWT_SECRET`
- `CLIENT_URL`
- `ALLOWED_ORIGINS`
- `COOKIE_SAME_SITE`
- `DB_SERVER`
- `DB_PORT`
- `DB_DATABASE`
- `DB_USER`
- `DB_PASSWORD`
- `AUTH_USER_LOOKUP_QUERY`
- `LOGIN_MODE` (optional override: `select` | `password` | `maintenance`)

Important: only variables prefixed with `VITE_` are exposed to browser code in a Vite app. Database credentials, JWT secrets, and OAuth client secrets remain on the backend service.

### Login Mode

A single app-wide setting controls what the sign-in page shows:

| Mode | Behavior |
|------|----------|
| `select` | Select-user test login (org + user dropdowns, no password) |
| `password` | Email + password form (`POST /api/auth/local/login`) |
| `maintenance` | Hides login forms and shows a custom message. Admins can bypass with `?admin=1` |

Admins configure the mode in **Settings → Authentication → Login Mode**. When `LOGIN_MODE` is set in the environment to a valid value, it overrides the database setting and locks the Settings toggle until the env var is removed or changed.

Deployment notes:

- For a single-service Railway deploy, leave `VITE_API_BASE_URL` empty so the browser calls the same origin that served the app.
- For a split deploy, set `VITE_API_BASE_URL` to your backend URL, set `CLIENT_URL` to your frontend URL, set `ALLOWED_ORIGINS` to the frontend origin or a comma-separated list of allowed origins, and set `COOKIE_SAME_SITE=none`.
- Railway injects `PORT`; the backend now uses it automatically in production.

## Authentication Flow

- The sign-in screen in the frontend remains the production UI.
- Google Sign-In uses the browser credential flow, then posts the returned credential to `/api/auth/google/client`.
- The backend verifies the Google ID token and creates a signed HTTP-only session cookie.
- The frontend restores the saved session through `/api/auth/me`, so refresh does not log the user out.
- User role and team are pulled from SQL Server if `AUTH_USER_LOOKUP_QUERY` is configured. If no database match is available yet, the app falls back to the seeded mock directory so testing can continue.

## Ticket Activity Persistence

- After sign-in, the frontend loads ticket records from SQL Server through `/api/tickets`.
- Teams, categories, and users are loaded from SQL Server through `/api/directory` after authentication.
- New ticket creation is persisted to SQL Server through `/api/tickets`.
- Ticket detail edits are persisted to SQL Server through `/api/tickets/:ticketId` and the backend creates the corresponding activity entries.
- Ticket comments are written to SQL Server through `/api/tickets/:ticketId/comments`, and the backend derives the comment actor from the signed session cookie instead of trusting the client payload.
- Ticket attachments are stored directly in SQL Server through `dbo.TicketAttachments` and exposed by `/api/tickets/:ticketId/attachments` routes.
- Dashboard metric cards, status overview, and team workload summary are loaded from SQL Server through `/api/dashboard/summary`.
- Dashboard trend data is loaded from SQL Server through `/api/dashboard/trends`.
- Ticket reads, creates, updates, and comments are scoped server-side to the signed-in user's team.
- The app still keeps the seeded mock data in the repo as fallback/reference data, but the active ticket workspace and directory bootstrap now hydrate from SQL after authentication.

## CRUD API Surface

Authenticated reads:

- `GET /api/teams`
- `GET /api/teams/:teamId`
- `GET /api/categories`
- `GET /api/categories/:categoryId`
- `GET /api/users`
- `GET /api/users/:userId`
- `GET /api/tickets`
- `GET /api/tickets/:ticketId`

Admin-only directory writes:

- `POST /api/teams`
- `PATCH /api/teams/:teamId`
- `DELETE /api/teams/:teamId`
- `POST /api/categories`
- `PATCH /api/categories/:categoryId`
- `DELETE /api/categories/:categoryId`
- `POST /api/users`
- `PATCH /api/users/:userId`
- `DELETE /api/users/:userId`

Team-scoped ticket writes:

- `POST /api/tickets`
- `PATCH /api/tickets/:ticketId`
- `DELETE /api/tickets/:ticketId`
- `POST /api/tickets/:ticketId/comments`

Team-scoped attachment operations:

- `GET /api/tickets/:ticketId/attachments`
- `POST /api/tickets/:ticketId/attachments`
- `GET /api/tickets/:ticketId/attachments/:attachmentId`
- `DELETE /api/tickets/:ticketId/attachments/:attachmentId`

Notes:

- Directory create endpoints accept optional `id` fields so you can preserve spreadsheet identifiers when importing.
- Ticket create accepts an optional `id` field as well; otherwise the server generates a `TKT-xxxxx` ID.
- Team and category deletes can fail if related rows still exist because SQL foreign keys are enforced.
- Attachment uploads are limited to 10 MB per file and are stored as `VARBINARY(MAX)` in SQL Server for this implementation.

## API Reference

See [docs/API.md](docs/API.md) for a mini API reference with authentication requirements, request payloads, and response shapes.

## Railway Guide

See [docs/RAILWAY.md](docs/RAILWAY.md) for a step-by-step Railway deployment checklist, required environment variables, and post-deploy verification steps.

## Deployment

### GitHub

Initialize the repository and push it to GitHub:

```bash
git init
git add .
git commit -m "Prepare TeamSupportPro for deployment"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

### Railway: Single Service

Use this when Railway should host both the frontend and backend.

- Build command: `npm run build`
- Start command: `npm start`
- Required environment variables:
	- `NODE_ENV=production`
	- `JWT_SECRET`
	- `VITE_GOOGLE_CLIENT_ID`
	- `GOOGLE_CLIENT_ID`
	- `GOOGLE_CLIENT_SECRET` only if you use the redirect flow
	- `GOOGLE_REDIRECT_URI` if you use the redirect flow
	- `CLIENT_URL=https://<your-railway-domain>`
	- `ALLOWED_ORIGINS=https://<your-railway-domain>`
	- `COOKIE_SAME_SITE=lax`
	- `DB_SERVER`
	- `DB_PORT=1433`
	- `DB_DATABASE`
	- `DB_USER`
	- `DB_PASSWORD`
	- `AUTH_USER_LOOKUP_QUERY`

Set your Google Authorized JavaScript origin to the Railway app URL. If you keep the redirect flow enabled, also set the Authorized redirect URI to `https://<your-railway-domain>/auth/google/callback`.

### Split Deployment

Use this when the frontend is hosted separately and Railway hosts only the backend.

- Frontend build environment:
	- `VITE_GOOGLE_CLIENT_ID`
	- `VITE_API_BASE_URL=https://<your-railway-backend-domain>`
- Railway backend environment:
	- `NODE_ENV=production`
	- `JWT_SECRET`
	- `GOOGLE_CLIENT_ID`
	- `GOOGLE_CLIENT_SECRET` only if you use the redirect flow
	- `GOOGLE_REDIRECT_URI=https://<your-railway-backend-domain>/auth/google/callback` if you use the redirect flow
	- `CLIENT_URL=https://<your-frontend-domain>`
	- `ALLOWED_ORIGINS=https://<your-frontend-domain>`
	- `COOKIE_SAME_SITE=none`
	- `DB_SERVER`
	- `DB_PORT=1433`
	- `DB_DATABASE`
	- `DB_USER`
	- `DB_PASSWORD`
	- `AUTH_USER_LOOKUP_QUERY`

For split hosting, your cookie must be cross-site, so `COOKIE_SAME_SITE=none` is required and HTTPS is mandatory.

## Verification

Production build:

```bash
npm run build
```

Production start after build:

```bash
npm start
```
