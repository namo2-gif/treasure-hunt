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

function assertJson(res: Response, path: string) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error(`Expected application/json for ${path}, got "${ct}"`);
  }
}

async function main() {
  console.log('--- Admin Smoke Tests (Phase 11: 16.2) ---');

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

    // 1. Unauthenticated checks -> must return JSON 401, not HTML or redirect
    console.log('Testing Unauthenticated API calls (must return JSON 401)...');
    const rUnauth1 = await fetch(`${baseUrl}/api/admin/dashboard`);
    assertJson(rUnauth1, '/api/admin/dashboard (unauth)');
    if (rUnauth1.status !== 401) throw new Error(`Expected 401, got ${rUnauth1.status}`);
    const unauthData1 = await rUnauth1.json();
    if (unauthData1.ok !== false || unauthData1.code !== 'UNAUTHORIZED') {
      throw new Error(`Expected { ok: false, code: 'UNAUTHORIZED' }, got ${JSON.stringify(unauthData1)}`);
    }
    console.log('  [PASS] Unauthenticated /api/admin/dashboard -> 401 JSON');

    const rUnauth2 = await fetch(`${baseUrl}/api/admin/content/riddles`);
    assertJson(rUnauth2, '/api/admin/content/riddles (unauth)');
    if (rUnauth2.status !== 401) throw new Error(`Expected 401, got ${rUnauth2.status}`);
    console.log('  [PASS] Unauthenticated /api/admin/content/riddles -> 401 JSON');

    // 2. Unknown admin routes -> must return JSON 404, not HTML
    console.log('Testing Unknown admin routes (must return JSON 404)...');
    const rUnknown1 = await fetch(`${baseUrl}/api/admin/nonexistent-random-endpoint`, { headers });
    assertJson(rUnknown1, '/api/admin/nonexistent-random-endpoint');
    if (rUnknown1.status !== 404) throw new Error(`Expected 404, got ${rUnknown1.status}`);
    const unknownData1 = await rUnknown1.json();
    if (unknownData1.ok !== false || unknownData1.code !== 'NOT_FOUND') {
      throw new Error(`Expected { ok: false, code: 'NOT_FOUND' }, got ${JSON.stringify(unknownData1)}`);
    }
    console.log('  [PASS] Unknown route GET /api/admin/nonexistent-random-endpoint -> 404 JSON');

    const rUnknown2 = await fetch(`${baseUrl}/api/admin/foo/bar/baz/deep`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ test: 123 }),
    });
    assertJson(rUnknown2, '/api/admin/foo/bar/baz/deep');
    if (rUnknown2.status !== 404) throw new Error(`Expected 404, got ${rUnknown2.status}`);
    console.log('  [PASS] Unknown route POST /api/admin/foo/bar/baz/deep -> 404 JSON');

    // 3. Authenticated Content GET routes
    console.log('Testing Authenticated Content routes...');
    const endpoints = [
      '/api/admin/dashboard',
      '/api/admin/content/riddles',
      '/api/admin/riddles',
      '/api/admin/content/questions',
      '/api/admin/questions',
      '/api/admin/content/teasers',
      '/api/admin/teasers',
      '/api/admin/content/qr',
      '/api/admin/qr',
      '/api/admin/round3',
      '/api/admin/round3/zones',
      '/api/admin/round3/teams',
      '/api/admin/round3/config',
      '/api/admin/export/r3',
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep}`, { headers });
      if (ep.startsWith('/api/admin/export/')) {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('text/csv')) {
          throw new Error(`Expected text/csv for ${ep}, got "${ct}"`);
        }
        if (res.status !== 200) throw new Error(`GET ${ep} returned ${res.status}`);
        console.log(`  [PASS] GET ${ep} -> 200 CSV`);
      } else {
        assertJson(res, ep);
        if (res.status !== 200) throw new Error(`GET ${ep} returned ${res.status}`);
        const body = await res.json();
        if (!body.ok) throw new Error(`GET ${ep} returned ok:false -> ${JSON.stringify(body)}`);
        console.log(`  [PASS] GET ${ep} -> 200 JSON`);
      }
    }

    // 4. Content CRUD checks
    console.log('Testing Content CRUD operations...');
    // Create Riddle
    const createRiddleRes = await fetch(`${baseUrl}/api/admin/content/riddles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        position: 9999,
        text: 'Smoke test riddle question?',
        options: [
          { id: 'a', text: 'Smoke option A' },
          { id: 'b', text: 'Smoke option B' },
        ],
        correctOptionId: 'a',
      }),
    });
    assertJson(createRiddleRes, 'POST /api/admin/content/riddles');
    const createdRiddle = await createRiddleRes.json();
    if (!createdRiddle.ok || !createdRiddle.id) throw new Error(`Create riddle failed: ${JSON.stringify(createdRiddle)}`);
    console.log(`  [PASS] Created test riddle id: ${createdRiddle.id}`);

    // Edit Riddle
    const editRiddleRes = await fetch(`${baseUrl}/api/admin/content/riddles/${createdRiddle.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ text: 'Smoke test riddle edited stem?' }),
    });
    assertJson(editRiddleRes, 'PUT /api/admin/content/riddles/[id]');
    const editRiddleData = await editRiddleRes.json();
    if (!editRiddleData.ok) throw new Error(`Edit riddle failed: ${JSON.stringify(editRiddleData)}`);
    console.log('  [PASS] Edited test riddle');

    // Delete Riddle
    const delRiddleRes = await fetch(`${baseUrl}/api/admin/content/riddles/${createdRiddle.id}`, {
      method: 'DELETE',
      headers,
    });
    assertJson(delRiddleRes, 'DELETE /api/admin/content/riddles/[id]');
    const delRiddleData = await delRiddleRes.json();
    if (!delRiddleData.ok) throw new Error(`Delete riddle failed: ${JSON.stringify(delRiddleData)}`);
    console.log('  [PASS] Deleted test riddle');

    // 5. QR CRUD
    const createQrRes = await fetch(`${baseUrl}/api/admin/content/qr`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Smoke Test QR', capacity: 10 }),
    });
    assertJson(createQrRes, 'POST /api/admin/content/qr');
    const qrData = await createQrRes.json();
    if (!qrData.ok || !qrData.qr?.id) throw new Error(`Create QR failed: ${JSON.stringify(qrData)}`);
    console.log(`  [PASS] Created test QR id: ${qrData.qr.id}`);

    const delQrRes = await fetch(`${baseUrl}/api/admin/content/qr/${qrData.qr.id}`, {
      method: 'DELETE',
      headers,
    });
    assertJson(delQrRes, 'DELETE /api/admin/content/qr/[id]');
    const delQrData = await delQrRes.json();
    if (!delQrData.ok) throw new Error(`Delete QR failed: ${JSON.stringify(delQrData)}`);
    console.log('  [PASS] Deleted test QR');

    console.log('\n--- ALL ADMIN SMOKE TESTS PASSED ---');
  } else {
    console.log('Server not reachable over HTTP. To run HTTP smoke tests, start the Next.js dev server.');
    console.log('Testing direct RPC and DB constraints...');
    const { data: codeRes, error: codeErr } = await supabase.rpc('r3_set_code', {
      p_code: '1DAI',
      p_admin_id: 1,
    });
    if (codeErr || !codeRes?.ok) throw new Error(`r3_set_code failed: ${codeErr?.message || JSON.stringify(codeRes)}`);
    console.log('  [PASS] Direct RPC check passed.');
  }
}

main().catch((err) => {
  console.error('\nSmoke test failed:', err);
  process.exit(1);
});
