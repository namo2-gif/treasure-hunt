import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';

export interface AdminSession {
  aid: number;
  adminId: number;
}

export type AdminHandler<T = any> = (
  req: NextRequest,
  context: { params: Promise<T>; session: AdminSession }
) => Promise<NextResponse | Response>;

export function withAdmin<T = any>(handler: AdminHandler<T>) {
  return async (req: NextRequest, context: { params: Promise<T> }): Promise<NextResponse | Response> => {
    try {
      const session = await getAdminSession();
      if (!session) {
        return NextResponse.json(
          { ok: false, code: 'UNAUTHORIZED', message: 'You must be logged in as an admin.' },
          { status: 401 }
        );
      }

      const paramsPromise = context?.params ?? Promise.resolve({} as T);
      return await handler(req, { params: paramsPromise, session });
    } catch (err: any) {
      console.error('[Admin API Error]', req.method, req.nextUrl?.pathname, err);
      return NextResponse.json(
        { ok: false, code: 'SERVER_ERROR', message: err?.message || 'Internal server error' },
        { status: 500 }
      );
    }
  };
}
