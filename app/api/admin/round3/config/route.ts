export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';

const putSchema = z.object({
  code: z.string().optional(),
  hintText: z.string().optional(),
});

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  const { data: config, error } = await db
    .from('r3_config')
    .select('code, hint_text')
    .eq('id', 1)
    .single();

  if (error || !config) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error?.message || 'Config not found' });
  }

  return NextResponse.json({
    ok: true,
    code: config.code,
    hintText: config.hint_text,
  });
}

export async function PUT(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
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

  const { code, hintText } = parsed.data;

  if (code !== undefined) {
    const { data: codeRes, error: codeErr } = await db.rpc('r3_set_code', {
      p_code: code,
      p_admin_id: session.adminId,
    });
    if (codeErr) {
      return NextResponse.json({ ok: false, code: 'DB_ERROR', message: codeErr.message });
    }
    if (codeRes && !codeRes.ok) {
      return NextResponse.json(codeRes);
    }
  }

  if (hintText !== undefined) {
    const { data: hintRes, error: hintErr } = await db.rpc('r3_set_hint', {
      p_hint: hintText,
      p_admin_id: session.adminId,
    });
    if (hintErr) {
      return NextResponse.json({ ok: false, code: 'DB_ERROR', message: hintErr.message });
    }
    if (hintRes && !hintRes.ok) {
      return NextResponse.json(hintRes);
    }
  }

  return NextResponse.json({ ok: true, message: 'Round 3 config updated' });
}
