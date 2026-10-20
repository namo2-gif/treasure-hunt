export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withAdmin } from '@/lib/admin-api';

function normalizeAnswer(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

const createTeaserSchema = z.object({
  run: z.union([z.literal(1), z.literal(2)]),
  size: z.number().int().min(3).max(5),
  pieces: z.array(z.string().min(1)),
  answerNorm: z.string().min(1),
});

export const GET = withAdmin(async () => {
  const { data: teasers, error } = await db
    .from('teaser_puzzles')
    .select('id, run, size, pieces, answer_norm')
    .order('run')
    .order('size');

  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    teasers: (teasers || []).map((t) => ({
      id: t.id,
      run: t.run,
      size: t.size,
      pieces: t.pieces,
      answerNorm: t.answer_norm,
    })),
  });
});

export const POST = withAdmin(async (request: NextRequest, { session }) => {
  let body: unknown = {};
  const text = await request.text();
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid JSON body' }, { status: 400 });
    }
  }

  const parsed = createTeaserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message || 'Validation failed' },
      { status: 400 }
    );
  }

  const { run, size, pieces, answerNorm } = parsed.data;

  if (pieces.length !== size) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_PIECES_COUNT', message: `Pieces count (${pieces.length}) must match size (${size})` },
      { status: 400 }
    );
  }

  const norm = normalizeAnswer(answerNorm);

  const { data, error } = await db
    .from('teaser_puzzles')
    .insert({
      run,
      size,
      pieces,
      answer_norm: norm,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { ok: false, code: 'DUPLICATE', message: `Teaser puzzle for run ${run}, size ${size} already exists` },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'create_teaser',
    target: String(data.id),
    before: null,
    after: JSON.stringify({ run, size, answerNorm: norm }),
  });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
});
