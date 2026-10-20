import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const PLAYER_COOKIE_NAME = 'th_session';
const ADMIN_COOKIE_NAME = 'th_admin';

function getPlayerSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

function getAdminSecret(): Uint8Array {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

export async function signPlayerToken(sid: string): Promise<string> {
  return new SignJWT({ sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getPlayerSecret());
}

export async function verifyPlayerToken(token: string): Promise<{ sid: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getPlayerSecret());
    if (typeof payload.sid === 'string') {
      return { sid: payload.sid };
    }
    return null;
  } catch {
    return null;
  }
}

export async function signAdminToken(aid: number): Promise<string> {
  return new SignJWT({ aid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(getAdminSecret());
}

export async function verifyAdminToken(token: string): Promise<{ aid: number; adminId: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getAdminSecret());
    if (typeof payload.aid === 'number') {
      return { aid: payload.aid, adminId: payload.aid };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getPlayerSession(): Promise<{ sid: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PLAYER_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyPlayerToken(token);
}

export async function getAdminSession(): Promise<{ aid: number; adminId: number } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAdminToken(token);
}

export function getPlayerCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    name: PLAYER_COOKIE_NAME,
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 24 * 60 * 60, // 24 hours
  };
}

export function getAdminCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    name: ADMIN_COOKIE_NAME,
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 8 * 60 * 60, // 8 hours
  };
}

export { PLAYER_COOKIE_NAME, ADMIN_COOKIE_NAME };
