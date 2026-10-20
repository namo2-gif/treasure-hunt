export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  // Load qualified, non-withdrawn teams, R2 standings, and R3 team assignments
  const [teamsRes, r2Res, r3TeamRes, settingsRes] = await Promise.all([
    db.from('teams').select('id, name, r3_eligible, withdrawn, qualified').eq('qualified', true).eq('withdrawn', false),
    db.from('r2_standings').select('team_id, points, last_ms'),
    db.from('r3_team').select('team_id, zone'),
    db.from('settings').select('key, value').eq('key', 'top_n_r3').single(),
  ]);

  if (teamsRes.error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: teamsRes.error.message });
  }

  const topN = settingsRes.data?.value ? parseInt(String(settingsRes.data.value), 10) : 5;
  const r2Map = new Map((r2Res.data || []).map((r) => [r.team_id, { points: r.points, lastMs: r.last_ms }]));
  const r3TeamMap = new Map((r3TeamRes.data || []).map((r) => [r.team_id, r.zone]));

  // Sort by points desc, last_ms asc nulls last, team_id asc
  const sorted = [...(teamsRes.data || [])].sort((a, b) => {
    const statA = r2Map.get(a.id) || { points: 0, lastMs: null };
    const statB = r2Map.get(b.id) || { points: 0, lastMs: null };
    if (statB.points !== statA.points) return statB.points - statA.points;
    const aMs = statA.lastMs ?? Number.MAX_SAFE_INTEGER;
    const bMs = statB.lastMs ?? Number.MAX_SAFE_INTEGER;
    if (aMs !== bMs) return aMs - bMs;
    return a.id.localeCompare(b.id);
  });

  // Calculate ranks
  let currentRank = 1;
  const teamList = sorted.map((t, i) => {
    const stat = r2Map.get(t.id) || { points: 0, lastMs: null };
    if (i > 0) {
      const prevT = sorted[i - 1];
      const prevStat = r2Map.get(prevT.id) || { points: 0, lastMs: null };
      const same = prevStat.points === stat.points && prevStat.lastMs === stat.lastMs;
      if (!same) {
        currentRank = i + 1;
      }
    }
    return {
      id: t.id,
      name: t.name,
      rank: currentRank,
      points: stat.points,
      lastMs: stat.lastMs,
      eligible: !!t.r3_eligible,
      zone: r3TeamMap.get(t.id) || null,
      tiedAtCutoff: false,
    };
  });

  // Flag tie at cutoff: if team at index topN-1 and index topN have identical points & lastMs
  if (teamList.length > topN) {
    const cutoffTeam = teamList[topN - 1];
    const afterCutoff = teamList[topN];
    if (cutoffTeam.points === afterCutoff.points && cutoffTeam.lastMs === afterCutoff.lastMs) {
      for (const t of teamList) {
        if (t.points === cutoffTeam.points && t.lastMs === cutoffTeam.lastMs) {
          t.tiedAtCutoff = true;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    topN,
    teams: teamList,
  });
}
