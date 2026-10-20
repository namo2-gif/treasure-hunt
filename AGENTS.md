# Campus Treasure Hunt: Build Specification

This file is the single source of truth for the coding agent. Save it as `AGENTS.md` in the repository root.

---

## 0. Rules for the coding agent (read first)

1. Read this whole file before writing code. If anything else (comments, older documents, your own preferences) conflicts with this file, this file wins.
2. Do not redesign, rename, add features, or add libraries beyond Section 2. Where something is unspecified, choose the simplest option, add one line to `DECISIONS.md`, and continue. Stop and ask only for missing credentials or a real contradiction inside this file.
3. Build phase by phase (Section 12). Run each phase's "Done when" checks, fix failures, commit, then stop and wait for the next instruction. Never start a later phase early.
4. The browser is untrusted. Every rule is enforced in server code or Postgres. Identity comes only from the signed session cookie, never from a request body.
5. Never send correct answers, scores, point values, or Round 3 clue/password/room to a client that is not entitled to them. Build every response through the mappers in `lib/dto.ts`. Never return raw database rows.
6. Every state-changing player action is atomic and idempotent (Sections 6 and 7).
7. No cron jobs, websockets, background workers, or external services other than Supabase and Vercel. Time-based changes are evaluated lazily (Section 4).
8. All placeholder content is marked `[PLACEHOLDER]`. Real content is entered later through the admin panel.
9. **Section 15 (Phase 10) overrides every older rule about Round 3, live mode, reset, the break clock and the admin layout.** Where Section 15 and any other section disagree, Section 15 wins. Phases 0 to 9 are already built; Phase 8 (the old password-claim Round 3) is replaced by Phase 10.
10. **Section 16 (Phase 11) overrides Section 15 and every older rule where they disagree.** It covers: Round 1 shows no correct or incorrect result (6.4 R1 branch, 8.1 R1 payload, 8.3), Round 1 scores are archived and cleared when Round 2 starts, admin paging, the admin JSON and layout repair, and the 75-team scale (about 375 players). Phase 10 migrations `005` and `006` may not be applied on the real database; Section 16.1 handles that.

---

## 1. Product summary

A mobile-first web app that runs a campus treasure hunt for about 375 players (about 75 teams in Round 1).

- **Players** are pre-registered with a student ID and team. Teams have 3 to 5 members, one of whom is the captain. Players log in with student ID plus a personal code.
- **Round 1:** a 30-minute website riddle quiz (one riddle per page, no result shown to players, Section 16.4). The captain submits for the team. Teams are ranked, and the top N (default 25) are selected for Round 2.
- **Round 2:** a 60-minute QR race made of two runs. In each run, members scan QR codes around campus, each scan reveals a teaser puzzle piece, the captain solves the teaser, then the team answers N poster-based questions (one per member). The captain submits.
- **Round 3 (see Section 15):** a 40-minute location hunt for the top 5 teams (admin can change the 5). Each team gets its own zone. The captain scans the zone QR (milestone 0), which unlocks 4 riddles and 4 one-character boxes (a digit then three letters), each with 2 tries. Every correct box is a milestone. The first team to enter all four correctly wins and the event ends for everyone; otherwise the furthest team wins when time runs out. Only the admin sees ranks.
- **Admin panel** controls the clock, content, interventions and exports.

---

## 2. Stack, structure, conventions

### 2.1 Stack (fixed)

- Next.js (current stable), App Router, TypeScript strict, Tailwind CSS.
- Supabase Postgres. Accessed **only from server code** using `@supabase/supabase-js` with the service-role key. Atomic logic lives in Postgres functions called through `.rpc()`. There are no direct Postgres connections.
- Libraries allowed: `@supabase/supabase-js`, `jose` (JWT), `bcryptjs`, `zod`, `qrcode`, `csv-parse`. Dev only: `eslint`, `vitest`, `tsx`. Nothing else.
- Hosting: Vercel, deployed from GitHub `main`.

### 2.2 Environment variables

| Name | Purpose |
|------|---------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Never prefix with `NEXT_PUBLIC_`. Holds the Supabase **secret key** (`sb_secret_...`); a legacy `service_role` key also works. Use it exactly as the service-role key |
| `SESSION_SECRET` | Signs player JWTs (32+ random bytes) |
| `ADMIN_SESSION_SECRET` | Signs admin JWTs (different value) |
| `BASE_URL` | Public site URL, used to build QR links |
| `SEED_ADMINS` | Up to 3 admin accounts as `username:password` pairs separated by `;`, for example `asha:Pw1;ravi:Pw2`. Passwords must not contain `:` or `;`. Read by `scripts/create-admins.ts`. All admins have the same full access |

Local values live in `.env.local` (git-ignored; never commit it). Scripts must load it explicitly: run them as `tsx --env-file=.env.local scripts/<name>.ts`. On Vercel the same names are set in Project Settings, with `BASE_URL` set to the production URL.

### 2.3 Manual steps for the human (tell them when you reach Phase 0)

1. Create a Supabase project. Copy the URL and service-role key.
2. Create a Vercel project from the GitHub repo and set the env vars above.
3. Create the Supabase project with these options: **Enable Data API = ON** (required: `supabase-js` and `.rpc()` use it), **Automatically expose new tables and functions = OFF**, **Automatic RLS = ON**. The migrations grant `service_role` explicitly, so the OFF setting is safe.
4. Run the SQL migrations (Section 5) in the Supabase SQL editor, in order.

### 2.4 Repository layout

```
app/
  (player)/            login, home, scan page /s/[token]
  hq/                  admin UI (Section 9)
  api/                 route handlers (Section 7)
lib/
  db.ts                server-only supabase client (import 'server-only')
  session.ts           player + admin JWT helpers
  dto.ts               response mappers (no raw rows leave the server)
  shuffle.ts           seeded shuffle (Section 2.6)
  messages.ts          error code to player text (Section 8.3)
supabase/migrations/   001_schema.sql, 002_functions.sql
scripts/               seed.ts (test data), create-admins.ts, concurrency-test.ts, load-test.ts
DECISIONS.md           one line per unspecified choice you made
```

### 2.5 API conventions

- Domain rejections (wrong phase, full QR, wrong answer, locked, and so on) return HTTP 200 with `{ ok:false, code, message }`. Success returns `{ ok:true, ... }`.
- HTTP 401 for no or invalid session, 400 for validation errors (validate every body with `zod`). The client treats only network failures and 5xx as "retrying".
- Every state-changing player request carries a client-generated UUID `requestId`. The client resends the **same** `requestId` on retry. The server stores it (`attempts.request_id`) and returns the original result on repeat. Scans and password claims are idempotent by their natural keys (Section 6).
- All API routes that use bcrypt or Supabase set `export const runtime = 'nodejs'`.
- JSON uses camelCase. The database uses snake_case.

### 2.6 Seeded shuffle (use exactly this)

Option order is deterministic per team and item, so it is never stored.

```ts
function fnv1a(s: string) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const a = [...items], rnd = mulberry32(fnv1a(seed));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// seed = `${teamId}:r1:${riddleId}` or `${teamId}:r2:${questionId}`
```

### 2.7 Text normalisation

For teaser answers: lowercase, trim, collapse internal whitespace to a single space. Nothing else. SQL: `lower(regexp_replace(trim(x), '\s+', ' ', 'g'))`. Store `answer_norm` already normalised. (Round 3 box values use their own rule in Section 15.4.7.)

### 2.8 UI rules

Mobile-first (design for 360 px width), one column, max width 480 px, system font, large tap targets, dark theme with one accent colour, no animation libraries, no images beyond QR codes. Player pages must stay light for slow data. Tone is playful and slightly mysterious (the "structured chaos" feel) but messages stay short.

---

## 3. Settings (table `settings`, editable in the admin panel)

| Key | Default | Locks when |
|-----|---------|------------|
| `top_n_r2` | 25 | never (informational for selection) |
| `top_n_r3` | 5 | never |
| `r1_minutes` | 30 | phase leaves `setup` |
| `r2_minutes` | 60 | phase leaves `r1_closed` |
| `run_cap_minutes` | 30 | phase leaves `r1_closed` |
| `break_minutes` | 3 | never |
| `run_total_points` | 120 | phase leaves `r1_closed` |
| `r1_points_per_riddle` | 1 | phase leaves `setup` |
| `tries_r1` | 1 | phase leaves `setup` |
| `tries_r2` | 2 | phase leaves `r1_closed` |
| `default_qr_capacity` | 12 | never |
| `variants_per_question` | 2 | never |
| `password_max_wrong` | 5 | never |
| `password_lockout_s` | 30 | never |

"Locks" means the admin API rejects edits (code `SETTING_LOCKED`) once the phase has moved past the stated point.

Points per R2 question: `full = floor(run_total_points / n)`, `half = floor(full / 2)`. With 120: n=3 gives 40/20, n=4 gives 30/15, n=5 gives 24/12. `teams.n` is constrained to 3 to 5.

**Content edits:** a riddle's or question's text (`stem`) may be edited at any time. Its options and correct answer lock once any attempt exists for it. Typos are fixed through the stem; real errors use "void" (Section 9).

---

## 4. Event clock and phases

### 4.1 One pausable event clock

`event_now_ms = (epoch_ms(now()) - paused_total_ms) - (paused_at is null ? 0 : epoch_ms(now()) - epoch_ms(paused_at))`.

Every deadline and timestamp (`r1_end_ms`, `opens_ms`, `deadline_ms`, `created_ms`, and so on) is stored in **event time**, so one pause moves everything together. The SQL function `event_now_ms()` is the only clock. Never use the client clock or JS `Date.now()` for any rule. The client shows countdowns by taking `eventNowMs` from the last API response, adding the local time elapsed since that response, and subtracting from the deadline. When paused it freezes.

### 4.2 Phases (`event_state.phase`)

| From | Trigger | To | Effects |
|------|---------|----|---------|
| `setup` | admin "Start Round 1" | `r1_running` | `r1_end_ms = now + r1_minutes` |
| `r1_running` | `event_now >= r1_end_ms`, or admin "End Round 1" | `r1_closed` | none |
| `r1_closed` | admin "Start Round 2" (at least 1 qualified team) | `r2_running` | `r2_start_ms = now`; `run2_open_ms = now + run_cap_minutes`; `r2_hard_end_ms = now + r2_minutes`; insert `team_run` run 1 for every qualified team with `opens_ms = now`, `deadline_ms = min(now + cap, hard_end)` |
| `r2_running` | `event_now >= r2_hard_end_ms`, or admin "End Round 2" | `r2_break` | `break_end_ms = hard_end + break_minutes` (if ended manually, `hard_end = now` first) |
| `r2_break` | admin "Start Round 3" (before the break ends only with a force confirm) | `r3_open` | run `open_round3(p_force)` (Section 15.4.4); `r3_start_ms = now`; `r3_end_ms = now + r3_minutes` |
| `r3_open` | a team solves all 4 boxes, or `event_now >= r3_end_ms`, or admin "End event" | `ended` | `r3_result` is written (Section 15.4.7, 15.4.8) |

`event_state.paused_at` is independent of phase. While paused, every player mutation is rejected with `PAUSED`.

### 4.3 Lazy evaluation (no cron)

`advance_event()` is a Postgres function that is idempotent and cheap. It is called as the first statement of every mutating RPC, and once per `/api/state` request and per admin dashboard poll. It does:

1. If `r1_running` and `event_now >= r1_end_ms`: set `r1_closed`.
2. If `r2_running` and `event_now >= r2_hard_end_ms`: set `r2_break` and `break_end_ms`.
3. If `r2_running` and `event_now >= run2_open_ms`: for every qualified, non-withdrawn team without a run 2 row, insert `team_run` run 2 with `opens_ms = run2_open_ms`, `deadline_ms = min(opens + cap, hard_end)`.
4. (Phase 10) If `r3_open` and `event_now >= r3_end_ms`: call `r3_decide('progress')`. When step 2 moves the phase to `r2_break`, also call `r3_preselect()` (Section 15.4).

Unanswered questions are **never written as locked**. A question counts as 0 when the run deadline has passed. `submit_answer` rejects after the deadline, and standings sum only real attempt rows.

### 4.4 Pause, resume, add time

- **Pause:** allowed in `r1_running`, `r2_running`, `r2_break`, `r3_open`. Sets `paused_at = now()`.
- **Resume:** `paused_total_ms += now() - paused_at`; `paused_at = null`.
- **Add time (X minutes):** `paused_total_ms += X*60000`. This is the only way to give more time. It pushes every deadline later by X (Round 1 end, Run 2 opening, run deadlines, hard end, break) all at once. Use it after an outage (the panel is unreachable during an outage, so nobody can press Pause) or whenever the event needs more time.

All three are logged to `admin_log`.

### 4.5 Current run of a team

`current_run(team) = highest run in team_run where opens_ms <= event_now`. A run is **open** when `finished_ms is null` and `event_now < deadline_ms`. A run is **finished** when all N of the team's `team_questions` for that run are resolved: voided, or have a correct attempt, or have `tries_r2` wrong attempts. When a team finishes run 1 and run 2 does not exist yet, `submit_answer` inserts run 2 with `opens_ms = event_now`, `deadline_ms = min(event_now + cap, hard_end)`.

---

## 5. Database schema

Put in `supabase/migrations/001_schema.sql`. Run exactly as written.

```sql
create extension if not exists pgcrypto;

create table settings (key text primary key, value jsonb not null);

create table event_state (
  id smallint primary key check (id = 1),
  mode text not null default 'test' check (mode in ('test','live')),
  phase text not null default 'setup' check (phase in ('setup','r1_running','r1_closed','r2_running','r2_break','r3_open','ended')),
  paused_at timestamptz,
  paused_total_ms bigint not null default 0,
  r1_end_ms bigint, r2_start_ms bigint, run2_open_ms bigint, r2_hard_end_ms bigint, break_end_ms bigint
);
insert into event_state (id) values (1);

create function event_now_ms() returns bigint language sql stable as $$
  select (extract(epoch from now()) * 1000)::bigint
         - paused_total_ms
         - case when paused_at is null then 0
                else ((extract(epoch from now()) - extract(epoch from paused_at)) * 1000)::bigint end
  from event_state where id = 1
$$;

create table teams (
  id text primary key, name text not null,
  n smallint not null check (n between 3 and 5),
  withdrawn boolean not null default false,
  qualified boolean not null default false,
  r3_eligible boolean not null default false,
  pw_wrong int not null default 0,              -- Round 3 password throttle
  pw_blocked_until timestamptz
);

create table students (
  id text primary key, name text not null,
  team_id text not null references teams(id),
  is_captain boolean not null default false,
  absent boolean not null default false,
  code_hash text not null,
  failed_logins int not null default 0,
  locked_until timestamptz
);
create unique index one_captain_per_team on students(team_id) where is_captain;

create table admins (
  id serial primary key, username text unique not null, password_hash text not null,
  failed_logins int not null default 0, locked_until timestamptz
);

create table qr_locations (
  id serial primary key, name text not null, token text unique not null,
  capacity int not null default 12 check (capacity > 0), active boolean not null default true
);

-- options format everywhere: [{"id":"a","text":"..."}, ...] with 8 to 10 items, ids 'a'..'j'
create table riddles (
  id serial primary key, position int not null, text text not null,
  options jsonb not null, correct_option_id text not null
);

create table teaser_puzzles (
  id serial primary key, run smallint not null check (run in (1,2)), size smallint not null check (size between 3 and 5),
  pieces jsonb not null,            -- array of exactly `size` strings
  answer_norm text not null,
  unique (run, size)
);

create table questions (
  id serial primary key, run smallint not null check (run in (1,2)),
  slot smallint not null check (slot between 1 and 5), variant smallint not null check (variant >= 1),
  qr_id int not null references qr_locations(id),   -- restrict delete: poster location by ID
  stem text not null, options jsonb not null, correct_option_id text not null,
  unique (run, slot, variant)
);

create table registrations (
  id bigserial primary key, run smallint not null,
  team_id text not null references teams(id), student_id text not null references students(id),
  qr_id int not null references qr_locations(id), slot_no int not null, created_ms bigint not null,
  unique (team_id, qr_id, run),      -- one member per team per QR per run
  unique (student_id, run),          -- one registration per student per run
  unique (student_id, qr_id),        -- a student never reuses a QR across runs
  unique (qr_id, run, slot_no)       -- slot_no between 1 and capacity
);

create table piece_assignments (
  run smallint not null, team_id text not null references teams(id), piece_no smallint not null,
  student_id text not null references students(id),
  via text not null check (via in ('scan','admin')),
  primary key (run, team_id, piece_no)
);

create table team_run (
  team_id text not null references teams(id), run smallint not null check (run in (1,2)),
  opens_ms bigint not null, deadline_ms bigint not null,
  teaser_done_ms bigint, teaser_skipped boolean not null default false,
  finished_ms bigint,
  primary key (team_id, run)
);

create table team_questions (
  team_id text not null references teams(id), run smallint not null,
  question_no smallint not null,            -- 1..N; question_no k belongs to the holder of piece k
  slot smallint not null, question_id int not null references questions(id),
  voided boolean not null default false,
  primary key (team_id, run, question_no),
  unique (team_id, run, slot)
);

create table attempts (
  id bigserial primary key, request_id uuid not null unique,
  team_id text not null references teams(id), student_id text not null references students(id),
  riddle_id int references riddles(id), question_id int references questions(id),
  option_id text not null, try_no smallint not null, correct boolean not null,
  points int not null, created_ms bigint not null,
  check ((riddle_id is null) <> (question_id is null)),
  unique (team_id, riddle_id, try_no), unique (team_id, question_id, try_no)
);

create table score_adjustments (
  id bigserial primary key, team_id text not null references teams(id), run smallint not null,
  question_id int references questions(id), points int not null, reason text not null,
  admin_id int references admins(id), created_ms bigint not null
);

create table round3 (
  id smallint primary key check (id = 1),
  clue_text text not null default '', password_norm text not null default '',
  key_info text not null default '', room text not null default ''
);
insert into round3 (id) values (1);

create table round3_claim (
  id smallint primary key check (id = 1),     -- only one row can ever exist
  team_id text not null references teams(id), student_id text not null references students(id),
  created_ms bigint not null
);

create table admin_log (
  id bigserial primary key, admin_id int references admins(id), action text not null,
  target text, before jsonb, after jsonb, created_at timestamptz not null default now()
);
create function admin_log_immutable() returns trigger language plpgsql as $$
begin raise exception 'admin_log is append-only'; end $$;
create trigger admin_log_no_change before update or delete on admin_log
  for each row execute function admin_log_immutable();

insert into settings (key, value) values
 ('top_n_r2','25'),('top_n_r3','5'),('r1_minutes','30'),('r2_minutes','60'),('run_cap_minutes','30'),
 ('break_minutes','3'),('run_total_points','120'),('r1_points_per_riddle','1'),('tries_r1','1'),('tries_r2','2'),
 ('default_qr_capacity','12'),('variants_per_question','2'),
 ('password_max_wrong','5'),('password_lockout_s','30');

-- standings (rank() gives ties the same rank, so ties at the cutoff all advance)
create view r1_standings as
select t.id as team_id,
       coalesce(sum(a.points), 0)::int as points,
       max(a.created_ms) filter (where a.points > 0) as last_ms
from teams t left join attempts a on a.team_id = t.id and a.riddle_id is not null
where not t.withdrawn group by t.id;

create view r2_standings as
select t.id as team_id,
  (coalesce((select sum(points) from attempts a where a.team_id = t.id and a.question_id is not null), 0)
 + coalesce((select sum(points) from score_adjustments s where s.team_id = t.id), 0))::int as points,
  (select max(created_ms) from attempts a where a.team_id = t.id and a.question_id is not null and a.points > 0) as last_ms
from teams t where t.qualified and not t.withdrawn;
-- ordering everywhere: points desc, last_ms asc nulls last.
-- rank: rank() over (order by points desc, last_ms asc nulls last). Adjustments never affect last_ms.

-- security: deny everything to anon/authenticated; only the service role (server) is used
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;
revoke all on all tables in schema public from anon, authenticated;

-- The project is created with "Automatically expose new tables" OFF, so nothing is granted to
-- any API role by default. The server uses the secret key (role service_role), which needs
-- explicit privileges. ALL includes TRUNCATE, which reset_event_data() needs.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
```

**Note (Phase 10):** the `round3` and `round3_claim` tables and the `teams.pw_*` columns above are already applied in the database; migration `006_round3.sql` (Section 15.3) drops them. Do not edit `001_schema.sql`.

`002_functions.sql` contains the functions of Section 6. At its end: `revoke execute on all functions in schema public from public, anon, authenticated; grant execute on all functions in schema public to service_role;`.

---

## 6. Atomic functions (Postgres, called via `.rpc()`)

All return `jsonb`: `{ "ok": true, ... }` or `{ "ok": false, "code": "CODE" }`. All start with `perform advance_event();`. Lock order is always **QR row, then team row, then team_questions row**, to avoid deadlocks. Player functions reject with `PAUSED` when `event_state.paused_at is not null`.

### 6.1 `register_scan(p_student text, p_token text)`

1. Load student and team. If the team is not `qualified` or is `withdrawn`: `NOT_IN_ROUND`. If `student.absent`: `ABSENT`. If phase is not `r2_running`: `WRONG_PHASE`.
2. Find the QR by token: none gives `INVALID_QR`; inactive gives `QR_INACTIVE`.
3. Determine the run: `current_run(team)`. If that run is not open: `WRONG_PHASE`.
4. `select ... for update` the QR row, then the team row.
5. If this student already has a registration for this run: same QR returns `{ok:true, already:true, ...}` (idempotent); a different QR returns `ALREADY_REGISTERED`.
6. If the team already has a registration at this QR for this run: `TEAMMATE_HERE`.
7. If this student has a registration at this QR in any run: `QR_USED_BEFORE`.
8. If the team's piece assignments for this run already number N: `TEAM_COMPLETE`.
9. If registrations at this QR for this run are at or above `capacity`: `QR_FULL`.
10. Insert the registration with `slot_no` = smallest free integer from 1 to capacity. Insert a `piece_assignments` row with `piece_no` = smallest free integer from 1 to N, `via='scan'`.
11. Return `{ok:true, run, piece_no, qr_name}`. Rejections write nothing, so they consume no capacity.

### 6.2 `solve_teaser(p_student text, p_answer text)` (captain only)

1. Not captain: `NOT_CAPTAIN`. Current run not open: `WRONG_PHASE`. Teaser already done or skipped: return `{ok:true, already:true}`.
2. If assigned pieces < N: `TEASER_NOT_READY`.
3. Compare normalised answer to `teaser_puzzles(run, size=N).answer_norm`. Missing puzzle: `CONTENT_MISSING`. Wrong: return `TEASER_WRONG`. Unlimited tries, no points, no throttle.
4. Correct: set `teaser_done_ms = event_now`, call `assign_questions(team, run)`, return `{ok:true}`.

`skip_teaser(team, run)` (admin) sets `teaser_skipped = true` and calls `assign_questions`.

### 6.3 `assign_questions(team, run)` (idempotent; no-op if rows exist)

Under `pg_advisory_xact_lock(hashtext('assign:' || run))`:

1. Count existing `team_questions` per `slot` for this run. Choose the N slots (from 1 to 5) with the lowest counts, ties random.
2. For each chosen slot, choose the variant with the fewest existing `team_questions` rows (ties random).
3. Assign `question_no` 1..N to the chosen slots in random order. Insert the rows.

### 6.4 `submit_answer(p_student text, p_kind text, p_key int, p_option text, p_request uuid)`

`p_kind` is `'r1'` (key = riddle id) or `'r2'` (key = question_no).

1. If an attempt with `request_id = p_request` exists, return its derived result (below). Never insert twice.
2. Not captain: `NOT_CAPTAIN`.
3. **R1:** phase must be `r1_running` and `event_now < r1_end_ms`, else `WRONG_PHASE`. Riddle must exist. `max_tries = tries_r1`, `full = r1_points_per_riddle`.
   **R2:** the team's current run must be open, the teaser done or skipped (else `TEASER_NOT_READY`), and `team_questions(run, question_no = p_key)` must exist and not be voided. `max_tries = tries_r2`, `full = floor(run_total_points / N)`.
4. Lock the `team_questions` row (R2) or the team row (R1).
5. Count existing attempts for this team and item. Any correct: `ALREADY_DONE`. Count at or above `max_tries`: `LOCKED`.
6. `p_option` must be one of the item's option ids, else `INVALID_OPTION`.
7. Insert the attempt: `try_no = count + 1`, `correct = (p_option = correct_option_id)`, `points = correct ? (try_no = 1 ? full : floor(full/2)) : 0`, `created_ms = event_now`.
8. R2 only: if all N questions of the run are now resolved, set `team_run.finished_ms = event_now`; if run = 1 and run 2 does not exist and phase is `r2_running`, insert run 2 (Section 4.5).
9. Return `{ok:true, status, runFinished}` where `status` is `correct`, `wrong_one_left` (wrong and `try_no < max_tries`), or `locked` (wrong and `try_no = max_tries`). Never return points or the correct option.
   Derived result for step 1: same mapping from the stored attempt.

### 6.5 Round 3 gameplay functions

**Superseded by Section 15.4.** The password claim (`claim_round3`) no longer exists. Round 3 uses `r3_scan` and `r3_submit_box`.

### 6.6 `open_round3`

**Superseded by Section 15.4.4.**

### 6.7 Admin functions (each writes `admin_log` with before and after)

`start_round1`, `end_round1`, `start_round2`, `end_round2`, `open_round3` (6.6), `end_event`, `pause_event`, `resume_event`, `add_time(minutes)` (Section 4.4); `set_qualified(team, bool)` (only in `r1_closed`); `set_captain(team, student)` (in one transaction: clear the old captain, set the new); `edit_team_n(team, n)` (only before phase `r2_running`); `mark_absent(student, move_to_student)`; `unmark_absent(student)`; `cancel_registration(registration_id)`; `admin_register(student, qr_id, run)` (same as `register_scan` but ignores capacity); `skip_teaser(team, run)`; `reset_attempts(team, item)`; `void_question(team or null, question_id)`; `reset_event_data(confirm text)`.

**`mark_absent(student, move_to)`:** set `absent = true`. For the current run, every piece number from 1 to N that has no assignment is assigned to `move_to` (`via='admin'`); any piece already held by the absent student is reassigned to `move_to` too. N and points per question do not change. If the absent student has a registration, keep it (it still occupies its slot).

**`cancel_registration(id)`:** delete the registration and delete the matching piece assignment if its holder is that student. Slot and piece number become free for the next registrant.

**`void_question(team|null, question_id)`:** for each affected team (the given team, or all teams that have this question): set `team_questions.voided = true`; insert a `score_adjustments` row with `points = full - (points already earned on that question)` (never negative), `reason` required. Re-evaluate run-finished. Adjustments count toward totals but are never used for tie-break time.

**`reset_event_data(confirm)`:** redefined in Section 15.4.10 (allowed in `setup`, `ended` or while paused; typed `RESET`; clears Round 3 runtime tables too).

**Live mode is removed.** There is no Go Live and no Test/Live switch (Section 15.1, A1).

---

## 7. API contract

### 7.1 Player routes (cookie `th_session`, identity from the session only)

| Route | Body | Result |
|-------|------|--------|
| `POST /api/auth/login` | `{studentId, code}` | sets cookie; `{ok:true}` or `INVALID_LOGIN` / `THROTTLED` (with `retryAfterSec`) |
| `POST /api/auth/logout` | none | clears cookie |
| `GET /api/state` | none | the state object of Section 8.1 |
| `POST /api/scan` | `{token}` | `register_scan` result |
| `POST /api/teaser` | `{answer, requestId}` | `solve_teaser` result |
| `POST /api/answer` | `{kind:'r1'\|'r2', key, optionId, requestId}` | `submit_answer` result |
| `POST /api/r3/answer` | `{box, value, requestId}` | `r3_submit_box` result (Section 15.5). `POST /api/scan` now calls `scan_dispatch` |

### 7.2 Scan page `GET /s/[token]`

1. No valid session: redirect to `/login?next=/s/<token>`. `next` must be a relative path starting with `/s/` or equal to `/`; otherwise ignore it (no open redirects).
2. With a session: render a small page, and **on load the client POSTs `/api/scan`** with the token. The scan is a POST triggered by page JavaScript, never a side effect of the GET, so link previews and prefetchers cannot register anyone.
3. Show the result (Section 8.2) with a button to the home screen. Re-scanning the same QR is safe (`already:true`).

### 7.3 Admin routes (cookie `th_admin`)

UI at `/hq`. Middleware verifies the admin JWT on `/hq/*` and `/api/admin/*` (except `POST /api/admin/login`). Every mutating admin route writes `admin_log`.

| Route | Purpose |
|-------|---------|
| `POST /api/admin/login` | username + password |
| `GET /api/admin/dashboard` | live dashboard data |
| `POST /api/admin/event/<action>` | `start-r1, end-r1, start-r2, end-r2, open-r3, end-event, pause, resume, add-time, reset` |
| `GET/PUT /api/admin/settings` | settings (respecting locks) |
| `POST /api/admin/import` | participant CSV (Section 11.1) |
| `POST /api/admin/students/<id>/<action>` | `reset-code, unlock, absent, unabsent, make-captain` |
| `PATCH /api/admin/teams/<id>` | `n`, `withdrawn`, `qualified` |
| CRUD `/api/admin/qr`, `/api/admin/riddles`, `/api/admin/questions`, `/api/admin/teasers`, `PUT /api/admin/round3` | content |
| `POST /api/admin/interventions/<action>` | `cancel-registration, admin-register, skip-teaser, reset-attempts, void-question` |
| `GET /api/admin/export/<name>` | CSV: `registrations, attempts, standings` |

---

## 8. Player experience

### 8.1 `GET /api/state` response

```ts
type State = {
  clock: { serverNowMs: number; eventNowMs: number; paused: boolean };
  me: { studentId: string; name: string; teamId: string; teamName: string; isCaptain: boolean; n: number };
  screen:
   | 'WAIT_R1' | 'R1' | 'R1_DONE'
   | 'R2_SPECTATOR' | 'R2_SCAN' | 'R2_TEASER' | 'R2_QUESTIONS' | 'R2_DONE' | 'R2_BREAK'
   | 'R3_FIND' | 'R3_BOXES' | 'R3_SPECTATOR' | 'ENDED';
  deadlineEventMs?: number;
  // plus the payload for the screen (below)
};
```

How `screen` is chosen (first match):

| Condition | Screen |
|-----------|--------|
| phase `setup` | `WAIT_R1` |
| phase `r1_running` | `R1` |
| phase `r1_closed` | `R1_DONE` |
| phase `r2_running`/`r2_break`, team not qualified or withdrawn | `R2_SPECTATOR` |
| phase `r2_running`, current run finished or deadline passed | `R2_DONE` |
| phase `r2_running`, current run open, student has no registration this run and team teaser not done/skipped | `R2_SCAN` |
| phase `r2_running`, teaser not done/skipped | `R2_TEASER` |
| phase `r2_running`, teaser done/skipped | `R2_QUESTIONS` |
| phase `r2_break` | `R2_BREAK` |
| phase `r3_open`, team `r3_eligible`, not yet scanned | `R3_FIND` |
| phase `r3_open`, team `r3_eligible`, scanned | `R3_BOXES` |
| phase `r3_open`, otherwise | `R3_SPECTATOR` |
| phase `ended` | `ENDED` |

When a team has finished run 1 and run 2 is open with no registration by this student, the screen is `R2_SCAN` with `message: "Run 2 is open. Scan any QR."`.

**Payloads:**

- `R1`: `deadlineEventMs`, `riddles: [{ id, position, text, options (seeded-shuffled), status: 'open'|'submitted', chosenOptionId? }]` (Section 16.4 replaces the old correct/wrong status), `canSubmit` (captain only). Members see riddles read-only. All riddles are visible and may be answered in any order. Round 1 shows no correct or wrong feedback (Section 16.4).
- `R2_SCAN`: `run`, `deadlineEventMs`, `message?`.
- `R2_TEASER`: `run`, `deadlineEventMs`, `piecesHeld: [{ pieceNo, text }]`, `registered` (count of assigned pieces), `total: n`, `canAnswer` (captain and `registered == n`, or teaser skipped).
- `R2_QUESTIONS`: `run`, `deadlineEventMs`, `mine: [{ questionNo, stem, locationName }]` for every question_no whose piece the student holds (a student holding several pieces sees several questions); if captain also `board: [{ questionNo, options (seeded-shuffled), status: 'open'|'one_try_left'|'correct'|'locked'|'voided' }]`. **The captain does not see other members' stems**, only the options for each numbered question. This forces the team to split up and report back. Members see the status of their own questions only. No points anywhere.
- `R2_DONE`: message only. `R2_BREAK`, and `R2_SPECTATOR` during `r2_break`: message plus `deadlineEventMs = break_end_ms` (countdown, Section 15.1 A5). `R2_SPECTATOR`: message "Round 2 is for qualified teams. You can watch the fun."
- Round 3 payloads (`R3_FIND`, `R3_BOXES`, `R3_SPECTATOR`, `ENDED`): **see Section 15.6.**

**Polling:** `R2_TEASER`, `R2_SCAN`, `WAIT_R1`, `R1_DONE`, `R2_DONE`, `R2_BREAK`, `R3_FIND`, `R3_BOXES` poll every 5 s with random jitter of plus or minus 1 s. `R1` and `R2_QUESTIONS` poll every 15 s (to catch pause and deadlines) and after each submit. `R2_SPECTATOR` and `ENDED` poll every 30 s; `R3_SPECTATOR` every 10 s. On network failure show "Retrying..." and keep the same `requestId`.

### 8.2 Scan result texts

Success: "Registered at {qrName}. You are piece {pieceNo} of {n}." (do not reveal anything about other teammates' locations). Failures use Section 8.3.

### 8.3 Error codes and player text (`lib/messages.ts`)

| Code | Text |
|------|------|
| `INVALID_LOGIN` | Student ID or code is wrong. |
| `THROTTLED` | Too many tries. Wait {s} seconds. |
| `WRONG_PHASE` | That is not open right now. |
| `PAUSED` | The event is paused. Hang tight. |
| `NOT_IN_ROUND` | Your team is not in this round. |
| `ABSENT` | You are marked absent. Ask an organiser. |
| `INVALID_QR` | This QR code is not valid. |
| `QR_INACTIVE` | This location is closed. Find another location. |
| `TEAMMATE_HERE` | A teammate already registered here. Find another location. |
| `QR_USED_BEFORE` | You used this location before. Find another location. |
| `QR_FULL` | This location is full. Find another location. |
| `ALREADY_REGISTERED` | You are already registered for this run. |
| `TEAM_COMPLETE` | Your team is already complete. |
| `NOT_CAPTAIN` | Only your captain can submit. |
| `TEASER_NOT_READY` | Wait until every teammate has registered. |
| `TEASER_WRONG` | Not quite. Keep talking to your team. |
| `ALREADY_DONE` | Already answered. |
| `LOCKED` | This question is locked. |
| `INVALID_OPTION` | Choose one of the options. |
| `NOT_ELIGIBLE` | Your team is not in this round. |
| `WRONG_PASSWORD` | That is not it. |
| `ALREADY_CLAIMED` | Another team got there first. |
| `CONTENT_MISSING` | Something is not set up. Tell an organiser. |

Answer feedback texts: `correct` gives "Correct.", `wrong_one_left` gives "Wrong. One try left.", `locked` gives "Wrong. Locked.". Round 1 shows no result text, only "Answer saved." (Section 16.4).

---

## 9. Admin panel (`/hq`)

Plain, functional UI that works from 360 to 1920 px (Section 15.1 A2). Polls the dashboard every 5 s (3 s during Round 3). All lists are searchable by team or student ID.

| Page | Contents |
|------|----------|
| **Dashboard** | phase, event clock, pause state, big buttons for the next valid phase action; per-team row: stage, run, teaser state, registrations (QR names), questions with status and attempts used, run deadline; per-QR live counts per run versus capacity |
| **Event control** | all actions in 4.2 and 4.4 with confirm dialogs, including Start Round 3 (Section 15.1 A6); Reset event data in a red Danger zone (typed `RESET`, guarded, Section 15.4.10). No Test/Live switch |
| **Teams & students** | CSV import (11.1), add/remove, edit N (before Round 2), change captain, withdraw, unlock login, reset code (shown once), mark absent with a "move to" teammate picker |
| **QR locations** | add (name, capacity default 12); token = `crypto.randomBytes(16).toString('base64url')`; link = `BASE_URL/s/<token>`; a printable sheet page of all active QRs (4 per A4 page, name under each, codes generated with `qrcode`); edit capacity live; deactivate; regenerate token; delete is blocked (FK) while any question points to it, with a clear message |
| **Riddles / Questions / Teasers** | CRUD per Section 3 edit rules; questions grouped by run, slot, variant; shows location name from `qr_id` |
| **Selection** | after Round 1: table ranked by `r1_standings`; first `top_n_r2` rows pre-ticked; admin ticks/unticks `qualified` (promote the next team by ticking it); header shows the count of ticked teams; applies only while phase is `r1_closed` |
| **Round 3** | `/hq/round3` and its live grid, overrides and QR sheet: **see Section 15.7**. Plus `/hq/standings` (Section 15.1 A4) |
| **Interventions** | cancel/override registration, skip teaser, reset attempts, void question (team or all, reason required) |
| **Log & export** | `admin_log` viewer; CSV downloads (7.3) |

---

## 10. Security rules

- Passwords and codes: bcrypt (cost 10). Student codes are 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, entered case-insensitively.
- **Player session:** JWT (HS256 via `jose`), payload `{ sid }` only, 24 h expiry. Cookie `th_session`: HttpOnly, Secure, SameSite=Lax (Lax is required so a cookie sent on a QR-scan navigation still works). On every request load the student and team fresh from the database; never trust role or team from the token.
- **Admin session:** separate secret and cookie `th_admin`, 8 h, payload `{ aid }`.
- **Login throttle:** per student and per admin account, after 5 consecutive failures set `locked_until = now + min(2 * 2^(failed_logins - 5), 60)` seconds; success resets the counter. An admin can unlock a student from the panel. There is no per-IP limit (campus Wi-Fi shares IPs).
- Admin UI is at `/hq`, has no links from the player site, and sends `X-Robots-Tag: noindex`. The real protection is authentication.
- `lib/db.ts` begins with `import 'server-only'`. The service-role key is never in client code.
- Responses never include `correct_option_id`, `answer_norm`, `r3_config.code`, points, other teams' data, or Round 3 content for ineligible teams (Section 15.8).
- Accepted limit: a shared login or a photo of a QR cannot be fully stopped. Poster questions, per-team attempt limits and server rules make that harmless enough.

---

## 11. Data formats and seed

### 11.1 Participant CSV (import)

Header: `student_id,name,team_id,team_name,is_captain`. Validate before writing anything: every team has exactly 1 captain and 3 to 5 members; `student_id` unique. On success create teams (`n` = member count), students, and generated codes; return a **one-time downloadable `codes.csv`** (`student_id,name,team_id,code`). Re-import replaces rows only in `setup` phase.

### 11.2 Seed script `scripts/seed.ts`

Creates in test data, all labelled `[PLACEHOLDER]`: 75 teams (`T01` to `T75`) with 3 to 5 students each (`S0101` style), exactly one captain each, codes written to `codes.csv`; 12 QR locations; 12 riddles with 8 options each; teaser puzzles for runs 1 and 2 in sizes 3, 4, 5; 20 questions (5 slots x 2 runs x 2 variants) linked to QRs; round3 with sample clue, password, key and room.

`scripts/create-admins.ts` reads `SEED_ADMINS` and creates or updates those admin accounts (re-running it resets their passwords). It touches nothing else, so it is also safe to run for the real event.

---

## 12. Build phases (stop after each; the human instructs the next)

| Phase | Build | Done when |
|-------|-------|-----------|
| **0** | Scaffold, env, `001_schema.sql` + `event_now_ms`, `lib/db.ts`, seed script, `create-admins.ts`, `DECISIONS.md` | App deploys; migrations run clean; seed runs; `select event_now_ms()` works |
| **1** | Player login/session, throttle, CSV import, admin login + middleware, `lib/dto.ts`, `lib/messages.ts` | Login works on a phone; 6 wrong codes cause a delay; admin routes return 401 without cookie |
| **2** | Clock and phases: `advance_event`, event control actions, pause/resume/add-time, dashboard skeleton | Walking `setup` to `ended` works; pausing for 2 minutes shifts all deadlines by 2 minutes; unit test of the clock formula passes |
| **3** | QR management, `register_scan`, `/s/[token]` flow, QR sheet | 30 parallel scans for the last free slot: exactly 1 succeeds (`scripts/concurrency-test.ts`); every rule in 6.1 has a test; scan from iPhone camera and Google Lens works after login redirect; link preview does not register anyone |
| **4** | Teaser, `assign_questions`, `submit_answer` (R2), `/api/state` for Round 2 screens | Full run: scan, teaser, N questions, captain submit with tries 2 then lock; duplicate `requestId` returns the same result without a second row; captain sees options but not others' stems |
| **-- Checkpoint --** | Human runs a pilot of phases 0-4 with friends on real phones | Fix what breaks before continuing |
| **5** | Run timing: run 2 opening (finish or 30-minute mark), deadlines, hard end, results break, void, absent/move, cancel registration | Test with `run_cap_minutes` temporarily 2 and `r2_minutes` 4: Run 2 opens correctly, expired runs score 0, break starts on time |
| **6** | Rest of admin panel: teams, interventions, dashboard detail, log, exports | Every action in Section 9 works and appears in the log |
| **7** | Round 1 (`R1` screen, `submit_answer` r1), selection page, standings | Ranked list, promote/remove, Start Round 2 is blocked with zero qualified teams |
| **8** | **ALREADY BUILT, now replaced.** Its Round 3 code is removed and rebuilt by Phase 10 (Section 15.12) | n/a |
| **9** | (already built; re-run its checks after Phase 10, Section 15.11) Hardening: RLS and grants verified, `load-test.ts`, edge-case sweep, README with the admin cheat sheet (pause, add time, captain swap, skip teaser, void, absent) and the one-page outage policy | Load test: 400 clients polling `/api/state` for 5 minutes, zero 5xx, p95 under 800 ms; security checks of Section 10 pass |
| **10** | Part A: admin fixes (live mode removed, responsive `/hq`, settings page, Round 2 scores, break clock, Start Round 3, every admin feature verified, server clock). Part B: new Round 3 (zones, scan milestone, 4 boxes, ranking, winner, admin grid and overrides) | Section 15.1 and 15.11 checks pass. Phases 0 to 9 already exist, so this phase modifies and replaces parts of them |
| **11** | Admin repair and scale (Section 16): DB drift check and one SQL file for the owner, `/hq/content` JSON failures, responsive admin and dashboard, blind Round 1 with paging, Round 1 archive and clear at Round 2 start, paging everywhere, 75-team seed and load test | Section 16.9 checks pass |

### Outage policy (put in the README, one page)

If the site is down for more than about 3 minutes: fix it, then use **Add time** for the downtime. State is saved on the server and players resume by reloading. Use the CSV export only if the database itself is lost.

---

## 13. Tests (vitest plus scripts)

1. Seeded shuffle: same seed gives the same order; different teams differ.
2. Points: n=3,4,5 give full 40/30/24 and half 20/15/12; tries exhaustion; a correct answer after a wrong one gives half.
3. Ranking: ties on points break by earliest last point-earning attempt; adjustments do not change the tie-break; `rank()` includes all teams tied at the cutoff.
4. Registration rules: each rule in 6.1 returns its code; cancel frees slot and piece; `QR_USED_BEFORE` across runs.
5. Concurrency: last-slot scan race; two teammates at one QR; duplicate `requestId`; simultaneous Round 3 final boxes (Section 15.10).
6. Clock: pause, resume, add time across the Run 2 mark and the hard end.
7. Security: no response contains `correct_option_id`, `r3_config.code`, points, or any Round 3 data for an ineligible team; anon Supabase key cannot read any table.

---

## 14. Out of scope for this version

GPS checks, in-site QR scanner, email/OTP/third-party login, paper fallback, 2FA for admins, websockets, multiple environments, scoreboards visible to players.

---

## 15. Phase 10: Round 3 redesign and admin fixes

### 15.0 Read this first

This section **supersedes every older Round 3 rule**. Wherever Sections 1, 2.7, 3, 4, 5, 6.5, 6.6, 6.7, 7, 8, 9, 10, 11, 13 or Phase 8 mention a password, a clue, a room, `claim_round3`, `round3`, `round3_claim`, `pw_wrong`, `pw_blocked_until`, `password_max_wrong`, `password_lockout_s`, the player screen `R3`, or Go Live / Test-Live mode, **this section wins and those parts are dead**. Phases 0 to 9 are **already built and running**, including the old Round 3 (Phase 8) and the hardening work (Phase 9). Phase 10 therefore **removes and replaces code that exists**; Section 15.12 lists what to remove or rewrite. Do not build anything from the old Phase 8 text.

**Order of work.** Part A (15.1) fixes what already exists. Part B (15.2 to 15.12) replaces the old Round 3 with the new one. Run each part's checks and commit before the next part. Stop after Part B.

**Working method for the agent:**

1. Read this file and `CODEMAP.md`. CODEMAP is **out of date** (it still says Phases 7 to 9 are not started and lists items as missing that are now built). Grep the code, trust the code, and rewrite CODEMAP at the end.
2. Before coding, append to `DECISIONS.md` the list of files you will touch (one line each). Do not write long plans.
3. One commit per numbered item (A1, A2, ... B1, B2, ...). Message format: `phase10: A3 settings overflow`.
4. Verify every UI change in the browser tool at widths **360, 768, 1280 and 1920 px**, and attach screenshots to your walkthrough.
5. When done, update `CODEMAP.md` (status, files, functions, routes, known problems).

**Human steps (tell the human when you reach them):**

1. Confirm migrations 002 to 004 are applied on the real Supabase: `select proname from pg_proc where proname in ('register_scan','submit_answer','player_state','void_question');` must return all four.
2. Run `005_phase10_fixes.sql`, then `006_round3.sql`, in the Supabase SQL editor.
3. Print the 5 Round 3 start QRs from `/hq/round3/qr-sheet` and place the 20 question cards (Section 15.2, rule 3).

---

### 15.1 Part A: fixes to the existing system

**A1. Remove live mode.**
- Delete the `go_live` function (drop it in `005`; find its signature with `select oid::regprocedure from pg_proc where proname = 'go_live'`), the `go-live` event action, the Go Live button and the Test/Live switch. Remove every read of `event_state.mode`. Leave the column in the table (never read, never shown).
- `reset_event_data` is redefined in `006` (Section 15.4.10): it works in any mode, but only when the phase is `setup` or `ended`, or the event is paused, and only with the typed word `RESET`. It lives only on **Event control**, inside a red "Danger zone" card. It is never on the dashboard.
- Reset removes game data only. Teams, students, codes, QR locations, all content, settings, and Round 3 config, zones and riddles stay. Run it once after rehearsals; during the real event the guard blocks it mid-round unless the event is paused.
- *Acceptance:* a search for `go_live`, `go-live` and `.mode` returns nothing outside `supabase/migrations`. Reset during an unpaused `r1_running` returns `RESET_BLOCKED`. Reset in `setup`, after `ended`, or while paused works.

**A2. Admin panel responsive for laptop and phone.** `/hq` must work from 360 to 1920 px. Section 2.8 applies to **player pages only**.
- At 1024 px and above: fixed left sidebar navigation, fluid content with `max-width: 1440px`, tables at full width with sticky headers, two-column forms. The dashboard shows the phase, clock and action buttons in a top row, the team table below, and the per-QR counts in a side column.
- Below 1024 px: top bar with a menu button that opens a navigation drawer, single column, tap targets at least 44 px, dialogs that fit 360 px.
- Every wide table sits in a wrapper with `overflow-x-auto`. The page itself never scrolls sideways.
- *Acceptance:* on every `/hq` page at 360, 768, 1280 and 1920 px, `document.documentElement.scrollWidth <= window.innerWidth`, no clipped buttons, no overlapping text. Record each page in `ADMIN_AUDIT.md` (A7).

**A3. `/hq/settings` breaks the screen on phones.** Find the real cause of the overflow (look for fixed widths, a non-wrapping table or grid, `min-w-*`, inputs without `min-w-0`) and fix it. Layout: one card per setting; under 640 px the label, help text, input and lock badge stack vertically; inputs are `w-full min-w-0`; the Save button is sticky at the bottom on mobile.
- *Acceptance:* at 360 px no horizontal scroll; every setting in Section 3 (plus the Phase 10 keys of 15.3) is editable; locked settings show why they are locked and reject edits with `SETTING_LOCKED`.

**A4. Round 2 scores are invisible to the admin.** Find the root cause (likely the dashboard payload never reads `r2_standings`) and fix it at the source.
- Dashboard team rows add: R2 points, R2 rank, last scoring time (`last_ms` shown as mm:ss after `r2_start_ms`).
- New page `/hq/standings` with two tabs, **Round 1** and **Round 2**: rank (from `rank()`), team, points, adjustments total, last scoring time. Ties are highlighted. Polls every 5 s. The table has a CSV download.
- Players still see no scores (Section 14 stands).
- *Acceptance:* after seeded attempts, the points on `/hq/standings` equal `select * from r2_standings`. A `void_question` adjustment changes the total. Tie order follows the rule under the Section 5 views.

**A5. Break clock for students.** After Round 2 ends, every student sees a countdown to the end of the break.
- The `R2_BREAK` payload, and the `R2_SPECTATOR` payload while the phase is `r2_break`, include `deadlineEventMs = break_end_ms`. The countdown uses the Section 4.1 rule and freezes while paused.
- Text: "Break. The next round starts soon." with the mm:ss countdown. At zero: "Break over. Waiting for the organisers." Nothing about Round 3, ranks or eligibility is shown to anyone.
- *Acceptance:* `/api/state` in `r2_break` returns `deadlineEventMs`; pausing freezes it; add-time moves it.

**A6. Admin can start Round 3.** In `r2_break`, the dashboard's big action button and the Event control page show **Start Round 3**.
- Before the break ends: the label reads "Start Round 3 (break ends in mm:ss)". The confirm dialog says "The break is not over. Start now?". Confirming calls `open-r3` with `{force:true}`.
- After the break ends: a normal confirm dialog, `{force:false}`.
- Errors from 15.4.4 (`R3_TEAM_COUNT`, `R3_CONTENT_MISSING`, `R3_CODE_INVALID`) show their message and say which item is wrong.
- If any Round 3 text still starts with `[PLACEHOLDER]`, the dialog shows a red warning with the count.
- *Acceptance:* a seeded event goes from `r2_break` to `r3_open` by button click only.

**A7. Every admin feature must really work.** No decoration.
- Walk every page, button and field in Section 9 and Section 15.7. For each one: the route exists, it calls the SQL function, the database changes, `admin_log` gets a row, and the UI updates without a reload. No stub handlers, no dead buttons, no fake success messages.
- Create `ADMIN_AUDIT.md` with the columns `page | control | route | function | how verified | result`. Fix every failing row. Include the routes CODEMAP lists as missing (settings GET/PUT, team patch for `n`, `withdrawn`, `qualified`, CRUD for riddles, questions, teasers and QR, `make-captain`, `admin-register`, `reset-attempts`, exports): implement any that truly do not exist.
- Create `scripts/admin-smoke.ts`. Against a seeded test database it calls each admin route in a valid state order and asserts: HTTP 200 with `ok:true`, the expected row changed, exactly one new `admin_log` row. Run it with `npx tsx --env-file=.env.local scripts/admin-smoke.ts`.
- *Acceptance:* the smoke script exits 0 and `ADMIN_AUDIT.md` has no failing row.

**A8. Server clock.** `lib/event-service.getEventStateAndClock` must not use `Date.now()` (Section 4.1). Add the SQL function `event_clock()` returning `{ serverNowMs, eventNowMs, paused }` in `005`, and use it everywhere a response needs the clock. Add a SQL test for it.

**Part A done when:** A1 to A8 acceptance checks pass, `npx next build` and `npm test` pass, and `tests/sql/run.sh` passes.

---

### 15.2 Round 3: the final rules

1. **Teams.** When Round 2 ends, the system preselects the top `top_n_r3` (5) teams by Round 2 rank, using the strict order `points desc, last_ms asc nulls last, team id`. In `r2_break` the admin can tick or untick any team (minimum 1, maximum 5). Round 3 runs for exactly the ticked teams (`teams.r3_eligible`). Teams tied at the cutoff are flagged in the admin list so the admin can decide.
2. **Zones.** There are 5 zones. Each is a separate physical area with its own **start QR**. Each zone has one **start riddle** (it points to the start QR's location) and **four box riddles** (20 box riddles in total). The four spots that the box riddles point to are physically near their zone, so teams never meet. Each eligible team gets a different zone: the admin may assign zones in `r2_break`, otherwise they are assigned randomly when Round 3 opens.
3. **The code.** One code for all teams: 4 characters, a digit 1 to 9 followed by three letters, stored in upper case in `r3_config.code` (example: `1DAI`). The admin can edit it until Round 3 opens. Box `i` expects character `i` of the code. **Authoring rule:** every question card for box `i`, in every zone, must have character `i` as its answer. The cipher is for the teams to solve (for example `1DAI` decodes to room `A419`); the system never shows the room.
4. **Clock.** `r3_minutes` (default 40) of event time from the moment Round 3 opens. Pausing stops it (Section 4.1).
5. **Milestone 0: the scan.** At opening each eligible team sees its zone's start riddle. The team's **captain** goes there and scans the start QR (logging in first if needed). The server checks identity from the session, exactly as in Round 2: the student must be an eligible team's captain and not absent, and the QR must belong to that team's zone. A scan of any other zone's QR is rejected with `WRONG_ZONE`. The first successful scan is **milestone 0** and stores the event time, the wall-clock time, the captain and a sequence number.
6. **The boxes.** After milestone 0 the team's four box riddles unlock. All members see the four riddles (read only, so the team can split up). Only the captain sees four inputs, each with its own Submit button. Box 1 accepts exactly one digit 1 to 9. Boxes 2, 3 and 4 accept exactly one letter A to Z, case-insensitive. Anything else is rejected with `INVALID_FORMAT` and **does not use a try**. Boxes can be answered in any order.
7. **Tries and locks.** Each box allows `r3_tries_per_box` (default 2) wrong answers. The last wrong answer **locks that box permanently** for that team (only the admin can reset it). A lock does not remove the team: its other boxes stay open and its milestones count. A team with a locked box can no longer enter the full code, but can still win on progress.
8. **Milestones.** Each correct box is one milestone (1 to 4), with event time, wall-clock time and a sequence number. A team's milestone count is 0 to 5 (the scan plus four boxes).
9. **Ranking (admin only).** `milestones desc`, then the lower `last_seq` (the team that reached its current count first). Sequence numbers come from one database sequence taken under a lock, so ties and races have a single answer.
10. **Winner by code.** The first team with all four boxes correct wins. In the same transaction the phase becomes `ended`; every other team stops immediately.
11. **Winner by progress.** If the clock reaches `r3_end_ms` first, the event ends and the top-ranked team with at least 1 milestone wins by progress. If no team reached milestone 0, there is no winner. A progress winner does not get the treasure room.
12. **What players see.** The code-winning team sees "Code correct! The code is the room number. Decipher it and go find the treasure." and its team ID in large text for the organiser. Everyone else sees only who won and how. **No player ever sees a rank, a milestone table, or another team's progress.** Only the admin does.
13. **Admin overrides** are allowed (15.4.9), each needing a reason, each written to `admin_log`.

---

### 15.3 Database

**`supabase/migrations/005_phase10_fixes.sql`**

```sql
-- drop go_live (use the real signature found with regprocedure)
drop function if exists go_live(text);
drop function if exists go_live();

create or replace function event_clock() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'serverNowMs', (extract(epoch from now()) * 1000)::bigint,
    'eventNowMs', event_now_ms(),
    'paused', (select paused_at is not null from event_state where id = 1))
$$;
```

**`supabase/migrations/006_round3.sql`**

```sql
-- 1. remove old Round 3 (already built in Phase 8: it has data and code that depend on it)
drop function if exists claim_round3(text, text);
drop function if exists open_round3();      -- the new open_round3(boolean) below must not be ambiguous with the old one
drop table if exists round3_claim;
drop table if exists round3;
alter table teams drop column if exists pw_wrong, drop column if exists pw_blocked_until;
delete from settings where key in ('password_max_wrong','password_lockout_s');

-- 2. new settings and clock fields
insert into settings (key, value) values ('r3_minutes','40'), ('r3_tries_per_box','2')
  on conflict (key) do nothing;
alter table event_state add column if not exists r3_start_ms bigint, add column if not exists r3_end_ms bigint;
-- Lock rule: r3_minutes and r3_tries_per_box lock when the phase leaves r2_break (extend Section 3 logic).

-- 3. content
create table r3_config (
  id smallint primary key check (id = 1),
  code text not null default '1DAI' check (code ~ '^[1-9][A-Z]{3}$'),   -- [PLACEHOLDER]
  hint_text text not null default ''                                    -- optional cipher hint shown on the box screen
);
insert into r3_config (id) values (1);

create table r3_zones (
  id smallint primary key check (id between 1 and 5),
  name text not null,
  token text unique not null,
  find_riddle text not null default '[PLACEHOLDER] riddle pointing to this zone''s start QR'
);
insert into r3_zones (id, name, token)
select g, 'Zone ' || g, translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_')
from generate_series(1, 5) g;

create table r3_riddles (
  zone smallint not null references r3_zones(id) on delete cascade,
  box smallint not null check (box between 1 and 4),
  text text not null default '[PLACEHOLDER] box riddle',
  primary key (zone, box)
);
insert into r3_riddles (zone, box) select z, b from generate_series(1,5) z, generate_series(1,4) b;

-- 4. runtime state
create sequence r3_seq;

create table r3_team (
  team_id text primary key references teams(id),
  zone smallint unique references r3_zones(id),        -- null until assigned
  scanned_ms bigint, scanned_at timestamptz, scanned_by text references students(id),
  scan_seq bigint, scan_credited boolean not null default false,
  finished_ms bigint
);

create table r3_boxes (
  team_id text not null references teams(id), box smallint not null check (box between 1 and 4),
  epoch int not null default 1,                          -- +1 on admin reset: tries are counted per epoch
  locked boolean not null default false,
  solved_ms bigint, solved_at timestamptz, solved_seq bigint, credited boolean not null default false,
  primary key (team_id, box)
);

create table r3_attempts (
  id bigserial primary key, request_id uuid not null unique,
  team_id text not null references teams(id), student_id text not null references students(id),
  box smallint not null, epoch int not null, try_no smallint not null,
  value text not null, correct boolean not null,
  created_ms bigint not null, created_at timestamptz not null default now(),
  unique (team_id, box, epoch, try_no)
);

create table r3_result (            -- exactly one row, always present; reason null = undecided
  id smallint primary key check (id = 1),
  winner_team_id text references teams(id),
  reason text check (reason in ('code','progress','admin','none')),
  decided_ms bigint, decided_at timestamptz
);
insert into r3_result (id) values (1);

create view r3_standings as
select rt.team_id, rt.zone,
  ((rt.scanned_ms is not null)::int + coalesce(b.solved, 0))::int as milestones,
  nullif(greatest(coalesce(rt.scan_seq, 0), coalesce(b.last_seq, 0)), 0) as last_seq
from r3_team rt
left join (select team_id, count(solved_ms)::int as solved, max(solved_seq) as last_seq
           from r3_boxes group by team_id) b on b.team_id = rt.team_id;
-- rank: row_number() over (order by milestones desc, last_seq asc nulls last, team_id)

-- 5. security (same pattern as Section 5)
alter table r3_config enable row level security;  alter table r3_zones enable row level security;
alter table r3_riddles enable row level security; alter table r3_team enable row level security;
alter table r3_boxes enable row level security;   alter table r3_attempts enable row level security;
alter table r3_result enable row level security;
revoke all on r3_config, r3_zones, r3_riddles, r3_team, r3_boxes, r3_attempts, r3_result from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
```

At the end of `006` (after the functions of 15.4) repeat the Section 5 pattern: `revoke execute on all functions in schema public from public, anon, authenticated; grant execute on all functions in schema public to service_role;`.

---

### 15.4 Atomic functions (in `006_round3.sql`, all return `jsonb` as in Section 6)

Every function starts with `perform advance_event();`. **Lock order for Round 3 is always: `event_state` (inside `advance_event`), then the `r3_result` row, then the `r3_team` row, then `r3_boxes` rows.** All Round 3 time values use `event_now_ms()`; the wall-clock value is `now()`. Player functions reject with `PAUSED` when `event_state.paused_at is not null`.

**15.4.1 `r3_preselect()`** (internal). Set `r3_eligible = false` for all teams, then `true` for the first `top_n_r3` rows of `r2_standings` ordered by `points desc, last_ms asc nulls last, team_id`. Called once, at every place that moves the phase to `r2_break` (inside `advance_event` step 2 and inside `end_round2`).

**15.4.2 `set_r3_eligible(team, bool)`** (admin). Only in `r2_break`, else `WRONG_PHASE`. Setting `true` when 5 are already ticked: `R3_TOO_MANY`. Logs.

**15.4.3 `r3_assign_zone(team, zone)` and `r3_randomize_zones()`** (admin). Only in `r2_break`. Writes `r3_team` rows lazily (insert missing rows for eligible teams). `zone` already used by another team: `R3_ZONE_TAKEN`. `r3_randomize_zones` assigns every eligible team without a zone to a random free zone, and never moves a team that already has one. Logs.

**15.4.4 `open_round3(p_force boolean default false)`** (admin). Replaces Section 6.6.
1. Phase must be `r2_break`, else `WRONG_PHASE`.
2. If `event_now < break_end_ms` and not `p_force`: `BREAK_NOT_OVER`. If forced, set `break_end_ms = event_now`.
3. Count of `r3_eligible` teams must be 1 to 5, else `R3_TEAM_COUNT`.
4. `r3_config.code` must match `^[1-9][A-Z]{3}$`, else `R3_CODE_INVALID`.
5. For every zone that will be used: `find_riddle` and the four `r3_riddles.text` must be non-blank, else `R3_CONTENT_MISSING` with the zone and box numbers in the message.
6. Insert missing `r3_team` rows, then assign random free zones to teams without one (as in 15.4.3).
7. Set `phase = 'r3_open'`, `r3_start_ms = event_now`, `r3_end_ms = event_now + r3_minutes * 60000`. Log.

**15.4.5 `advance_event` addition.** Add step 4: if `phase = 'r3_open'` and `event_now >= r3_end_ms`, call `r3_decide('progress')`. Also in step 2 call `r3_preselect()` when entering `r2_break`.

**15.4.6 `scan_dispatch(p_student, p_token)`** and `r3_scan`.
`scan_dispatch`: if `p_token` exists in `r3_zones.token`, return `r3_scan(...)`; otherwise return `register_scan(...)` (Section 6.1). `/api/scan` calls only `scan_dispatch`.

`r3_scan(p_student, p_token)`:
1. Paused: `PAUSED`. Load student and team. Team not `r3_eligible` or withdrawn, or no `r3_team` row: `NOT_ELIGIBLE`. `student.absent`: `ABSENT`. Not the captain: `NOT_CAPTAIN`.
2. Phase `ended`: `R3_OVER`. Phase not `r3_open`: `WRONG_PHASE`.
3. Lock the `r3_result` row. If `reason is not null`: `R3_OVER`. Then lock the team's `r3_team` row.
4. Token's zone must equal `r3_team.zone`, else `WRONG_ZONE`.
5. If `scanned_ms is not null`: return `{ok:true, already:true, kind:'r3'}` (writes nothing).
6. Set `scanned_ms = event_now`, `scanned_at = now()`, `scanned_by = student`, `scan_seq = nextval('r3_seq')`. Insert four `r3_boxes` rows (box 1 to 4, `epoch 1`). Return `{ok:true, kind:'r3'}`.

**15.4.7 `r3_submit_box(p_student text, p_box int, p_value text, p_request uuid)`**
1. If an `r3_attempts` row with `request_id = p_request` exists, return its derived result (step 10). Never insert twice.
2. Paused: `PAUSED`. Not captain: `NOT_CAPTAIN`. Team not eligible: `NOT_ELIGIBLE`. `p_box` outside 1 to 4: `INVALID_BOX`.
3. Phase `ended`: `R3_OVER`. Not `r3_open`: `WRONG_PHASE`.
4. Lock the `r3_result` row; `reason is not null`: `R3_OVER`. Lock the team's `r3_team` row; `scanned_ms is null`: `NOT_SCANNED`.
5. Normalise the value: `upper(btrim(p_value))`. Box 1 must match `^[1-9]$`; boxes 2 to 4 must match `^[A-Z]$`. Otherwise `INVALID_FORMAT`. **Nothing is written and no try is used.**
6. Lock the `r3_boxes` row. `solved_ms is not null`: `ALREADY_DONE`. `locked`: `BOX_LOCKED`.
7. `tries_used` = count of `r3_attempts` for (team, box, current epoch). Insert the attempt with `try_no = tries_used + 1`, `correct = (value = substr(r3_config.code, box, 1))`, `created_ms = event_now`.
8. Correct: set `solved_ms`, `solved_at = now()`, `solved_seq = nextval('r3_seq')`. If all four boxes of the team are now solved: set `r3_team.finished_ms`, set `r3_result` to `winner_team_id = team`, `reason = 'code'`, `decided_ms`, `decided_at`, and set `phase = 'ended'`. Return `status 'won'`.
9. Wrong: if `tries_used + 1 >= r3_tries_per_box`, set `locked = true` and return `status 'locked'`; otherwise return `status 'wrong'` with `triesLeft`.
10. Return `{ok:true, status, box, triesLeft?}` with `status` one of `correct`, `won`, `wrong`, `locked`. Never return the code, the expected character, or other teams' data. A duplicate `requestId` derives the same status from the stored attempt (`won` if that attempt solved the last box and the team is the result's winner).

**15.4.8 `r3_decide(p_reason text)`** (internal; also used by `end_event`). Lock the `r3_result` row. If `reason is not null`, return (idempotent). Pick the winner: the first row of `r3_standings` ordered by `milestones desc, last_seq asc nulls last, team_id` where `milestones >= 1`. If none: `reason = 'none'`, `winner_team_id = null`. Otherwise `reason = p_reason` (`'progress'` from the clock, `'admin'` from `end_event`). Set `decided_ms`, `decided_at`, and `phase = 'ended'`.
Redefine `end_event()`: from `r3_open` call `r3_decide('admin')`; from any other phase keep the old behaviour. Log.

**15.4.9 Admin overrides** (each needs a non-blank `reason`, else `REASON_REQUIRED`; each logs before and after; all lock in the standard order; all need phase `r3_open`, else `WRONG_PHASE`):
- `r3_credit_scan(team, reason)`: if not scanned, do step 6 of `r3_scan` with `scan_credited = true`, `scanned_by = null`. Use it when a start QR is damaged.
- `r3_credit_box(team, box, reason)`: team must have scanned (`NOT_SCANNED`). Box must be unsolved. If crediting would leave **no unsolved box**, reject with `CREDIT_LAST_BOX` (the team must type the last box itself; use reset). Otherwise set `solved_*` with `credited = true`.
- `r3_reset_box(team, box, reason)`: box must be unsolved. Set `locked = false`, `epoch = epoch + 1`. Old attempts stay in `r3_attempts` for the record.
- `r3_reassign_zone(team, zone, reason)`: both involved teams must be unscanned. Moving to a free zone, or swapping with the team that holds it (use a temporary null to respect the unique index).

**15.4.10 `reset_event_data(confirm)`** (replaces Section 6.7 version).
1. `confirm` must equal `RESET`, else `RESET_BLOCKED` with message "Type RESET".
2. Allowed only if `phase in ('setup','ended')` or `paused_at is not null`, else `RESET_BLOCKED`.
3. Truncate `registrations, piece_assignments, team_run, team_questions, attempts, score_adjustments, r3_attempts, r3_boxes, r3_team, admin_log`. `update r3_result set winner_team_id = null, reason = null, decided_ms = null, decided_at = null`. `alter sequence r3_seq restart`.
4. Set `event_state` to defaults including `r3_start_ms = null`, `r3_end_ms = null`. `teams.qualified = false, r3_eligible = false`; `students.absent = false, failed_logins = 0, locked_until = null`.
5. Insert one fresh `admin_log` row `reset_event_data`. Keep teams, students, QRs, riddles, questions, teasers, settings, `r3_config`, `r3_zones`, `r3_riddles`.

**15.4.11 Config edits** (admin, each logs): `r3_set_code(code)` and `r3_set_hint(text)` only while phase is not `r3_open` or `ended`, else `R3_LOCKED`; code is upper-cased and must match `^[1-9][A-Z]{3}$`, else `R3_CODE_INVALID`. Zone names, start riddles, box riddles and token regeneration may be edited at any time (typos), and log.

---

### 15.5 API

**Player routes** (cookie `th_session`):

| Route | Body | Result |
|-------|------|--------|
| `POST /api/scan` | `{token}` | `scan_dispatch` result. The scan page (Section 7.2) is unchanged: it works for Round 2 QRs and Round 3 start QRs |
| `POST /api/r3/answer` | `{box, value, requestId}` | `r3_submit_box` result |

`box` is validated with `zod` as an integer; `value` as a string of at most 8 characters. Format rules (digit or letter) are domain rejections (HTTP 200, `INVALID_FORMAT`), not 400s. There is no `/api/r3/claim`.

**Admin routes** (cookie `th_admin`, all log):

| Route | Purpose |
|-------|---------|
| `POST /api/admin/event/open-r3` | body `{force?: boolean}`, calls `open_round3` |
| `GET/PUT /api/admin/round3/config` | code and hint (15.4.11) |
| `PUT /api/admin/round3/zones/[id]` | name, `findRiddle`; action `regenerate-token` |
| `PUT /api/admin/round3/riddles/[zone]/[box]` | box riddle text |
| `POST /api/admin/round3/eligible` | `{teamId, eligible}` |
| `POST /api/admin/round3/assign-zone`, `POST /api/admin/round3/randomize` | zone assignment |
| `POST /api/admin/round3/override/<action>` | `credit-scan, credit-box, reset-box, reassign-zone`, body `{teamId, box?, zone?, reason}` |
| `GET /api/admin/export/r3` | CSV: `team, zone, scan_time, scanned_by, box1_time .. box4_time, wrong_values_per_box, milestones, rank` |

Remove the `go-live` action from `POST /api/admin/event/<action>`. Add `r3` to the export names. `GET /api/admin/dashboard` gains a `round3` object (15.7).

---

### 15.6 Player experience for Round 3

**State changes (Section 8.1).** Remove the screen `R3`. Screen list becomes `... | 'R3_FIND' | 'R3_BOXES' | 'R3_SPECTATOR' | 'ENDED'`.

| Condition | Screen |
|-----------|--------|
| phase `r3_open`, team `r3_eligible`, team not yet scanned | `R3_FIND` |
| phase `r3_open`, team `r3_eligible`, team scanned | `R3_BOXES` |
| phase `r3_open`, otherwise | `R3_SPECTATOR` |
| phase `ended` | `ENDED` |

**Payloads:**
- `R3_FIND`: `deadlineEventMs = r3_end_ms`, `findRiddle` (this team's zone), `isCaptain`. Text: "Find the place this riddle points to. Your captain scans the QR there." The zone name and QR token are never sent.
- `R3_BOXES`: `deadlineEventMs`, `hint` (from `r3_config.hint_text`, may be empty), `canSubmit` (captain only), `boxes: [{ box, riddle, kind: 'digit' | 'letter', status: 'open' | 'one_try_left' | 'solved' | 'locked' }]` for boxes 1 to 4 (`one_try_left` means exactly one try remains). Members see riddles and statuses read-only. The captain screen has one input and one Submit button per box: box 1 `inputmode="numeric"`, `maxlength=1`; boxes 2 to 4 `maxlength=1`, letters only; the Submit button is disabled while the input is empty or invalid, and a confirm line says "You have N tries on this box" before sending. The client resends the same `requestId` on retry.
- `R3_SPECTATOR`: message "You are not among the top 5 teams. Watch the hunt." with the countdown.
- `ENDED`: `result?: { reason: 'code' | 'progress' | 'none', winnerTeamName?: string, youWon: boolean, teamId?: string, milestones?: number }`. `teamId` is sent **only** to the winning team. `milestones` is sent only when `reason = 'progress'`.
  - `code` and `youWon`: "Code correct! The code is the room number. Decipher it and go find the treasure." and the team ID in large text with "Show this to the organiser."
  - `code` and not `youWon`: "{winnerTeamName} cracked the code first. The hunt is over."
  - `progress`: "Time is up. {winnerTeamName} wins with the furthest progress ({milestones} of 5 steps)." No treasure line.
  - `none`: "Time is up. Nobody reached the first location."
  - no `result` (the event was ended before Round 3): "The event is over."

**Polling.** `R3_FIND` and `R3_BOXES`: every 5 s with jitter of plus or minus 1 s, and after each submit. `R3_SPECTATOR`: every 10 s (the hunt can end at any moment). `ENDED`: every 30 s.

**New error codes (`lib/messages.ts`):**

| Code | Text |
|------|------|
| `WRONG_ZONE` | This is not your team's location. Check your riddle. |
| `NOT_SCANNED` | Scan your location QR first. |
| `INVALID_FORMAT` | Box 1 takes one digit from 1 to 9. Boxes 2 to 4 take one letter. (show the sentence for that box) |
| `BOX_LOCKED` | This box is locked. |
| `INVALID_BOX` | That box does not exist. |
| `R3_OVER` | The hunt is over. |

Answer feedback: `correct` "Correct."; `wrong` "Wrong. {triesLeft} try left."; `locked` "Wrong. This box is locked."; `won` "Code correct! The code is the room number. Decipher it and go find the treasure." Reuse `ALREADY_DONE`, `NOT_CAPTAIN`, `NOT_ELIGIBLE`, `ABSENT`, `PAUSED`, `WRONG_PHASE`, `INVALID_QR`, `THROTTLED`.

Scan success text for a Round 3 QR: "Location verified. Your riddles are unlocked." (already scanned: "You already scanned here.").

**Admin-side codes** (shown in the panel): `BREAK_NOT_OVER`, `R3_TEAM_COUNT` ("Choose 1 to 5 teams"), `R3_TOO_MANY`, `R3_ZONE_TAKEN`, `R3_CONTENT_MISSING`, `R3_CODE_INVALID` ("One digit 1 to 9, then three letters"), `R3_LOCKED`, `CREDIT_LAST_BOX` ("Reset the box so the team types it"), `REASON_REQUIRED`, `RESET_BLOCKED`.

---

### 15.7 Admin panel for Round 3

**Dashboard.** In `r2_break` and later, the dashboard shows the Round 3 block. While `r3_open` it polls every 3 s.

`round3` payload: `{ phase, startMs, endMs, result, codeSet: boolean, teams: [{ rank, teamId, teamName, zoneName, scan: { at, ms, by, credited } | null, boxes: [{ box, status: 'open'|'solved'|'locked', solvedAt, solvedMs, credited, triesUsed, wrongValues: [{ value, at }] }], milestones, state: 'searching'|'solving'|'finished' }] }`.

**Live grid** (laptop: full width table; phone: table inside `overflow-x-auto`): one row per eligible team ordered by rank, columns `Rank | Team | Zone | Login | Box 1 | Box 2 | Box 3 | Box 4 | Milestones | State`. A solved cell shows the wall-clock time (browser local, `HH:MM:SS`) and the elapsed time since `r3_start_ms` (mm:ss). An unsolved cell shows `tries used / max`. A locked cell is red. A credited cell has a "credited" tag. Clicking a team opens its wrong values with times. The leader row is highlighted; a finished team shows FINISHED. When `ended`, the top shows the result (winner, reason, milestones).

**New page `/hq/round3`** with sections:
1. **Setup** (editable before opening): the code input (validated live, warning "Change the physical cards too"), the hint text, five zone cards (name, start riddle, QR link, token regenerate), and a 20-item editor for box riddles grouped by zone and box. A red banner counts text that still starts with `[PLACEHOLDER]`.
2. **Teams**: all Round 2 teams in rank order with checkboxes (`r3_eligible`; max 5; tie-at-cutoff flagged), a zone dropdown per ticked team, and a **Randomize zones** button.
3. **Live and results**: the grid above, the result, and an **Overrides** menu per team and box: credit login, credit box, reset box, reassign zone. Each opens a dialog with a required reason.
4. `/hq/round3/qr-sheet`: printable page with the 5 start QRs, one per half A4 page, with zone name under each (reuse the existing QR sheet code, `qrcode` library).

Event control: the existing actions, minus Go Live, plus Start Round 3 (A6). Add the standings page of A4 to the navigation.

---

### 15.8 Security additions

- Player responses never include `r3_config.code`, expected characters, other teams' zones, ranks, milestones, wrong values or tries counts (only the per-box status).
- A Round 3 QR is bound to a team through its zone. A photographed QR is useless to another team (`WRONG_ZONE`), and a non-captain's scan is rejected.
- Accepted risk: teams share the same four code characters, so a team could pass an answer to a friend. The 2-try lock limits guessing, and the admin watches the live grid. Do not try to solve this in code.
- All Round 3 routes require the normal session checks of Section 10, load the student and team fresh, and set `runtime = 'nodejs'`.
- Admin Round 3 routes sit behind the existing middleware (`/api/admin/*`).

---

### 15.9 Seed

Extend `scripts/seed.ts`: set `r3_config.code = '1DAI'` (label `[PLACEHOLDER]`), keep the 5 seeded zones, and fill the 20 riddles and 5 start riddles with `[PLACEHOLDER] Zone Z box B` text. Remove the old `round3` seed. Add `scripts/r3-simulate.ts`: opens Round 3 for 5 test teams, scans with each captain, solves boxes in a scripted order, and prints the final `r3_standings` (used by the Phase 10 test run).

---

### 15.10 Tests (vitest plus SQL plus scripts)

Add `tests/sql/phase10_round3.sql` (run by `tests/sql/run.sh`) and extend `tests/sql/concurrency.sh`. Required cases:

1. **Preselect:** top 5 by the strict order; ticking a 6th returns `R3_TOO_MANY`; unticking works; admin ticks only in `r2_break`.
2. **Open:** `BREAK_NOT_OVER` without force and success with force; `R3_TEAM_COUNT` with 0 or 6 ticked; `R3_CODE_INVALID`; `R3_CONTENT_MISSING` when a riddle is blank; zones unique per team; random assignment fills free zones only.
3. **Scan:** non-captain `NOT_CAPTAIN`; absent captain `ABSENT`; wrong zone `WRONG_ZONE`; before open `WRONG_PHASE`; while paused `PAUSED`; correct scan stores milestone 0; a repeat scan returns `already:true` and changes nothing; `scan_dispatch` still routes Round 2 tokens to `register_scan`.
4. **Format:** box 1 rejects `0`, `10`, `A`, empty, `!`; boxes 2 to 4 reject `1`, `AB`, `!`, empty. None of these uses a try. `' d '` and `'D'` and `'d'` are equal.
5. **Tries and lock:** two valid-wrong answers lock the box; a third gives `BOX_LOCKED`; a correct answer afterwards is refused; the other boxes still work; a team with a locked box cannot win by code but can win on progress.
6. **Idempotency:** a duplicate `requestId` returns the same result without a second row.
7. **Ranking:** 3 milestones beats 2; equal milestones go to the team that reached the count first; locks never change rank.
8. **Win by code:** the 4th correct box sets `ended`, writes `r3_result` with `reason 'code'`; later submits return `R3_OVER`. **Concurrency:** two teams submit their last correct box at the same instant, repeated 50 times: exactly one winner every time.
9. **Win by progress:** with `r3_minutes` set to 1 and `advance_event` called after expiry, the top milestone team wins; with nobody scanned the result is `none`.
10. **Pause:** pausing for 2 minutes moves `r3_end_ms` effect by 2 minutes; `add_time` also extends it.
11. **Overrides:** every override without a reason returns `REASON_REQUIRED`; crediting the last unsolved box returns `CREDIT_LAST_BOX`; `reset_box` restores the full tries and keeps old attempts; each override writes one `admin_log` row.
12. **Reset:** `reset_event_data` returns `RESET_BLOCKED` in an unpaused running phase and works in `setup`, `ended` or paused; it clears all Round 3 runtime tables, the result row and the sequence; it keeps config, zones and riddles.
13. **Security:** no player payload contains the code or any other team's data; `R3_SPECTATOR` carries no riddle; admin routes return 401 without the cookie.
14. **UI:** the checks of A2 and A3 at 360, 768, 1280 and 1920 px; `scripts/admin-smoke.ts` exits 0.

---

### 15.11 Part B done when

- Migrations `005` and `006` apply cleanly on a fresh Postgres 16 and on the real Supabase.
- `scripts/r3-simulate.ts` runs a complete hunt for 5 teams; the admin grid shows 5 teams times 5 timestamps live; the code winner ends the event for everyone.
- All 14 test groups above pass; `npm test`, `tests/sql/run.sh`, `tests/sql/concurrency.sh` and `npx next build` pass.
- On a real phone: scan a Round 3 start QR with the camera, log in, and land back on the right team page (this also closes the CODEMAP "real-phone checks" item).
- Phase 9 checks are re-run against the new Round 3: `scripts/load-test.ts` (400 clients polling `/api/state` for 5 minutes, zero 5xx, p95 under 800 ms), the Section 10 security checks, and RLS and grants verified for the new tables.
- No file still references `claim_round3`, `round3_claim`, `password_norm`, `go_live` or `/api/r3/claim` (search the repo).
- `CODEMAP.md` (fully rewritten, since it is stale), `README` and `ADMIN_AUDIT.md` are updated, and the agent stops.

---

### 15.12 Removing and rewriting the existing Round 3 code (Phases 7 to 9 are built)

Do this together with Part B. For each item, find the code by searching for the quoted names.

| Existing item | Action |
|---------------|--------|
| `claim_round3`, `round3`, `round3_claim`, `teams.pw_*`, settings `password_*` | dropped by `006` (15.3). Delete every TypeScript reference |
| `open_round3()` (old, no arguments) | dropped by `006`; replaced by `open_round3(boolean)` (15.4.4). Update `lib/event-service.ts` and `/api/admin/event/[action]` |
| `end_event`, `advance_event`, `reset_event_data` | `create or replace` with the new behaviour (15.4.5, 15.4.8, 15.4.10) |
| `go_live` and the `go-live` action, Go Live button, mode switch | delete (A1) |
| `POST /api/r3/claim` and its zod schema | delete; add `POST /api/r3/answer` |
| `/api/scan` | switch to `scan_dispatch` (15.4.6) |
| `lib/game-service` Round 3 wrapper, `lib/state.ts` R3 branch, `lib/dto.ts` R3 mapper | replace with `R3_FIND`, `R3_BOXES`, `R3_SPECTATOR`, `ENDED` (15.6) |
| `components/Game.tsx` R3 screen | replace with the four new screens; update polling intervals |
| `lib/messages.ts` | remove `WRONG_PASSWORD`, `ALREADY_CLAIMED`, `THROTTLED` for passwords; add the codes of 15.6 |
| Admin Round 3 page and `PUT /api/admin/round3` | replace with `/hq/round3` and the routes of 15.5 |
| `scripts/seed.ts` round3 seed | replace (15.9) |
| Phase 8 tests (password claim, simultaneous claims) | delete and replace with 15.10 |
| `scripts/load-test.ts` | update to poll the new Round 3 screens too; re-run |
| README admin cheat sheet and outage policy | add: Start Round 3, Round 3 overrides, the reset guard; remove live mode |

---

## 16. Phase 11: admin repair, blind Round 1, Round 1 reset, 75-team scale

### 16.0 Read this first

This section **overrides Section 15 and every older rule** wherever they disagree. Phase 10 is built, but the owner reports that the admin panel is still broken. Do not trust earlier "done" claims, `CODEMAP.md` or `ADMIN_AUDIT.md`. Re-verify everything this section touches.

**Scale facts.** About 75 teams (about 375 players) in Round 1. `top_n_r2` = 25 teams in Round 2. 5 teams in Round 3. Any list that can pass 25 rows is paged (16.6).

**Database drift is the most likely root cause of several admin bugs.** The owner never ran `005_phase10_fixes.sql` or `006_round3.sql` in the Supabase SQL editor, so the live database still has the old Round 3 and no `event_clock()`, `r3_*` tables or `open_round3(boolean)`, while the deployed code calls them. You cannot run DDL: supabase-js talks to PostgREST and has no DDL access. **Never state that a migration is applied unless `scripts/db-check.ts` proves it.** The owner runs SQL by hand, so produce SQL that is safe to paste and safe to run twice.

**Working method (Antigravity):**
1. Use Planning mode. The implementation-plan artifact lists only the files you will touch, one line each. Copy that list into `DECISIONS.md`.
2. One commit per numbered item: `phase11: 16.3 admin layout`. Stop after 16.9.
3. For every UI change, use the browser tool at widths **360, 768, 1280 and 1920 px**, attach screenshots to the walkthrough artifact, and run `document.documentElement.scrollWidth <= window.innerWidth` on each page.
4. Fix root causes, not symptoms. `overflow-x: hidden` on `html` or `body` is forbidden as a fix. No new libraries (Section 2.1).
5. Update `CODEMAP.md` and `ADMIN_AUDIT.md` at the end.

### 16.1 Item 1: database check, migration 007, one SQL file for the owner

**a. `scripts/db-check.ts`** (run with `npx tsx --env-file=.env.local scripts/db-check.ts`). Using the service-role client, print a table `object | expected | status (OK or MISSING)` for:
- tables: every table in Sections 5, 15.3 and `r1_archive`; columns `event_state.r3_start_ms`, `event_state.r3_end_ms`, `r3_boxes.epoch`;
- functions through `.rpc()`: `event_clock`, `advance_event`, `scan_dispatch`, `r3_submit_box`, `open_round3`, `start_round2`, `submit_answer`, `reset_event_data`. Call each with harmless invalid arguments. PostgREST code `PGRST202` means MISSING; any other error means the function exists;
- old objects that must be gone: `go_live`, `claim_round3`, tables `round3` and `round3_claim` (status `STILL PRESENT` is a failure).

**b. `supabase/migrations/007_phase11.sql`**, with these contents. Base every `create or replace function` on the **latest definition in the repo** (including 005 and 006), not on Section 6, and change only what is listed.

1. Table `r1_archive (team_id text primary key references teams(id), points int not null, submitted int not null, last_ms bigint, rank int not null, qualified boolean not null, archived_at timestamptz not null default now())`. Enable RLS, `revoke all ... from anon, authenticated`, `grant all ... to service_role`.
2. `submit_answer`, **R1 branch only**:
   - Lock the team row. If **any** attempt exists for (team, riddle), return `{ok:false, code:'ALREADY_SUBMITTED'}`. Do not distinguish correct from wrong, and never return `ALREADY_DONE` or `LOCKED` in Round 1.
   - Otherwise insert the attempt exactly as before. Points are computed on the server: `r1_points_per_riddle` if correct, else 0. `try_no = 1`.
   - Return `{ok:true, status:'recorded', runFinished:false}`. A duplicate `requestId` returns the same `recorded`. The R2 branch is unchanged.
3. `start_round2`: inside the same transaction, after the existing validations and before the existing effects:
   - upsert into `r1_archive` one row per non-withdrawn team from `r1_standings`, with `rank() over (order by points desc, last_ms asc nulls last)`, `submitted` = count of that team's R1 attempts, and `qualified` as it stands now;
   - `delete from attempts where riddle_id is not null;`
   - write the `admin_log` row with `after` = `{teamsArchived, r1AttemptsDeleted}`.
4. `reset_event_data`: also truncate `r1_archive`. Everything else stays as in 15.4.10.
5. Last line of the file: `notify pgrst, 'reload schema';`

**c. `supabase/RUN_THIS_IN_SQL_EDITOR.sql`**: the single file the owner pastes. Contents: `begin;`, then 005, 006, 007 in order, then `commit;`, then a final verification `select`. Rules for this file (leave the original migration files untouched):
- idempotent: `create table if not exists`, `create or replace function`, `drop ... if exists`, `alter table ... add column if not exists`, `insert ... on conflict do nothing`;
- `drop function if exists open_round3();` and `claim_round3(text, text)` and `go_live(...)` as written in 15.3, before the new definitions;
- ends with the Section 5 revoke and grant pattern for functions, sequences and tables, then `notify pgrst, 'reload schema';`;
- the verification select returns one row, for example `event_clock, go_live_gone, old_r3_gone, r3_zones, r1_archive`, each true or false, so the owner can read the result at a glance.

**d. Stop and hand over.** Run `db-check.ts`. If anything is MISSING or STILL PRESENT, **stop**. Tell the owner, in plain words: "Open the Supabase SQL editor, paste all of `supabase/RUN_THIS_IN_SQL_EDITOR.sql`, run it once, then reply SQL done." Do nothing else until the owner confirms and `db-check.ts` prints all OK. If a later item needs more SQL, put it in `008_*.sql` and repeat this handover.

### 16.2 Item 2: `/hq/content` JSON failure and every admin fetch

Symptom: `Failed to execute 'json' on 'Response': Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. The client called an admin API and got an HTML page. Find which of these it is (open the Network tab on `/hq/content`) and fix **all** of them:
1. The route does not exist (CODEMAP lists CRUD for riddles, questions, teasers and QR as missing), so Next returns the HTML 404. Implement the missing routes of Section 7.3.
2. Middleware redirects an unauthenticated `/api/admin/*` call to the login page (HTML). For `/api/admin/*` it must return JSON `401 {ok:false, code:'UNAUTHORIZED'}` and never redirect. Only `/hq/*` pages redirect.
3. A route throws and Next returns its HTML 500 page. Wrap every admin handler in one `withAdmin(handler)` helper that catches errors and returns JSON `{ok:false, code:'SERVER_ERROR', message}` with status 500 (log the detail server-side only). Set `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'` on every admin route.
4. Add `app/api/admin/[...unknown]/route.ts` that answers every method with JSON `404 {ok:false, code:'NOT_FOUND'}`, so a wrong path can never return HTML.

Client side: create `lib/admin-fetch.ts`, the **only** way `/hq` code calls the API. It checks `content-type` before `.json()`. On 401 it redirects to `/hq/login`. On any non-JSON reply it returns an error that reads `Server returned {status} for {url}` and the page shows it in a visible error banner with a Retry button (never an uncaught exception). Replace every raw `fetch('/api/admin/...').then(r => r.json())` in `/hq`.

*Acceptance:* every tab of `/hq/content` (riddles, questions, teasers, QR locations, Round 3 content) loads with data; create, edit and delete work for each; with the cookie removed the API returns JSON 401; an unknown admin path returns JSON 404. `scripts/admin-smoke.ts` asserts a JSON content type on every response, including 401 and 404.

### 16.3 Item 3: admin layout (laptop and phone) and the dashboard

Phase 10 A2 and A3 are reported as failing. Diagnose before restyling:
- Search `app/layout.tsx`, `app/globals.css`, `body` and shared components for `max-w-[480px]`, `max-w-md`, `w-[360px]`, `max-w-sm` or a centred narrow column. The 480 px column (Section 2.8) belongs **only** in `app/(player)/layout.tsx`. The root layout must be neutral, and `/hq` gets its own `app/hq/layout.tsx` shell.
- Search `/hq` for fixed pixel widths, `min-w-*`, `grid-cols-[...px...]`, `whitespace-nowrap`, `table-fixed`, flex or grid children without `min-w-0`, and tables outside an `overflow-x-auto` wrapper. Confirm the viewport meta tag exists.

Build:
- **At 1024 px and above:** fixed left sidebar (240 px), content `min-w-0` with `max-width: 1440px`, tables full width with sticky headers, two-column forms. Dashboard: top row with phase, event clock and the next-action buttons; below it the team table (left, fluid) and a 320 px column with the per-QR counts (right). Use `grid grid-cols-[minmax(0,1fr)_320px]`.
- **Below 1024 px:** top bar with a menu button and a navigation drawer, one column, 44 px tap targets, dialogs that fit 360 px.
- **Phone dashboard:** the team table becomes a **card list** (one card per team: name, stage, points, rank, deadline, with an expand toggle for the rest). Do not squeeze a wide table onto a phone. Wide tables that stay tables sit in `overflow-x-auto`.
- Shared components: `components/hq/Shell.tsx`, `ResponsiveTable.tsx`, `Pager.tsx` (16.6), `ErrorBanner.tsx`.
- **Dashboard payload** (`GET /api/admin/dashboard?page=&pageSize=&q=`) is split into `summary` (phase, clock, counts, per-QR counts, `round3` block) and `teams: { rows, total, page, pageSize }`. Only the requested page of team rows is built and sent. Polling stays 5 s (3 s in Round 3) and refetches the **current** page and search text without resetting them.
- Dashboard team rows by phase: Round 1 shows submitted count (`n / total`), R1 points, R1 rank, last scoring time. From `r2_running` they show the Round 2 columns of A4, starting at 0. Round 1 rows cover all teams; from Round 2 on only qualified teams.

*Acceptance:* every `/hq` page (dashboard, event control, settings, teams and students, QR, content, selection, standings, round3, interventions, log) passes the scroll-width check at 360, 768, 1280 and 1920 px **with 75 seeded teams**, with no clipped buttons and no overlapping text. Record each page and width in `ADMIN_AUDIT.md`.

### 16.4 Item 4: Round 1 is blind (no correct or incorrect shown)

Players never learn whether an R1 answer was right. The server calculates points, the admin sees them, and the player UI only records the submission.

**Server (rule 5, the browser is untrusted).** `/api/state` for `R1` and the `/api/answer` response must contain no `correct`, `wrong`, points or any field that reveals correctness. This also removes the leak where a second submit would say `ALREADY_DONE` (correct) or `LOCKED` (wrong).
- `R1` payload: `deadlineEventMs`, `canSubmit`, `submittedCount`, `total`, `riddles: [{ id, position, text, options (seeded-shuffled), status: 'open' | 'submitted', chosenOptionId? }]`.
- `/api/answer` for `kind:'r1'` returns `{ok:true, status:'recorded'}` or `ALREADY_SUBMITTED`.
- `lib/messages.ts`: add `ALREADY_SUBMITTED` = "This riddle is already submitted."; remove "Correct." and "Wrong." from Round 1; the success text is "Answer saved."
- `tries_r1` is always 1 in effect. Show it read-only on the settings page with the note "Round 1 allows one submission per riddle and shows no result."

**Player UI (one riddle per page, with paging).**
- Header: "Riddle 3 of 12" and the countdown. Below it a number strip (submitted = filled, current = outlined, open = empty) that scrolls horizontally at 360 px. Previous and Next buttons. Anyone can page through all riddles.
- Captain: tap an option, then tap **Lock in answer**. After the server replies `recorded`, show "Answer saved." for about 600 ms and move to the **next unsubmitted** riddle (wrapping around). When none are left show "All {total} answers submitted. Waiting for Round 1 to end."
- Submitted riddles show the options disabled with the chosen one marked "Your answer" in the **neutral accent colour**. Never use green, red, ticks or crosses for answers in Round 1.
- Members see the same pages read-only with the "submitted" marks.
- `R1_DONE` text: "Round 1 is over. The organisers are counting." Nothing about scores or ranks.
- Network retry reuses the same `requestId`. A `WRONG_PHASE` reply (time over) shows its message and refreshes state.

### 16.5 Item 5: Round 1 scores are cleared when Round 2 starts

`r2_standings` already counts only question attempts and adjustments, so Round 1 points never entered Round 2 totals. The owner still wants a visible clean start, so `start_round2` (16.1b, item 3) archives and then deletes the Round 1 attempts.
- The **Start Round 2** dialog says: "Round 1 scores will be saved to an archive and cleared. Round 2 starts from 0 for every team. {k} teams are qualified (target {top_n_r2})." It shows a yellow warning when `k` differs from `top_n_r2`.
- After Round 2 starts: the dashboard no longer shows R1 points; `/hq/standings` **Round 1** tab reads from `r1_archive` with a badge "Archived. Cleared from live scoring."; add `r1` to the CSV export names (`GET /api/admin/export/r1`, from `r1_archive`); the **Round 2** tab starts at 0 for all 25 teams.
- **Selection page** (before Round 2): ranked by `r1_standings`, paged (16.6). Provide a **Pre-tick top {top_n_r2}** button (calls `set_qualified` for every team with rank at most `top_n_r2`) and call it automatically the first time the page opens with zero ticked teams. Ties at the cutoff are flagged. The header shows the ticked count across **all** pages. Each tick saves immediately. A "Show ticked only" filter is available.

### 16.6 Item 6: paging everywhere

Server-side paging for: dashboard team rows, both standings tabs, selection, teams and students (about 375 students), registrations, attempts views, the `admin_log` viewer (default 50), and the Round 3 team list.
- Query parameters `page` (from 1), `pageSize` (25, 50 or 100; default 25; server caps at 100) and `q` (team name or ID, student ID or name). Response `{ rows, total, page, pageSize }`. Order is stable (ties broken by id).
- `components/hq/Pager.tsx`: "1 to 25 of 75", Previous, Next, and a page-size select. At 360 px it stays on one line without overflow. Changing `q` resets to page 1. Polling keeps the current page.
- Pickers in interventions (team, student, QR) are search-as-you-type selects, never full dropdowns of 75 or 375 items.
- Player pages are not paged except Round 1 (16.4).

### 16.7 Item 7: scale to 75 teams

- `scripts/seed.ts`: 75 teams (`T01` to `T75`), 3 to 5 students each, one captain each; flag `--with-r1-attempts` inserts random Round 1 attempts for every team so standings, selection and archive can be tested.
- `scripts/load-test.ts`: 400 clients (mix of R1, R2 and spectator states) polling `/api/state` for 5 minutes; zero 5xx; p95 under 800 ms. Also poll the admin dashboard page every 5 s from 3 admin sessions.
- Confirm there is no N+1 query in the dashboard or standings builders (one query per table, joined in code or SQL).

### 16.8 Tests

Add `tests/sql/phase11.sql` (run by `tests/sql/run.sh`) and extend `scripts/admin-smoke.ts`:
1. R1 submit: correct and wrong both return `recorded`; a second submit returns `ALREADY_SUBMITTED` for both; the points stored are right; duplicate `requestId` returns the same result with one row.
2. No R1 payload or `/api/answer` response contains `correct`, `wrong`, `points` or `correct_option_id` (string search on the JSON).
3. `start_round2`: `attempts where riddle_id is not null` is 0 afterwards; `r1_archive` has one row per non-withdrawn team with the right points and rank; `r2_standings` is all 0; the R1 CSV export still returns the archived scores; the `admin_log` row exists.
4. `reset_event_data` empties `r1_archive`.
5. Admin API: every response is JSON (including 401 and 404); `/hq/content` CRUD works end to end for riddles, questions, teasers and QR.
6. Paging: `page`, `pageSize`, `q` return the right slice and `total` on 75 seeded teams; `pageSize=1000` is capped at 100.
7. Selection: pre-tick marks exactly the teams with rank at most 25 (ties flagged); untick and tick persist; Start Round 2 with 0 qualified is still blocked.
8. UI: scroll-width check at 360, 768, 1280 and 1920 px on every `/hq` page.
9. `npm test`, `tests/sql/run.sh`, `tests/sql/concurrency.sh`, `npx next build` and `scripts/admin-smoke.ts` all pass.

### 16.9 Done when, and the final message to the owner

Done when: `db-check.ts` prints all OK; items 16.2 to 16.7 pass their acceptance checks; the tests of 16.8 pass; `CODEMAP.md` and `ADMIN_AUDIT.md` are updated; and no file references `go_live`, `claim_round3` or `/api/r3/claim`.

Your final message to the owner must contain, in this order: (1) a list of what was fixed and, for the `/hq/content` error, the real cause you found; (2) **"SQL to run in Supabase"**: the exact file name, or "nothing more to run" if the owner already ran everything; (3) anything you could not verify and why.
