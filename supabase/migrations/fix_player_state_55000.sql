-- FIX FOR ERROR 55000: record "v_run" is not assigned yet
-- Run this in Supabase SQL editor to immediately fix the "Retrying..." home screen!

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
  v_r3 record;
  v_claim record;
  v_r3_clue text := null;
  v_r3_claimed boolean := false;
  v_r3_winner text := null;
  v_r3_key text := null;
  v_r3_room text := null;
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

  -- Round 3 Payload
  select * into v_claim from round3_claim where id = 1;
  v_r3_claimed := found;
  if v_r3_claimed then
    v_r3_winner := v_claim.team_id;
  end if;

  if v_state.phase in ('r3_open', 'ended') and v_team.r3_eligible then
    select * into v_r3 from round3 where id = 1;
    v_r3_clue := v_r3.clue_text;
    if v_r3_claimed and v_claim.team_id = v_team.id then
      v_r3_key := v_r3.key_info;
      v_r3_room := v_r3.room;
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
    'riddles', v_riddles,
    'r3Clue', v_r3_clue,
    'r3Claimed', v_r3_claimed,
    'r3WinnerTeamId', v_r3_winner,
    'r3KeyInfo', v_r3_key,
    'r3Room', v_r3_room
  );
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
