export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';
import { executeEventAction, EventAction } from '@/lib/event-service';

const addTimeSchema = z.object({
  minutes: z.number().int().positive(),
});

const openR3Schema = z.object({
  force: z.boolean().optional(),
});

const resetSchema = z.object({
  confirm: z.literal('RESET'),
});

const validActions: Set<string> = new Set([
  'start-r1',
  'start-round1',
  'end-r1',
  'end-round1',
  'start-r2',
  'start-round2',
  'end-r2',
  'end-round2',
  'open-r3',
  'open-round3',
  'end-event',
  'pause',
  'resume',
  'add-time',
  'reset',
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  const { action: rawAction } = await params;
  const action = rawAction.toLowerCase();

  if (!validActions.has(action)) {
    return NextResponse.json({ ok: false, code: 'INVALID_ACTION', message: `Unknown action: ${rawAction}` }, { status: 400 });
  }

  // Canonicalize aliases
  let canonicalAction = action as EventAction;
  if (action === 'start-round1') canonicalAction = 'start-r1';
  if (action === 'end-round1') canonicalAction = 'end-r1';
  if (action === 'start-round2') canonicalAction = 'start-r2';
  if (action === 'end-round2') canonicalAction = 'end-r2';
  if (action === 'open-round3') canonicalAction = 'open-r3';

  let body: any = {};
  const text = await request.text();
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid JSON body' }, { status: 400 });
    }
  }

  // Validate payloads where required
  if (canonicalAction === 'add-time') {
    const parsed = addTimeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'Field minutes must be a positive integer' }, { status: 400 });
    }
    body = parsed.data;
  } else if (canonicalAction === 'open-r3') {
    const parsed = openR3Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid open-r3 payload' }, { status: 400 });
    }
    body = parsed.data;
  } else if (canonicalAction === 'reset') {
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'Field confirm must be exactly "RESET"' }, { status: 400 });
    }
    body = parsed.data;
  }

  const result = await executeEventAction(db, canonicalAction, session.aid, body);
  return NextResponse.json(result);
}
