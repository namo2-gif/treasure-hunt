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
  position: z.number().int().min(1).optional(),
  text: z.string().min(1).optional(),
  options: z.array(optionSchema).min(2).optional(),
  correctOptionId: z.string().min(1).optional(),
});

export const GET = withAdmin(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const riddleId = parseInt(id as string, 10);
  if (isNaN(riddleId)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid riddle ID' }, { status: 400 });
  }

  const { data: riddle, error } = await db
    .from('riddles')
    .select('id, position, text, options, correct_option_id')
    .eq('id', riddleId)
    .single();

  if (error || !riddle) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: 'Riddle not found' }, { status: 404 });
  }

  const { count } = await db
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('riddle_id', riddleId);

  return NextResponse.json({
    ok: true,
    riddle: {
      id: riddle.id,
      position: riddle.position,
      text: riddle.text,
      options: riddle.options,
      correctOptionId: riddle.correct_option_id,
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
  const riddleId = parseInt(id as string, 10);
  if (isNaN(riddleId)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid riddle ID' }, { status: 400 });
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

  const { data: riddle } = await db
    .from('riddles')
    .select('id, position, text, options, correct_option_id')
    .eq('id', riddleId)
    .single();

  if (!riddle) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: 'Riddle not found' }, { status: 404 });
  }

  // Check if attempts exist (locks options & correctOptionId)
  const { count } = await db
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('riddle_id', riddleId);

  const hasAttempts = (count ?? 0) > 0;
  const { options, correctOptionId, text: stem, position } = parsed.data;

  if (hasAttempts && (options !== undefined || correctOptionId !== undefined)) {
    return NextResponse.json({
      ok: false,
      code: 'CONTENT_LOCKED',
      message: 'Options and correct answer are locked because attempts exist',
    });
  }

  const updates: Record<string, unknown> = {};
  if (stem !== undefined) updates.text = stem;
  if (position !== undefined) updates.position = position;
  if (!hasAttempts) {
    if (options !== undefined) updates.options = options;
    if (correctOptionId !== undefined) updates.correct_option_id = correctOptionId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, message: 'Nothing to update' });
  }

  const { error } = await db.from('riddles').update(updates).eq('id', riddleId);
  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'edit_riddle',
    target: String(riddleId),
    before: JSON.stringify({ text: riddle.text, position: riddle.position }),
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
  const riddleId = parseInt(id as string, 10);
  if (isNaN(riddleId)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Invalid riddle ID' }, { status: 400 });
  }

  // Block delete if attempts exist
  const { count } = await db
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('riddle_id', riddleId);

  if ((count ?? 0) > 0) {
    return NextResponse.json({
      ok: false,
      code: 'CONTENT_LOCKED',
      message: 'Cannot delete riddle with existing attempts',
    });
  }

  const { error } = await db.from('riddles').delete().eq('id', riddleId);
  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', message: error.message }, { status: 500 });
  }

  await db.from('admin_log').insert({
    admin_id: session.aid,
    action: 'delete_riddle',
    target: String(riddleId),
    before: JSON.stringify({ riddleId }),
    after: null,
  });

  return NextResponse.json({ ok: true });
});
