-- Drop old Phase 8 Round 3 tables (force with CASCADE to remove any FK dependencies)
-- Run this in the Supabase SQL editor

drop table if exists round3_claim cascade;
drop table if exists round3 cascade;

notify pgrst, 'reload schema';

-- Verify they are gone:
select
  not exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'round3') as round3_gone,
  not exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'round3_claim') as round3_claim_gone;
