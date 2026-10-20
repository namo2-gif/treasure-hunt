export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';

function toCSV(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const escape = (v: string | number | boolean | null | undefined): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(','), ...rows.map((r) => r.map(escape).join(','))];
  return lines.join('\n');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  const { name } = await params;

  if (name === 'registrations') {
    const { data, error } = await db
      .from('registrations')
      .select('id, run, team_id, student_id, qr_id, slot_no, created_ms, qr_locations(name)')
      .order('id');

    if (error) {
      return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message });
    }

    const csv = toCSV(
      ['id', 'run', 'team_id', 'student_id', 'qr_id', 'qr_name', 'slot_no', 'created_ms'],
      (data || []).map((r: any) => [r.id, r.run, r.team_id, r.student_id, r.qr_id, r.qr_locations?.name ?? '', r.slot_no, r.created_ms])
    );

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="registrations.csv"',
      },
    });
  }

  if (name === 'attempts') {
    const { data, error } = await db
      .from('attempts')
      .select('id, request_id, team_id, student_id, riddle_id, question_id, option_id, try_no, correct, points, created_ms')
      .order('id');

    if (error) {
      return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message });
    }

    const csv = toCSV(
      ['id', 'request_id', 'team_id', 'student_id', 'item_type', 'item_id', 'option_id', 'try_no', 'correct', 'points', 'created_ms'],
      (data || []).map((a: any) => [
        a.id,
        a.request_id,
        a.team_id,
        a.student_id,
        a.riddle_id != null ? 'r1' : 'r2',
        a.riddle_id ?? a.question_id,
        a.option_id,
        a.try_no,
        a.correct,
        a.points,
        a.created_ms,
      ])
    );

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="attempts.csv"',
      },
    });
  }

  if (name === 'standings') {
    const [{ data: r1 }, { data: r2 }] = await Promise.all([
      db.from('r1_standings').select('team_id, points, last_ms').order('points', { ascending: false }),
      db.from('r2_standings').select('team_id, points, last_ms').order('points', { ascending: false }),
    ]);

    // Compute rank with ties
    function rankRows(rows: { team_id: string; points: number; last_ms: number | null }[]) {
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
        return { rank, ...row };
      });
    }

    const r1Ranked = rankRows(r1 || []);
    const r2Ranked = rankRows(r2 || []);

    const lines: string[] = [
      '# R1 Standings',
      'rank,team_id,points,last_ms',
      ...r1Ranked.map((r) => `${r.rank},${r.team_id},${r.points},${r.last_ms ?? ''}`),
      '',
      '# R2 Standings',
      'rank,team_id,points,last_ms',
      ...r2Ranked.map((r) => `${r.rank},${r.team_id},${r.points},${r.last_ms ?? ''}`),
    ];

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="standings.csv"',
      },
    });
  }

  if (name === 'r3') {
    // CSV: team, zone, scan_time, scanned_by, box1_time .. box4_time, wrong_values_per_box, milestones, rank
    const [{ data: r3Teams }, { data: boxes }, { data: attempts }, { data: standings }] = await Promise.all([
      db.from('r3_team').select('team_id, zone, scanned_at, scanned_ms, scanned_by, r3_zones(name)').order('team_id'),
      db.from('r3_boxes').select('team_id, box, solved_at, solved_ms, credited').order('box'),
      db.from('r3_attempts').select('team_id, box, value, correct, created_at').order('created_ms'),
      db.from('r3_standings').select('team_id, milestones, last_seq'),
    ]);

    // Rank standings by milestones desc, last_seq asc nulls last, team_id
    const sortedStandings = [...(standings || [])].sort((a, b) => {
      if (b.milestones !== a.milestones) return b.milestones - a.milestones;
      const aSeq = a.last_seq ?? Number.MAX_SAFE_INTEGER;
      const bSeq = b.last_seq ?? Number.MAX_SAFE_INTEGER;
      if (aSeq !== bSeq) return aSeq - bSeq;
      return a.team_id.localeCompare(b.team_id);
    });

    const rankMap: Record<string, { rank: number; milestones: number }> = {};
    sortedStandings.forEach((s, idx) => {
      rankMap[s.team_id] = { rank: idx + 1, milestones: s.milestones };
    });

    const rows = (r3Teams || []).map((t: any) => {
      const teamBoxes = (boxes || []).filter((b: any) => b.team_id === t.team_id);
      const teamAttempts = (attempts || []).filter((a: any) => a.team_id === t.team_id);

      const boxTimes: (string | null)[] = [null, null, null, null];
      for (let b = 1; b <= 4; b++) {
        const found = teamBoxes.find((tb: any) => tb.box === b);
        if (found && found.solved_at) {
          boxTimes[b - 1] = found.solved_at;
        }
      }

      // wrong_values_per_box: e.g. "b1:X; b2:Y,Z"
      const wrongByBox: string[] = [];
      for (let b = 1; b <= 4; b++) {
        const wrongs = teamAttempts
          .filter((a: any) => a.box === b && !a.correct)
          .map((a: any) => a.value);
        if (wrongs.length > 0) {
          wrongByBox.push(`box${b}:[${wrongs.join(';')}]`);
        }
      }

      const st = rankMap[t.team_id];
      return [
        t.team_id,
        t.r3_zones?.name ?? (t.zone ? `Zone ${t.zone}` : ''),
        t.scanned_at ?? '',
        t.scanned_by ?? '',
        boxTimes[0] ?? '',
        boxTimes[1] ?? '',
        boxTimes[2] ?? '',
        boxTimes[3] ?? '',
        wrongByBox.join(' | '),
        st?.milestones ?? 0,
        st?.rank ?? '',
      ];
    });

    const csv = toCSV(
      [
        'team',
        'zone',
        'scan_time',
        'scanned_by',
        'box1_time',
        'box2_time',
        'box3_time',
        'box4_time',
        'wrong_values_per_box',
        'milestones',
        'rank',
      ],
      rows
    );

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="round3.csv"',
      },
    });
  }

  return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: `Unknown export: ${name}` }, { status: 404 });
}
