export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withAdmin } from '@/lib/admin-api';

const putSchema = z.object({
  code: z.string().regex(/^[1-9][A-Z]{3}$/, 'Must be 1 digit followed by 3 uppercase letters').optional(),
  hintText: z.string().optional(),
  // For backwards compatibility with older admin forms
  clueText: z.string().optional(),
  passwordNorm: z.string().optional(),
  keyInfo: z.string().optional(),
  room: z.string().optional(),
});

export const GET = withAdmin(async () => {
  const { data: config } = await db.from('r3_config').select('code, hint_text').eq('id', 1).maybeSingle();

  return NextResponse.json({
    ok: true,
    code: config?.code || '1DAI',
    hintText: config?.hint_text || '',
    // legacy compatibility
    clueText: config?.hint_text || '',
    passwordNorm: config?.code || '',
    keyInfo: 'Configured in /hq/round3',
    room: 'Configured in /hq/round3',
  });
});

export const PUT = withAdmin(async (req: NextRequest, { session }) => {
  let body: unknown = {};
  const text = await req.text();
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid JSON body' }, { status: 400 });
    }
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message || 'Validation failed' },
      { status: 400 }
    );
  }

  const { code, hintText, passwordNorm, clueText } = parsed.data;
  const targetCode = (code || passwordNorm)?.trim().toUpperCase();
  const targetHint = hintText !== undefined ? hintText : clueText;

  const updates: Record<string, unknown> = {};
  if (targetCode && /^[1-9][A-Z]{3}$/.test(targetCode)) {
    updates.code = targetCode;
  }
  if (targetHint !== undefined) {
    updates.hint_text = targetHint;
  }

  if (Object.keys(updates).length > 0) {
    const { data: before } = await db.from('r3_config').select('*').eq('id', 1).maybeSingle();
    await db.from('r3_config').update(updates).eq('id', 1);
    await db.from('admin_log').insert({
      admin_id: session.aid,
      action: 'edit_round3_config',
      target: 'r3_config',
      before: JSON.stringify(before),
      after: JSON.stringify(updates),
    });
  }

  return NextResponse.json({ ok: true });
});
