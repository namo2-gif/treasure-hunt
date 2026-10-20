export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withAdmin } from '@/lib/admin-api';

function normalizeAnswer(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

const updateSchema = z.object({
  pieces: z.array(z.string().min(1)).optional(),
  answerNorm: z.string().min(1).optional(),
});

export const GET = withAdmin(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const teaserId = parseInt(id as string, 10);
  if (isNaN(teaserId)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid teaser ID' }, { status: 400 });
  }

  const { data: teaser, error } = await db
    .from('teaser_puzzles')
    .select('id, run, size, pieces, answer_norm')
    .eq('id', teaserId)
    .single();

  if (error || !teaser) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: 'Teaser not found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    teaser: {
      id: teaser.id,
      run: teaser.run,
      size: teaser.size,
      pieces: teaser.pieces,
      answerNorm: teaser.answer_norm,
    },
  });
});

async function handleUpdate(
  request: NextRequest,
  params: Promise<Record<string, string | string[]>>,
  session: { aid: number }
) {
  const { id } = await params;
  const teaserId = parseInt(id as string, 10);
  if (isNaN(teaserId)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid teaser ID' }, { status: 400 });
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

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message || 'Validation failed' },
      { status: 400 }
    );
  }

  const { data: teaser } = await db
    .from('teaser_puzzles')
    .select('id, size, pieces, answer_norm')
    .eq('id', teaserId)
    .single();

  if (!teaser) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: 'Teaser not found' }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  const { pieces, answerNorm } = parsed.data;

  if (pieces !== undefined) {
    if (pieces.length !== teaser.size) {
      return NextResponse.json(
        { ok: false, code: 'INVALID_PIECES_COUNT', message: `Pieces count (${pieces.length}) must match size (${teaser.size})` },
        { status: 400 }
      );
    }
    updates.pieces = pieces;
  }

  if (answerNorm !== undefined) {
    updates.answer_norm = normalizeAnswer(answerNorm);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, message: 'Nothing to update' });
  }

  const { error } = await db.from('teaser_puzzles').update(updates).eq('id', teaserId);
  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'edit_teaser',
    target: String(teaserId),
    before: JSON.stringify({ pieces: teaser.pieces, answerNorm: teaser.answer_norm }),
    after: JSON.stringify(updates),
  });

  return NextResponse.json({ ok: true });
}

export const PUT = withAdmin(async (req, { params, session }) => {
  return handleUpdate(req, params, session);
});

export const PATCH = withAdmin(async (req, { params, session }) => {
  return handleUpdate(req, params, session);
});

export const DELETE = withAdmin(async (request: NextRequest, { params, session }) => {
  const { id } = await params;
  const teaserId = parseInt(id as string, 10);
  if (isNaN(teaserId)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid teaser ID' }, { status: 400 });
  }

  const { error } = await db.from('teaser_puzzles').delete().eq('id', teaserId);
  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'delete_teaser',
    target: String(teaserId),
    before: JSON.stringify({ teaserId }),
    after: null,
  });

  return NextResponse.json({ ok: true });
});
