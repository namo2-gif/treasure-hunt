export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';

const putSchema = z.object({
  text: z.string().min(1, 'Riddle text cannot be empty'),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ zone: string; box: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  const { zone, box } = await params;
  const zoneId = parseInt(zone, 10);
  const boxNo = parseInt(box, 10);

  if (isNaN(zoneId) || zoneId < 1 || zoneId > 5 || isNaN(boxNo) || boxNo < 1 || boxNo > 4) {
    return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'Zone must be 1-5 and box must be 1-4' }, { status: 400 });
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
    return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message || 'Validation failed' }, { status: 400 });
  }

  const { text: riddleText } = parsed.data;

  const { data: currentRiddle } = await db
    .from('r3_riddles')
    .select('zone, box, text')
    .eq('zone', zoneId)
    .eq('box', boxNo)
    .single();

  const { error: updateErr } = await db
    .from('r3_riddles')
    .update({ text: riddleText })
    .eq('zone', zoneId)
    .eq('box', boxNo);

  if (updateErr) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: updateErr.message });
  }

  await db.from('admin_log').insert({
    admin_id: session.adminId,
    action: 'r3_riddle_update',
    target: `zone:${zoneId}:box:${boxNo}`,
    before: currentRiddle,
    after: { zone: zoneId, box: boxNo, text: riddleText },
  });

  return NextResponse.json({ ok: true, message: 'Box riddle updated' });
}
