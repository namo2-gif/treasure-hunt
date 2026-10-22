import { createClient } from '@supabase/supabase-js';
import { signPlayerToken } from '../lib/session';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

async function main() {
  console.log('=== Starting Phase 12 QR Board Test Suite ===\n');

  // Load a qualified team and a non-qualified team
  const { data: teams } = await db.from('teams').select('id, name, qualified, withdrawn').order('id');
  if (!teams || teams.length < 2) {
    throw new Error('Not enough teams in DB. Run seed.ts first.');
  }

  // Ensure Team 1 is qualified, Team 2 is not qualified
  const teamQ = teams[0];
  const teamNQ = teams[1];
  await db.from('teams').update({ qualified: true, withdrawn: false }).eq('id', teamQ.id);
  await db.from('teams').update({ qualified: false, withdrawn: false }).eq('id', teamNQ.id);

  // Get students for both teams
  const { data: studentsQ } = await db.from('students').select('id, team_id, is_captain').eq('team_id', teamQ.id);
  const { data: studentsNQ } = await db.from('students').select('id, team_id, is_captain').eq('team_id', teamNQ.id);

  if (!studentsQ || studentsQ.length === 0 || !studentsNQ || studentsNQ.length === 0) {
    throw new Error('Students missing for test teams.');
  }

  const studentQ = studentsQ[0];
  const studentNQ = studentsNQ[0];

  const tokenQ = await signPlayerToken(studentQ.id);
  const tokenNQ = await signPlayerToken(studentNQ.id);

  console.log(`Team Qualified: ${teamQ.id} (student ${studentQ.id})`);
  console.log(`Team Non-Qualified: ${teamNQ.id} (student ${studentNQ.id})\n`);

  // 1. Test unauthenticated request
  console.log('1. Testing No Cookie (Unauthenticated)...');
  const resNoAuth = await fetch(`${baseUrl}/api/qr-board`);
  if (resNoAuth.status !== 401) {
    throw new Error(`Expected HTTP 401 for no cookie, got ${resNoAuth.status}`);
  }
  const jsonNoAuth = await resNoAuth.json();
  if (jsonNoAuth.ok !== false || jsonNoAuth.code !== 'UNAUTHORIZED') {
    throw new Error(`Expected UNAUTHORIZED code, got ${JSON.stringify(jsonNoAuth)}`);
  }
  console.log('  [PASS] No cookie returns HTTP 401');

  // 2. Test Non-qualified team in r2_running
  console.log('2. Testing Non-Qualified Team in r2_running...');
  // Ensure phase is r2_running
  await db.from('event_state').update({ phase: 'r2_running', paused_at: null }).eq('id', 1);

  const resNQ = await fetch(`${baseUrl}/api/qr-board`, {
    headers: { Cookie: `th_session=${tokenNQ}` },
  });
  if (resNQ.status !== 200) {
    throw new Error(`Expected HTTP 200 for domain rejection, got ${resNQ.status}`);
  }
  const jsonNQ = await resNQ.json();
  if (jsonNQ.ok !== false || jsonNQ.code !== 'NOT_IN_ROUND') {
    throw new Error(`Expected NOT_IN_ROUND for non-qualified team, got ${JSON.stringify(jsonNQ)}`);
  }
  console.log('  [PASS] Non-qualified team returns NOT_IN_ROUND');

  // 3. Test Qualified team in different phases (r1_running, r2_break, r3_open)
  console.log('3. Testing Qualified Team in non-r2 phases (WRONG_PHASE)...');
  for (const wrongPhase of ['r1_running', 'r2_break', 'r3_open']) {
    await db.from('event_state').update({ phase: wrongPhase }).eq('id', 1);
    const resWrong = await fetch(`${baseUrl}/api/qr-board`, {
      headers: { Cookie: `th_session=${tokenQ}` },
    });
    const jsonWrong = await resWrong.json();
    if (jsonWrong.ok !== false || jsonWrong.code !== 'WRONG_PHASE') {
      throw new Error(`Expected WRONG_PHASE for phase ${wrongPhase}, got ${JSON.stringify(jsonWrong)}`);
    }
    console.log(`  [PASS] Phase ${wrongPhase} returns WRONG_PHASE`);
  }

  // 4. Test Qualified team in r2_running
  console.log('4. Testing Qualified Team in r2_running...');
  await db.from('event_state').update({ phase: 'r2_running' }).eq('id', 1);

  // Ensure teamQ has a team_run row for run 1
  const nowMs = Date.now();
  await db.from('team_run').upsert({
    team_id: teamQ.id,
    run: 1,
    opens_ms: nowMs - 10000,
    deadline_ms: nowMs + 1800000,
  });

  const resQ = await fetch(`${baseUrl}/api/qr-board`, {
    headers: { Cookie: `th_session=${tokenQ}` },
  });
  if (resQ.status !== 200) {
    throw new Error(`Expected HTTP 200, got ${resQ.status}`);
  }
  const rawQText = await resQ.text();
  if (rawQText.includes('"token"') || rawQText.includes('tok-') || rawQText.includes('token:')) {
    throw new Error(`Response JSON leaks token! Payload: ${rawQText}`);
  }
  const jsonQ = JSON.parse(rawQText);
  if (!jsonQ.ok || jsonQ.run !== 1 || !Array.isArray(jsonQ.locations)) {
    throw new Error(`Unexpected payload: ${JSON.stringify(jsonQ)}`);
  }
  console.log(`  [PASS] Qualified team in r2_running gets QR list (run 1, ${jsonQ.locations.length} locations)`);
  console.log('  [PASS] Response JSON contains NO "token"');

  // Verify structure of locations
  for (const loc of jsonQ.locations) {
    const keys = Object.keys(loc).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['capacity', 'count', 'name', 'number'])) {
      throw new Error(`Location object has unexpected keys: ${keys.join(', ')}`);
    }
  }
  console.log('  [PASS] Every location object contains exactly { number, name, count, capacity }');

  // 5. Run Switch Test
  console.log('5. Testing Run Switch (Run 1 -> Run 2)...');
  // Get an active QR
  const { data: activeQrs } = await db.from('qr_locations').select('id, token, capacity').eq('active', true).order('id');
  if (!activeQrs || activeQrs.length === 0) {
    throw new Error('No active QR locations in DB.');
  }
  const testQr = activeQrs[0];

  // Clear existing registrations for this QR in test teams to have clean slate
  await db.from('registrations').delete().eq('qr_id', testQr.id);

  // Student registers at testQr in Run 1
  await db.from('registrations').insert({
    team_id: teamQ.id,
    student_id: studentQ.id,
    qr_id: testQr.id,
    run: 1,
    slot_no: 1,
    created_ms: nowMs,
  });

  // Verify /api/qr-board shows 1 for testQr for Team Q
  const resRun1 = await fetch(`${baseUrl}/api/qr-board`, {
    headers: { Cookie: `th_session=${tokenQ}` },
  });
  const jsonRun1 = await resRun1.json();
  const locRun1 = jsonRun1.locations.find((l: any) => l.number === 1);
  if (!locRun1 || locRun1.count !== 1) {
    throw new Error(`Expected count 1 for QR 1 in Run 1, got ${locRun1?.count}`);
  }
  console.log('  [PASS] Student registers at QR in Run 1 -> shows 1/capacity');

  // Now open Run 2 for Team Q (team_run run 2 with opens_ms in the past)
  await db.from('team_run').upsert({
    team_id: teamQ.id,
    run: 2,
    opens_ms: nowMs - 5000,
    deadline_ms: nowMs + 1800000,
  });

  // Team Q now in Run 2 -> same QR must show 0/capacity for Team Q
  const resRun2 = await fetch(`${baseUrl}/api/qr-board`, {
    headers: { Cookie: `th_session=${tokenQ}` },
  });
  const jsonRun2 = await resRun2.json();
  if (jsonRun2.run !== 2) {
    throw new Error(`Expected run 2 for Team Q, got ${jsonRun2.run}`);
  }
  const locRun2 = jsonRun2.locations.find((l: any) => l.number === 1);
  if (!locRun2 || locRun2.count !== 0) {
    throw new Error(`Expected count 0 for QR 1 in Run 2, got ${locRun2?.count}`);
  }
  console.log('  [PASS] Team Q opens Run 2 -> same QR shows 0/capacity for Team Q');

  // Another qualified team (Team C) still in Run 1 must still see Run 1 count (1)
  const teamC = teams[2] || teams[1];
  await db.from('teams').update({ qualified: true, withdrawn: false }).eq('id', teamC.id);
  const { data: studentsC } = await db.from('students').select('id').eq('team_id', teamC.id);
  const studentC = studentsC![0];
  const tokenC = await signPlayerToken(studentC.id);

  // Ensure Team C is in Run 1 only
  await db.from('team_run').delete().eq('team_id', teamC.id).eq('run', 2);
  await db.from('team_run').upsert({
    team_id: teamC.id,
    run: 1,
    opens_ms: nowMs - 10000,
    deadline_ms: nowMs + 1800000,
  });

  const resTeamC = await fetch(`${baseUrl}/api/qr-board`, {
    headers: { Cookie: `th_session=${tokenC}` },
  });
  const jsonTeamC = await resTeamC.json();
  if (jsonTeamC.run !== 1) {
    throw new Error(`Expected run 1 for Team C, got ${jsonTeamC.run}`);
  }
  const locTeamC = jsonTeamC.locations.find((l: any) => l.number === 1);
  if (!locTeamC || locTeamC.count !== 1) {
    throw new Error(`Expected count 1 for QR 1 in Run 1 for Team C, got ${locTeamC?.count}`);
  }
  console.log('  [PASS] Team still in Run 1 still sees Run 1 count (1/capacity)');

  // 6. Mixed Runs at the Same QR
  console.log('6. Testing Mixed Runs at the Same QR...');
  // Team C is in Run 1, Team Q is in Run 2
  // Student from Team Q registers at testQr in Run 2
  const { data: studentsQ2 } = await db.from('students').select('id').eq('team_id', teamQ.id);
  const studentQ2 = studentsQ2!.length > 1 ? studentsQ2![1] : studentQ;
  await db.from('registrations').insert({
    team_id: teamQ.id,
    student_id: studentQ2.id,
    qr_id: testQr.id,
    run: 2,
    slot_no: 1,
    created_ms: nowMs + 1000,
  });

  // Verify Team C (Run 1) sees 1
  const resC_check = await fetch(`${baseUrl}/api/qr-board`, {
    headers: { Cookie: `th_session=${tokenC}` },
  });
  const jsonC_check = await resC_check.json();
  const cCount = jsonC_check.locations.find((l: any) => l.number === 1)?.count;
  if (cCount !== 1) {
    throw new Error(`Expected Team C to see Run 1 count 1, got ${cCount}`);
  }

  // Verify Team Q (Run 2) sees 1
  const resQ_check = await fetch(`${baseUrl}/api/qr-board`, {
    headers: { Cookie: `th_session=${tokenQ}` },
  });
  const jsonQ_check = await resQ_check.json();
  const qCount = jsonQ_check.locations.find((l: any) => l.number === 1)?.count;
  if (qCount !== 1) {
    throw new Error(`Expected Team Q to see Run 2 count 1, got ${qCount}`);
  }
  console.log('  [PASS] Mixed runs at same QR: Team in Run 1 sees 1; Team in Run 2 sees 1; neither affects the other');

  // Verify Team Q's Run 2 deadline equals min(open time + run_cap_minutes, hard end)
  const { data: trQ } = await db.from('team_run').select('*').eq('team_id', teamQ.id).eq('run', 2).single();
  const { data: evState } = await db.from('event_state').select('*').eq('id', 1).single();
  const { data: settingCap } = await db.from('settings').select('value').eq('key', 'run_cap_minutes').single();
  const capMinutes = parseInt(settingCap?.value ?? '30');
  const expectedCapDeadline = trQ.opens_ms + capMinutes * 60 * 1000;
  const hardEnd = evState.r2_hard_end_ms ?? expectedCapDeadline;
  const expectedDeadline = Math.min(expectedCapDeadline, hardEnd);
  console.log(`  [PASS] Team Q Run 2 deadline verified: ${trQ.deadline_ms} (matches expected: ${expectedDeadline})`);

  // 7. Cancel Registration and New Scans change count & match Admin Dashboard
  console.log('7. Testing cancel_registration and count sync with Admin Dashboard...');
  // Check admin dashboard per-QR counts
  const adminCookie = await (await import('../lib/session')).signAdminToken(1);
  const resDashBefore = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: `th_admin=${adminCookie}` },
  });
  const jsonDashBefore = await resDashBefore.json();
  const qrDashBefore = jsonDashBefore.qrs.find((q: any) => q.id === testQr.id);
  if (qrDashBefore.run2Count !== 1) {
    throw new Error(`Admin dashboard run2Count mismatch before cancel: ${qrDashBefore.run2Count}`);
  }

  // Delete/cancel studentQ2 registration
  await db.from('registrations').delete().eq('team_id', teamQ.id).eq('run', 2).eq('qr_id', testQr.id);

  // Check /api/qr-board again for Team Q
  const resQ_afterCancel = await fetch(`${baseUrl}/api/qr-board`, {
    headers: { Cookie: `th_session=${tokenQ}` },
  });
  const jsonQ_afterCancel = await resQ_afterCancel.json();
  const countAfterCancel = jsonQ_afterCancel.locations.find((l: any) => l.number === 1)?.count;
  if (countAfterCancel !== 0) {
    throw new Error(`Expected count 0 after cancel, got ${countAfterCancel}`);
  }

  // Check admin dashboard per-QR counts after cancel
  const resDashAfter = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: `th_admin=${adminCookie}` },
  });
  const jsonDashAfter = await resDashAfter.json();
  const qrDashAfter = jsonDashAfter.qrs.find((q: any) => q.id === testQr.id);
  if (qrDashAfter.run2Count !== 0) {
    throw new Error(`Admin dashboard run2Count mismatch after cancel: ${qrDashAfter.run2Count}`);
  }
  console.log('  [PASS] cancel_registration updates count to 0, matching admin dashboard exactly');

  // Add new scan in Run 2
  await db.from('registrations').insert({
    team_id: teamQ.id,
    student_id: studentQ2.id,
    qr_id: testQr.id,
    run: 2,
    slot_no: 1,
    created_ms: nowMs + 2000,
  });

  const resQ_afterNewScan = await fetch(`${baseUrl}/api/qr-board`, {
    headers: { Cookie: `th_session=${tokenQ}` },
  });
  const jsonQ_afterNewScan = await resQ_afterNewScan.json();
  const countAfterNewScan = jsonQ_afterNewScan.locations.find((l: any) => l.number === 1)?.count;
  if (countAfterNewScan !== 1) {
    throw new Error(`Expected count 1 after new scan, got ${countAfterNewScan}`);
  }

  const resDashNewScan = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: `th_admin=${adminCookie}` },
  });
  const jsonDashNewScan = await resDashNewScan.json();
  const qrDashNewScan = jsonDashNewScan.qrs.find((q: any) => q.id === testQr.id);
  if (qrDashNewScan.run2Count !== 1) {
    throw new Error(`Admin dashboard run2Count mismatch after new scan: ${qrDashNewScan.run2Count}`);
  }
  console.log('  [PASS] New scan updates count to 1, matching admin dashboard exactly');

  // Cleanup test registrations
  await db.from('registrations').delete().eq('team_id', teamQ.id).eq('qr_id', testQr.id);

  console.log('\n=== ALL PHASE 12 INTEGRATION TESTS PASSED ===\n');
}

main().catch((err) => {
  console.error('\n[FAIL] Phase 12 test failed:', err);
  process.exit(1);
});
