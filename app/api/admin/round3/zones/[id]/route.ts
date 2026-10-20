export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';
import crypto from 'crypto';

const putSchema = z.object({
  name: z.string().optional(),
  findRiddle: z.string().optional(),
  action: z.enum(['regenerate-token']).optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  const { id } = await params;
  const zoneId = parseInt(id, 10);
  if (isNaN(zoneId) || zoneId < 1 || zoneId > 5) {
    return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'Zone ID must be between 1 and 5' }, { status: 400 });
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

  const { name, findRiddle, action } = parsed.data;

  // Fetch current zone row
  const { data: currentZone, error: fetchErr } = await db
    .from('r3_zones')
    .select('id, name, token, find_riddle')
    .eq('id', zoneId)
    .single();

  if (fetchErr || !currentZone) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: 'Zone not found' }, { status: 404 });
  }

  const updates: Record<string, string> = {};
  if (name !== undefined) updates.name = name;
  if (findRiddle !== undefined) updates.find_riddle = findRiddle;
  if (action === 'regenerate-token') {
    updates.token = crypto.randomBytes(16).toString('base64url');
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, message: 'Nothing to update' });
  }

  const { error: updateErr } = await db
    .from('r3_zones')
    .update(updates)
    .eq('id', zoneId);

  if (updateErr) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: updateErr.message });
  }

  // Log action
  await db.from('admin_log').insert({
    admin_id: session.adminId,
    action: action === 'regenerate-token' ? 'r3_zone_regenerate_token' : 'r3_zone_update',
    target: `zone:${zoneId}`,
    before: currentZone,
    after: { ...currentZone, ...updates },
  });

  return NextResponse.json({ ok: true, zone: { ...currentZone, ...updates } });
}
