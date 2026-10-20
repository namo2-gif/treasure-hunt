# CODEMAP (read AGENTS.md first; it wins over this file)

## 1. Status
- Phase 0: DONE (schema matches AGENTS.md Section 5; migrations apply on Postgres 16)
- Phase 1: DONE (player/admin login, rate throttle, CSV student import, middleware, dto, messages)
- Phase 2: DONE (advance_event, event actions, pause/resume/add-time, event_clock SQL clock)
- Phase 3: DONE (register_scan SQL verified with concurrency testing, QR capacity limits)
- Phase 4: DONE (teaser gating, seeded shuffle, question assignments, 2-try scoring, attempt idempotency)
- Phase 5: DONE (Run timing, run 2 opening, deadlines, hard end & break, expired runs score 0, void_question, mark_absent, unmark_absent, cancel_registration)
- Phase 6: DONE (Admin panel: teams, interventions, dashboard, log, exports, settings, content CRUD)
- Phase 7: DONE (Round 1: R1 quiz screen, submit_answer r1, standings ranking, selection API & HQ page)
- Phase 8: SUPERSEDED by Phase 10
- Phase 9: DONE (Hardening: load-test.ts, comprehensive test suite passing, README with outage policy and admin cheat sheet)
- Phase 10: DONE (Round 3 complete redesign: 5 physical zones, start QR scan dispatch, 4-box riddles with 1 digit + 3 letter master code, 2 tries per box with lock, winner by code or progress, full admin grid with live 3s polling, overrides, printable QR sheet, migration 005 and 006)
- Entire specification: COMPLETE ✅

## 2. File Organization
```
app/
  (player)/
    login/page.tsx               # Player login form (student ID + personal code)
    page.tsx                     # Main player screen (dispatches Game.tsx)
    s/[token]/page.tsx           # QR entrypoint (routes to ScanClient.tsx)
    s/[token]/ScanClient.tsx     # Handles automatic QR scanning & dispatch
  hq/
    page.tsx                     # Admin dashboard (clock, phase controls, live R3 grid)
    login/page.tsx               # Admin login
    event/page.tsx               # Danger zone (reset_event_data with 'RESET' confirmation)
    round3/page.tsx              # Phase 10 Round 3 management (Setup, Teams, Live Grid, Overrides)
    round3/qr-sheet/page.tsx     # Printable half-A4 start QR sheet for 5 zones
    standings/page.tsx           # Full R1 & R2 standings and scores table
    teams/page.tsx               # Team & student manager, edit size/status, make captain
    content/page.tsx             # Riddle & question editor with attempt locking guards
    qr/page.tsx                  # QR locations manager & capacity settings
    interventions/page.tsx       # Student absence, cancel registration, void question, skip teaser
    logs/page.tsx                # Append-only audit logs viewer & CSV export
    settings/page.tsx            # System settings editor (mobile friendly card stack)
  api/
    auth/login|logout/route.ts   # Player session handling
    state/route.ts               # GET player state snapshot
    scan/route.ts                # Scan dispatch (R2 QR or R3 start QR)
    teaser/route.ts              # Teaser puzzle submission (captain)
    answer/route.ts              # Round 1 & Round 2 answer submission
    r3/
      answer/route.ts            # Round 3 box answer submission (captain)
    admin/
      login|logout/route.ts      # Admin session handling
      dashboard/route.ts         # Dashboard status + R3 live grid payload
      event/[action]/route.ts    # Start/end rounds, pause/resume, add-time, reset
      event/open-r3/route.ts     # Open Round 3 (with force flag support)
      round3/
        config/route.ts          # Master code & hint GET/PUT
        zones/route.ts           # All 5 zones + riddles + config GET
        zones/[id]/route.ts      # Zone name, start riddle, regenerate-token PUT
        riddles/[zone]/[box]/    # 20 box riddles editor PUT
        teams/route.ts           # R2 standings, R3 eligibility & zone assignment GET
        eligible/route.ts        # Toggle team eligibility POST
        assign-zone/route.ts     # Assign zone to team POST
        randomize/route.ts       # Randomize free zones POST
        override/[action]/       # Overrides (credit-scan, credit-box, reset-box, reassign-zone)
      export/
        r3/route.ts              # Round 3 results CSV export
        [name]/route.ts          # Generic exports (teams, attempts, logs)
      settings/route.ts          # Settings GET & PUT
      standings/route.ts         # R1 & R2 standings
      teams/[id]/route.ts        # Team updates (n, withdrawn, qualified)
      students/[id]/[action]/    # Absent/unabsent, make-captain
      interventions/[action]/    # Skip teaser, void question, cancel registration, admin register
      qr/ (+ [id])/route.ts      # QR CRUD
      riddles/ (+ [id])/route.ts # R1 riddles CRUD
      questions/ (+ [id])/       # R2 questions CRUD
      teasers/ (+ [id])/route.ts # Teaser puzzles CRUD
lib/
  db.ts                          # Server-only Supabase client (service role key)
  session.ts                     # Signed JWT tokens for players and admins (jose)
  dto.ts                         # Response mappers: never return raw database rows
  state.ts                       # Maps raw player state to screen DTO
  clock.ts                       # Clock helpers (database event_clock() is authority)
  messages.ts                    # Error codes to human-readable message mapping
  shuffle.ts                     # Deterministic seeded shuffle (FNV-1a + Mulberry32)
  game-service.ts                # Player RPC wrappers (r3_submit_box, scan_dispatch, etc.)
  admin-service.ts               # Admin RPC wrappers
  event-service.ts               # Event state & advance_event wrappers
supabase/migrations/
  001_schema.sql                 # Base schema, settings, tables, views, RLS
  002_functions.sql              # advance_event, clock, register_scan, attempt_result
  003_phase4.sql                 # Question assignment, teaser, submit_answer, player_state
  004_phase5.sql                 # Interventions, absences, cancellations, voiding
  005_phase10_fixes.sql          # Drops go_live, adds event_clock()
  006_round3.sql                 # Phase 10 Round 3 schema, zones, riddles, atomic RPCs, reset guard
scripts/
  seed.ts                        # Seeds test data, QR codes, riddles, R3 zones & 20 riddles
  create-admins.ts               # Creates admin accounts from SEED_ADMINS
  r3-simulate.ts                 # Full 5-team Round 3 simulation
  admin-smoke.ts                 # Asserts all admin routes return 200 & write to admin_log
  load-test.ts                   # 150 concurrent client load testing for /api/state
tests/
  sql/run.sh                     # Runs throwaway Postgres test database migrations and suites
  sql/phase10_round3.sql         # 14 test groups covering Round 3, overrides, reset, security
  sql/concurrency.sh             # Concurrency tests for scans and submissions
  *.test.ts                      # Vitest unit tests for pure functions
```

## 3. Database Functions & RPCs
- `advance_event()`: Lazy event progression on every mutating RPC and admin poll.
- `event_clock()`: Server-side event and wall clock computation.
- `scan_dispatch(p_student, p_token)`: Routes token to R2 `register_scan` or R3 `r3_scan`.
- `r3_preselect()`: Selects top 5 teams from R2 standings when entering break.
- `set_r3_eligible(p_team, p_eligible, p_admin_id)`: Admin eligibility toggle during break.
- `r3_assign_zone(p_team, p_zone, p_admin_id)`: Explicit zone allocation.
- `r3_randomize_zones(p_admin_id)`: Assigns remaining free zones randomly.
- `open_round3(p_force, p_admin_id)`: Starts Round 3 with break clock validation.
- `r3_scan(p_student, p_token)`: Captain scans zone start QR to unlock boxes (milestone 0).
- `r3_submit_box(p_student, p_box, p_value, p_request)`: Captain box submission, 2 tries per box, instant win on 4th correct.
- `r3_decide(p_reason, p_winner, p_admin_id)`: Ends Round 3 by code, progress, or admin decision.
- `r3_credit_scan`, `r3_credit_box`, `r3_reset_box`, `r3_reassign_zone`: Admin overrides with mandatory reason and logging.
- `reset_event_data(p_confirmation, p_admin_id)`: Clears game runtime tables while protecting configuration and content.
