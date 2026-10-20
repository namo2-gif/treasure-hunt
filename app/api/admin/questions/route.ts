export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withAdmin } from '@/lib/admin-api';

const optionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

const createQuestionSchema = z.object({
  run: z.union([z.literal(1), z.literal(2)]),
  slot: z.number().int().min(1).max(5),
  variant: z.number().int().min(1),
  qrId: z.number().int().positive(),
  stem: z.string().min(1),
  options: z.array(optionSchema).min(2),
  correctOptionId: z.string().min(1),
});

export const GET = withAdmin(async () => {
  const { data: questions, error } = await db
    .from('questions')
    .select('id, run, slot, variant, qr_id, stem, options, correct_option_id, qr_locations(name)')
    .order('run')
    .order('slot')
    .order('variant');

  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  // Check which questions have attempts
  const { data: attempted } = await db
    .from('attempts')
    .select('question_id')
    .not('question_id', 'is', null);

  const attemptedIds = new Set((attempted || []).map((a) => a.question_id));

  return NextResponse.json({
    ok: true,
    questions: (questions || []).map((q: any) => ({
      id: q.id,
      run: q.run,
      slot: q.slot,
      variant: q.variant,
      qrId: q.qr_id,
      qrName: q.qr_locations?.name ?? 'Unknown',
      stem: q.stem,
      options: q.options,
      correctOptionId: q.correct_option_id,
      hasAttempts: attemptedIds.has(q.id),
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

  const parsed = createQuestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message || 'Validation failed' },
      { status: 400 }
    );
  }

  const { run, slot, variant, qrId, stem, options, correctOptionId } = parsed.data;

  // Validate that correctOptionId exists in options
  if (!options.some((o) => o.id === correctOptionId)) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_CORRECT_OPTION', message: 'correctOptionId must match one of the option IDs' },
      { status: 400 }
    );
  }

  // Verify QR exists
  const { data: qr } = await db.from('qr_locations').select('id').eq('id', qrId).single();
  if (!qr) {
    return NextResponse.json({ ok: false, code: 'INVALID_QR', message: 'QR location not found' }, { status: 400 });
  }

  const { data, error } = await db
    .from('questions')
    .insert({
      run,
      slot,
      variant,
      qr_id: qrId,
      stem,
      options,
      correct_option_id: correctOptionId,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { ok: false, code: 'DUPLICATE', message: `Question for run ${run}, slot ${slot}, variant ${variant} already exists` },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'create_question',
    target: String(data.id),
    before: null,
    after: JSON.stringify({ run, slot, variant, qrId, stem }),
  });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
});
