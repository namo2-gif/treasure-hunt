-- FIX: ERROR 55000 "record v_r3z is not assigned yet"
-- Root cause: v_r3z is a record variable only assigned inside `if v_r3t.zone is not null`,
-- but the return block reads v_r3z.find_riddle unconditionally for any r3_eligible team.
-- Fix: replace the record with a plain text scalar (initialised to null) so teams without
-- a zone just return findRiddle: null instead of throwing 55000.
--
-- Run this in the Supabase SQL editor. It is idempotent (CREATE OR REPLACE).

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
  v_r3_find_riddle text;          -- FIX: was "v_r3z record" (scalar = null by default)
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
  -- FIX: only select the one column we need; scalar variable is null when no zone is assigned
  if v_r3t.zone is not null then
    select find_riddle into v_r3_find_riddle from r3_zones where id = v_r3t.zone;
  end if;

  select * into v_r3_config from r3_config where id = 1;
  select * into v_r3_result from r3_result where id = 1;
  select coalesce((value ->> '{}')::int, 2) into v_max_tries from settings where key = 'r3_tries_per_box';

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

revoke execute on function player_state(text) from public, anon, authenticated;
grant execute on function player_state(text) to service_role;
