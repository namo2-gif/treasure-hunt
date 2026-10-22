export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';
import { getEventStateAndClock } from '@/lib/event-service';
import { countRegistrationsByRun } from '@/lib/qr';

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  // advance_event is called inside getEventStateAndClock
  const { state, clock } = await getEventStateAndClock(db);

  // Teams overview & R2 standings
  const [{ data: teams }, { data: r2Standings }] = await Promise.all([
    db.from('teams').select('id, name, n, qualified, withdrawn, r3_eligible').order('id'),
    db.from('r2_standings').select('team_id, points, last_ms').order('points', { ascending: false }),
  ]);

  // Compute R2 rank with ties
  const sortedR2 = [...(r2Standings || [])].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const aMs = a.last_ms ?? Number.MAX_SAFE_INTEGER;
    const bMs = b.last_ms ?? Number.MAX_SAFE_INTEGER;
    return aMs - bMs;
  });

  const r2StatsMap: Record<string, { rank: number; points: number; lastMs: number | null }> = {};
  let currentRank = 1;
  sortedR2.forEach((row, i) => {
    if (i > 0) {
      const prev = sortedR2[i - 1];
      const same = prev.points === row.points && prev.last_ms === row.last_ms;
      if (!same) currentRank = i + 1;
    }
    r2StatsMap[row.team_id] = {
      rank: currentRank,
      points: row.points,
      lastMs: row.last_ms,
    };
  });

  // Team runs
  const { data: teamRuns } = await db
    .from('team_run')
    .select('team_id, run, opens_ms, deadline_ms, teaser_done_ms, teaser_skipped, finished_ms');

  // QR locations & registrations count
  const { data: qrs } = await db
    .from('qr_locations')
    .select('id, name, capacity, active')
    .order('id');

  const { data: registrations } = await db
    .from('registrations')
    .select('qr_id, run');

  const qrCounts = countRegistrationsByRun(registrations);

  // Count qualified teams
  const qualifiedCount = teams?.filter(t => t.qualified && !t.withdrawn).length || 0;

  // Determine allowed phase transition action
  let primaryAction: { action: string; label: string; enabled: boolean; reason?: string } | null = null;

  switch (state.phase) {
    case 'setup':
      primaryAction = { action: 'start-r1', label: 'Start Round 1', enabled: true };
      break;
    case 'r1_running':
      primaryAction = { action: 'end-r1', label: 'End Round 1', enabled: true };
      break;
    case 'r1_closed':
      primaryAction = {
        action: 'start-r2',
        label: 'Start Round 2',
        enabled: qualifiedCount > 0,
        reason: qualifiedCount === 0 ? 'Need at least 1 qualified team' : undefined,
      };
      break;
    case 'r2_running':
      primaryAction = { action: 'end-r2', label: 'End Round 2', enabled: true };
      break;
    case 'r2_break':
      primaryAction = {
        action: 'open-r3',
        label: 'Start Round 3',
        enabled: true,
      };
      break;
    case 'r3_open':
      primaryAction = { action: 'end-event', label: 'End Event', enabled: true };
      break;
    case 'ended':
      primaryAction = null;
      break;
  }

  // Round 3 block for r2_break, r3_open, ended
  let round3Data = null;
  if (state.phase === 'r2_break' || state.phase === 'r3_open' || state.phase === 'ended') {
    const [
      { data: r3Config },
      { data: r3Result },
      { data: r3Teams },
      { data: r3Zones },
      { data: r3Boxes },
      { data: r3Attempts },
      { data: r3Standings },
      { data: allTeams },
    ] = await Promise.all([
      db.from('r3_config').select('code, hint_text').eq('id', 1).single(),
      db.from('r3_result').select('winner_team_id, reason, decided_ms, decided_at').eq('id', 1).single(),
      db.from('r3_team').select('team_id, zone, scanned_ms, scanned_at, scanned_by, scan_credited, finished_ms'),
      db.from('r3_zones').select('id, name'),
      db.from('r3_boxes').select('team_id, box, epoch, locked, solved_ms, solved_at, credited'),
      db.from('r3_attempts').select('team_id, box, epoch, try_no, value, correct, created_at, created_ms').order('created_ms'),
      db.from('r3_standings').select('team_id, milestones, last_seq'),
      db.from('teams').select('id, name, r3_eligible'),
    ]);

    const eligibleTeamsList = (allTeams || []).filter(t => t.r3_eligible);
    const zoneMap: Record<number, string> = {};
    (r3Zones || []).forEach(z => { zoneMap[z.id] = z.name; });

    // Standings sort
    const sortedStandings = [...(r3Standings || [])].sort((a, b) => {
      if (b.milestones !== a.milestones) return b.milestones - a.milestones;
      const aSeq = a.last_seq ?? Number.MAX_SAFE_INTEGER;
      const bSeq = b.last_seq ?? Number.MAX_SAFE_INTEGER;
      if (aSeq !== bSeq) return aSeq - bSeq;
      return a.team_id.localeCompare(b.team_id);
    });

    const rankMap: Record<string, number> = {};
    sortedStandings.forEach((s, idx) => {
      rankMap[s.team_id] = idx + 1;
    });

    const teamRows = eligibleTeamsList.map(t => {
      const rt = (r3Teams || []).find(r => r.team_id === t.id);
      const teamBoxes = (r3Boxes || []).filter(b => b.team_id === t.id);
      const teamAttempts = (r3Attempts || []).filter(a => a.team_id === t.id);

      const zoneName = rt?.zone ? (zoneMap[rt.zone] || `Zone ${rt.zone}`) : 'Unassigned';
      const scan = rt?.scanned_ms
        ? {
            at: rt.scanned_at,
            ms: rt.scanned_ms,
            by: rt.scanned_by,
            credited: rt.scan_credited,
          }
        : null;

      const boxesList = [1, 2, 3, 4].map(boxNum => {
        const bRow = teamBoxes.find(b => b.box === boxNum);
        const currentEpoch = bRow?.epoch ?? 1;
        const boxAttempts = teamAttempts.filter(a => a.box === boxNum && a.epoch === currentEpoch);
        const wrongAttempts = teamAttempts
          .filter(a => a.box === boxNum && !a.correct)
          .map(a => ({ value: a.value, at: a.created_at }));

        let status: 'open' | 'solved' | 'locked' = 'open';
        if (bRow?.solved_ms) status = 'solved';
        else if (bRow?.locked) status = 'locked';

        return {
          box: boxNum,
          status,
          solvedAt: bRow?.solved_at ?? null,
          solvedMs: bRow?.solved_ms ?? null,
          credited: bRow?.credited ?? false,
          triesUsed: boxAttempts.length,
          wrongValues: wrongAttempts,
        };
      });

      const milestones = (rt?.scanned_ms ? 1 : 0) + teamBoxes.filter(b => b.solved_ms).length;
      let teamState: 'searching' | 'solving' | 'finished' = 'searching';
      if (rt?.finished_ms) teamState = 'finished';
      else if (rt?.scanned_ms) teamState = 'solving';

      return {
        rank: rankMap[t.id] ?? 999,
        teamId: t.id,
        teamName: t.name,
        zoneName,
        scan,
        boxes: boxesList,
        milestones,
        state: teamState,
      };
    });

    // Sort teams by rank
    teamRows.sort((a, b) => a.rank - b.rank);

    let winnerName = undefined;
    if (r3Result?.winner_team_id) {
      winnerName = allTeams?.find(t => t.id === r3Result.winner_team_id)?.name || r3Result.winner_team_id;
    }

    round3Data = {
      phase: state.phase,
      startMs: state.r3_start_ms,
      endMs: state.r3_end_ms,
      result: r3Result?.reason ? {
        winnerTeamId: r3Result.winner_team_id,
        winnerTeamName: winnerName,
        reason: r3Result.reason,
        decidedMs: r3Result.decided_ms,
        decidedAt: r3Result.decided_at,
      } : null,
      codeSet: !r3Config?.code?.includes('[PLACEHOLDER]') && /^[1-9][A-Z]{3}$/.test(r3Config?.code || ''),
      teams: teamRows,
    };
  }

  return NextResponse.json({
    ok: true,
    clock,
    state: {
      phase: state.phase,
      pausedAt: state.paused_at,
      pausedTotalMs: state.paused_total_ms,
      r1EndMs: state.r1_end_ms,
      r2StartMs: state.r2_start_ms,
      run2OpenMs: state.run2_open_ms,
      r2HardEndMs: state.r2_hard_end_ms,
      breakEndMs: state.break_end_ms,
      r3StartMs: state.r3_start_ms,
      r3EndMs: state.r3_end_ms,
    },
    primaryAction,
    stats: {
      totalTeams: teams?.length || 0,
      qualifiedTeams: qualifiedCount,
      activeQRs: qrs?.filter(q => q.active).length || 0,
    },
    round3: round3Data,
    teams: (teams || []).map(t => {
      const runs = (teamRuns || []).filter(r => r.team_id === t.id);
      const r2Stat = r2StatsMap[t.id];
      return {
        ...t,
        runs,
        r2Points: r2Stat ? r2Stat.points : null,
        r2Rank: r2Stat ? r2Stat.rank : null,
        r2LastMs: r2Stat ? r2Stat.lastMs : null,
      };
    }),
    qrs: (qrs || []).map(q => ({
      ...q,
      run1Count: qrCounts[q.id]?.run1 || 0,
      run2Count: qrCounts[q.id]?.run2 || 0,
    })),
  });
}
