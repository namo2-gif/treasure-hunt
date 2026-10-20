-- ============================================================================
-- 006_round3.sql: Phase 10 Round 3 Redesign
-- ============================================================================

-- 1. Remove old Round 3 (password-claim model from Phase 8)
drop function if exists claim_round3(text, text);
drop function if exists open_round3();      -- Replace with open_round3(boolean)
drop table if exists round3_claim;
drop table if exists round3;
alter table teams drop column if exists pw_wrong, drop column if exists pw_blocked_until;
delete from settings where key in ('password_max_wrong','password_lockout_s');

-- 2. New settings and clock fields
insert into settings (key, value) values ('r3_minutes','40'), ('r3_tries_per_box','2')
  on conflict (key) do nothing;
alter table event_state add column if not exists r3_start_ms bigint, add column if not exists r3_end_ms bigint;

-- 3. Content
create table if not exists r3_config (
  id smallint primary key check (id = 1),
  code text not null default '1DAI' check (code ~ '^[1-9][A-Z]{3}$'),   -- [PLACEHOLDER]
  hint_text text not null default ''                                    -- optional cipher hint shown on the box screen
);
insert into r3_config (id) values (1) on conflict (id) do nothing;

create table if not exists r3_zones (
  id smallint primary key check (id between 1 and 5),
  name text not null,
  token text unique not null,
  find_riddle text not null default '[PLACEHOLDER] riddle pointing to this zone''s start QR'
);

insert into r3_zones (id, name, token)
select g, 'Zone ' || g, translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_')
from generate_series(1, 5) g
on conflict (id) do nothing;

create table if not exists r3_riddles (
  zone smallint not null references r3_zones(id) on delete cascade,
  box smallint not null check (box between 1 and 4),
  text text not null default '[PLACEHOLDER] box riddle',
  primary key (zone, box)
);

insert into r3_riddles (zone, box)
select z, b from generate_series(1,5) z, generate_series(1,4) b
on conflict (zone, box) do nothing;

-- 4. Runtime state
create sequence if not exists r3_seq;

create table if not exists r3_team (
  team_id text primary key references teams(id),
  zone smallint unique references r3_zones(id),        -- null until assigned
  scanned_ms bigint, scanned_at timestamptz, scanned_by text references students(id),
  scan_seq bigint, scan_credited boolean not null default false,
  finished_ms bigint
);

create table if not exists r3_boxes (
  team_id text not null references teams(id), box smallint not null check (box between 1 and 4),
  epoch int not null default 1,                          -- +1 on admin reset: tries are counted per epoch
  locked boolean not null default false,
  solved_ms bigint, solved_at timestamptz, solved_seq bigint, credited boolean not null default false,
  primary key (team_id, box)
);

create table if not exists r3_attempts (
  id bigserial primary key, request_id uuid not null unique,
  team_id text not null references teams(id), student_id text not null references students(id),
  box smallint not null, epoch int not null, try_no smallint not null,
  value text not null, correct boolean not null,
  created_ms bigint not null, created_at timestamptz not null default now(),
  unique (team_id, box, epoch, try_no)
);

create table if not exists r3_result (            -- exactly one row, always present; reason null = undecided
  id smallint primary key check (id = 1),
  winner_team_id text references teams(id),
  reason text check (reason in ('code','progress','admin','none')),
  decided_ms bigint, decided_at timestamptz
);
insert into r3_result (id) values (1) on conflict (id) do nothing;

create or replace view r3_standings as
select rt.team_id, rt.zone,
  ((rt.scanned_ms is not null)::int + coalesce(b.solved, 0))::int as milestones,
  nullif(greatest(coalesce(rt.scan_seq, 0), coalesce(b.last_seq, 0)), 0) as last_seq
from r3_team rt
left join (select team_id, count(solved_ms)::int as solved, max(solved_seq) as last_seq
           from r3_boxes group by team_id) b on b.team_id = rt.team_id;

-- Security / RLS
alter table r3_config enable row level security;
alter table r3_zones enable row level security;
alter table r3_riddles enable row level security;
alter table r3_team enable row level security;
alter table r3_boxes enable row level security;
alter table r3_attempts enable row level security;
alter table r3_result enable row level security;

revoke all on r3_config, r3_zones, r3_riddles, r3_team, r3_boxes, r3_attempts, r3_result from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ============================================================================
-- Atomic Functions
-- ============================================================================

-- 15.4.1 r3_preselect() (internal)
create or replace function r3_preselect() returns void language plpgsql as $$
declare
  v_top_n bigint;
begin
  select coalesce((value #>> '{}')::bigint, 5) into v_top_n from settings where key = 'top_n_r3';

  update teams set r3_eligible = false where true;

  update teams t
  set r3_eligible = true
  from (
    select team_id
    from r2_standings
    order by points desc, last_ms asc nulls last, team_id
    limit v_top_n
  ) sel
  where t.id = sel.team_id;
end;
$$;

-- 15.4.8 r3_decide(p_reason text) (internal, also used by end_event)
create or replace function r3_decide(p_reason text) returns jsonb language plpgsql as $$
declare
  v_res record;
  v_winner record;
  v_now bigint;
begin
  select * into v_res from r3_result where id = 1 for update;
  if v_res.reason is not null then
    return jsonb_build_object('ok', true, 'already', true, 'reason', v_res.reason, 'winner', v_res.winner_team_id);
  end if;

  v_now := event_now_ms();

  select * into v_winner
  from r3_standings
  where milestones >= 1
  order by milestones desc, last_seq asc nulls last, team_id
  limit 1;

  if not found then
    update r3_result set
      winner_team_id = null,
      reason = 'none',
      decided_ms = v_now,
      decided_at = now()
    where id = 1;
  else
    update r3_result set
      winner_team_id = v_winner.team_id,
      reason = p_reason,
      decided_ms = v_now,
      decided_at = now()
    where id = 1;
  end if;

  update event_state set phase = 'ended' where id = 1;

  return jsonb_build_object('ok', true, 'reason', coalesce(v_winner.team_id, 'none'));
end;
$$;

-- 15.4.5 advance_event addition (replaces Section 4.3 advance_event)
create or replace function advance_event() returns void language plpgsql as $$
declare
  v_state record;
  v_now bigint;
  v_break_min bigint;
  v_cap_min bigint;
  v_hard_end bigint;
  v_cap_ms bigint;
  v_team record;
begin
  select * into v_state from event_state where id = 1 for update;
  if not found then
    return;
  end if;

  v_now := event_now_ms();

  -- 1. If r1_running and event_now >= r1_end_ms: set r1_closed
  if v_state.phase = 'r1_running' and v_state.r1_end_ms is not null and v_now >= v_state.r1_end_ms then
    update event_state set phase = 'r1_closed' where id = 1;
    v_state.phase := 'r1_closed';
  end if;

  -- 2. If r2_running and event_now >= r2_hard_end_ms: set r2_break and break_end_ms and r3_preselect()
  if v_state.phase = 'r2_running' and v_state.r2_hard_end_ms is not null and v_now >= v_state.r2_hard_end_ms then
    select coalesce((value #>> '{}')::bigint, 3) into v_break_min from settings where key = 'break_minutes';
    update event_state set
      phase = 'r2_break',
      break_end_ms = v_state.r2_hard_end_ms + (v_break_min * 60000)
    where id = 1;
    v_state.phase := 'r2_break';
    v_state.break_end_ms := v_state.r2_hard_end_ms + (v_break_min * 60000);
    perform r3_preselect();
  end if;

  -- 3. If r2_running and event_now >= run2_open_ms
  if v_state.phase = 'r2_running' and v_state.run2_open_ms is not null and v_now >= v_state.run2_open_ms then
    select coalesce((value #>> '{}')::bigint, 30) into v_cap_min from settings where key = 'run_cap_minutes';
    v_cap_ms := v_cap_min * 60000;
    v_hard_end := v_state.r2_hard_end_ms;

    for v_team in
      select t.id from teams t
      where t.qualified = true and t.withdrawn = false
        and not exists (select 1 from team_run tr where tr.team_id = t.id and tr.run = 2)
    loop
      insert into team_run (team_id, run, opens_ms, deadline_ms)
      values (
        v_team.id,
        2,
        v_state.run2_open_ms,
        case
          when v_hard_end is not null and (v_state.run2_open_ms + v_cap_ms) > v_hard_end then v_hard_end
          else v_state.run2_open_ms + v_cap_ms
        end
      )
      on conflict (team_id, run) do nothing;
    end loop;
  end if;

  -- 4. If r3_open and event_now >= r3_end_ms: decide winner by progress
  if v_state.phase = 'r3_open' and v_state.r3_end_ms is not null and v_now >= v_state.r3_end_ms then
    perform r3_decide('progress');
  end if;
end;
$$;

-- Redefine end_round2 to also call r3_preselect()
create or replace function end_round2(p_admin_id int default null) returns jsonb language plpgsql as $$
declare
  v_state event_state%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_now bigint;
  v_break_min bigint;
begin
  perform advance_event();
  select * into v_state from event_state where id = 1 for update;
  if v_state.phase <> 'r2_running' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'Can only end Round 2 while running');
  end if;

  v_before := to_jsonb(v_state);
  v_now := event_now_ms();
  select coalesce((value #>> '{}')::bigint, 3) into v_break_min from settings where key = 'break_minutes';

  update event_state set
    phase = 'r2_break',
    r2_hard_end_ms = v_now,
    break_end_ms = v_now + (v_break_min * 60000)
  where id = 1
  returning * into v_state;

  v_after := to_jsonb(v_state);

  perform r3_preselect();

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'end-r2', 'event_state', v_before, v_after);

  return jsonb_build_object('ok', true, 'phase', v_state.phase, 'break_end_ms', v_state.break_end_ms);
end;
$$;

-- Redefine end_event(): from r3_open calls r3_decide('admin')
create or replace function end_event(p_admin_id int default null) returns jsonb language plpgsql as $$
declare
  v_state event_state%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  perform advance_event();
  select * into v_state from event_state where id = 1 for update;

  if v_state.phase = 'r3_open' then
    perform r3_decide('admin');
    select * into v_state from event_state where id = 1;
    insert into admin_log (admin_id, action, target, before, after)
    values (p_admin_id, 'end-event', 'event_state', to_jsonb(v_state), to_jsonb(v_state));
    return jsonb_build_object('ok', true, 'phase', 'ended');
  end if;

  if v_state.phase = 'ended' then
    return jsonb_build_object('ok', true, 'phase', 'ended', 'already', true);
  end if;

  v_before := to_jsonb(v_state);
  update event_state set phase = 'ended' where id = 1 returning * into v_state;
  v_after := to_jsonb(v_state);

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'end-event', 'event_state', v_before, v_after);

  return jsonb_build_object('ok', true, 'phase', v_state.phase);
end;
$$;

-- 15.4.2 set_r3_eligible(team, bool) (admin)
create or replace function set_r3_eligible(p_team text, p_eligible boolean, p_admin_id int default null)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_count int;
  v_before jsonb;
  v_after jsonb;
begin
  perform advance_event();
  select phase into v_state from event_state where id = 1;
  if v_state.phase <> 'r2_break' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'Can only edit Round 3 eligibility during break');
  end if;

  if p_eligible then
    select count(*) into v_count from teams where r3_eligible = true and id <> p_team and not withdrawn;
    if v_count >= 5 then
      return jsonb_build_object('ok', false, 'code', 'R3_TOO_MANY', 'message', 'Maximum 5 teams can participate in Round 3');
    end if;
  end if;

  select to_jsonb(t) into v_before from teams t where id = p_team;
  update teams set r3_eligible = p_eligible where id = p_team;
  select to_jsonb(t) into v_after from teams t where id = p_team;

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'set_r3_eligible', p_team, v_before, v_after);

  return jsonb_build_object('ok', true, 'teamId', p_team, 'eligible', p_eligible);
end;
$$;

-- 15.4.3 r3_assign_zone(team, zone) and r3_randomize_zones() (admin)
create or replace function r3_assign_zone(p_team text, p_zone smallint, p_admin_id int default null)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_taken text;
  v_before jsonb;
  v_after jsonb;
begin
  perform advance_event();
  select phase into v_state from event_state where id = 1;
  if v_state.phase <> 'r2_break' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'Can only assign zones during break');
  end if;

  select team_id into v_taken from r3_team where zone = p_zone and team_id <> p_team;
  if found then
    return jsonb_build_object('ok', false, 'code', 'R3_ZONE_TAKEN', 'message', 'Zone is already assigned to another team');
  end if;

  select to_jsonb(rt) into v_before from r3_team rt where team_id = p_team;

  insert into r3_team (team_id, zone)
  values (p_team, p_zone)
  on conflict (team_id) do update set zone = p_zone;

  select to_jsonb(rt) into v_after from r3_team rt where team_id = p_team;

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'r3_assign_zone', p_team, v_before, v_after);

  return jsonb_build_object('ok', true, 'teamId', p_team, 'zone', p_zone);
end;
$$;

create or replace function r3_randomize_zones(p_admin_id int default null)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_team record;
  v_zone smallint;
begin
  perform advance_event();
  select phase into v_state from event_state where id = 1;
  if v_state.phase <> 'r2_break' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'Can only randomize zones during break');
  end if;

  -- Ensure r3_team row exists for all eligible non-withdrawn teams
  insert into r3_team (team_id)
  select t.id from teams t
  where t.r3_eligible = true and not t.withdrawn
  on conflict (team_id) do nothing;

  -- Assign free zones to teams without a zone
  for v_team in
    select team_id from r3_team rt
    join teams t on t.id = rt.team_id
    where t.r3_eligible = true and not t.withdrawn and rt.zone is null
    order by random()
  loop
    select z.id into v_zone
    from r3_zones z
    where not exists (select 1 from r3_team where zone = z.id)
    order by random() limit 1;

    if v_zone is not null then
      update r3_team set zone = v_zone where team_id = v_team.team_id;
    end if;
  end loop;

  insert into admin_log (admin_id, action, target)
  values (p_admin_id, 'r3_randomize_zones', 'all');

  return jsonb_build_object('ok', true);
end;
$$;

-- 15.4.4 open_round3(p_force boolean default false) (admin)
create or replace function open_round3(p_force boolean default false, p_admin_id int default null)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_now bigint;
  v_count int;
  v_cfg record;
  v_missing record;
  v_r3_min bigint;
  v_before jsonb;
  v_after jsonb;
begin
  perform advance_event();
  select * into v_state from event_state where id = 1 for update;
  if v_state.phase <> 'r2_break' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'Can only start Round 3 from r2_break');
  end if;

  v_now := event_now_ms();
  if v_state.break_end_ms is not null and v_now < v_state.break_end_ms and not p_force then
    return jsonb_build_object('ok', false, 'code', 'BREAK_NOT_OVER', 'message', 'Break has not ended yet');
  end if;

  if p_force and v_state.break_end_ms is not null and v_now < v_state.break_end_ms then
    update event_state set break_end_ms = v_now where id = 1;
  end if;

  select count(*) into v_count from teams where r3_eligible = true and not withdrawn;
  if v_count < 1 or v_count > 5 then
    return jsonb_build_object('ok', false, 'code', 'R3_TEAM_COUNT', 'message', 'Choose 1 to 5 teams');
  end if;

  select * into v_cfg from r3_config where id = 1;
  if v_cfg.code is null or v_cfg.code !~ '^[1-9][A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'code', 'R3_CODE_INVALID', 'message', 'One digit 1 to 9, then three letters');
  end if;

  -- Ensure missing r3_team rows are created
  insert into r3_team (team_id)
  select t.id from teams t
  where t.r3_eligible = true and not t.withdrawn
  on conflict (team_id) do nothing;

  -- Randomly assign zones to any eligible teams without one
  perform r3_randomize_zones(p_admin_id);

  -- Check content for all zones that will be used
  for v_missing in
    select z.id as zone_id, z.name as zone_name
    from r3_team rt
    join r3_zones z on z.id = rt.zone
    join teams t on t.id = rt.team_id
    where t.r3_eligible = true and not t.withdrawn and (
      btrim(z.find_riddle) = '' or
      exists (select 1 from r3_riddles r where r.zone = z.id and btrim(r.text) = '')
    )
  loop
    return jsonb_build_object('ok', false, 'code', 'R3_CONTENT_MISSING', 'message', 'Content missing for ' || v_missing.zone_name);
  end loop;

  v_before := to_jsonb(v_state);
  select coalesce((value #>> '{}')::bigint, 40) into v_r3_min from settings where key = 'r3_minutes';

  update event_state set
    phase = 'r3_open',
    r3_start_ms = v_now,
    r3_end_ms = v_now + (v_r3_min * 60000)
  where id = 1
  returning * into v_state;

  v_after := to_jsonb(v_state);

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'open-r3', 'event_state', v_before, v_after);

  return jsonb_build_object('ok', true, 'phase', v_state.phase, 'r3_start_ms', v_state.r3_start_ms, 'r3_end_ms', v_state.r3_end_ms);
end;
$$;

-- 15.4.6 r3_scan(p_student, p_token) and scan_dispatch(p_student, p_token)
create or replace function r3_scan(p_student text, p_token text) returns jsonb language plpgsql as $$
declare
  v_state record;
  v_student record;
  v_team record;
  v_res record;
  v_r3t record;
  v_zone record;
  v_now bigint;
begin
  perform advance_event();
  select * into v_state from event_state where id = 1;
  if v_state.paused_at is not null then
    return jsonb_build_object('ok', false, 'code', 'PAUSED', 'message', 'The event is paused. Hang tight.');
  end if;

  select * into v_student from students where id = p_student;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LOGIN');
  end if;

  if v_student.absent then
    return jsonb_build_object('ok', false, 'code', 'ABSENT', 'message', 'You are marked absent.');
  end if;

  if not v_student.is_captain then
    return jsonb_build_object('ok', false, 'code', 'NOT_CAPTAIN', 'message', 'Only your captain can scan this QR.');
  end if;

  select * into v_team from teams where id = v_student.team_id;
  if not found or not v_team.r3_eligible or v_team.withdrawn then
    return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE', 'message', 'Your team is not eligible for Round 3.');
  end if;

  select * into v_r3t from r3_team where team_id = v_team.id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE');
  end if;

  if v_state.phase = 'ended' then
    return jsonb_build_object('ok', false, 'code', 'R3_OVER', 'message', 'The hunt is over.');
  end if;
  if v_state.phase <> 'r3_open' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'That is not open right now.');
  end if;

  -- Lock order: r3_result row, then r3_team row
  select * into v_res from r3_result where id = 1 for update;
  if v_res.reason is not null then
    return jsonb_build_object('ok', false, 'code', 'R3_OVER', 'message', 'The hunt is over.');
  end if;

  select * into v_r3t from r3_team where team_id = v_team.id for update;

  select * into v_zone from r3_zones where token = p_token;
  if not found or v_zone.id <> v_r3t.zone then
    return jsonb_build_object('ok', false, 'code', 'WRONG_ZONE', 'message', 'This is not your team''s location. Check your riddle.');
  end if;

  if v_r3t.scanned_ms is not null then
    return jsonb_build_object('ok', true, 'already', true, 'kind', 'r3', 'message', 'You already scanned here.');
  end if;

  v_now := event_now_ms();

  update r3_team set
    scanned_ms = v_now,
    scanned_at = now(),
    scanned_by = v_student.id,
    scan_seq = nextval('r3_seq')
  where team_id = v_team.id;

  insert into r3_boxes (team_id, box, epoch)
  select v_team.id, b, 1 from generate_series(1, 4) b
  on conflict (team_id, box) do nothing;

  return jsonb_build_object('ok', true, 'kind', 'r3', 'message', 'Location verified. Your riddles are unlocked.');
end;
$$;

create or replace function scan_dispatch(p_student text, p_token text) returns jsonb language plpgsql as $$
begin
  if exists (select 1 from r3_zones where token = p_token) then
    return r3_scan(p_student, p_token);
  else
    return register_scan(p_student, p_token);
  end if;
end;
$$;

-- 15.4.7 r3_submit_box(p_student text, p_box int, p_value text, p_request uuid)
create or replace function r3_submit_box(
  p_student text,
  p_box int,
  p_value text,
  p_request uuid
) returns jsonb language plpgsql as $$
declare
  v_att record;
  v_state record;
  v_student record;
  v_team record;
  v_res record;
  v_r3t record;
  v_box record;
  v_cfg record;
  v_val text;
  v_tries_used int;
  v_max_tries int;
  v_correct boolean;
  v_now bigint;
  v_solved_count int;
  v_status text;
  v_tries_left int;
begin
  -- 1. Idempotency: duplicate request derives same result
  select * into v_att from r3_attempts where request_id = p_request;
  if found then
    select * into v_res from r3_result where id = 1;
    if v_att.correct then
      if v_res.winner_team_id = v_att.team_id and v_res.reason = 'code' then
        return jsonb_build_object('ok', true, 'status', 'won', 'box', v_att.box);
      else
        return jsonb_build_object('ok', true, 'status', 'correct', 'box', v_att.box);
      end if;
    else
      select coalesce((value #>> '{}')::int, 2) into v_max_tries from settings where key = 'r3_tries_per_box';
      if v_att.try_no >= v_max_tries then
        return jsonb_build_object('ok', true, 'status', 'locked', 'box', v_att.box);
      else
        return jsonb_build_object('ok', true, 'status', 'wrong', 'box', v_att.box, 'triesLeft', v_max_tries - v_att.try_no);
      end if;
    end if;
  end if;

  perform advance_event();
  select * into v_state from event_state where id = 1;
  if v_state.paused_at is not null then
    return jsonb_build_object('ok', false, 'code', 'PAUSED', 'message', 'The event is paused. Hang tight.');
  end if;

  select * into v_student from students where id = p_student;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LOGIN');
  end if;

  if not v_student.is_captain then
    return jsonb_build_object('ok', false, 'code', 'NOT_CAPTAIN', 'message', 'Only your captain can submit answers.');
  end if;

  select * into v_team from teams where id = v_student.team_id;
  if not found or not v_team.r3_eligible or v_team.withdrawn then
    return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE');
  end if;

  if p_box < 1 or p_box > 4 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_BOX', 'message', 'That box does not exist.');
  end if;

  if v_state.phase = 'ended' then
    return jsonb_build_object('ok', false, 'code', 'R3_OVER', 'message', 'The hunt is over.');
  end if;
  if v_state.phase <> 'r3_open' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'That is not open right now.');
  end if;

  -- Lock order: r3_result, then r3_team, then r3_boxes
  select * into v_res from r3_result where id = 1 for update;
  if v_res.reason is not null then
    return jsonb_build_object('ok', false, 'code', 'R3_OVER', 'message', 'The hunt is over.');
  end if;

  select * into v_r3t from r3_team where team_id = v_team.id for update;
  if v_r3t.scanned_ms is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_SCANNED', 'message', 'Scan your location QR first.');
  end if;

  -- 5. Value normalisation & validation
  v_val := upper(btrim(p_value));
  if p_box = 1 then
    if v_val !~ '^[1-9]$' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_FORMAT', 'message', 'Box 1 takes one digit from 1 to 9.');
    end if;
  else
    if v_val !~ '^[A-Z]$' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_FORMAT', 'message', 'Boxes 2 to 4 take one letter.');
    end if;
  end if;

  -- 6. Lock r3_boxes row
  select * into v_box from r3_boxes where team_id = v_team.id and box = p_box for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_BOX');
  end if;

  if v_box.solved_ms is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DONE', 'message', 'This box is already solved.');
  end if;

  if v_box.locked then
    return jsonb_build_object('ok', false, 'code', 'BOX_LOCKED', 'message', 'This box is locked.');
  end if;

  select coalesce((value #>> '{}')::int, 2) into v_max_tries from settings where key = 'r3_tries_per_box';
  select count(*) into v_tries_used from r3_attempts
  where team_id = v_team.id and box = p_box and epoch = v_box.epoch;

  select * into v_cfg from r3_config where id = 1;
  v_correct := (v_val = substr(v_cfg.code, p_box, 1));
  v_now := event_now_ms();

  insert into r3_attempts (
    request_id, team_id, student_id, box, epoch, try_no, value, correct, created_ms, created_at
  ) values (
    p_request, v_team.id, v_student.id, p_box, v_box.epoch, v_tries_used + 1, v_val, v_correct, v_now, now()
  );

  if v_correct then
    update r3_boxes set
      solved_ms = v_now,
      solved_at = now(),
      solved_seq = nextval('r3_seq')
    where team_id = v_team.id and box = p_box;

    select count(*) into v_solved_count from r3_boxes
    where team_id = v_team.id and solved_ms is not null;

    if v_solved_count >= 4 then
      update r3_team set finished_ms = v_now where team_id = v_team.id;
      update r3_result set
        winner_team_id = v_team.id,
        reason = 'code',
        decided_ms = v_now,
        decided_at = now()
      where id = 1;
      update event_state set phase = 'ended' where id = 1;
      return jsonb_build_object('ok', true, 'status', 'won', 'box', p_box);
    else
      return jsonb_build_object('ok', true, 'status', 'correct', 'box', p_box);
    end if;
  else
    if (v_tries_used + 1) >= v_max_tries then
      update r3_boxes set locked = true where team_id = v_team.id and box = p_box;
      return jsonb_build_object('ok', true, 'status', 'locked', 'box', p_box);
    else
      v_tries_left := v_max_tries - (v_tries_used + 1);
      return jsonb_build_object('ok', true, 'status', 'wrong', 'box', p_box, 'triesLeft', v_tries_left);
    end if;
  end if;
end;
$$;

-- 15.4.9 Admin overrides
create or replace function r3_credit_scan(p_team text, p_reason text, p_admin_id int default null)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_r3t record;
  v_before jsonb;
  v_after jsonb;
  v_now bigint;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED', 'message', 'Reason is required');
  end if;

  perform advance_event();
  select phase into v_state from event_state where id = 1;
  if v_state.phase <> 'r3_open' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'Can only credit scan while Round 3 is open');
  end if;

  select * into v_r3t from r3_team where team_id = p_team for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE');
  end if;

  if v_r3t.scanned_ms is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  v_before := to_jsonb(v_r3t);
  v_now := event_now_ms();

  update r3_team set
    scanned_ms = v_now,
    scanned_at = now(),
    scanned_by = null,
    scan_credited = true,
    scan_seq = nextval('r3_seq')
  where team_id = p_team
  returning * into v_r3t;

  insert into r3_boxes (team_id, box, epoch)
  select p_team, b, 1 from generate_series(1, 4) b
  on conflict (team_id, box) do nothing;

  v_after := to_jsonb(v_r3t);

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'r3_credit_scan', p_team, v_before, v_after);

  return jsonb_build_object('ok', true, 'teamId', p_team);
end;
$$;

create or replace function r3_credit_box(p_team text, p_box int, p_reason text, p_admin_id int default null)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_r3t record;
  v_box record;
  v_unsolved int;
  v_before jsonb;
  v_after jsonb;
  v_now bigint;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED', 'message', 'Reason is required');
  end if;

  perform advance_event();
  select phase into v_state from event_state where id = 1;
  if v_state.phase <> 'r3_open' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'Can only credit box while Round 3 is open');
  end if;

  select * into v_r3t from r3_team where team_id = p_team for update;
  if not found or v_r3t.scanned_ms is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_SCANNED', 'message', 'Team has not scanned its location');
  end if;

  select * into v_box from r3_boxes where team_id = p_team and box = p_box for update;
  if not found or v_box.solved_ms is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DONE', 'message', 'Box is already solved');
  end if;

  -- Check if crediting would leave NO unsolved box
  select count(*) into v_unsolved from r3_boxes
  where team_id = p_team and solved_ms is null and box <> p_box;

  if v_unsolved = 0 then
    return jsonb_build_object('ok', false, 'code', 'CREDIT_LAST_BOX', 'message', 'Reset the box so the team types it');
  end if;

  v_before := to_jsonb(v_box);
  v_now := event_now_ms();

  update r3_boxes set
    solved_ms = v_now,
    solved_at = now(),
    solved_seq = nextval('r3_seq'),
    credited = true
  where team_id = p_team and box = p_box
  returning * into v_box;

  v_after := to_jsonb(v_box);

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'r3_credit_box', p_team || ':' || p_box, v_before, v_after);

  return jsonb_build_object('ok', true, 'teamId', p_team, 'box', p_box);
end;
$$;

create or replace function r3_reset_box(p_team text, p_box int, p_reason text, p_admin_id int default null)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_box record;
  v_before jsonb;
  v_after jsonb;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED', 'message', 'Reason is required');
  end if;

  perform advance_event();
  select phase into v_state from event_state where id = 1;
  if v_state.phase <> 'r3_open' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'Can only reset box while Round 3 is open');
  end if;

  select * into v_box from r3_boxes where team_id = p_team and box = p_box for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_BOX');
  end if;

  if v_box.solved_ms is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DONE', 'message', 'Box is already solved');
  end if;

  v_before := to_jsonb(v_box);

  update r3_boxes set
    locked = false,
    epoch = epoch + 1
  where team_id = p_team and box = p_box
  returning * into v_box;

  v_after := to_jsonb(v_box);

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'r3_reset_box', p_team || ':' || p_box, v_before, v_after);

  return jsonb_build_object('ok', true, 'teamId', p_team, 'box', p_box, 'epoch', v_box.epoch);
end;
$$;

create or replace function r3_reassign_zone(p_team text, p_zone smallint, p_reason text, p_admin_id int default null)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_team1 record;
  v_other_team record;
  v_before jsonb;
  v_after jsonb;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED', 'message', 'Reason is required');
  end if;

  perform advance_event();
  select phase into v_state from event_state where id = 1;
  if v_state.phase <> 'r3_open' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'Can only reassign zone while Round 3 is open');
  end if;

  select * into v_team1 from r3_team where team_id = p_team for update;
  if not found or v_team1.scanned_ms is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SCANNED', 'message', 'Team has already scanned its zone');
  end if;

  select * into v_other_team from r3_team where zone = p_zone for update;
  if found and v_other_team.scanned_ms is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SCANNED', 'message', 'Target zone team has already scanned');
  end if;

  v_before := jsonb_build_object('team1', to_jsonb(v_team1), 'otherTeam', to_jsonb(v_other_team));

  if found then
    -- Swap using temporary null
    update r3_team set zone = null where team_id = v_other_team.team_id;
    update r3_team set zone = p_zone where team_id = p_team;
    update r3_team set zone = v_team1.zone where team_id = v_other_team.team_id;
  else
    update r3_team set zone = p_zone where team_id = p_team;
  end if;

  v_after := jsonb_build_object('team', p_team, 'newZone', p_zone);

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'r3_reassign_zone', p_team, v_before, v_after);

  return jsonb_build_object('ok', true, 'teamId', p_team, 'zone', p_zone);
end;
$$;

-- 15.4.10 reset_event_data(p_admin_id, p_confirm) (replaces older version)
create or replace function reset_event_data(p_admin_id int default null, p_confirm text default '')
returns jsonb language plpgsql as $$
declare
  v_state event_state%rowtype;
begin
  if p_confirm <> 'RESET' then
    return jsonb_build_object('ok', false, 'code', 'RESET_BLOCKED', 'message', 'Type RESET');
  end if;

  select * into v_state from event_state where id = 1 for update;
  if not (v_state.phase in ('setup', 'ended') or v_state.paused_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'RESET_BLOCKED', 'message', 'Reset allowed only in setup, ended, or while paused');
  end if;

  truncate table
    registrations, piece_assignments, team_run, team_questions,
    attempts, score_adjustments, r3_attempts, r3_boxes, r3_team, admin_log;

  update r3_result set
    winner_team_id = null,
    reason = null,
    decided_ms = null,
    decided_at = null
  where id = 1;

  alter sequence r3_seq restart;

  update event_state set
    phase = 'setup',
    paused_at = null,
    paused_total_ms = 0,
    r1_end_ms = null,
    r2_start_ms = null,
    run2_open_ms = null,
    r2_hard_end_ms = null,
    break_end_ms = null,
    r3_start_ms = null,
    r3_end_ms = null
  where id = 1;

  update teams set
    qualified = false,
    r3_eligible = false
  where true;

  update students set
    absent = false,
    failed_logins = 0,
    locked_until = null
  where true;

  insert into admin_log (admin_id, action, target)
  values (p_admin_id, 'reset_event_data', 'event_state');

  return jsonb_build_object('ok', true);
end;
$$;

-- 15.4.11 Config edits (admin)
create or replace function r3_set_code(p_code text, p_admin_id int default null)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_norm text;
  v_before jsonb;
  v_after jsonb;
begin
  perform advance_event();
  select phase into v_state from event_state where id = 1;
  if v_state.phase in ('r3_open', 'ended') then
    return jsonb_build_object('ok', false, 'code', 'R3_LOCKED', 'message', 'Round 3 code cannot be changed once open or ended');
  end if;

  v_norm := upper(btrim(p_code));
  if v_norm !~ '^[1-9][A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'code', 'R3_CODE_INVALID', 'message', 'One digit 1 to 9, then three letters');
  end if;

  select to_jsonb(c) into v_before from r3_config c where id = 1;
  update r3_config set code = v_norm where id = 1;
  select to_jsonb(c) into v_after from r3_config c where id = 1;

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'r3_set_code', 'r3_config', v_before, v_after);

  return jsonb_build_object('ok', true, 'code', v_norm);
end;
$$;

create or replace function r3_set_hint(p_hint text, p_admin_id int default null)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_before jsonb;
  v_after jsonb;
begin
  perform advance_event();
  select phase into v_state from event_state where id = 1;
  if v_state.phase in ('r3_open', 'ended') then
    return jsonb_build_object('ok', false, 'code', 'R3_LOCKED', 'message', 'Hint cannot be changed once open or ended');
  end if;

  select to_jsonb(c) into v_before from r3_config c where id = 1;
  update r3_config set hint_text = coalesce(p_hint, '') where id = 1;
  select to_jsonb(c) into v_after from r3_config c where id = 1;

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'r3_set_hint', 'r3_config', v_before, v_after);

  return jsonb_build_object('ok', true, 'hintText', coalesce(p_hint, ''));
end;
$$;

-- Redefine player_state() to return Round 3 payload according to Phase 10
create or replace function player_state(p_student text) returns jsonb language plpgsql as $$
declare
  v_state record;
  v_student record;
  v_team record;
  v_run team_run%rowtype;
  v_has_run boolean := false;
  v_now bigint;
  v_pieces int := 0;
  v_reg boolean := false;
  v_held jsonb := '[]'::jsonb;
  v_mine jsonb := '[]'::jsonb;
  v_board jsonb := '[]'::jsonb;
  v_teaser_open boolean;
  v_riddles jsonb := '[]'::jsonb;
  v_r3t record;
  v_r3z record;
  v_r3_boxes jsonb := '[]'::jsonb;
  v_r3_config record;
  v_r3_result record;
  v_max_tries int;
begin
  perform advance_event();
  select * into v_state from event_state where id = 1;
  select * into v_student from students where id = p_student;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;
  select * into v_team from teams where id = v_student.team_id;
  v_now := event_now_ms();

  -- R1 Riddles for r1_running or r1_closed
  if v_state.phase in ('r1_running', 'r1_closed') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'position', r.position,
      'text', r.text,
      'options', r.options,
      'attempts', coalesce((
        select jsonb_agg(jsonb_build_object('try_no', a.try_no, 'correct', a.correct) order by a.try_no)
        from attempts a where a.team_id = v_team.id and a.riddle_id = r.id
      ), '[]'::jsonb)
    ) order by r.position), '[]'::jsonb)
    into v_riddles
    from riddles r;
  end if;

  if v_state.phase = 'r2_running' and v_team.qualified and not v_team.withdrawn then
    select * into v_run from team_run
     where team_id = v_team.id and opens_ms <= v_now
     order by run desc limit 1;
    v_has_run := found;
  end if;

  if v_has_run then
    select count(*) into v_pieces from piece_assignments where team_id = v_team.id and run = v_run.run;
    v_reg := exists (select 1 from registrations where student_id = v_student.id and run = v_run.run);
    v_teaser_open := v_run.teaser_done_ms is null and not v_run.teaser_skipped;

    if v_teaser_open then
      select coalesce(jsonb_agg(jsonb_build_object('pieceNo', pa.piece_no, 'text', tp.pieces ->> (pa.piece_no - 1)) order by pa.piece_no), '[]'::jsonb)
        into v_held
        from piece_assignments pa
        left join teaser_puzzles tp on tp.run = pa.run and tp.size = v_team.n
       where pa.team_id = v_team.id and pa.run = v_run.run and pa.student_id = v_student.id;
    else
      select coalesce(jsonb_agg(jsonb_build_object(
               'questionNo', tq.question_no, 'stem', q.stem, 'locationName', l.name, 'voided', tq.voided,
               'attempts', coalesce((select jsonb_agg(jsonb_build_object('try_no', a.try_no, 'correct', a.correct) order by a.try_no)
                                       from attempts a where a.team_id = tq.team_id and a.question_id = tq.question_id), '[]'::jsonb))
             order by tq.question_no), '[]'::jsonb)
        into v_mine
        from team_questions tq
        join piece_assignments pa on pa.team_id = tq.team_id and pa.run = tq.run and pa.piece_no = tq.question_no
                                 and pa.student_id = v_student.id
        join questions q on q.id = tq.question_id
        join qr_locations l on l.id = q.qr_id
       where tq.team_id = v_team.id and tq.run = v_run.run;

      if v_student.is_captain then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'question_no', tq.question_no, 'id', q.id, 'options', q.options, 'voided', tq.voided,
                 'attempts', coalesce((select jsonb_agg(jsonb_build_object('try_no', a.try_no, 'correct', a.correct) order by a.try_no)
                                         from attempts a where a.team_id = tq.team_id and a.question_id = tq.question_id), '[]'::jsonb))
               order by tq.question_no), '[]'::jsonb)
          into v_board
          from team_questions tq
          join questions q on q.id = tq.question_id
         where tq.team_id = v_team.id and tq.run = v_run.run;
      end if;
    end if;
  end if;

  -- Round 3 data assembly
  select * into v_r3t from r3_team where team_id = v_team.id;
  if v_r3t.zone is not null then
    select * into v_r3z from r3_zones where id = v_r3t.zone;
  end if;

  select * into v_r3_config from r3_config where id = 1;
  select * into v_r3_result from r3_result where id = 1;
  select coalesce((value #>> '{}')::int, 2) into v_max_tries from settings where key = 'r3_tries_per_box';

  if v_r3t.scanned_ms is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'box', b.box,
      'riddle', (select r.text from r3_riddles r where r.zone = v_r3t.zone and r.box = b.box),
      'kind', case when b.box = 1 then 'digit' else 'letter' end,
      'status', case
        when b.solved_ms is not null then 'solved'
        when b.locked then 'locked'
        when (select count(*) from r3_attempts a where a.team_id = v_team.id and a.box = b.box and a.epoch = b.epoch) >= (v_max_tries - 1)
             and (select count(*) from r3_attempts a where a.team_id = v_team.id and a.box = b.box and a.epoch = b.epoch) > 0 then 'one_try_left'
        else 'open'
      end
    ) order by b.box), '[]'::jsonb)
    into v_r3_boxes
    from r3_boxes b
    where b.team_id = v_team.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'serverNowMs', (extract(epoch from now()) * 1000)::bigint,
    'eventNowMs', v_now,
    'paused', v_state.paused_at is not null,
    'phase', v_state.phase,
    'r1DeadlineMs', v_state.r1_end_ms,
    'breakEndMs', v_state.break_end_ms,
    'r3EndMs', v_state.r3_end_ms,
    'triesR1', setting_int('tries_r1', 1),
    'triesR2', setting_int('tries_r2', 2),
    'student', jsonb_build_object('id', v_student.id, 'name', v_student.name, 'isCaptain', v_student.is_captain),
    'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'n', v_team.n,
                               'qualified', v_team.qualified, 'withdrawn', v_team.withdrawn, 'r3Eligible', v_team.r3_eligible),
    'run', case when v_has_run then jsonb_build_object(
              'run', v_run.run, 'deadlineMs', v_run.deadline_ms,
              'finished', v_run.finished_ms is not null,
              'expired', v_now >= v_run.deadline_ms,
              'teaserDone', v_run.teaser_done_ms is not null or v_run.teaser_skipped) else null end,
    'registeredByMe', v_reg,
    'piecesAssigned', v_pieces,
    'piecesHeld', v_held,
    'mine', v_mine,
    'board', v_board,
    'riddles', v_riddles,
    'r3', jsonb_build_object(
      'hasScanned', v_r3t.scanned_ms is not null,
      'findRiddle', case when v_team.r3_eligible and v_r3z.find_riddle is not null then v_r3z.find_riddle else null end,
      'hint', v_r3_config.hint_text,
      'boxes', v_r3_boxes,
      'result', case when v_r3_result.reason is not null then jsonb_build_object(
        'reason', v_r3_result.reason,
        'winnerTeamId', v_r3_result.winner_team_id,
        'winnerTeamName', (select name from teams where id = v_r3_result.winner_team_id),
        'milestones', case when v_r3_result.reason = 'progress' then (
          select milestones from r3_standings where team_id = v_r3_result.winner_team_id
        ) else null end
      ) else null end
    )
  );
end;
$$;

-- Revoke and grant privileges
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
