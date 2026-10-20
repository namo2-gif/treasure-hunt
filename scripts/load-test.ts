/**
 * scripts/load-test.ts
 *
 * Section 12 Phase 9 Hardening:
 *   "Load test: 150 clients polling /api/state for 5 minutes, zero 5xx, p95 under 800 ms"
 *
 * Run: tsx --env-file=.env.local scripts/load-test.ts [--duration=300] [--clients=150] [--url=http://localhost:3000]
 */

import { SignJWT } from 'jose';

// Configuration from CLI flags or defaults
const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : fallback;
}

const BASE_URL = getArg('url', process.env.BASE_URL || 'http://localhost:3000');
const CLIENTS_COUNT = parseInt(getArg('clients', '150'), 10);
const DURATION_SECONDS = parseInt(getArg('duration', '300'), 10);
const SESSION_SECRET = process.env.SESSION_SECRET || 'a-very-secret-key-32-chars-long!!';

const secretKey = new TextEncoder().encode(SESSION_SECRET);

async function createPlayerCookie(studentId: string): Promise<string> {
  const jwt = await new SignJWT({ sid: studentId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secretKey);
  return `th_session=${jwt}`;
}

interface RequestRecord {
  durationMs: number;
  status: number;
  screen?: string;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('====================================================');
  console.log(' Campus Treasure Hunt — Load Test (Phase 9)');
  console.log(` Target URL:        ${BASE_URL}`);
  console.log(` Simulated Clients: ${CLIENTS_COUNT}`);
  console.log(` Test Duration:     ${DURATION_SECONDS} seconds`);
  console.log('====================================================\n');

  // Generate tokens for test students (S0101 to S3005)
  console.log('Generating client authentication tokens...');
  const clients: Array<{ id: string; cookie: string }> = [];
  for (let i = 1; i <= CLIENTS_COUNT; i++) {
    const teamNum = Math.floor((i - 1) / 5) + 1;
    const memberNum = ((i - 1) % 5) + 1;
    const studentId = `S${String(teamNum).padStart(2, '0')}${String(memberNum).padStart(2, '0')}`;
    const cookie = await createPlayerCookie(studentId);
    clients.push({ id: studentId, cookie });
  }

  const records: RequestRecord[] = [];
  let stop = false;
  const startTime = Date.now();
  const endTime = startTime + DURATION_SECONDS * 1000;

  // Single client worker loop
  async function runClient(client: { id: string; cookie: string }, index: number) {
    // Initial random stagger (0 - 5 seconds)
    await sleep(Math.random() * 5000);

    while (!stop && Date.now() < endTime) {
      const reqStart = Date.now();
      try {
        const res = await fetch(`${BASE_URL}/api/state`, {
          headers: { Cookie: client.cookie },
          cache: 'no-store',
        });
        const duration = Date.now() - reqStart;
        let screen: string | undefined = undefined;
        if (res.status === 200) {
          try {
            const body = await res.json();
            screen = body?.state?.screen;
          } catch {}
        }
        records.push({ durationMs: duration, status: res.status, screen });
      } catch (err: any) {
        const duration = Date.now() - reqStart;
        records.push({ durationMs: duration, status: 599 });
      }

      // Poll interval: 5 seconds with +/- 1 second jitter
      const nextDelay = 4000 + Math.random() * 2000;
      await sleep(nextDelay);
    }
  }

  // Live reporter loop
  const reportInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const totalReqs = records.length;
    const errors5xx = records.filter((r) => r.status >= 500).length;
    const rps = elapsed > 0 ? (totalReqs / elapsed).toFixed(1) : '0';
    console.log(
      `[${elapsed}s / ${DURATION_SECONDS}s] Requests: ${totalReqs} | Rate: ${rps} req/s | 5xx errors: ${errors5xx}`
    );
  }, 10000);

  console.log(`Starting ${CLIENTS_COUNT} concurrent polling workers...\n`);
  const workers = clients.map((c, i) => runClient(c, i));

  // Wait for duration
  await sleep(DURATION_SECONDS * 1000);
  stop = true;
  clearInterval(reportInterval);
  await Promise.all(workers);

  // Compute metrics
  console.log('\n====================================================');
  console.log(' Load Test Finished — Metric Summary');
  console.log('====================================================');

  const total = records.length;
  if (total === 0) {
    console.error('No requests completed. Check if target server is running.');
    process.exit(1);
  }

  const errors = records.filter((r) => r.status >= 500);
  const latencies = records.map((r) => r.durationMs).sort((a, b) => a - b);

  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / total);
  const p50 = latencies[Math.floor(total * 0.5)];
  const p90 = latencies[Math.floor(total * 0.9)];
  const p95 = latencies[Math.floor(total * 0.95)];
  const p99 = latencies[Math.floor(total * 0.99)];
  const max = latencies[latencies.length - 1];

  console.log(`Total Requests Completed: ${total}`);
  console.log(`5xx Error Count:          ${errors.length} (${((errors.length / total) * 100).toFixed(2)}%)`);
  console.log(`Average Latency:          ${avgLatency} ms`);
  console.log(`Median (p50):             ${p50} ms`);
  console.log(`p90:                      ${p90} ms`);
  console.log(`p95:                      ${p95} ms (Target: < 800 ms)`);
  console.log(`p99:                      ${p99} ms`);

  // Screen breakdown
  const screenCounts: Record<string, number> = {};
  for (const r of records) {
    if (r.screen) screenCounts[r.screen] = (screenCounts[r.screen] || 0) + 1;
  }
  if (Object.keys(screenCounts).length > 0) {
    console.log('\nScreen distribution across polled requests:');
    for (const [screen, count] of Object.entries(screenCounts)) {
      console.log(`  - ${screen}: ${count} responses (${((count / total) * 100).toFixed(1)}%)`);
    }
  }
  console.log(`Max Latency:              ${max} ms`);

  // Target criteria check
  const passedErrors = errors.length === 0;
  const passedP95 = p95 < 800;

  console.log('----------------------------------------------------');
  console.log(`Criteria 1 (Zero 5xx):     ${passedErrors ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`Criteria 2 (p95 < 800 ms): ${passedP95 ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log('====================================================\n');

  if (!passedErrors || !passedP95) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
