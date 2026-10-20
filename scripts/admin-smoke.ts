import { createClient } from '@supabase/supabase-js';
import { signAdminToken } from '../lib/session';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

async function main() {
  console.log('--- Admin Smoke Tests ---');

  const adminToken = await signAdminToken(1);
  let serverReachable = false;

  try {
    const probe = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Cookie: `th_admin=${adminToken}` },
    });
    if (probe.status < 500) {
      serverReachable = true;
    }
  } catch {
    serverReachable = false;
  }

  if (serverReachable) {
    console.log(`Next.js server is online at ${baseUrl}. Running HTTP route smoke tests...`);
    const headers = {
      Cookie: `th_admin=${adminToken}`,
      'Content-Type': 'application/json',
    };

    // 1. GET Dashboard
    const rDashboard = await fetch(`${baseUrl}/api/admin/dashboard`, { headers });
    if (rDashboard.status !== 200) throw new Error(`GET /api/admin/dashboard returned ${rDashboard.status}`);
    console.log('  [PASS] GET /api/admin/dashboard -> 200');

    // 2. GET Round 3 Zones
    const rZones = await fetch(`${baseUrl}/api/admin/round3/zones`, { headers });
    if (rZones.status !== 200) throw new Error(`GET /api/admin/round3/zones returned ${rZones.status}`);
    console.log('  [PASS] GET /api/admin/round3/zones -> 200');

    // 3. GET Round 3 Teams
    const rTeams = await fetch(`${baseUrl}/api/admin/round3/teams`, { headers });
    if (rTeams.status !== 200) throw new Error(`GET /api/admin/round3/teams returned ${rTeams.status}`);
    console.log('  [PASS] GET /api/admin/round3/teams -> 200');

    // 4. GET Round 3 Config
    const rConfig = await fetch(`${baseUrl}/api/admin/round3/config`, { headers });
    if (rConfig.status !== 200) throw new Error(`GET /api/admin/round3/config returned ${rConfig.status}`);
    console.log('  [PASS] GET /api/admin/round3/config -> 200');

    // 5. GET R3 Export CSV
    const rExport = await fetch(`${baseUrl}/api/admin/export/r3`, { headers });
    if (rExport.status !== 200) throw new Error(`GET /api/admin/export/r3 returned ${rExport.status}`);
    console.log('  [PASS] GET /api/admin/export/r3 -> 200');

    // 6. PUT Round 3 Config (Mutating -> must write to admin_log)
    const logCountBefore = (await supabase.from('admin_log').select('id', { count: 'exact', head: true })).count || 0;
    const rPutConfig = await fetch(`${baseUrl}/api/admin/round3/config`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ code: '1DAI', hintText: 'Smoke test cipher hint' }),
    });
    if (rPutConfig.status !== 200) throw new Error(`PUT /api/admin/round3/config returned ${rPutConfig.status}`);
    const logCountAfter = (await supabase.from('admin_log').select('id', { count: 'exact', head: true })).count || 0;
    if (logCountAfter <= logCountBefore) throw new Error('PUT /api/admin/round3/config failed to write to admin_log');
    console.log('  [PASS] PUT /api/admin/round3/config -> 200 and logged to admin_log');

  } else {
    console.log('Server not reachable over HTTP. Verifying Admin RPCs & admin_log writes directly...');

    // 1. Test r3_set_code
    const countBefore = (await supabase.from('admin_log').select('id', { count: 'exact', head: true })).count || 0;
    const { data: codeRes, error: codeErr } = await supabase.rpc('r3_set_code', {
      p_code: '1DAI',
      p_admin_id: 1,
    });
    if (codeErr || !codeRes?.ok) throw new Error(`r3_set_code failed: ${codeErr?.message || JSON.stringify(codeRes)}`);

    // 2. Test r3_set_hint
    const { data: hintRes, error: hintErr } = await supabase.rpc('r3_set_hint', {
      p_hint: 'Direct RPC hint test',
      p_admin_id: 1,
    });
    if (hintErr || !hintRes?.ok) throw new Error(`r3_set_hint failed: ${hintErr?.message || JSON.stringify(hintRes)}`);

    const countAfter = (await supabase.from('admin_log').select('id', { count: 'exact', head: true })).count || 0;
    if (countAfter < countBefore + 2) throw new Error('admin_log entries were not created for r3_set_code / r3_set_hint');
    console.log('  [PASS] Admin RPCs executed successfully and logged to admin_log.');
  }

  console.log('✅ Admin smoke tests passed successfully!');
}

main().catch((err) => {
  console.error('Admin smoke test failed:', err);
  process.exit(1);
});
