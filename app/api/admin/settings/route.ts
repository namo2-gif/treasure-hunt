export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';

// Keys that lock once setup phase passes
const LOCK_ON_SETUP = ['r1_minutes', 'r1_points_per_riddle', 'tries_r1'];
// Keys that lock once r1_closed passes (i.e., when r2 starts)
const LOCK_ON_R1_CLOSED = ['r2_minutes', 'run_cap_minutes', 'run_total_points', 'tries_r2'];
// Keys that lock once r2_break passes (i.e., when r3 starts)
const LOCK_ON_R2_BREAK = ['r3_minutes', 'r3_tries_per_box'];

const PHASES_AFTER_SETUP = ['r1_running', 'r1_closed', 'r2_running', 'r2_break', 'r3_open', 'ended'];
const PHASES_AFTER_R1_CLOSED = ['r2_running', 'r2_break', 'r3_open', 'ended'];
const PHASES_AFTER_R2_BREAK = ['r3_open', 'ended'];

function isLocked(key: string, phase: string): boolean {
  if (LOCK_ON_SETUP.includes(key) && PHASES_AFTER_SETUP.includes(phase)) return true;
  if (LOCK_ON_R1_CLOSED.includes(key) && PHASES_AFTER_R1_CLOSED.includes(phase)) return true;
  if (LOCK_ON_R2_BREAK.includes(key) && PHASES_AFTER_R2_BREAK.includes(phase)) return true;
  return false;
}

const SETTING_LABELS: Record<string, string> = {
  top_n_r2: 'Top N teams to Round 2',
  top_n_r3: 'Top N teams to Round 3',
  r1_minutes: 'Round 1 Duration (minutes)',
  r2_minutes: 'Round 2 Duration (minutes)',
  run_cap_minutes: 'Run Cap Duration (minutes)',
  break_minutes: 'Break Duration (minutes)',
  run_total_points: 'Total Points per Run',
  r1_points_per_riddle: 'Points per R1 Riddle',
  tries_r1: 'Max Tries R1',
  tries_r2: 'Max Tries R2',
  default_qr_capacity: 'Default QR Capacity',
  variants_per_question: 'Variants per Question',
  r3_minutes: 'Round 3 Duration (minutes)',
  r3_tries_per_box: 'Max Tries per Round 3 Box',
};

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  const [{ data: settings }, { data: state }] = await Promise.all([
    db.from('settings').select('key, value').order('key'),
    db.from('event_state').select('phase').eq('id', 1).single(),
  ]);

  const phase = state?.phase ?? 'setup';

  return NextResponse.json({
    ok: true,
    settings: (settings || []).map((s) => ({
      key: s.key,
      value: s.value,
      label: SETTING_LABELS[s.key] ?? s.key,
      locked: isLocked(s.key, phase),
    })),
  });
}

const putSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.number(), z.string()]),
});

export async function PUT(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  let body: unknown = {};
  const text = await request.text();
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid JSON body' }, { status: 400 });
    }
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'key and value are required' }, { status: 400 });
  }

  const { key, value } = parsed.data;
  const { data, error } = await db.rpc('update_setting', {
    p_key: key,
    p_value: JSON.stringify(value),
    p_admin_id: session.aid,
  });

  if (error || !data) {
    return NextResponse.json({ ok: false, code: error?.code || 'RPC_ERROR', message: error?.message || 'Failed to update setting' });
  }

  return NextResponse.json(data);
}
