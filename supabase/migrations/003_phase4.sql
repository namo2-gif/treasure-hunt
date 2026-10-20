-- 003_phase4.sql: teaser, question assignment, Round 2 answers, player state (Sections 6.2 to 6.4, 8.1)
-- Safe to re-run (all functions are create or replace). Run after 002_functions.sql.

create or replace function setting_int(p_key text, p_default int) returns int language sql stable as $$
  select coalesce((select (value #>> '{}')::int from settings where key = p_key), p_default)
$$;

-- 6.3 assign_questions: idempotent, serialised per run by an advisory lock
create or replace function assign_questions(p_team text, p_run int) returns jsonb language plpgsql as $$
declare
  v_n int;
  v_slots int;
begin
  perform pg_advisory_xact_lock(hashtext('assign:' || p_run));

  if exists (select 1 from team_questions where team_id = p_team and run = p_run) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select n into v_n from teams where id = p_team;
  if v_n is null then
    return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
  end if;

  select count(distinct slot) into v_slots from questions where run = p_run;
  if v_slots < v_n then
    return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
  end if;

  -- N slots with the lowest usage (ties random); question_no 1..N in random order;
  -- per slot, the variant with the fewest existing assignments (ties random)
  insert into team_questions (team_id, run, question_no, slot, question_id)
  select p_team, p_run, nb.qno, nb.slot,
    (select q.id
       from questions q
       left join (select question_id, count(*) as cnt from team_questions group by question_id) tc
         on tc.question_id = q.id
      where q.run = p_run and q.slot = nb.slot
      order by coalesce(tc.cnt, 0), random()
      limit 1)
  from (
    select c.slot, (row_number() over (order by random()))::smallint as qno
    from (
      select s.slot
      from (select distinct q.slot from questions q where q.run = p_run) s
      left join (select slot, count(*) as cnt from team_questions where run = p_run group by slot) u
        on u.slot = s.slot
      order by coalesce(u.cnt, 0), random()
      limit v_n
    ) c
  ) nb;

  return jsonb_build_object('ok', true);
end;
$$;

-- 6.2 solve_teaser (captain only)
create or replace function solve_teaser(p_student text, p_answer text) returns jsonb language plpgsql as $$
declare
  v_state record;
  v_student record;
  v_team record;
  v_run_row record;
  v_puzzle record;
  v_now bigint;
  v_assign jsonb;
  v_pieces int;
begin
  perform advance_event();
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

  if v_state.phase <> 'r2_running' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE');
  end if;

  -- lock order: team row first
  select * into v_team from teams where id = v_student.team_id for update;
  if not v_team.qualified or v_team.withdrawn then
    return jsonb_build_object('ok', false, 'code', 'NOT_IN_ROUND');
  end if;

  v_now := event_now_ms();
  select * into v_run_row from team_run
   where team_id = v_team.id and opens_ms <= v_now
   order by run desc limit 1;
  if not found or v_run_row.finished_ms is not null or v_now >= v_run_row.deadline_ms then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE');
  end if;

  if v_run_row.teaser_done_ms is not null or v_run_row.teaser_skipped then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select count(*) into v_pieces from piece_assignments where team_id = v_team.id and run = v_run_row.run;
  if v_pieces < v_team.n then
    return jsonb_build_object('ok', false, 'code', 'TEASER_NOT_READY');
  end if;

  select * into v_puzzle from teaser_puzzles where run = v_run_row.run and size = v_team.n;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
  end if;

  if lower(regexp_replace(trim(coalesce(p_answer, '')), '\s+', ' ', 'g')) <> v_puzzle.answer_norm then
    return jsonb_build_object('ok', false, 'code', 'TEASER_WRONG');
  end if;

  v_assign := assign_questions(v_team.id, v_run_row.run);
  if not (v_assign->>'ok')::boolean then
    return v_assign;
  end if;

  update team_run set teaser_done_ms = v_now where team_id = v_team.id and run = v_run_row.run;
  return jsonb_build_object('ok', true);
end;
$$;

-- 6.2 skip_teaser (admin)
create or replace function skip_teaser(p_team text, p_run int, p_admin_id int default null) returns jsonb language plpgsql as $$
declare
  v_run_row record;
  v_assign jsonb;
begin
  perform advance_event();
  perform 1 from teams where id = p_team for update;
  select * into v_run_row from team_run where team_id = p_team and run = p_run for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE');
  end if;
  if v_run_row.teaser_done_ms is not null or v_run_row.teaser_skipped then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  v_assign := assign_questions(p_team, p_run);
  if not (v_assign->>'ok')::boolean then
    return v_assign;
  end if;

  update team_run set teaser_skipped = true where team_id = p_team and run = p_run;
  insert into admin_log (admin_id, action, target, before, after)
  values (p_admin_id, 'skip_teaser', p_team || ':run' || p_run,
          jsonb_build_object('teaser_skipped', false), jsonb_build_object('teaser_skipped', true));
  return jsonb_build_object('ok', true);
end;
$$;

-- maps a stored attempt to the player-facing result (used for duplicate requestIds)
create or replace function attempt_result(p_attempt_id bigint) returns jsonb language plpgsql as $$
declare
  a record;
  v_max int;
  v_status text;
  v_finished boolean;
begin
  select * into a from attempts where id = p_attempt_id;
  v_max := case when a.question_id is null then setting_int('tries_r1', 1) else setting_int('tries_r2', 2) end;
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

-- 6.4 submit_answer. Round 1 (kind 'r1') is added in Phase 7.
create or replace function submit_answer(p_student text, p_kind text, p_key int, p_option text, p_request uuid)
returns jsonb language plpgsql as $$
declare
  v_state record;
  v_student record;
  v_team record;
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

  if p_kind = 'r1' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE');
  elsif p_kind <> 'r2' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_OPTION');
  end if;

  if v_state.phase <> 'r2_running' then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE');
  end if;

  -- lock order: team row, then team_questions row. Locking the team row also serialises the
  -- "is the whole run resolved?" check below, so two simultaneous answers cannot both miss it.
  select * into v_team from teams where id = v_student.team_id for update;
  if not v_team.qualified or v_team.withdrawn then
    return jsonb_build_object('ok', false, 'code', 'NOT_IN_ROUND');
  end if;

  -- a concurrent request with the same id may have committed while we waited for the lock
  select id into v_att_id from attempts where request_id = p_request;
  if found then
    return attempt_result(v_att_id);
  end if;

  v_now := event_now_ms();
  select * into v_run_row from team_run
   where team_id = v_team.id and opens_ms <= v_now
   order by run desc limit 1;
  if not found or v_run_row.finished_ms is not null or v_now >= v_run_row.deadline_ms then
    return jsonb_build_object('ok', false, 'code', 'WRONG_PHASE');
  end if;

  if v_run_row.teaser_done_ms is null and not v_run_row.teaser_skipped then
    return jsonb_build_object('ok', false, 'code', 'TEASER_NOT_READY');
  end if;

  select * into v_tq from team_questions
   where team_id = v_team.id and run = v_run_row.run and question_no = p_key
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
  end if;
  if v_tq.voided then
    return jsonb_build_object('ok', false, 'code', 'LOCKED');
  end if;

  select * into v_q from questions where id = v_tq.question_id;
  v_max_tries := setting_int('tries_r2', 2);
  v_full := floor(setting_int('run_total_points', 120)::numeric / v_team.n);

  select count(*), coalesce(bool_or(correct), false) into v_cnt, v_any_correct
    from attempts where team_id = v_team.id and question_id = v_q.id;
  if v_any_correct then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DONE');
  end if;
  if v_cnt >= v_max_tries then
    return jsonb_build_object('ok', false, 'code', 'LOCKED');
  end if;

  if not exists (select 1 from jsonb_array_elements(v_q.options) o where o->>'id' = p_option) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_OPTION');
  end if;

  v_try := v_cnt + 1;
  v_correct := (p_option = v_q.correct_option_id);
  v_points := case when v_correct then (case when v_try = 1 then v_full else floor(v_full / 2.0)::int end) else 0 end;

  insert into attempts (request_id, team_id, student_id, riddle_id, question_id, option_id, try_no, correct, points, created_ms)
  values (p_request, v_team.id, v_student.id, null, v_q.id, p_option, v_try, v_correct, v_points, v_now);

  v_status := case when v_correct then 'correct'
                   when v_try < v_max_tries then 'wrong_one_left'
                   else 'locked' end;

  -- 8. is every question of this run resolved (voided, correct, or out of tries)?
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
end;
$$;

-- 8.1 player_state: one read for /api/state. Never selects correct_option_id, answer_norm,
-- points, other teams' data, or Round 3 content.
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
begin
  perform advance_event();
  select * into v_state from event_state where id = 1;
  select * into v_student from students where id = p_student;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;
  select * into v_team from teams where id = v_student.team_id;
  v_now := event_now_ms();

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
        -- all N questions, options only (no stems)
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
    'board', v_board
  );
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
