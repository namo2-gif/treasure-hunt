export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { GET as exportHandler } from '../[name]/route';

export async function GET(request: NextRequest) {
  return exportHandler(request, { params: Promise.resolve({ name: 'r3' }) });
}
