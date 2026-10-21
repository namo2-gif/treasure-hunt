-- ============================================================================
-- 007_phase11.sql: Phase 11 Database Updates
-- ============================================================================

-- 1. Table r1_archive
create table if not exists r1_archive (
  team_id text primary key references teams(id),
  points int not null,
  submitted int not null,
  last_ms bigint,
  rank int not null,
  qualified boolean not null,
  archived_at timestamptz not null default now()
);

alter table r1_archive enable row level security;
revoke all on r1_archive from anon, authenticated;
grant all on r1_archive to service_role;

-- Update attempt_result to return recorded for R1 attempts
create or replace function attempt_result(p_attempt_id bigint) returns jsonb language plpgsql as $$
declare
  a record;
  v_max int;
  v_status text;
  v_finished boolean := false;
begin
  select * into a from attempts where id = p_attempt_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
  end if;

  if a.riddle_id is not null then
    return jsonb_build_object('ok', true, 'status', 'recorded', 'runFinished', false);
  end if;

  v_max := setting_int('tries_r2', 2);
  v_status := case when a.correct then 'correct'
                   when a.try_no < v_max then 'wrong_one_left'
                   else 'locked' end;
  select coalesce(bool_or(tr.finished_ms is not null), false) into v_finished
    from team_questions tq
    join team_run tr on tr.team_id = tq.team_id and tr.run = tq.run
   where tq.team_id = a.team_id and tq.question_id = a.question_id;

  return jsonb_build_object('ok', true, 'status', v_status, 'runFinished', coalesce(v_finished, false));
end;
$$;

-- Helper function points_per_question (handles both smallint and int)
create or replace function points_per_question(p_n smallint) returns int language sql stable as $$
  select floor(setting_int('run_total_points', 120)::numeric / p_n)::int;
$$;

create or replace function points_per_question(p_n int) returns int language sql stable as $$
  select floor(setting_int('run_total_points', 120)::numeric / p_n)::int;
$$;

-- 2. submit_answer: R1 branch updated for blind Round 1
create or replace function submit_answer(p_student text, p_kind text, p_key int, p_option text, p_request uuid)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_student record;
  v_team record;
  v_riddle record;
  v_run_row record;
  v_tq record;
  v_q record;
  v_att_id bigint;
  v_att_team text;
  v_now bigint;
  v_max_tries int;
  v_full int;
  v_cnt int;
  v_any_correct boolean;
  v_try int;
  v_correct boolean;
  v_points int;
  v_status text;
  v_unresolved int;
  v_finished boolean := false;
  v_cap_ms bigint;
  v_opt_exists boolean;
begin
  perform advance_event();

  -- 1. duplicate request: return the stored result, never insert twice
  select id, team_id into v_att_id, v_att_team from attempts where request_id = p_request;
  if found then
    if v_att_team is distinct from (select team_id from students where id = p_student) then
      return jsonb_build_object('ok', false, 'code', 'DUPLICATE_REQUEST');
    end if;
    return attempt_result(v_att_id);
  end if;

  select * into v_state from event_state where id = 1;
  if v_state.paused_at is not null then
    return jsonb_build_object('ok', false, 'code', 'PAUSED');
  end if;

  select * into v_student from students where id = p_student;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LOGIN');
  end if;
  if not v_student.is_captain then
    return jsonb_build_object('ok', false, 'code', 'NOT_CAPTAIN');
  end if;

  v_now := event_now_ms();

  -------------------------------------------------------------
  -- R1 Logic (Blind: no correct/incorrect leak, try_no = 1)
  -------------------------------------------------------------
  if p_kind = 'r1' then
    if v_state.phase <> 'r1_running' or v_now >= v_state.r1_end_ms then
      return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE');
    end if;

    select * into v_team from teams where id = v_student.team_id for update;
    if v_team.withdrawn then
      return jsonb_build_object('ok', false, 'code', 'NOT_IN_ROUND');
    end if;

    -- duplicate check after lock
    select id into v_att_id from attempts where request_id = p_request;
    if found then
      return attempt_result(v_att_id);
    end if;

    select * into v_riddle from riddles where id = p_key;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
    end if;

    v_full := setting_int('r1_points_per_riddle', 1);

    -- check if option is valid
    select exists (
      select 1 from jsonb_array_elements(v_riddle.options) elem
      where elem->>'id' = p_option
    ) into v_opt_exists;
    if not v_opt_exists then
      return jsonb_build_object('ok', false, 'code', 'INVALID_OPTION');
    end if;

    -- check if any attempt exists for (team, riddle)
    select count(*)
      into v_cnt
      from attempts
     where team_id = v_team.id and riddle_id = v_riddle.id;

    if v_cnt > 0 then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_SUBMITTED');
    end if;

    v_try := 1;
    v_correct := (p_option = v_riddle.correct_option_id);
    v_points := case when v_correct then v_full else 0 end;

    insert into attempts (request_id, team_id, student_id, riddle_id, question_id, option_id, try_no, correct, points, created_ms)
    values (p_request, v_team.id, v_student.id, v_riddle.id, null, p_option, v_try, v_correct, v_points, v_now);

    return jsonb_build_object('ok', true, 'status', 'recorded', 'runFinished', false);

  -------------------------------------------------------------
  -- R2 Logic (Unchanged)
  -------------------------------------------------------------
  elsif p_kind = 'r2' then
    if v_state.phase <> 'r2_running' then
      return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE');
    end if;

    select * into v_team from teams where id = v_student.team_id for update;
    if not v_team.qualified or v_team.withdrawn then
      return jsonb_build_object('ok', false, 'code', 'NOT_IN_ROUND');
    end if;

    select id into v_att_id from attempts where request_id = p_request;
    if found then
      return attempt_result(v_att_id);
    end if;

    select * into v_run_row
      from team_run
     where team_id = v_team.id and opens_ms <= v_now
     order by run desc limit 1;

    if not found or v_run_row.finished_ms is not null or v_now >= v_run_row.deadline_ms then
      return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE');
    end if;

    if v_run_row.teaser_done_ms is null and not v_run_row.teaser_skipped then
      return jsonb_build_object('ok', false, 'code', 'TEASER_NOT_READY');
    end if;

    select * into v_tq
      from team_questions
     where team_id = v_team.id and run = v_run_row.run and question_no = p_key
       for update;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
    end if;
    if v_tq.voided then
      return jsonb_build_object('ok', false, 'code', 'LOCKED');
    end if;

    select * into v_q from questions where id = v_tq.question_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
    end if;

    select exists (
      select 1 from jsonb_array_elements(v_q.options) elem
      where elem->>'id' = p_option
    ) into v_opt_exists;
    if not v_opt_exists then
      return jsonb_build_object('ok', false, 'code', 'INVALID_OPTION');
    end if;

    v_max_tries := setting_int('tries_r2', 2);
    v_full := floor(setting_int('run_total_points', 120)::numeric / v_team.n);

    select count(*), coalesce(bool_or(correct), false)
      into v_cnt, v_any_correct
      from attempts
     where team_id = v_team.id and question_id = v_q.id;

    if v_any_correct then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_DONE');
    end if;
    if v_cnt >= v_max_tries then
      return jsonb_build_object('ok', false, 'code', 'LOCKED');
    end if;

    v_try := v_cnt + 1;
    v_correct := (p_option = v_q.correct_option_id);
    v_points := case when not v_correct then 0
                     when v_try = 1 then v_full
                     else floor(v_full / 2)::int end;

    insert into attempts (request_id, team_id, student_id, riddle_id, question_id, option_id, try_no, correct, points, created_ms)
    values (p_request, v_team.id, v_student.id, null, v_q.id, p_option, v_try, v_correct, v_points, v_now);

    v_status := case when v_correct then 'correct'
                     when v_try < v_max_tries then 'wrong_one_left'
                     else 'locked' end;

    -- Check if all N questions in this run are now resolved
    select count(*) into v_unresolved
      from team_questions tq
      where tq.team_id = v_team.id
        and tq.run = v_run_row.run
        and not tq.voided
        and not exists (select 1 from attempts a where a.team_id = v_team.id and a.question_id = tq.question_id and a.correct)
        and (select count(*) from attempts a where a.team_id = v_team.id and a.question_id = tq.question_id) < v_max_tries;

    if v_unresolved = 0 then
      v_finished := true;
      update team_run
         set finished_ms = v_now
       where team_id = v_team.id and run = v_run_row.run;

      -- If run 1 just finished, unlock run 2 immediately
      if v_run_row.run = 1 then
        select coalesce((value #>> '{}')::bigint, 30) into v_cap_ms from settings where key = 'run_cap_minutes';
        v_cap_ms := v_cap_ms * 60000;
        insert into team_run (team_id, run, opens_ms, deadline_ms)
        values (
          v_team.id,
          2,
          v_now,
          case when (v_now + v_cap_ms) > v_state.r2_hard_end_ms then v_state.r2_hard_end_ms else (v_now + v_cap_ms) end
        )
        on conflict (team_id, run) do nothing;
      end if;
    end if;

    return jsonb_build_object('ok', true, 'status', v_status, 'runFinished', v_finished);

  else
    return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
  end if;
end;
$$;

-- 3. start_round2: archives R1 scores and clears attempts
create or replace function start_round2(p_admin_id int default null) returns jsonb language plpgsql as $$
declare
  v_state event_state%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_now bigint;
  v_r2_min bigint;
  v_cap_min bigint;
  v_qual_count int;
  v_cap_ms bigint;
  v_hard_end bigint;
  v_team record;
  v_teams_archived int := 0;
  v_r1_deleted int := 0;
begin
  perform advance_event();
  select * into v_state from event_state where id = 1 for update;
  if v_state.phase <> 'r1_closed' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE', 'message', 'Can only start Round 2 from r1_closed phase');
  end if;

  select count(*) into v_qual_count from teams where qualified = true and withdrawn = false;
  if v_qual_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_QUALIFIED_TEAMS', 'message', 'At least 1 qualified team is required to start Round 2');
  end if;

  v_before := to_jsonb(v_state);
  v_now := event_now_ms();

  -- Archive R1 standings and clear R1 attempts
  insert into r1_archive (team_id, points, submitted, last_ms, rank, qualified)
  select
    s.team_id,
    s.points,
    coalesce(att.submitted, 0)::int as submitted,
    s.last_ms,
    rank() over (order by s.points desc, s.last_ms asc nulls last)::int as rank,
    t.qualified
  from r1_standings s
  join teams t on t.id = s.team_id
  left join (
    select team_id, count(*)::int as submitted
    from attempts
    where riddle_id is not null
    group by team_id
  ) att on att.team_id = s.team_id
  where not t.withdrawn
  on conflict (team_id) do update set
    points = excluded.points,
    submitted = excluded.submitted,
    last_ms = excluded.last_ms,
    rank = excluded.rank,
    qualified = excluded.qualified,
    archived_at = now();

  get diagnostics v_teams_archived = row_count;

  delete from attempts where riddle_id is not null;
  get diagnostics v_r1_deleted = row_count;

  select coalesce((value #>> '{}')::bigint, 60) into v_r2_min from settings where key = 'r2_minutes';
  select coalesce((value #>> '{}')::bigint, 30) into v_cap_min from settings where key = 'run_cap_minutes';

  v_cap_ms := v_cap_min * 60000;
  v_hard_end := v_now + (v_r2_min * 60000);

  update event_state set
    phase = 'r2_running',
    r2_start_ms = v_now,
    run2_open_ms = v_now + v_cap_ms,
    r2_hard_end_ms = v_hard_end
  where id = 1
  returning * into v_state;

  v_after := to_jsonb(v_state);

  -- Insert run 1 for every qualified team
  for v_team in select id from teams where qualified = true and withdrawn = false loop
    insert into team_run (team_id, run, opens_ms, deadline_ms)
    values (
      v_team.id,
      1,
      v_now,
      case when (v_now + v_cap_ms) > v_hard_end then v_hard_end else (v_now + v_cap_ms) end
    )
    on conflict (team_id, run) do nothing;
  end loop;

  insert into admin_log (admin_id, action, target, before, after)
  values (
    p_admin_id,
    'start-r2',
    'event_state',
    v_before,
    v_after || jsonb_build_object('teamsArchived', v_teams_archived, 'r1AttemptsDeleted', v_r1_deleted)
  );

  return jsonb_build_object(
    'ok', true,
    'phase', v_state.phase,
    'r2_start_ms', v_state.r2_start_ms,
    'r2_hard_end_ms', v_state.r2_hard_end_ms,
    'teamsArchived', v_teams_archived,
    'r1AttemptsDeleted', v_r1_deleted
  );
end;
$$;

-- 4. reset_event_data: truncates r1_archive as well
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
    attempts, score_adjustments, r3_attempts, r3_boxes, r3_team, r1_archive, admin_log;

  update r3_result set
    winner_team_id = null,
    reason = null,
    decided_ms = null,
    decided_at = null
  where id = 1;

  alter sequence if exists r3_seq restart;

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

  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'reset_event_data', 'system', to_jsonb(v_state), jsonb_build_object('status', 'reset'));

  return jsonb_build_object('ok', true, 'phase', 'setup');
end;
$$;

-- 5. player_state: no leak of correct/wrong for R1 riddles, returns option_id and submitted
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
  v_r3_find_riddle text;          -- FIX: was "v_r3z record"; scalar = null by default, avoids 55000
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

  -- R1 Riddles for r1_running or r1_closed (blind: no correct/wrong field)
  if v_state.phase in ('r1_running', 'r1_closed') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'position', r.position,
      'text', r.text,
      'options', r.options,
      'attempts', coalesce((
        select jsonb_agg(jsonb_build_object('try_no', a.try_no, 'option_id', a.option_id) order by a.try_no)
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
  -- FIX: only select the one column we need; scalar is null when no zone is assigned yet
  if v_r3t.zone is not null then
    select find_riddle into v_r3_find_riddle from r3_zones where id = v_r3t.zone;
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
      'findRiddle', case when v_team.r3_eligible then v_r3_find_riddle else null end,  -- FIX: no v_r3z
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

-- Permissions
revoke execute on function points_per_question(smallint) from public, anon, authenticated;
grant execute on function points_per_question(smallint) to service_role;

revoke execute on function points_per_question(int) from public, anon, authenticated;
grant execute on function points_per_question(int) to service_role;

revoke execute on function submit_answer(text, text, int, text, uuid) from public, anon, authenticated;
grant execute on function submit_answer(text, text, int, text, uuid) to service_role;

revoke execute on function attempt_result(bigint) from public, anon, authenticated;
grant execute on function attempt_result(bigint) to service_role;

revoke execute on function start_round2(int) from public, anon, authenticated;
grant execute on function start_round2(int) to service_role;

revoke execute on function reset_event_data(int, text) from public, anon, authenticated;
grant execute on function reset_event_data(int, text) to service_role;

revoke execute on function player_state(text) from public, anon, authenticated;
grant execute on function player_state(text) to service_role;

-- Reload schema cache
notify pgrst, 'reload schema';
