export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';

const overrideSchema = z.object({
  teamId: z.string().min(1, 'teamId is required'),
  box: z.number().int().min(1).max(4).optional(),
  zone: z.number().int().min(1).max(5).optional(),
  reason: z.string().min(1, 'Reason is required'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  const { action } = await params;

  let body: unknown = {};
  const text = await request.text();
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid JSON body' }, { status: 400 });
    }
  }

  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message || 'Validation failed' }, { status: 400 });
  }

  const { teamId, box, zone, reason } = parsed.data;

  let result: any = null;
  let rpcErr: any = null;

  switch (action) {
    case 'credit-scan': {
      const res = await db.rpc('r3_credit_scan', {
        p_team: teamId,
        p_reason: reason,
        p_admin_id: session.adminId,
      });
      result = res.data;
      rpcErr = res.error;
      break;
    }

    case 'credit-box': {
      if (!box) {
        return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'box (1-4) is required for credit-box' }, { status: 400 });
      }
      const res = await db.rpc('r3_credit_box', {
        p_team: teamId,
        p_box: box,
        p_reason: reason,
        p_admin_id: session.adminId,
      });
      result = res.data;
      rpcErr = res.error;
      break;
    }

    case 'reset-box': {
      if (!box) {
        return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'box (1-4) is required for reset-box' }, { status: 400 });
      }
      const res = await db.rpc('r3_reset_box', {
        p_team: teamId,
        p_box: box,
        p_reason: reason,
        p_admin_id: session.adminId,
      });
      result = res.data;
      rpcErr = res.error;
      break;
    }

    case 'reassign-zone': {
      if (!zone) {
        return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', message: 'zone (1-5) is required for reassign-zone' }, { status: 400 });
      }
      const res = await db.rpc('r3_reassign_zone', {
        p_team: teamId,
        p_zone: zone,
        p_reason: reason,
        p_admin_id: session.adminId,
      });
      result = res.data;
      rpcErr = res.error;
      break;
    }

    default:
      return NextResponse.json({ ok: false, code: 'INVALID_ACTION', message: `Unknown override action: ${action}` }, { status: 400 });
  }

  if (rpcErr) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: rpcErr.message });
  }

  return NextResponse.json(result);
}
