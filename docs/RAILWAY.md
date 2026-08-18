# Railway Deployment Guide

This guide covers deploying TeamSupportPro from GitHub to Railway as a single service that serves both the React frontend and the Express API.

## Deployment Model

This repository is already set up for the recommended Railway flow:

- `npm run build` builds the Vite frontend and the compiled Node server
- `npm start` runs `dist/server/index.js`
- Express serves the built frontend and API from the same Railway service
- Railway injects `PORT`, and the server already respects it

Recommended production URL shape:

- App: `https://<your-railway-domain>`
- API: `https://<your-railway-domain>/api/...`
- Anonymous ticket page: `https://<your-railway-domain>/anon/`

## Before You Start

Make sure you already have:

1. A GitHub repository with the latest code pushed
2. A Railway account connected to GitHub
3. A SQL Server / Azure SQL database that is reachable from Railway
4. A Google Cloud OAuth client if you are using Google sign-in

## Create The Railway Project

1. In Railway, click `New Project`
2. Choose `Deploy from GitHub repo`
3. Select your `team-support-pro` repository
4. Let Railway create the service
5. In the service settings, confirm:

- Build Command: `npm run build`
- Start Command: `npm start`

If Railway does not auto-detect them correctly, set them manually.

## Required Environment Variables

Set these in Railway under your service `Variables` tab.

### Core runtime

- `NODE_ENV=production`
- `JWT_SECRET=<long-random-secret>`
- `CLIENT_URL=https://<your-railway-domain>`
- `ALLOWED_ORIGINS=https://<your-railway-domain>`
- `COOKIE_SAME_SITE=lax`

### Frontend-exposed Vite variables

- `VITE_APP_NAME=TeamSupportPro`
- `VITE_GOOGLE_CLIENT_ID=<your-google-client-id>`
- `VITE_API_BASE_URL=`

Important:

- Leave `VITE_API_BASE_URL` blank for the single-service Railway deploy
- That keeps the frontend calling the same origin that served the app

### Google auth

- `GOOGLE_CLIENT_ID=<your-google-client-id>`
- `GOOGLE_CLIENT_SECRET=<your-google-client-secret>` if redirect flow is enabled
- `GOOGLE_REDIRECT_URI=https://<your-railway-domain>/auth/google/callback` if redirect flow is enabled

If you only use the browser credential flow, `GOOGLE_CLIENT_ID` is still required. The client and server values should refer to the same Google OAuth app.

### Database

- `DB_SERVER=<your-sql-server-host>`
- `DB_PORT=1433`
- `DB_DATABASE=<your-database-name>`
- `DB_USER=<your-database-user>`
- `DB_PASSWORD=<your-database-password>`
- `AUTH_USER_LOOKUP_QUERY=<your-auth-query>`

Use the same `AUTH_USER_LOOKUP_QUERY` shape you have validated locally. If you already have a working `.env`, copy the query from there carefully into Railway.

### Optional test-only values

Only set these if you want the Postman test API key behavior in production-like environments:

- `TEST_API_KEY=<optional-test-key>`
- `TEST_API_USER_NAME=Postman IT Staff`
- `TEST_API_USER_EMAIL=postman.it.staff@local.test`

If you do not need that testing path in Railway, leave them unset.

## Recommended Railway Variable Set

Example single-service configuration:

```env
NODE_ENV=production
JWT_SECRET=replace-with-a-long-random-secret
VITE_APP_NAME=TeamSupportPro
VITE_GOOGLE_CLIENT_ID=replace-with-google-client-id
VITE_API_BASE_URL=
GOOGLE_CLIENT_ID=replace-with-google-client-id
GOOGLE_CLIENT_SECRET=replace-with-google-client-secret
GOOGLE_REDIRECT_URI=https://<your-railway-domain>/auth/google/callback
CLIENT_URL=https://<your-railway-domain>
ALLOWED_ORIGINS=https://<your-railway-domain>
COOKIE_SAME_SITE=lax
DB_SERVER=replace-with-db-host
DB_PORT=1433
DB_DATABASE=replace-with-db-name
DB_USER=replace-with-db-user
DB_PASSWORD=replace-with-db-password
AUTH_USER_LOOKUP_QUERY=replace-with-your-query
```

## Google Cloud Console Updates

After Railway gives you a public domain, update your Google OAuth app:

1. Add Authorized JavaScript origin:

`https://<your-railway-domain>`

2. If redirect flow is enabled, add Authorized redirect URI:

`https://<your-railway-domain>/auth/google/callback`

If you forget this step, Google sign-in will fail in production even if Railway deploy succeeds.

## Deploy

After variables are saved:

1. Trigger a deploy in Railway, or push a new commit to GitHub
2. Wait for the build to finish
3. Open the generated Railway domain

## Post-Deploy Verification

Check these in order:

1. Health endpoint

`https://<your-railway-domain>/api/health`

Expected response:

```json
{
  "ok": true
}
```

2. Main app loads

- Open `https://<your-railway-domain>`

3. Anonymous ticket page loads

- Open `https://<your-railway-domain>/anon/`

4. Google sign-in works

- Confirm sign-in completes and session restore works after refresh

5. SQL-backed data loads

- Directory data
- Tickets
- Dashboard summary

## Common Railway Problems

### App loads but API calls fail

Check:

- `ALLOWED_ORIGINS`
- `CLIENT_URL`
- `COOKIE_SAME_SITE`
- database variables

For single-service Railway deploys, `CLIENT_URL` and `ALLOWED_ORIGINS` should both be your Railway app origin.

### Google login fails in production

Check:

- `VITE_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`
- Google Authorized JavaScript origin
- Google Authorized redirect URI if using redirect flow

### Build succeeds but app does not start

Check:

- Railway Start Command is `npm start`
- `NODE_ENV=production`
- build logs include both Vite output and `dist/server/index.js`

### Database connection fails

Check:

- `DB_SERVER`
- `DB_PORT`
- `DB_DATABASE`
- `DB_USER`
- `DB_PASSWORD`
- whether your database firewall allows Railway outbound access

## Local Parity Check Before Deploying

Run these before pushing a release commit:

```bash
npm run build
npm start
```

Then confirm locally:

- `http://localhost:3001/api/health`
- `http://localhost:3001/`
- `http://localhost:3001/anon/`

## Related Docs

- [README.md](../README.md)
- [docs/API.md](./API.md)