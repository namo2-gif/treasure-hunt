export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  const [{ data: r1Standings }, { data: r2Standings }, { data: adjustments }, { data: state }] = await Promise.all([
    db.from('r1_standings').select('team_id, points, last_ms').order('points', { ascending: false }),
    db.from('r2_standings').select('team_id, points, last_ms').order('points', { ascending: false }),
    db.from('score_adjustments').select('team_id, points'),
    db.from('event_state').select('r2_start_ms').eq('id', 1).single(),
  ]);

  const adjMap: Record<string, number> = {};
  if (adjustments) {
    for (const a of adjustments) {
      adjMap[a.team_id] = (adjMap[a.team_id] || 0) + a.points;
    }
  }

  // Rank computation with ties (standard rank() behavior)
  function rankList(rows: { team_id: string; points: number; last_ms: number | null }[]) {
    const sorted = [...rows].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const aMs = a.last_ms ?? Number.MAX_SAFE_INTEGER;
      const bMs = b.last_ms ?? Number.MAX_SAFE_INTEGER;
      return aMs - bMs;
    });

    let rank = 1;
    return sorted.map((row, i) => {
      if (i > 0) {
        const prev = sorted[i - 1];
        const sameRank = prev.points === row.points && prev.last_ms === row.last_ms;
        if (!sameRank) rank = i + 1;
      }
      return {
        rank,
        teamId: row.team_id,
        points: row.points,
        lastMs: row.last_ms,
        adjustments: adjMap[row.team_id] || 0,
      };
    });
  }

  const r1 = rankList(r1Standings || []);
  const r2 = rankList(r2Standings || []);

  return NextResponse.json({
    ok: true,
    r2StartMs: state?.r2_start_ms,
    r1,
    r2,
  });
}
