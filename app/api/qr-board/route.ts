export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getPlayerSession } from '@/lib/session';
import { getEventStateAndClock } from '@/lib/event-service';
import { countRegistrationsForRun } from '@/lib/qr';
import { mapQrBoardDTO } from '@/lib/dto';

export async function GET() {
  const session = await getPlayerSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHORIZED', message: 'You must be logged in to access this.' },
      { status: 401 }
    );
  }

  // Load student and team fresh from database (Section 10)
  const { data: student } = await db
    .from('students')
    .select('id, absent, teams(id, qualified, withdrawn)')
    .eq('id', session.sid)
    .single();

  if (!student || !student.teams) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHORIZED', message: 'Student or team not found.' },
      { status: 401 }
    );
  }

  const team = Array.isArray(student.teams) ? student.teams[0] : student.teams;
  if (!team || !team.qualified || team.withdrawn) {
    return NextResponse.json({ ok: false, code: 'NOT_IN_ROUND' });
  }

  // advance_event() is called lazily inside getEventStateAndClock
  const { state, clock } = await getEventStateAndClock(db);

  if (state.phase !== 'r2_running') {
    return NextResponse.json({ ok: false, code: 'WRONG_PHASE' });
  }

  // Determine current run: highest run in team_run where opens_ms <= event_now (Section 4.5)
  const { data: runRow } = await db
    .from('team_run')
    .select('run')
    .eq('team_id', team.id)
    .lte('opens_ms', clock.eventNowMs)
    .order('run', { ascending: false })
    .limit(1)
    .single();

  const currentRun = runRow?.run ?? 1;

  // One query for active QRs, one for that run's registrations (no N+1)
  const [{ data: qrs }, { data: registrations }] = await Promise.all([
    db
      .from('qr_locations')
      .select('id, name, capacity, active')
      .eq('active', true)
      .order('id'),
    db
      .from('registrations')
      .select('qr_id')
      .eq('run', currentRun),
  ]);

  const counts = countRegistrationsForRun(registrations);
  const payload = mapQrBoardDTO(currentRun, qrs || [], counts);

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
