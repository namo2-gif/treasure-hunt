-- ============================================================================
-- FIX_ROUND2_MCQ.sql
-- Fix for Issue 3: Missing points_per_question function causing error 42883
-- and "Something is not setup. Tell an organiser" during Round 2 MCQ submit.
-- Run this once in the Supabase SQL Editor.
-- ============================================================================

-- 1. Helper function points_per_question (handles both smallint and int)
create or replace function points_per_question(p_n smallint) returns int language sql stable as $$
  select floor(setting_int('run_total_points', 120)::numeric / p_n)::int;
$$;

create or replace function points_per_question(p_n int) returns int language sql stable as $$
  select floor(setting_int('run_total_points', 120)::numeric / p_n)::int;
$$;

revoke execute on function points_per_question(smallint) from public, anon, authenticated;
grant execute on function points_per_question(smallint) to service_role;

revoke execute on function points_per_question(int) from public, anon, authenticated;
grant execute on function points_per_question(int) to service_role;

-- 2. Update submit_answer with safe inline calculation and blind R1
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

revoke execute on function submit_answer(text, text, int, text, uuid) from public, anon, authenticated;
grant execute on function submit_answer(text, text, int, text, uuid) to service_role;

notify pgrst, 'reload schema';
