import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

async function main() {
  const { data: st, error: stErr } = await supabase.from('students').select('id, name, team_id').limit(1);
  if (stErr || !st || !st[0]) {
    console.error('Students check failed:', stErr);
    return;
  }
  console.log('Testing with student:', st[0]);

  const { data, error } = await supabase.rpc('player_state', { p_student: st[0].id });
  if (error) {
    console.error('player_state RPC ERROR:', error.code, error.message, error.details, error.hint);
  } else {
    console.log('player_state RPC SUCCESS! Keys:', Object.keys(data));
    console.log('Phase:', data.phase, 'Screen:', data.phase);
  }
}

main().catch(console.error);
