import { authErrorMessage } from '../../../../lib/authErrors';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { waitForAuthBackend } from '../../../../lib/authBackend';
import { z } from 'zod';
import { backendUrl, checkOrigin, jsonError, SESSION_COOKIE } from '../../../../lib/backend';

export const maxDuration = 150;

const requestSchema = z.object({ credential: z.string().min(1).max(16384) });

export async function POST(request: Request) {
  const originError = checkOrigin(request);
  if (originError) return originError;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('A Google credential is required.', 400);
  try {
    await waitForAuthBackend();
    const upstream = await fetch(backendUrl('/api/auth/google'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data), cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json();
    if (!upstream.ok) return jsonError(authErrorMessage(payload, 'Google sign-in failed. Please try again.'), upstream.status);
    if (typeof payload.token !== 'string' || !payload.user || !Number.isInteger(payload.expires_in) || payload.expires_in <= 0) {
      return jsonError('Invalid authentication response.', 502);
    }
    (await cookies()).set(SESSION_COOKIE, payload.token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: payload.expires_in,
    });
    return NextResponse.json(payload.user, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return jsonError('Sign-in service is temporarily unavailable.', 503);
  }
}
