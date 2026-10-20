-- 006_phase7.sql: Round 1 support for submit_answer and player_state

-- Update attempt_result to support R1 attempts
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
    v_max := setting_int('tries_r1', 1);
    v_status := case when a.correct then 'correct'
                     when a.try_no < v_max then 'wrong_one_left'
                     else 'locked' end;
    return jsonb_build_object('ok', true, 'status', v_status, 'runFinished', false);
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

-- 6.4 submit_answer: handles both R1 (riddles) and R2 (poster questions)
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
  -- R1 Logic
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

    v_max_tries := setting_int('tries_r1', 1);
    v_full := setting_int('r1_points_per_riddle', 1);

    -- check if option is valid
    select exists (
      select 1 from jsonb_array_elements(v_riddle.options) elem
      where elem->>'id' = p_option
    ) into v_opt_exists;
    if not v_opt_exists then
      return jsonb_build_object('ok', false, 'code', 'INVALID_OPTION');
    end if;

    -- check existing attempts
    select count(*), coalesce(bool_or(correct), false)
      into v_cnt, v_any_correct
      from attempts
     where team_id = v_team.id and riddle_id = v_riddle.id;

    if v_any_correct then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_DONE');
    end if;
    if v_cnt >= v_max_tries then
      return jsonb_build_object('ok', false, 'code', 'LOCKED');
    end if;

    v_try := v_cnt + 1;
    v_correct := (p_option = v_riddle.correct_option_id);
    v_points := case when v_correct then v_full else 0 end;

    insert into attempts (request_id, team_id, student_id, riddle_id, question_id, option_id, try_no, correct, points, created_ms)
    values (p_request, v_team.id, v_student.id, v_riddle.id, null, p_option, v_try, v_correct, v_points, v_now);

    v_status := case when v_correct then 'correct'
                     when v_try < v_max_tries then 'wrong_one_left'
                     else 'locked' end;

    return jsonb_build_object('ok', true, 'status', v_status, 'runFinished', false);

  -------------------------------------------------------------
  -- R2 Logic
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
    v_full := floor(setting_int('run_total_points', 120)::numeric / v_team.n)::int;

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
                     else floor(v_full::numeric / 2)::int end;

    insert into attempts (request_id, team_id, student_id, riddle_id, question_id, option_id, try_no, correct, points, created_ms)
    values (p_request, v_team.id, v_student.id, null, v_q.id, p_option, v_try, v_correct, v_points, v_now);

    v_status := case when v_correct then 'correct'
                     when v_try < v_max_tries then 'wrong_one_left'
                     else 'locked' end;

    select count(*) into v_unresolved
      from team_questions tq
     where tq.team_id = v_team.id and tq.run = v_run_row.run and not tq.voided
       and not exists (select 1 from attempts a where a.team_id = tq.team_id and a.question_id = tq.question_id and a.correct)
       and (select count(*) from attempts a where a.team_id = tq.team_id and a.question_id = tq.question_id) < v_max_tries;

    if v_unresolved = 0 then
      update team_run set finished_ms = v_now where team_id = v_team.id and run = v_run_row.run;
      v_finished := true;

      if v_run_row.run = 1
         and not exists (select 1 from team_run where team_id = v_team.id and run = 2)
         and v_state.phase = 'r2_running' then
        v_cap_ms := setting_int('run_cap_minutes', 30)::bigint * 60000;
        insert into team_run (team_id, run, opens_ms, deadline_ms)
        values (v_team.id, 2, v_now, least(v_now + v_cap_ms, v_state.r2_hard_end_ms));
      end if;
    end if;

    return jsonb_build_object('ok', true, 'status', v_status, 'runFinished', v_finished);

  else
    return jsonb_build_object('ok', false, 'code', 'INVALID_OPTION');
  end if;
end;
$$;

-- 8.1 player_state: includes R1 riddles snapshot for r1_running and r1_closed phases
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
      -- questions whose piece this student holds
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

  return jsonb_build_object(
    'ok', true,
    'serverNowMs', (extract(epoch from now()) * 1000)::bigint,
    'eventNowMs', v_now,
    'paused', v_state.paused_at is not null,
    'phase', v_state.phase,
    'r1DeadlineMs', v_state.r1_end_ms,
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
    'riddles', v_riddles
  );
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
