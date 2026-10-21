export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getPlayerSession } from '@/lib/session';
import { submitAnswer } from '@/lib/game-service';

const schema = z.object({
  kind: z.enum(['r1', 'r2']),
  key: z.number().int(),
  optionId: z.string().min(1).max(4),
  requestId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const session = await getPlayerSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'You must be logged in to access this.' }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid request' }, { status: 400 });
  }
  const { kind, key, optionId, requestId } = parsed.data;
  const res = await submitAnswer(db, session.sid, kind, key, optionId, requestId);
  if (kind === 'r1' && res.ok) {
    return NextResponse.json({ ok: true, status: 'recorded', runFinished: false });
  }
  return NextResponse.json(res);
}
