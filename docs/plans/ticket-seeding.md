# Plan: Random Ticket Seeding in Admin Settings

## TL;DR
Add an admin-only "Ticket Seeding" section to Settings that creates 10 random Tickets at once, scoped to the admin's current organization, with an on-by-default toggle that randomly assigns ~25% of them to staff members on the same ticket team. Implementation mirrors the existing "Trend Seeding" accordion and reuses the existing `createTicket` data path so validation, activity logging, and ID generation stay consistent.

---

## Phases

### Phase 1 — Backend ticket seeding module
*Goal: Add a reusable, admin-only function that generates 10 random tickets.*

1. **Create `server/ticket-seeding.ts`**
   - Export `seedRandomTickets(input: SeedRandomTicketsInput): Promise<TicketRecord[]>`.
   - Input shape: `{ organizationId: string; actor: string; assignToStaff?: boolean }`.
   - Query the DB for:
     - Teams where `OrganizationId = organizationId`.
     - Categories for those teams.
     - Staff/Admin users (`Role IN ('Staff','Admin')`) in the organization.
     - Active locations (via `listLocations(true)`).
   - Build a static pool of random requestor names/emails and ticket title/description templates (e.g., arrays of plausible values per category).
   - For `i = 0..9`:
     - Pick a random team from the org.
     - Pick a random category that belongs to that team.
     - Pick a random priority from `priorityOptions`.
     - Pick a random active location or fall back to `'Not specified'`.
     - Determine `assignedToId`:
       - If `assignToStaff` is true **and** `Math.random() < 0.25`, pick a random user whose `teamId` equals the selected ticket team; otherwise leave `null`.
     - Call `createTicket(..., actor)` from `server/tickets.js` so the same validation, activity row, custom-field inserts, and ID collision handling apply.
     - Collect returned `TicketRecord`s.
   - Return the array of created tickets.
   - Throw explicit errors for missing teams/categories (`organization_has_no_teams`, `organization_has_no_categories`).

2. **Wire the admin route in `server/routes/tickets.ts` (preferred) or a new admin router**
   - Add `POST /api/admin/tickets/seed` protected by `requireAdmin`.
   - Body: `{ assignToStaff?: boolean }`.
   - Use `req.user!.organizationId` and `req.user!.name` as actor.
   - Call `seedRandomTickets({ organizationId, actor, assignToStaff })`.
   - Return `{ tickets: TicketRecord[] }` on success.
   - Map known errors to `400`; return `500` for unexpected failures.
   - Do **not** dispatch `ticket.created`/`ticket.assigned` webhooks here (seeded data should not trigger integrations).

3. **Register the route in `server/index.ts`**
   - If placed in `routes/tickets.ts`, mount with `app.use('/api/admin/tickets', ticketsRouter)`; if a new router, import and mount similarly.

### Phase 2 — Frontend Settings UI
*Goal: Add a "Ticket Seeding" accordion section analogous to "Trend Seeding".*

4. **Extend settings types and state in `src/App.tsx`**
   - Add `'ticketSeeding'` to `SettingsAccordionSection` union and to `defaultSettingsAccordionOrder`.
   - Add state:
     - `ticketSeedPending: boolean`
     - `ticketSeedNotice: string`
     - `ticketSeedError: string`
     - `ticketSeedAssignEnabled: boolean` (default `true`)
   - Add `'ticketSeeding'` entry to `accordionMetadata` (title: "Ticket Seeding", description: "Create random sample tickets for testing and demos.").

5. **Add the accordion content renderer in `src/App.tsx`**
   - In the settings switch statement, add `case 'ticketSeeding'`.
   - Show the admin gate (same pattern as `trendSeeding`).
   - Render:
     - Description text explaining it creates 10 tickets scoped to the current organization.
     - A checkbox/toggle bound to `ticketSeedAssignEnabled` labeled "Randomly assign ~25% to staff" (default checked).
     - A single primary button "Seed 10 Tickets" with loading state `ticketSeedPending`.
     - `ticketSeedError` and `ticketSeedNotice` alert boxes.
   - On click, call `POST /api/admin/tickets/seed` with `{ assignToStaff: ticketSeedAssignEnabled }`.
   - On success, show a notice like "Created 10 tickets." and refresh the ticket list/dashboard so the new tickets appear (reuse existing `fetchTickets()` / `fetchDashboardSummary()` / `fetchDashboardTrends()` helpers).

### Phase 3 — Verification & polish
*Goal: Confirm end-to-end behavior and avoid regressions.*

6. **Run the dev server and exercise the feature**
   - Log in as an admin.
   - Open Settings → Ticket Seeding.
   - Click "Seed 10 Tickets" with the assign toggle on and verify ~2–3 tickets are assigned to staff on the correct team.
   - Click again with the toggle off and verify all 10 are unassigned.
   - Confirm the tickets appear in Dashboard, Team Tickets, and Unassigned views.

7. **Add/update automated checks**
   - If tests exist for trend seeding or ticket routes, add a minimal test for `/api/admin/tickets/seed`:
     - Admin request succeeds and returns 10 tickets.
     - Non-admin request returns `403`.
     - Approximately 25% assigned when `assignToStaff: true` (statistical smoke test).
   - Run `npm run lint` and `npm run typecheck` (or the equivalent scripts) and fix any type errors.

---

## Relevant files

- `server/ticket-seeding.ts` — new module; core random-generation logic using `createTicket`.
- `server/tickets.ts` — reuse `createTicket` and `priorityOptions` validation.
- `server/routes/tickets.ts` — add `POST /api/admin/tickets/seed` under `requireAdmin`.
- `server/index.ts` — mount `/api/admin/tickets` router if needed.
- `server/directory.ts` — reference for org-scoped team/user/category queries.
- `server/locations.ts` — reference for `listLocations(true)`.
- `server/middleware.ts` — `requireAdmin` guard.
- `src/App.tsx` — settings accordion section, state, metadata, and fetch handler.
- `src/constants.ts` — `priorityOptions` array.
- `src/types.ts` — `Ticket`, `User`, `Team`, `Category` shapes.
- `docs/swagger.yaml` — optionally document the new admin endpoint.

---

## Verification

1. **Backend unit/integration test** (or manual `curl` with admin cookie):
   ```
   POST /api/admin/tickets/seed
   { "assignToStaff": true }
   ```
   Expect `200 { tickets: [...10 records] }`.
2. **Permission check**: non-admin cookie returns `403 { error: 'admin_required' }`.
3. **Data integrity check**: each created ticket has a valid `teamId`/`categoryId` pair and `assignedToId` either `null` or a user whose `teamId` matches the ticket's team.
4. **UI smoke test**: Settings accordion renders for admins, hidden/gated for staff, button shows loading state, success notice appears, dashboard trend/charts update.
5. **Lint/typecheck**: `npm run lint` and `npm run typecheck` pass.

---

## Decisions

- **Scope**: seeded tickets are limited to the admin's `organizationId` (matches the user's stated "staff in the Organization").
- **Assignment toggle**: UI checkbox defaults to ON; ~25% of the 10 tickets are randomly assigned to staff users whose `teamId` equals the ticket's team. If no eligible staff exists for a selected team, that ticket is left unassigned rather than failing.
- **Status**: all seeded tickets start as `Open` to keep them visible in queues and avoid surprising resolved-ticket counts.
- **Priority**: randomly chosen from `priorityOptions` (`Low`, `Medium`, `High`, `Critical`).
- **Location**: randomly chosen from active `Locations`; falls back to `'Not specified'` when no locations exist.
- **Webhook policy**: intentionally **do not** dispatch `ticket.created`/`ticket.assigned` webhooks for seeded tickets, so demos/QA do not fire integrations.
- **Data path**: reuse `createTicket` in `server/tickets.ts` rather than duplicating INSERT logic, ensuring category-team validation, user-team validation, custom-field handling, and activity logging stay in sync.

---

## Further considerations

1. **Bulk count**: the requirement is fixed at 10. If you later want a configurable count, the backend can accept `count` (capped, e.g., 1–50) with a small UI number input.
2. **Random realism**: the first version can use hard-coded title/description pools. If you want richer/generated data, we can add a lightweight faker dependency or expand the template arrays.

---

## Implementation notes

- **Status**: Implemented and verified.
- **Files added/changed**:
  - `server/ticket-seeding.ts` (new random ticket generation module)
  - `server/routes/tickets.ts` (`POST /api/admin/tickets/seed`)
  - `server/index.ts` (mount `/api/admin/tickets`)
  - `src/App.tsx` (settings UI, state, data refresh helpers)
  - `docs/plans/ticket-seeding.md` (this plan)
- **Verification**:
  - Admin Settings shows the "Ticket Seeding" accordion.
  - New "Target team" dropdown defaults to "All teams" and can restrict seeding to one team.
  - "Seed 10 Tickets" creates 10 Open tickets scoped to the current organization/selected team.
  - Toggle ON: tickets are randomly assigned to eligible staff on the matching team.
  - Toggle OFF: all 10 tickets are created unassigned.
  - Non-admin API calls return `403 { error: 'admin_required' }`.
  - Unauthenticated API calls return `401 { error: 'unauthenticated' }`.
  - `npm run lint` passes (only pre-existing warnings).
  - `npm run build` passes.
- **Bug fix**: the ticket detail form now loads the organization ticket layout when a ticket is opened from any view (not just New Ticket / Ticket Designer). A default fallback layout was also added to `LayoutTicketForm` so fields render even if the layout is unavailable.
