export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminSession } from '@/lib/session';

export async function POST() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Admin session required' }, { status: 401 });
  }

  const { data, error } = await db.rpc('r3_randomize_zones', {
    p_admin_id: session.adminId,
  });

  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message });
  }

  return NextResponse.json(data);
}
