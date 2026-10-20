export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withAdmin } from '@/lib/admin-api';

const createQrSchema = z.object({
  name: z.string().min(1).trim(),
  capacity: z.number().int().positive().optional().default(12),
});

export const GET = withAdmin(async () => {
  const { data: qrs, error } = await db
    .from('qr_locations')
    .select('id, name, token, capacity, active')
    .order('id');

  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  // Count live registrations per run
  const { data: registrations } = await db
    .from('registrations')
    .select('qr_id, run');

  const counts: Record<number, { run1: number; run2: number }> = {};
  if (qrs) {
    for (const qr of qrs) {
      counts[qr.id] = { run1: 0, run2: 0 };
    }
  }
  if (registrations) {
    for (const reg of registrations) {
      if (counts[reg.qr_id]) {
        if (reg.run === 1) counts[reg.qr_id].run1++;
        if (reg.run === 2) counts[reg.qr_id].run2++;
      }
    }
  }

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  return NextResponse.json({
    ok: true,
    qrs: (qrs || []).map((q) => ({
      id: q.id,
      name: q.name,
      token: q.token,
      capacity: q.capacity,
      active: q.active,
      registeredRun1: counts[q.id]?.run1 ?? 0,
      registeredRun2: counts[q.id]?.run2 ?? 0,
      scanUrl: `${baseUrl}/s/${q.token}`,
    })),
  });
});

export const POST = withAdmin(async (request: NextRequest, { session }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createQrSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'Name is required' }, { status: 400 });
  }

  const token = crypto.randomBytes(16).toString('base64url');

  const { data, error } = await db
    .from('qr_locations')
    .insert({
      name: parsed.data.name,
      token,
      capacity: parsed.data.capacity,
      active: true,
    })
    .select('id, name, token, capacity, active')
    .single();

  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'create_qr',
    target: String(data.id),
    before: null,
    after: JSON.stringify({ name: data.name, capacity: data.capacity }),
  });

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  return NextResponse.json(
    {
      ok: true,
      qr: {
        ...data,
        registeredRun1: 0,
        registeredRun2: 0,
        scanUrl: `${baseUrl}/s/${data.token}`,
      },
    },
    { status: 201 }
  );
});
