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

const updateSchema = z.object({
  stem: z.string().min(1).optional(),
  qrId: z.number().int().positive().optional(),
  options: z.array(optionSchema).min(2).optional(),
  correctOptionId: z.string().min(1).optional(),
});

export const GET = withAdmin(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const questionId = parseInt(id as string, 10);
  if (isNaN(questionId)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid question ID' }, { status: 400 });
  }

  const { data: question, error } = await db
    .from('questions')
    .select('id, run, slot, variant, qr_id, stem, options, correct_option_id, qr_locations(name)')
    .eq('id', questionId)
    .single();

  if (error || !question) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: 'Question not found' }, { status: 404 });
  }

  const { count } = await db
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('question_id', questionId);

  return NextResponse.json({
    ok: true,
    question: {
      id: question.id,
      run: question.run,
      slot: question.slot,
      variant: question.variant,
      qrId: question.qr_id,
      qrName: (question as any).qr_locations?.name ?? 'Unknown',
      stem: question.stem,
      options: question.options,
      correctOptionId: question.correct_option_id,
      hasAttempts: (count ?? 0) > 0,
    },
  });
});

async function handleUpdate(
  request: NextRequest,
  params: Promise<Record<string, string | string[]>>,
  session: { aid: number }
) {
  const { id } = await params;
  const questionId = parseInt(id as string, 10);
  if (isNaN(questionId)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid question ID' }, { status: 400 });
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

  const { data: question } = await db
    .from('questions')
    .select('id, stem, options, correct_option_id, qr_id')
    .eq('id', questionId)
    .single();

  if (!question) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: 'Question not found' }, { status: 404 });
  }

  // Check attempts
  const { count } = await db
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('question_id', questionId);

  const hasAttempts = (count ?? 0) > 0;
  const { stem, qrId, options, correctOptionId } = parsed.data;

  if (hasAttempts && (options !== undefined || correctOptionId !== undefined)) {
    return NextResponse.json({
      ok: false,
      code: 'CONTENT_LOCKED',
      message: 'Options and correct answer are locked because attempts exist',
    });
  }

  const updates: Record<string, unknown> = {};
  if (stem !== undefined) updates.stem = stem;
  if (qrId !== undefined) updates.qr_id = qrId;
  if (!hasAttempts) {
    if (options !== undefined) updates.options = options;
    if (correctOptionId !== undefined) updates.correct_option_id = correctOptionId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, message: 'Nothing to update' });
  }

  const { error } = await db.from('questions').update(updates).eq('id', questionId);
  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'edit_question',
    target: String(questionId),
    before: JSON.stringify({ stem: question.stem, qrId: question.qr_id }),
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
  const questionId = parseInt(id as string, 10);
  if (isNaN(questionId)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid question ID' }, { status: 400 });
  }

  const { count } = await db
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('question_id', questionId);

  if ((count ?? 0) > 0) {
    return NextResponse.json({
      ok: false,
      code: 'CONTENT_LOCKED',
      message: 'Cannot delete question with existing attempts',
    });
  }

  const { error } = await db.from('questions').delete().eq('id', questionId);
  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'delete_question',
    target: String(questionId),
    before: JSON.stringify({ questionId }),
    after: null,
  });

  return NextResponse.json({ ok: true });
});
