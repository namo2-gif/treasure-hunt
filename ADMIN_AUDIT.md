# Admin Control Audit (`ADMIN_AUDIT.md`)

This audit records every admin control, route, underlying database function or RPC, verification method, and verification result per AGENTS.md Section 15.1 (A7) and Section 15.11.

---

## 1. Responsive Screen Audits (A2 & A3)

| Page | Viewport | Max Scroll Width vs Inner Width | Overlapping Text / Clipped Controls | Result |
|------|----------|---------------------------------|--------------------------------------|--------|
| `/hq` (Dashboard) | 360 px (Mobile) | `scrollWidth <= innerWidth` (Drawer menu, one col) | None. Primary action sticky, cards wrap. | PASS |
| `/hq` (Dashboard) | 768 px (Tablet) | `scrollWidth <= innerWidth` | None. Clean two-column grid. | PASS |
| `/hq` (Dashboard) | 1280 px (Laptop) | `scrollWidth <= innerWidth` (Top nav bar, live metrics) | None. | PASS |
| `/hq` (Dashboard) | 1920 px (Desktop) | `scrollWidth <= innerWidth` | None. Full container max-w-7xl centered. | PASS |
| `/hq/settings` | 360 px (Mobile) | `scrollWidth <= innerWidth` (Card-per-setting, `min-w-0`) | None. Sticky save button at bottom. | PASS |
| `/hq/settings` | 768 px (Tablet) | `scrollWidth <= innerWidth` | None. Responsive flex wrap. | PASS |
| `/hq/settings` | 1280 px (Laptop) | `scrollWidth <= innerWidth` | None. | PASS |
| `/hq/round3` | 360 px (Mobile) | `scrollWidth <= innerWidth` (Table inside `overflow-x-auto`) | None. Tabbed sections, clean modals. | PASS |
| `/hq/round3` | 768 px (Tablet) | `scrollWidth <= innerWidth` | None. Clean responsive tables and cards. | PASS |
| `/hq/round3` | 1280 px (Laptop) | `scrollWidth <= innerWidth` | None. Full width live grid with 11 columns. | PASS |
| `/hq/round3/qr-sheet` | Half-A4 Print | Formatted 2 cards per A4 page with page break | None. High-contrast QR codes for physical printing. | PASS |
| `/hq/standings` | 360 px (Mobile) | `scrollWidth <= innerWidth` (Horizontal scroll table) | None. Shows R1 & R2 points & rank. | PASS |
| `/hq/teams` | 360 px (Mobile) | `scrollWidth <= innerWidth` | None. | PASS |
| `/hq/content` | 360 px (Mobile) | `scrollWidth <= innerWidth` | None. | PASS |
| `/hq/qr` | 360 px (Mobile) | `scrollWidth <= innerWidth` | None. | PASS |
| `/hq/interventions` | 360 px (Mobile) | `scrollWidth <= innerWidth` | None. | PASS |
| `/hq/logs` | 360 px (Mobile) | `scrollWidth <= innerWidth` | None. | PASS |

---

## 2. Admin API & Control Route Audit

| Page | Control | Route | Function / RPC | How Verified | Result |
|------|---------|-------|----------------|--------------|--------|
| `/hq` | Start Round 1 | `POST /api/admin/event/start-r1` | `start_round1()` | `tests/sql/run.sh`, `admin-smoke.ts` | PASS |
| `/hq` | End Round 1 | `POST /api/admin/event/end-r1` | `end_round1()` | `tests/sql/run.sh` | PASS |
| `/hq` | Start Round 2 | `POST /api/admin/event/start-r2` | `start_round2()` | `tests/sql/phase4.sql` | PASS |
| `/hq` | End Round 2 | `POST /api/admin/event/end-r2` | `end_round2()` | `tests/sql/run.sh` | PASS |
| `/hq` | Start Round 3 (Normal / Force) | `POST /api/admin/event/open-r3` | `open_round3(p_force)` | `tests/sql/phase10_round3.sql`, `r3-simulate.ts` | PASS |
| `/hq` | End Event | `POST /api/admin/event/end-event` | `end_event()` | `tests/sql/phase10_round3.sql` | PASS |
| `/hq` | Pause Event | `POST /api/admin/event/pause` | `pause_event()` | `tests/sql/run.sh` | PASS |
| `/hq` | Resume Event | `POST /api/admin/event/resume` | `resume_event()` | `tests/sql/run.sh` | PASS |
| `/hq` | Add Time (+X mins) | `POST /api/admin/event/add-time` | `add_time(minutes)` | `tests/sql/run.sh` | PASS |
| `/hq/event` | Reset Event Data (Danger Zone) | `POST /api/admin/event/reset` | `reset_event_data(confirmation)` | `tests/sql/phase10_round3.sql` | PASS |
| `/hq` | Dashboard Data Polling | `GET /api/admin/dashboard` | `advance_event()`, `event_clock()`, direct queries | `scripts/admin-smoke.ts` | PASS |
| `/hq/settings` | Load Settings | `GET /api/admin/settings` | direct read from `settings` table | `scripts/admin-smoke.ts` | PASS |
| `/hq/settings` | Save Settings | `PUT /api/admin/settings` | updates `settings`, logs to `admin_log` | `scripts/admin-smoke.ts` | PASS |
| `/hq/standings` | View R1 & R2 Scores | `GET /api/admin/standings` | queries `r1_standings`, `r2_standings` | `scripts/admin-smoke.ts` | PASS |
| `/hq/teams` | Edit Team (n, qualified, withdrawn) | `PATCH /api/admin/teams/[id]` | updates `teams`, logs to `admin_log` | `scripts/admin-smoke.ts` | PASS |
| `/hq/teams` | Make Captain | `POST /api/admin/students/[id]/make-captain` | updates `students.is_captain`, logs to `admin_log` | `scripts/admin-smoke.ts` | PASS |
| `/hq/teams` | Admin Register Student to QR | `POST /api/admin/interventions/admin-register` | `admin_register()` / direct registration RPC | `scripts/admin-smoke.ts` | PASS |
| `/hq/teams` | Reset Attempts | `POST /api/admin/interventions/reset-attempts` | deletes attempts, logs to `admin_log` | `scripts/admin-smoke.ts` | PASS |
| `/hq/round3` | Master Code & Hint Save | `PUT /api/admin/round3/config` | `r3_set_code()`, `r3_set_hint()` | `phase10_round3.sql`, `admin-smoke.ts` | PASS |
| `/hq/round3` | Fetch Zones & Riddles | `GET /api/admin/round3/zones` | reads `r3_zones`, `r3_riddles`, `r3_config` | `admin-smoke.ts`, `qr-sheet` | PASS |
| `/hq/round3` | Update Zone & Start Riddle | `PUT /api/admin/round3/zones/[id]` | updates `r3_zones`, logs to `admin_log` | `admin-smoke.ts` | PASS |
| `/hq/round3` | Regenerate Zone Token | `PUT /api/admin/round3/zones/[id]` | updates `r3_zones.token`, logs to `admin_log` | `admin-smoke.ts` | PASS |
| `/hq/round3` | Update Box Riddle (1-20) | `PUT /api/admin/round3/riddles/[zone]/[box]` | updates `r3_riddles`, logs to `admin_log` | `admin-smoke.ts` | PASS |
| `/hq/round3` | Fetch R2 Teams & Eligibility | `GET /api/admin/round3/teams` | joins `teams`, `r2_standings`, `r3_team` | `admin-smoke.ts` | PASS |
| `/hq/round3` | Toggle R3 Eligibility | `POST /api/admin/round3/eligible` | `set_r3_eligible()` | `phase10_round3.sql` | PASS |
| `/hq/round3` | Assign Zone to Team | `POST /api/admin/round3/assign-zone` | `r3_assign_zone()` | `phase10_round3.sql` | PASS |
| `/hq/round3` | Randomize Free Zones | `POST /api/admin/round3/randomize` | `r3_randomize_zones()` | `phase10_round3.sql` | PASS |
| `/hq/round3` | Override: Credit Start QR | `POST /api/admin/round3/override/credit-scan` | `r3_credit_scan()` | `phase10_round3.sql` | PASS |
| `/hq/round3` | Override: Credit Box | `POST /api/admin/round3/override/credit-box` | `r3_credit_box()` | `phase10_round3.sql` | PASS |
| `/hq/round3` | Override: Reset Box | `POST /api/admin/round3/override/reset-box` | `r3_reset_box()` | `phase10_round3.sql` | PASS |
| `/hq/round3` | Override: Reassign Zone | `POST /api/admin/round3/override/reassign-zone` | `r3_reassign_zone()` | `phase10_round3.sql` | PASS |
| `/hq/round3` | Export Round 3 Results CSV | `GET /api/admin/export/r3` | formats R3 standings, milestones, times to CSV | `scripts/admin-smoke.ts` | PASS |
| `/hq/interventions` | Mark Absent | `POST /api/admin/students/[id]/absent` | `mark_absent()` | `tests/sql/run.sh` | PASS |
| `/hq/interventions` | Unmark Absent | `POST /api/admin/students/[id]/unabsent` | `unmark_absent()` | `tests/sql/run.sh` | PASS |
| `/hq/interventions` | Cancel Registration | `POST /api/admin/interventions/cancel-registration` | `cancel_registration()` | `tests/sql/run.sh` | PASS |
| `/hq/interventions` | Void Question | `POST /api/admin/interventions/void-question` | `void_question()` | `tests/sql/run.sh` | PASS |
| `/hq/interventions` | Skip Teaser | `POST /api/admin/interventions/skip-teaser` | `skip_teaser()` | `tests/sql/phase4.sql` | PASS |
| `/hq/qr` | Create QR Location | `POST /api/admin/qr` | inserts `qr_locations`, logs to `admin_log` | `scripts/admin-smoke.ts` | PASS |
| `/hq/qr` | Update QR Location | `PATCH /api/admin/qr/[id]` | updates `qr_locations`, logs to `admin_log` | `scripts/admin-smoke.ts` | PASS |
| `/hq/content` | Riddles, Questions, Teasers CRUD | `GET/POST/PUT/DELETE /api/admin/*` | updates content tables with lock guards | `scripts/admin-smoke.ts` | PASS |
| `/hq/logs` | Fetch Admin Logs | `GET /api/admin/log` | reads append-only `admin_log` | `scripts/admin-smoke.ts` | PASS |
| `/hq/logs` | Export Event Data CSVs | `GET /api/admin/export/[name]` | generates CSVs for teams, attempts, logs, etc. | `scripts/admin-smoke.ts` | PASS |
