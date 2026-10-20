\set ON_ERROR_STOP on
\set QUIET on

do $$
declare
  r jsonb;
  ts jsonb;
  v_req uuid;
  v_log_before int;
  v_log_after int;
begin
  -- Ensure test setup and fixture state
  -- 1. Preselect tests: admin ticks only in r2_break
  update event_state set phase = 'r1_running' where id = 1;
  r := set_r3_eligible('T01', true, 1);
  perform t_assert(r->>'code' = 'WRONG_PHASE', 'set_r3_eligible blocked outside r2_break: ' || r::text);

  update event_state set phase = 'r2_break', break_end_ms = event_now_ms() + 180000 where id = 1;

  -- Preselect top 5
  perform r3_preselect();
  perform t_assert((select count(*) from teams where r3_eligible = true) = 5, 'preselect chose 5 teams');

  -- Ticking 6th returns R3_TOO_MANY
  r := set_r3_eligible('T06', true, 1);
  perform t_assert(r->>'code' = 'R3_TOO_MANY', 'ticking 6th gives R3_TOO_MANY: ' || r::text);

  -- Unticking works
  r := set_r3_eligible('T05', false, 1);
  perform t_assert((r->>'ok')::boolean, 'unticking works: ' || r::text);
  perform t_assert((select count(*) from teams where r3_eligible = true) = 4, 'now 4 eligible');

  -- Tick T05 back
  perform set_r3_eligible('T05', true, 1);

  -- 2. Open tests
  -- BREAK_NOT_OVER without force
  r := open_round3(false, 1);
  perform t_assert(r->>'code' = 'BREAK_NOT_OVER', 'open without force gives BREAK_NOT_OVER: ' || r::text);

  -- R3_CODE_INVALID test
  update r3_config set code = 'INVALID';
  r := open_round3(true, 1);
  perform t_assert(r->>'code' = 'R3_CODE_INVALID', 'invalid code gives R3_CODE_INVALID: ' || r::text);
  update r3_config set code = '1DAI';

  -- Open with force = true
  r := open_round3(true, 1);
  perform t_assert((r->>'ok')::boolean, 'open with force succeeds: ' || r::text);
  perform t_assert((select phase from event_state where id = 1) = 'r3_open', 'phase is r3_open');
  perform t_assert((select count(*) from r3_team) = 5, '5 teams assigned zones');
  perform t_assert((select count(distinct zone) from r3_team) = 5, 'zones are unique per team');

  -- 3. Scan tests
  -- non-captain NOT_CAPTAIN
  r := r3_scan('S012', (select token from r3_zones where id = (select zone from r3_team where team_id = 'T01')));
  perform t_assert(r->>'code' = 'NOT_CAPTAIN', 'non-captain scan returns NOT_CAPTAIN: ' || r::text);

  -- wrong zone WRONG_ZONE
  r := r3_scan('S011', (select token from r3_zones where id <> (select zone from r3_team where team_id = 'T01') limit 1));
  perform t_assert(r->>'code' = 'WRONG_ZONE', 'wrong zone token returns WRONG_ZONE: ' || r::text);

  -- correct scan
  r := r3_scan('S011', (select token from r3_zones where id = (select zone from r3_team where team_id = 'T01')));
  perform t_assert((r->>'ok')::boolean, 'correct scan succeeds: ' || r::text);
  perform t_assert((select scanned_ms from r3_team where team_id = 'T01') is not null, 'milestone 0 recorded');

  -- duplicate scan is idempotent
  r := r3_scan('S011', (select token from r3_zones where id = (select zone from r3_team where team_id = 'T01')));
  perform t_assert((r->>'already')::boolean, 'repeat scan returns already:true: ' || r::text);

  -- 4. Format tests (Box 1 expects digit 1-9; Boxes 2-4 expect letter)
  v_req := gen_random_uuid();
  r := r3_submit_box('S011', 1, '0', v_req);
  perform t_assert(r->>'code' = 'INVALID_FORMAT', 'box 1 rejects 0: ' || r::text);
  r := r3_submit_box('S011', 1, 'A', v_req);
  perform t_assert(r->>'code' = 'INVALID_FORMAT', 'box 1 rejects letter A: ' || r::text);
  r := r3_submit_box('S011', 1, '10', v_req);
  perform t_assert(r->>'code' = 'INVALID_FORMAT', 'box 1 rejects 10: ' || r::text);

  r := r3_submit_box('S011', 2, '1', v_req);
  perform t_assert(r->>'code' = 'INVALID_FORMAT', 'box 2 rejects digit 1: ' || r::text);
  r := r3_submit_box('S011', 2, 'AB', v_req);
  perform t_assert(r->>'code' = 'INVALID_FORMAT', 'box 2 rejects multi-char AB: ' || r::text);

  -- Verify format errors do not consume a try
  perform t_assert((select count(*) from r3_attempts where team_id = 'T01') = 0, 'format errors used no tries');

  -- 5. Tries and Lock (2 wrong tries lock the box)
  v_req := gen_random_uuid();
  r := r3_submit_box('S011', 2, 'Z', v_req);
  perform t_assert(r->>'status' = 'wrong_one_left', 'first wrong gives wrong_one_left: ' || r::text);

  -- 6. Idempotency (resending same requestId returns identical result without extra attempt)
  r := r3_submit_box('S011', 2, 'Z', v_req);
  perform t_assert(r->>'status' = 'wrong_one_left', 'duplicate requestId gives same status: ' || r::text);
  perform t_assert((select count(*) from r3_attempts where team_id = 'T01' and box = 2) = 1, 'idempotent call added no row');

  -- Second wrong locks box 2
  r := r3_submit_box('S011', 2, 'X', gen_random_uuid());
  perform t_assert(r->>'status' = 'locked', 'second wrong locks box: ' || r::text);

  -- Third submit on locked box gives BOX_LOCKED
  r := r3_submit_box('S011', 2, 'D', gen_random_uuid());
  perform t_assert(r->>'code' = 'BOX_LOCKED', 'submitting on locked box returns BOX_LOCKED: ' || r::text);

  -- 11. Overrides: reset_box clears lock and restores tries
  r := r3_reset_box('T01', 2, '', 1);
  perform t_assert(r->>'code' = 'REASON_REQUIRED', 'override without reason returns REASON_REQUIRED: ' || r::text);

  r := r3_reset_box('T01', 2, 'Admin test reset', 1);
  perform t_assert((r->>'ok')::boolean, 'reset_box succeeds: ' || r::text);
  perform t_assert((select count(*) from r3_attempts where team_id = 'T01' and box = 2) = 2, 'attempts preserved');

  -- Now correct answer with whitespace and lowercase (' d ') matches 'D'
  r := r3_submit_box('S011', 2, ' d ', gen_random_uuid());
  perform t_assert(r->>'status' = 'correct', 'box 2 correct with normalisation: ' || r::text);

  -- Box 1 correct
  r := r3_submit_box('S011', 1, '1', gen_random_uuid());
  perform t_assert(r->>'status' = 'correct', 'box 1 correct: ' || r::text);

  -- Box 3 correct
  r := r3_submit_box('S011', 3, 'A', gen_random_uuid());
  perform t_assert(r->>'status' = 'correct', 'box 3 correct: ' || r::text);

  -- 8. Win by code: 4th box completes code -> event ends
  r := r3_submit_box('S011', 4, 'I', gen_random_uuid());
  perform t_assert(r->>'status' = 'winner', 'box 4 wins: ' || r::text);
  perform t_assert((select phase from event_state where id = 1) = 'ended', 'event phase is ended');
  perform t_assert((select reason from r3_result where id = 1) = 'code', 'result reason is code');
  perform t_assert((select winner_team_id from r3_result where id = 1) = 'T01', 'winner is T01');

  -- Further submit returns R3_OVER
  r := r3_submit_box('S011', 4, 'I', gen_random_uuid());
  perform t_assert(r->>'code' = 'R3_OVER', 'later submit gives R3_OVER: ' || r::text);

  -- 12. Reset event data
  -- Reset blocked during running phase unless paused, but in 'ended' it succeeds
  r := reset_event_data('WRONG_KEY');
  perform t_assert(r->>'code' = 'INVALID_CONFIRMATION', 'bad reset confirmation rejected');

  r := reset_event_data('RESET', 1);
  perform t_assert((r->>'ok')::boolean, 'reset_event_data in ended succeeds: ' || r::text);
  perform t_assert((select count(*) from r3_team) = 0, 'r3_team wiped');
  perform t_assert((select count(*) from r3_boxes) = 0, 'r3_boxes wiped');
  perform t_assert((select count(*) from r3_attempts) = 0, 'r3_attempts wiped');
  perform t_assert((select code from r3_config where id = 1) = '1DAI', 'r3_config preserved');
  perform t_assert((select count(*) from r3_zones) = 5, 'r3_zones preserved');
  perform t_assert((select count(*) from r3_riddles) = 20, 'r3_riddles preserved');

end $$;
