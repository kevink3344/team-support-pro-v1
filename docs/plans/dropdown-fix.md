# Fix: New Ticket Category / Assigned To Dropdowns Empty on Azure (SQL Server)

**Date:** 2026-08-19
**Commit:** `b74654d` on `main` → auto-deploys to `teamsupportpro-sandbox` (Azure App Service)
**File changed:** `src/App.tsx` (new-ticket form team sync effect)
**Related issue:** After deployment to Azure in SQL Server mode, Category and Assigned To dropdowns on New Ticket showed only placeholders while Location (234 options) worked. APIs returned correct data.

## 1. Symptom

- **URL:** `https://teamsupportpro-sandbox-ecbve8cff4eghgcq.eastus2-01.azurewebsites.net/` → New Ticket view
- Category select: only `— Select a category —` (expected 6 for ALS team `team-legacy-default-indian-education`)
- Assigned To select: only `— Unassigned —` (expected team members)
- Team Controls sidebar correctly showed `Advanced Learning Services (ALS)` and `3` roster members
- `GET /api/directory` (200) returned `categories:16, users:8, teams:3` with correct `teamId` values
- `GET /api/categories`, `/api/users`, `/api/locations` all 200
- Location dropdown worked (not team-filtered)

## 2. Root Cause

`src/App.tsx` new-ticket form state:

```ts
const [newTicketForm, setNewTicketForm] = useState({ teamId: '', ... })
```

Sync effect (before fix):

```ts
useEffect(() => {
  setNewTicketForm((current) => {
    const formTeamId = current.teamId || currentTeam?.id || ''
    // ...
    const formTeamCategories = categories.filter(c => c.teamId === formTeamId)
  })
}, [categories, currentTeam?.id])
```

Sequence:

1. Initial render: `availableTeams` falls back to `initialTeams` (`it`, `facilities`, `learning`, `security` from `src/data/mockData.ts`) because `directoryLoaded === false`.
2. `currentTeam` resolves to mock team `it`.
3. Effect runs, sets `newTicketForm.teamId = 'it'`.
4. `/api/directory` loads real directory (`team-legacy-default-indian-education`, etc.), `categories` updates to 16 real categories, `currentTeam` becomes ALS.
5. Effect re-runs but `current.teamId` (`'it'`) is truthy, so `formTeamId` stays `'it'`.
6. `categories.filter(c => c.teamId === 'it')` → 0 results.
7. `LayoutTicketForm` filters by `values.teamId`:

```ts
const currentTeamCategories = categories.filter(c => c.teamId === values.teamId)
const currentTeamMembers = users.filter(u => u.teamId === values.teamId)
```

→ both empty. Location works because it is not filtered by `teamId`.

The bug is not SQL Server specific; it reproduces whenever real team IDs differ from mock IDs (which they do after seeding Academics/ALS/ESL/Title I).

## 3. Fix

For users without org-wide ticket access (`canViewAllOrgTickets === false`), the form must always follow `currentTeam.id`. Org-wide users may keep a manually selected team.

```ts
useEffect(() => {
  setNewTicketForm((current) => {
    const targetTeamId = currentTeam?.id || ''
    if (!targetTeamId) return current
    const formTeamId = canViewAllOrgTickets ? (current.teamId || targetTeamId) : targetTeamId
    if (!formTeamId) return current
    const formTeamCategories = categories.filter((category) => category.teamId === formTeamId)
    if (formTeamCategories.length === 0) {
      return current.teamId === formTeamId ? current : { ...current, teamId: formTeamId }
    }
    const validIds = new Set(formTeamCategories.map((c) => c.id))
    if (current.teamId === formTeamId && validIds.has(current.categoryId)) {
      return current
    }
    return { ...current, teamId: formTeamId, categoryId: formTeamCategories[0].id }
  })
}, [categories, currentTeam?.id, canViewAllOrgTickets])
```

Diff: `src/App.tsx` lines ~1496-1515, commit `b74654d`.

## 4. Verification

1. `npm run build` passes (vite 8.0.14, 2793 modules).
2. Push to `origin/main` triggers `.github/workflows/main_teamsupportpro(sandbox).yml` → Azure deploy.
3. Hard refresh sandbox (Ctrl+F5) → New Ticket → Category shows 6 ALS categories, Assigned To shows ALS members.
4. Regression: org-wide admin (`canViewAllOrgTickets=true`) can still switch teams via `teamOptions`/`canChangeTeam` path in `LayoutTicketForm`.

## 5. Follow-ups / Lessons

- Avoid initializing team-scoped form state from mock fallback teams. Consider initializing `newTicketForm.teamId` from `currentTeam.id` after `directoryLoaded` or deriving it directly from `currentTeam` for non-org-wide users.
- Add a Playwright check: New Ticket Category options count > 1 after login as `chris.rice@yahoo.com` (ALS).
- Consider removing `initialTeams`/`initialCategories` fallback once directory API is required, or make the sync effect explicitly handle mock→real team ID migration.
