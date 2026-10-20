export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  const [zonesRes, riddlesRes, configRes] = await Promise.all([
    db.from('r3_zones').select('id, name, token, find_riddle').order('id', { ascending: true }),
    db.from('r3_riddles').select('zone, box, text').order('zone', { ascending: true }).order('box', { ascending: true }),
    db.from('r3_config').select('code, hint_text').eq('id', 1).single(),
  ]);

  if (zonesRes.error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: zonesRes.error.message });
  }
  if (riddlesRes.error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: riddlesRes.error.message });
  }

  return NextResponse.json({
    ok: true,
    zones: (zonesRes.data || []).map((z) => ({
      id: z.id,
      name: z.name,
      token: z.token,
      findRiddle: z.find_riddle,
    })),
    riddles: (riddlesRes.data || []).map((r) => ({
      zone: r.zone,
      box: r.box,
      text: r.text,
    })),
    config: configRes.data
      ? {
          code: configRes.data.code,
          hintText: configRes.data.hint_text,
        }
      : null,
  });
}
