# Plan: Default Password on Admin-Created Users

## Goal

When an admin creates a user via `POST /api/users`, automatically provision a local-auth account for that user with the password from the `DEFAULT_PASSWORD` environment variable (already set in `.env`, to be promoted to a deployment env var). New users can then sign in immediately in `password` login mode without an admin having to set a password manually.

## Context

- **User creation today:** `POST /api/users` (`requireAdmin`) in `server/routes/directory.ts` calls `createUser()` in `server/directory.ts`, which inserts a row into `Users` (SQL Server / Turso / SQLite via `getDb()`). No local-auth account is created.
- **Local auth store:** `server/local-auth.ts` persists salted scrypt hashes to `.local-auth-accounts.json` (file-backed `Map` + `queueLocalAccountsPersist`). Existing helpers:
  - `registerLocalAccountPersisted(name, email, password)` — fails with `email_exists` if already present.
  - `upsertLocalAccountPersisted(name, email, password)` — creates or overwrites.
  - `changeLocalAccountPasswordPersisted(name, email, newPassword)` — used by `POST /api/auth/users/:userId/change-password` (admin) and `POST /api/auth/change-password` (self-service).
  - `authenticateLocalAccountPersisted` / `verifyLocalAccountPassword` — login verification.
- **Bootstrap admin:** `server/index.ts:ensureBootstrapAdmin()` already uses `upsertLocalAccountPersisted` with `LOCAL_ADMIN_PASSWORD` from `server/config.ts`.
- **Current gap:** `DEFAULT_PASSWORD=password1` exists in `.env` (line 20) but is **not** parsed in `server/config.ts` (`envSchema` has no `DEFAULT_PASSWORD` entry, no `serverConfig.defaultPassword`). No code reads it.
- **Login modes:** `select` (no password), `password` (local-auth), `maintenance`. Default-password only matters in `password` mode, but should be provisioned regardless of current mode so users are ready when mode switches.

## Changes

### 1. `server/config.ts` — parse `DEFAULT_PASSWORD`

Add to `envSchema`:

```ts
DEFAULT_PASSWORD: z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().min(8).optional()
),
```

Expose on `serverConfig`:

```ts
defaultPassword: parsed.DEFAULT_PASSWORD?.trim() || '',
```

- Trim whitespace; treat empty string as unset.
- `min(8)` matches the existing password policy (`local-auth.ts` and `routes/auth.ts` both enforce `>= 8`).
- Keep `optional` so the server still boots when unset (e.g., `select` mode dev), but user-creation will handle the missing case explicitly.
- Add `DEFAULT_PASSWORD` to `.env.example` with a comment: `DEFAULT_PASSWORD — initial password for admin-created users; must be >= 8 chars; set in deployment env`.

### 2. `server/routes/directory.ts` — provision local account after `createUser`

In `directoryRouter.post('/users', requireAdmin, ...)` (currently ~line 431):

```ts
const createdUser = await createUser({ ... })
if (!createdUser) { return 400 }

const defaultPassword = serverConfig.defaultPassword
if (!defaultPassword) {
  console.warn('DEFAULT_PASSWORD not set — user created without local auth account:', createdUser.email)
  // Option A (recommended): return 201 with warning field so UI can surface it
  // Option B: return 500 default_password_not_configured and roll back Users insert
  // Recommended: Option A — don't block user creation, admin can set via change-password
} else {
  const result = await registerLocalAccountPersisted(
    createdUser.name,
    createdUser.email,
    defaultPassword
  )
  if ('error' in result) {
    if (result.error === 'email_exists') {
      console.warn('Local account already exists for', createdUser.email, '— leaving existing password')
    } else {
      console.error('Failed to create local account for', createdUser.email, result.error)
      // Do NOT delete the Users row; return 201 with warning. Admin can retry via POST /api/auth/users/:id/change-password
    }
  }
}
res.status(201).json({ user: createdUser })
```

**Import:** `import { registerLocalAccountPersisted } from '../local-auth.js'` and `import { serverConfig } from '../config.js'`.

**Why `register` not `upsert`:** `register` preserves an existing password if the email was previously used (e.g., user deleted then re-added). If the desired behavior is always reset to default on creation, swap to `upsertLocalAccountPersisted`. Document the choice; default recommendation is `register` + warn on `email_exists`.

**Atomicity:** `Users` (DB) and local-auth (JSON file) are separate stores with no transaction. If local-auth fails, keep the `Users` row and surface a warning rather than rolling back — the user is still valid in the directory and the admin can set a password via the existing `POST /api/auth/users/:userId/change-password` endpoint. Alternative (stricter) is to `await deleteUser(createdUser.id)` and return `500 local_account_create_failed`; call out as a decision point.

**Validation:** `registerLocalAccountPersisted` already validates `name >=2`, `email` format, `password >=8`. `DEFAULT_PASSWORD` is validated at config parse; if it fails `min(8)`, the server will throw on boot (Zod), which is desirable — fail fast rather than silently creating weak passwords.

**Logging:** Never log the password value. Log only email and error code.

### 3. `server/directory.ts` — no change required

Keep `createUser` focused on DB. The local-auth side effect belongs in the route handler, mirroring how `server/index.ts` handles bootstrap admin (DB + local-auth in the same flow but not inside `directory.ts`).

### 4. Frontend `src/App.tsx` — surface result (optional, minimal)

`addUser()` (around line 4589) already shows `User added successfully.` on `201`. Extend to handle a warning:

- If the API returns `{ user, warning: 'default_password_not_configured' }` or `{ user, warning: 'local_account_failed' }`, show `User added but default password was not set — set it via Change Password.` in `userDirectoryNotice` / `userDirectoryError`.
- No password input is needed in the create-user form; the default is intentionally not exposed in the UI.

If keeping the API response as `{ user }` only (no warning field), no frontend change is needed — the admin will discover the missing password only when the user fails to log in. Adding the warning field is preferred for UX.

### 5. Docs & deployment

- **`.env.example`:** add `DEFAULT_PASSWORD=` with comment explaining length requirement and that it must be set in production env.
- **`README.md` / `docs/API.md`:** note that `POST /api/users` now provisions a local account with `DEFAULT_PASSWORD` when set.
- **`docs/swagger.yaml`:** annotate `POST /api/users` response to mention side effect (creates local-auth account if `DEFAULT_PASSWORD` configured).
- **Deployment:** add `DEFAULT_PASSWORD` to the hosting provider's env vars (Railway / Azure). Rotate if `password1` is only for dev.

## Behavior decisions

- **Missing `DEFAULT_PASSWORD`:** Do not block user creation. Create the `Users` row, log a warning, and return `201` (optionally with `warning` field). The admin can then set a password via `POST /api/auth/users/:userId/change-password`. Stricter alternative is to return `500` and roll back — choose and document.
- **Existing local account:** Use `register` semantics — if `email_exists`, leave the existing hash untouched and warn. If always-reset is desired, use `upsert`.
- **Password policy:** Reuse existing `>= 8` check. `DEFAULT_PASSWORD` below 8 chars fails at config parse (server won't start) — intentional.
- **No password in API response:** Never return the password or hash. The response remains `{ user }` (plus optional `warning`).
- **Login mode agnostic:** Provision the account regardless of current `loginMode` so users work when mode switches to `password`.
- **No forced password change on first login:** Users provisioned with `DEFAULT_PASSWORD` are NOT required to change their password on first login. They may continue using the default password indefinitely until they or an admin changes it via `POST /api/auth/change-password` or `POST /api/auth/users/:userId/change-password`. No `mustChangePassword` flag, redirect, or login blocking is introduced in v1.

## Alternatives considered

- **Put logic in `server/directory.ts:createUser`:** Would couple DB and file store; rejected — keep side effect in route handler.
- **Require password in `POST /api/users` body:** More flexible per-user passwords but changes the admin UX and API contract; rejected for v1 since the requirement is a single env default.
- **Hash in DB instead of `.local-auth-accounts.json`:** Would require schema migration; out of scope — reuse existing local-auth file.

## Verification

1. **Config:** Set `DEFAULT_PASSWORD` in `.env` to a value `>= 8` chars, restart server, confirm `serverConfig.defaultPassword` is populated (log or debugger). Remove it and confirm user creation still succeeds with a warning.
2. **Happy path (password mode):**
   ```bash
   # as admin
   curl -X POST http://localhost:3001/api/users \
     -H "Content-Type: application/json" -b cookies.txt \
     -d '{"name":"Test User","email":"test.user@example.com","organizationId":"...","teamId":"...","role":"Staff"}'
   # expect 201 { user }
   # then as new user
   curl -X POST http://localhost:3001/api/auth/local/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test.user@example.com","password":"<DEFAULT_PASSWORD>"}'
   # expect 200 { authenticated: true }
   ```
3. **Self-service change:** Log in as the new user, `POST /api/auth/change-password` with `currentPassword=<DEFAULT_PASSWORD>` and a new password, then re-login with the new password.
4. **Admin override:** `POST /api/auth/users/:userId/change-password` as admin should still work to reset any user's password.
5. **Edge cases:**
   - `DEFAULT_PASSWORD` unset → user created, login with any password returns `401 invalid_credentials`, admin can set via change-password.
   - Duplicate email → `POST /api/users` returns `400 user_create_failed` (DB constraint) or if `Users` allows duplicate email, local-auth returns `email_exists` and is handled.
   - `DEFAULT_PASSWORD` too short → server fails to start with Zod error (expected).
6. **Lint/typecheck:** `npm run lint` and `tsc -b` pass.

## Further considerations

- **Force password change on first login (intentionally not implemented):** Per product decision, v1 does NOT force a password change on first login. If required in the future, this would need a `mustChangePassword` boolean on `Users` or `isDefaultPassword` on `LocalAuthAccount`, checked on login with a redirect to the `change-password` view until changed — but this is explicitly out of scope for the current plan.
- **Per-user password on creation:** Extend `POST /api/users` to accept optional `password` in body; if provided, use it instead of `DEFAULT_PASSWORD`.
- **Migrate existing users:** One-off script to iterate `Users` and `registerLocalAccountPersisted` for any email missing a local account, using `DEFAULT_PASSWORD`.
- **Move local-auth to DB:** Replace file store with a `LocalAccounts` table to get transactional consistency with `Users`.

## Relevant files

- `server/config.ts` — add `DEFAULT_PASSWORD` to `envSchema` and `serverConfig`.
- `server/routes/directory.ts` — `POST /api/users` handler; add local-auth provisioning.
- `server/local-auth.ts` — `registerLocalAccountPersisted` / `upsertLocalAccountPersisted` (no change, just called).
- `server/directory.ts` — `createUser` (reference, no change).
- `server/index.ts` — `ensureBootstrapAdmin` pattern to mirror.
- `server/routes/auth.ts` — `POST /api/auth/users/:userId/change-password` and `POST /api/auth/change-password` (existing admin/self-service flows).
- `src/App.tsx` — `addUser()` (optional warning handling).
- `.env` / `.env.example` — `DEFAULT_PASSWORD` definition.
- `docs/swagger.yaml` — document side effect.
