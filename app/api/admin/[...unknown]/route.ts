export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

function notFoundResponse() {
  return NextResponse.json(
    { ok: false, code: 'NOT_FOUND', message: 'API endpoint not found' },
    { status: 404 }
  );
}

export async function GET() { return notFoundResponse(); }
export async function POST() { return notFoundResponse(); }
export async function PUT() { return notFoundResponse(); }
export async function PATCH() { return notFoundResponse(); }
export async function DELETE() { return notFoundResponse(); }
export async function OPTIONS() { return notFoundResponse(); }
