export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withAdmin } from '@/lib/admin-api';

const updateQrSchema = z.object({
  name: z.string().min(1).trim().optional(),
  capacity: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  regenerateToken: z.boolean().optional(),
});

export const GET = withAdmin(async (request: NextRequest, { params }) => {
  const { id: rawId } = await params;
  const qrId = parseInt(rawId as string, 10);
  if (isNaN(qrId)) {
    return NextResponse.json({ ok: false, code: 'INVALID_ID', message: 'QR ID must be an integer' }, { status: 400 });
  }

  const { data: qr, error } = await db
    .from('qr_locations')
    .select('*')
    .eq('id', qrId)
    .single();

  if (error || !qr) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: 'QR location not found' }, { status: 404 });
  }

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  return NextResponse.json({
    ok: true,
    qr: {
      ...qr,
      scanUrl: `${baseUrl}/s/${qr.token}`,
    },
  });
});

async function handleUpdate(
  request: NextRequest,
  params: Promise<Record<string, string | string[]>>,
  session: { aid: number }
) {
  const { id: rawId } = await params;
  const qrId = parseInt(rawId as string, 10);
  if (isNaN(qrId)) {
    return NextResponse.json({ ok: false, code: 'INVALID_ID', message: 'QR ID must be an integer' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = updateQrSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid update fields' }, { status: 400 });
  }

  const { data: existing, error: findError } = await db
    .from('qr_locations')
    .select('*')
    .eq('id', qrId)
    .single();

  if (findError || !existing) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: 'QR location not found' }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.capacity !== undefined) updates.capacity = parsed.data.capacity;
  if (parsed.data.active !== undefined) updates.active = parsed.data.active;
  if (parsed.data.regenerateToken) {
    updates.token = crypto.randomBytes(16).toString('base64url');
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, qr: existing });
  }

  const { data: updated, error: updateError } = await db
    .from('qr_locations')
    .update(updates)
    .eq('id', qrId)
    .select('id, name, token, capacity, active')
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: updateError?.message || 'Update failed' }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'edit_qr',
    target: String(qrId),
    before: JSON.stringify({ name: existing.name, capacity: existing.capacity, active: existing.active, token: existing.token }),
    after: JSON.stringify(updates),
  });

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  return NextResponse.json({
    ok: true,
    qr: {
      ...updated,
      scanUrl: `${baseUrl}/s/${updated.token}`,
    },
  });
}

export const PUT = withAdmin(async (req, { params, session }) => {
  return handleUpdate(req, params, session);
});

export const PATCH = withAdmin(async (req, { params, session }) => {
  return handleUpdate(req, params, session);
});

export const DELETE = withAdmin(async (request: NextRequest, { params, session }) => {
  const { id: rawId } = await params;
  const qrId = parseInt(rawId as string, 10);
  if (isNaN(qrId)) {
    return NextResponse.json({ ok: false, code: 'INVALID_ID', message: 'QR ID must be an integer' }, { status: 400 });
  }

  // Check if questions reference this QR
  const { count } = await db
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('qr_id', qrId);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { ok: false, code: 'IN_USE', message: 'Cannot delete QR location referenced by questions' },
      { status: 400 }
    );
  }

  // Check if registrations reference this QR
  const { count: regCount } = await db
    .from('registrations')
    .select('id', { count: 'exact', head: true })
    .eq('qr_id', qrId);

  if ((regCount ?? 0) > 0) {
    return NextResponse.json(
      { ok: false, code: 'IN_USE', message: 'Cannot delete QR location with existing registrations' },
      { status: 400 }
    );
  }

  const { error } = await db.from('qr_locations').delete().eq('id', qrId);
  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'delete_qr',
    target: String(qrId),
    before: null,
    after: null,
  });

  return NextResponse.json({ ok: true });
});
