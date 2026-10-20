import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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
  console.log('--- Starting Round 3 Full Simulation ---');

  // 1. Fetch 5 qualified teams
  const { data: teams, error: teamsErr } = await supabase
    .from('teams')
    .select('id, name')
    .eq('withdrawn', false)
    .order('id')
    .limit(5);

  if (teamsErr || !teams || teams.length < 5) {
    throw new Error(`Need at least 5 teams for R3 simulation. Found: ${teams?.length || 0}`);
  }

  const teamIds = teams.map((t) => t.id);
  console.log(`Simulating with 5 teams: ${teamIds.join(', ')}`);

  // Ensure eligible flag is true for these 5 teams, false for others
  await supabase.from('teams').update({ r3_eligible: false }).neq('id', '');
  await supabase.from('teams').update({ r3_eligible: true, qualified: true }).in('id', teamIds);

  // Set phase to r2_break so open_round3 can be invoked
  console.log('Transitioning event state to r2_break...');
  await supabase.from('event_state').update({
    phase: 'r2_break',
    paused_at: null,
    break_end_ms: null,
  }).eq('id', 1);

  // 2. Open Round 3 with force=true
  console.log('Calling open_round3(true)...');
  const { data: openRes, error: openErr } = await supabase.rpc('open_round3', {
    p_force: true,
  });

  if (openErr) {
    throw new Error(`open_round3 RPC failed: ${openErr.message}`);
  }
  if (!openRes || !openRes.ok) {
    throw new Error(`open_round3 returned error: ${JSON.stringify(openRes)}`);
  }
  console.log('Round 3 opened successfully!', openRes);

  // 3. Get master code from r3_config
  const { data: cfg, error: cfgErr } = await supabase
    .from('r3_config')
    .select('code')
    .eq('id', 1)
    .single();

  if (cfgErr || !cfg) {
    throw new Error(`Failed to load r3_config: ${cfgErr?.message}`);
  }
  const code = cfg.code;
  console.log(`Using Master Code: "${code}"`);

  // 4. Fetch assigned zones & captains
  const { data: r3Teams, error: r3TErr } = await supabase
    .from('r3_team')
    .select('team_id, zone, r3_zones(id, name, token)')
    .in('team_id', teamIds);

  if (r3TErr || !r3Teams || r3Teams.length < 5) {
    throw new Error(`Failed to fetch r3_teams: ${r3TErr?.message}`);
  }

  const { data: captains, error: capErr } = await supabase
    .from('students')
    .select('id, name, team_id')
    .in('team_id', teamIds)
    .eq('is_captain', true)
    .eq('absent', false);

  if (capErr || !captains || captains.length < 5) {
    throw new Error(`Failed to find captains for all 5 teams: ${capErr?.message}`);
  }

  const capMap = new Map(captains.map((c) => [c.team_id, c.id]));

  // 5. Scan start QRs for all 5 teams
  console.log('Scanning start QR codes for all 5 teams...');
  for (const rt of r3Teams) {
    const captainId = capMap.get(rt.team_id);
    if (!captainId) throw new Error(`No captain found for team ${rt.team_id}`);
    const zoneToken = (rt.r3_zones as any)?.token;
    if (!zoneToken) throw new Error(`No zone token for team ${rt.team_id}`);

    const { data: scanRes, error: scanErr } = await supabase.rpc('r3_scan', {
      p_student: captainId,
      p_token: zoneToken,
    });
    if (scanErr || !scanRes?.ok) {
      throw new Error(`Scan failed for team ${rt.team_id}: ${scanErr?.message || JSON.stringify(scanRes)}`);
    }
    console.log(`  Team ${rt.team_id} (Captain: ${captainId}) scanned zone ${rt.zone} successfully.`);
  }

  // 6. Scripted Box Solves:
  // Team 2 solves box 1, 2, 3
  // Team 3 solves box 1, 2
  // Team 4 solves box 1
  // Team 1 solves box 1, 2, 3, 4 (Winning Team)
  console.log('Submitting box solutions in scripted order...');

  const team1 = teamIds[0];
  const team2 = teamIds[1];
  const team3 = teamIds[2];
  const team4 = teamIds[3];

  async function submitBox(teamId: string, box: number, char: string) {
    const student = capMap.get(teamId)!;
    const reqId = crypto.randomUUID();
    const { data, error } = await supabase.rpc('r3_submit_box', {
      p_student: student,
      p_box: box,
      p_value: char,
      p_request: reqId,
    });
    if (error || !data?.ok) {
      throw new Error(`Failed submit box ${box} for ${teamId}: ${error?.message || JSON.stringify(data)}`);
    }
    return data;
  }

  // Team 4 solves box 1
  console.log(`  Team ${team4} solving Box 1...`);
  await submitBox(team4, 1, code[0]);

  // Team 3 solves box 1, 2
  console.log(`  Team ${team3} solving Box 1 & 2...`);
  await submitBox(team3, 1, code[0]);
  await submitBox(team3, 2, code[1]);

  // Team 2 solves box 1, 2, 3
  console.log(`  Team ${team2} solving Box 1, 2, 3...`);
  await submitBox(team2, 1, code[0]);
  await submitBox(team2, 2, code[1]);
  await submitBox(team2, 3, code[2]);

  // Team 1 solves all 4 boxes (1, 2, 3, 4)
  console.log(`  Team ${team1} solving Box 1, 2, 3...`);
  await submitBox(team1, 1, code[0]);
  await submitBox(team1, 2, code[1]);
  await submitBox(team1, 3, code[2]);

  console.log(`  Team ${team1} submitting final Box 4 (Code complete)...`);
  const winRes = await submitBox(team1, 4, code[3]);
  console.log('  Final submission response:', winRes);

  if (winRes.winnerTeamId !== team1) {
    throw new Error(`Expected team ${team1} to be winner, got: ${winRes.winnerTeamId}`);
  }

  // 7. Verify result and final standings
  console.log('\n--- Simulation Results ---');
  const { data: resultRow } = await supabase.from('r3_result').select('*').eq('id', 1).single();
  console.log('R3 Result Row:', resultRow);

  const { data: standings } = await supabase.from('r3_standings').select('*');
  console.log('\nFinal R3 Standings:');
  console.table(standings);

  console.log('\n✅ Round 3 Simulation completed successfully!');
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
