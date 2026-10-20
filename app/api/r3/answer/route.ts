export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getPlayerSession } from '@/lib/session';
import { submitR3Box } from '@/lib/game-service';

const answerSchema = z.object({
  box: z.number().int(),
  value: z.string().max(8),
  requestId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const session = await getPlayerSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHORIZED', message: 'You must be logged in to submit.' },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION_ERROR', message: 'Valid box, value and requestId are required' },
      { status: 400 }
    );
  }

  const { box, value, requestId } = parsed.data;
  const result = await submitR3Box(db, session.sid, box, value, requestId);
  return NextResponse.json(result);
}
