-- ============================================================================
-- 008_fixed_4_questions.sql
-- Round 2: always assign exactly 4 questions per run, regardless of team size.
-- Teaser is unchanged (each member = 1 piece, N pieces for N members).
-- Points per question = floor(run_total_points / 4) for every team.
-- ============================================================================

-- 1. assign_questions: always pick 4 slots, not v_n slots
create or replace function assign_questions(p_team text, p_run int) returns jsonb language plpgsql as $$
declare
  v_n int;
  v_slots int;
  v_q_count constant int := 4;   -- fixed number of questions per run
begin
  perform pg_advisory_xact_lock(hashtext('assign:' || p_run));

  if exists (select 1 from team_questions where team_id = p_team and run = p_run) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select n into v_n from teams where id = p_team;
  if v_n is null then
    return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
  end if;

  -- Need at least 4 distinct question slots in the database
  select count(distinct slot) into v_slots from questions where run = p_run;
  if v_slots < v_q_count then
    return jsonb_build_object('ok', false, 'code', 'CONTENT_MISSING');
  end if;

  -- Pick v_q_count (4) slots with the lowest usage (ties random);
  -- question_no 1..4 in random order;
  -- per slot, the variant with the fewest existing assignments (ties random).
  -- question_no k is shown to the member who holds piece k.
  -- If team has < 4 members, questions with no matching piece_no appear only on the captain's board.
  -- If team has > 4 members, the member with the highest piece_no has no question in 'mine'.
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
      limit v_q_count
    ) c
  ) nb;

  return jsonb_build_object('ok', true);
end;
$$;

-- 2. submit_answer: divide points by 4, not team size
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
  v_q_count constant int := 4;   -- fixed questions per run
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
  -- R2 Logic: points divided by 4 (fixed question count)
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
    -- Points divided by 4 (fixed question count), not team size
    v_full := floor(setting_int('run_total_points', 120)::numeric / v_q_count);

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

    -- Check if all 4 questions in this run are now resolved
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

-- 3. void_question: divide by 4, not team size
create or replace function void_question(
  p_team text,
  p_question_id int,
  p_reason text,
  p_admin_id int default null
) returns jsonb language plpgsql as $$
declare
  v_reason text;
  v_now bigint;
  v_full int;
  v_earned int;
  v_adj int;
  v_count int := 0;
  v_unresolved int;
  v_cap_ms bigint;
  v_run_row record;
  v_state record;
  v_tq record;
  v_team record;
  v_rec record;
  v_q_count constant int := 4;   -- fixed questions per run
begin
  perform advance_event();
  select * into v_state from event_state where id = 1;

  v_reason := trim(coalesce(p_reason, ''));
  if v_reason = '' then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED', 'message', 'A reason is required to void a question');
  end if;

  if not exists (select 1 from questions where id = p_question_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Question not found');
  end if;

  v_now := event_now_ms();

  for v_rec in
    select distinct team_id
      from team_questions
     where question_id = p_question_id
       and not voided
       and (p_team is null or p_team = '' or team_id = p_team)
  loop
    select * into v_team from teams where id = v_rec.team_id for update;
    select * into v_tq from team_questions
     where team_id = v_team.id and question_id = p_question_id
       for update;

    -- Mark voided
    update team_questions
       set voided = true
     where team_id = v_team.id and question_id = p_question_id;

    -- Points adjustment: divide by 4 (fixed question count)
    v_full := floor(setting_int('run_total_points', 120)::numeric / v_q_count);
    select coalesce(sum(points), 0)::int into v_earned
      from attempts
     where team_id = v_team.id and question_id = p_question_id and correct = true;

    v_adj := greatest(0, v_full - v_earned);

    insert into score_adjustments (team_id, run, question_id, points, reason, admin_id, created_ms)
    values (v_team.id, v_tq.run, p_question_id, v_adj, v_reason, p_admin_id, v_now);

    -- Re-evaluate run-finished
    select count(*) into v_unresolved
      from team_questions tq
     where tq.team_id = v_team.id and tq.run = v_tq.run and not tq.voided
       and not exists (select 1 from attempts a where a.team_id = tq.team_id and a.question_id = tq.question_id and a.correct)
       and (select count(*) from attempts a where a.team_id = tq.team_id and a.question_id = tq.question_id) < setting_int('tries_r2', 2);

    if v_unresolved = 0 then
      select * into v_run_row from team_run
       where team_id = v_team.id and run = v_tq.run
         for update;
      if found and v_run_row.finished_ms is null then
        update team_run
           set finished_ms = v_now
         where team_id = v_team.id and run = v_tq.run;

        if v_tq.run = 1
           and not exists (select 1 from team_run where team_id = v_team.id and run = 2)
           and v_state.phase = 'r2_running' then
          v_cap_ms := setting_int('run_cap_minutes', 30)::bigint * 60000;
          insert into team_run (team_id, run, opens_ms, deadline_ms)
          values (v_team.id, 2, v_now, least(v_now + v_cap_ms, v_state.r2_hard_end_ms));
        end if;
      end if;
    end if;

    insert into admin_log (admin_id, action, target, before, after)
    values (
      p_admin_id,
      'void_question',
      v_team.id || ':q' || p_question_id,
      jsonb_build_object('voided', false),
      jsonb_build_object('voided', true, 'points_adjusted', v_adj, 'reason', v_reason)
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'affectedTeams', v_count);
end;
$$;

-- 4. points_per_question helper: divide by 4, not p_n
create or replace function points_per_question(p_n smallint) returns int language sql stable as $$
  select floor(setting_int('run_total_points', 120)::numeric / 4)::int;
$$;

create or replace function points_per_question(p_n int) returns int language sql stable as $$
  select floor(setting_int('run_total_points', 120)::numeric / 4)::int;
$$;

-- Permissions
revoke execute on function assign_questions(text, int) from public, anon, authenticated;
grant execute on function assign_questions(text, int) to service_role;

revoke execute on function submit_answer(text, text, int, text, uuid) from public, anon, authenticated;
grant execute on function submit_answer(text, text, int, text, uuid) to service_role;

revoke execute on function void_question(text, int, text, int) from public, anon, authenticated;
grant execute on function void_question(text, int, text, int) to service_role;

revoke execute on function points_per_question(smallint) from public, anon, authenticated;
grant execute on function points_per_question(smallint) to service_role;

revoke execute on function points_per_question(int) from public, anon, authenticated;
grant execute on function points_per_question(int) to service_role;

-- Reload schema cache
notify pgrst, 'reload schema';
