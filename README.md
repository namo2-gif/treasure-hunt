# Campus Treasure Hunt

A mobile-first web app powering an intense, structured-chaos campus treasure hunt for ~100 participants.

---

## 1. Quick Start & Setup

### Environment Variables
Configure `.env.local` (local) or Vercel Environment Variables (production):

```env
SUPABASE_URL="https://<project-id>.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."
SESSION_SECRET="32_random_bytes_for_player_jwt"
ADMIN_SESSION_SECRET="different_32_bytes_for_admin_jwt"
BASE_URL="https://treasure-hunt-techspardha2k26.vercel.app"
SEED_ADMINS="asha:SecretPw1;ravi:SecretPw2"
```

### Database Migrations
Run all migrations in order in your Supabase SQL editor:
1. `supabase/migrations/001_schema.sql` (Base schema, settings, tables, views, RLS, service role grants)
2. `supabase/migrations/002_functions.sql` (Event clock, advance_event, event actions)
3. `supabase/migrations/003_phase4.sql` (Teasers, question assignments, attempt checks)
4. `supabase/migrations/004_phase5.sql` (Timing, hard end, void question, absent reassignments)
5. `supabase/migrations/005_phase10_fixes.sql` (Removes legacy go_live, introduces event_clock() function)
6. `supabase/migrations/006_round3.sql` (Phase 10 Round 3 schema, zones, riddles, atomic RPCs, reset guard)

### Seeding Data
Run:
```bash
npx tsx --env-file=.env.local scripts/seed.ts
npx tsx --env-file=.env.local scripts/create-admins.ts
```

---

## 2. Admin Operational Cheat Sheet

The admin panel is located at `/hq` (protected by the `th_admin` signed JWT cookie).

| Situation | Action to Take in `/hq` |
|-----------|-------------------------|
| **Campus Outage / Wi-Fi Drop** | **Add time**: In `/hq`, enter minutes (e.g. `5`) and click `Add time`. This shifts every deadline (R1 end, Run 2 opening, run deadlines, hard end, break, R3 end) forward simultaneously. |
| **Emergency Pause** | In `/hq`, click **Pause**. Freezes the event clock and stops all participant mutations with code `PAUSED`. Click **Resume** when ready. |
| **Start Round 3** | When Round 2 ends, the event enters `r2_break`. Top 5 teams are preselected. In `/hq` or `/hq/round3`, click **Start Round 3**. If clicked before the break timer expires, confirm with force to start immediately. |
| **Round 3 Overrides** | On `/hq/round3` Live Grid, use the **Overrides** menu for any team: Credit start QR scan, credit an unsolved box, reset a locked box (restores tries), or reassign their zone. Every override requires an admin reason and is logged. |
| **Emergency Game Reset Guard** | Located only at `/hq/event` inside the red **Danger Zone** card. Reset requires typing `RESET`. It is blocked while any round is actively running unless the event is paused. Keeps teams, student accounts, QR locations, settings, and content intact. |
| **Teammate Cannot Attend / Leaves** | Go to `/hq/teams`, find the student, and click **Mark Absent**. Pick an active teammate to take over their puzzle pieces and poster questions. Team size $N$ and points do not change. |
| **Captain Phone Dies / Lost** | Go to `/hq/teams`, locate the team, and click **Make Captain** on any other teammate. Captain privileges swap atomically in one transaction. |
| **Student Locked Out After Wrong Logins** | In `/hq/teams`, click **Unlock** on the student's card. If they forgot their code, click **Reset Code** (displays their new 6-character code once). |
| **Poster Stolen / Broken Clue** | Go to `/hq/interventions`, select **Void Question**, enter the Question ID, and supply a mandatory reason. Teams who answered it will have their scores credited without penalty. |
| **Physical Beacon Broken / QR Issue** | Go to `/hq/interventions`, use **Admin Register** to manually place a student at a location without capacity restrictions. |
| **Team Stuck on Teaser Due to Bug** | Go to `/hq/interventions`, use **Skip Teaser** with the Team ID and run number to immediately unlock poster questions. |

---

## 3. One-Page Outage Policy

> [!IMPORTANT]
> **Read this protocol before event day.**

If the site or network goes down during the event:

1. **Do Not Panic — State is Preserved:**
   All student registrations, piece assignments, scores, Round 3 box attempts, and timestamps live inside atomic Postgres rows. A network blip loses zero progress.
2. **If Downtime Lasts More Than 3 Minutes:**
   - Restore access or let campus connectivity recover.
   - Calculate how many minutes the outage lasted (e.g. 7 minutes).
   - In `/hq`, enter `7` into the **Add time** field and click **Add time**.
   - This smoothly pushes back Round 1 deadlines, Run 2 opening marks, individual run timers, break ends, and Round 3 end timers all at once without changing phase logic.
3. **Player Recovery:**
   - Players simply refresh their browser on their phones.
   - The polling client automatically catches up with the latest server event clock and picks up on the exact screen and riddle/box where they left off.
4. **Emergency Data Backup:**
   - Real-time snapshots can be downloaded anytime via `/hq/logs` (`registrations.csv`, `attempts.csv`, and `standings.csv`) and `/hq/round3` (`export/r3`).

---

## 4. Running Verification & Load Tests

### Unit & Security Test Suite
```bash
npm test
```

### Round 3 End-to-End Simulation
```bash
npx tsx --env-file=.env.local scripts/r3-simulate.ts
```
Simulates a complete 5-team Round 3 hunt: opens R3, executes captain QR scans, submits box answers in scripted order, and asserts instant game completion when the 4th box is solved.

### Admin Smoke Test
```bash
npx tsx --env-file=.env.local scripts/admin-smoke.ts
```
Asserts admin routes return 200 and create verified entries in `admin_log`.

### 150-Client Load Test
```bash
npx tsx --env-file=.env.local scripts/load-test.ts --duration=60 --clients=150
```
Simulates 150 live participants polling `/api/state` with realistic random jitter across all screens (including R3 screens), asserting zero 5xx errors and p95 latency under 800 ms.
