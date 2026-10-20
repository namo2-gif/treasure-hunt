-- 005_phase10_fixes.sql (Part A fixes)

-- drop go_live (use the real signature found with regprocedure)
drop function if exists go_live(int, text);
drop function if exists go_live(text);
drop function if exists go_live();

create or replace function event_clock() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'serverNowMs', (extract(epoch from now()) * 1000)::bigint,
    'eventNowMs', event_now_ms(),
    'paused', (select paused_at is not null from event_state where id = 1))
$$;

revoke execute on function event_clock() from public, anon, authenticated;
grant execute on function event_clock() to service_role;
