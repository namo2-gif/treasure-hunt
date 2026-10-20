import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

type CheckResult = {
  object: string;
  expected: string;
  status: 'OK' | 'MISSING' | 'STILL PRESENT';
  details?: string;
};

async function checkTable(tableName: string): Promise<CheckResult> {
  const { error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
  if (error) {
    if (
      error.code === 'PGRST205' ||
      error.code === '42P01' ||
      error.message.includes('relation') ||
      error.message.includes('does not exist') ||
      error.message.includes('Could not find the table')
    ) {
      return { object: `table ${tableName}`, expected: 'exists', status: 'MISSING', details: error.message };
    }
  }
  return { object: `table ${tableName}`, expected: 'exists', status: 'OK' };
}

async function checkColumn(tableName: string, columnName: string): Promise<CheckResult> {
  const { error } = await supabase.from(tableName).select(columnName).limit(1);
  if (error) {
    if (
      error.code === 'PGRST204' ||
      error.code === 'PGRST205' ||
      error.code === '42703' ||
      error.message.includes('column') ||
      error.message.includes('does not exist') ||
      error.message.includes('Could not find the table')
    ) {
      return {
        object: `column ${tableName}.${columnName}`,
        expected: 'exists',
        status: 'MISSING',
        details: error.message,
      };
    }
  }
  return { object: `column ${tableName}.${columnName}`, expected: 'exists', status: 'OK' };
}

async function checkFunction(funcName: string, args: Record<string, unknown> = {}): Promise<CheckResult> {
  const { error } = await supabase.rpc(funcName, args);
  if (error) {
    if (error.code === 'PGRST202' || error.message.includes('Could not find the function')) {
      return { object: `function ${funcName}`, expected: 'exists', status: 'MISSING', details: error.message };
    }
  }
  return { object: `function ${funcName}`, expected: 'exists', status: 'OK' };
}

async function checkGoneFunction(funcName: string, args: Record<string, unknown> = {}): Promise<CheckResult> {
  const { error } = await supabase.rpc(funcName, args);
  if (error && (error.code === 'PGRST202' || error.message.includes('Could not find the function'))) {
    return { object: `function ${funcName}`, expected: 'gone', status: 'OK' };
  }
  return {
    object: `function ${funcName}`,
    expected: 'gone',
    status: 'STILL PRESENT',
    details: 'Function was successfully resolved',
  };
}

async function checkGoneTable(tableName: string): Promise<CheckResult> {
  // Use AbortController so a stale-cache hang doesn't block forever
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  let error: { code?: string; message: string } | null = null;
  try {
    const res = await supabase.from(tableName).select('*').limit(1);
    error = res.error;
  } catch {
    // aborted = PostgREST cached a table that no longer exists → treat as gone
    clearTimeout(timeout);
    return { object: `table ${tableName}`, expected: 'gone', status: 'OK', details: 'request timed out (stale cache, table is gone)' };
  }
  clearTimeout(timeout);
  if (
    error &&
    (error.code === 'PGRST205' ||
      error.code === '42P01' ||
      (error.message && (error.message.includes('relation') ||
      error.message.includes('does not exist') ||
      error.message.includes('Could not find the table'))))
  ) {
    return { object: `table ${tableName}`, expected: 'gone', status: 'OK' };
  }
  if (!error) {
    return {
      object: `table ${tableName}`,
      expected: 'gone',
      status: 'STILL PRESENT',
      details: 'Table returned data — it still exists in the database',
    };
  }
  // Any other error (e.g. RLS blocking reads but table exists) → treat as still present
  return {
    object: `table ${tableName}`,
    expected: 'gone',
    status: 'STILL PRESENT',
    details: error.message,
  };
}

async function main() {
  console.log('Running database schema and functions audit...\n');

  const results: CheckResult[] = [];

  // 1. Tables: Section 5, 15.3, and r1_archive
  const tables = [
    'settings',
    'event_state',
    'teams',
    'students',
    'admins',
    'qr_locations',
    'riddles',
    'teaser_puzzles',
    'questions',
    'registrations',
    'piece_assignments',
    'team_run',
    'team_questions',
    'attempts',
    'score_adjustments',
    'admin_log',
    'r3_config',
    'r3_zones',
    'r3_riddles',
    'r3_team',
    'r3_boxes',
    'r3_attempts',
    'r3_result',
    'r1_archive',
  ];

  for (const t of tables) {
    results.push(await checkTable(t));
  }

  // 2. Columns
  results.push(await checkColumn('event_state', 'r3_start_ms'));
  results.push(await checkColumn('event_state', 'r3_end_ms'));
  results.push(await checkColumn('r3_boxes', 'epoch'));

  // 3. Functions
  results.push(await checkFunction('event_clock'));
  results.push(await checkFunction('advance_event'));
  results.push(await checkFunction('scan_dispatch', { p_student: '__check__', p_token: '__check__' }));
  results.push(
    await checkFunction('r3_submit_box', {
      p_student: '__check__',
      p_box: 1,
      p_value: '1',
      p_request: '00000000-0000-0000-0000-000000000000',
    })
  );
  results.push(await checkFunction('open_round3', { p_force: false }));
  results.push(await checkFunction('start_round2'));
  results.push(
    await checkFunction('submit_answer', {
      p_student: '__check__',
      p_kind: 'r1',
      p_key: 1,
      p_option: 'a',
      p_request: '00000000-0000-0000-0000-000000000000',
    })
  );
  results.push(await checkFunction('reset_event_data', { p_confirm: '__check__' }));

  // 4. Old objects that must be gone
  results.push(await checkGoneFunction('go_live'));
  results.push(await checkGoneFunction('claim_round3', { p_student: '__check__', p_password: '__check__' }));
  results.push(await checkGoneTable('round3'));
  results.push(await checkGoneTable('round3_claim'));

  // Print results table
  console.log('| ' + 'Object'.padEnd(35) + ' | ' + 'Expected'.padEnd(10) + ' | ' + 'Status'.padEnd(14) + ' |');
  console.log('|-' + '-'.repeat(35) + '-|-' + '-'.repeat(10) + '-|-' + '-'.repeat(14) + '-|');
  for (const r of results) {
    console.log('| ' + r.object.padEnd(35) + ' | ' + r.expected.padEnd(10) + ' | ' + r.status.padEnd(14) + ' |');
  }

  const failures = results.filter((r) => r.status !== 'OK');
  if (failures.length > 0) {
    console.log(`\nDATABASE AUDIT FAILED: ${failures.length} item(s) failed check.`);
    for (const f of failures) {
      console.log(`  - ${f.object}: status ${f.status}${f.details ? ` (${f.details})` : ''}`);
    }
    process.exit(1);
  } else {
    console.log('\nDATABASE AUDIT PASSED: All objects match expected state.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error during db-check:', err);
  process.exit(1);
});
