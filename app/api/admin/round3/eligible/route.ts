export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';

const postSchema = z.object({
  teamId: z.string().min(1, 'teamId is required'),
  eligible: z.boolean(),
});

export async function POST(request: NextRequest) {
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

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message || 'Validation failed' }, { status: 400 });
  }

  const { teamId, eligible } = parsed.data;

  const { data, error } = await db.rpc('set_r3_eligible', {
    p_team: teamId,
    p_eligible: eligible,
    p_admin_id: session.adminId,
  });

  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message });
  }

  return NextResponse.json(data);
}
