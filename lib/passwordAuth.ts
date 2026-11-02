import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { backendUrl, checkOrigin, jsonError, SESSION_COOKIE } from './backend';

export async function passwordAuth(request: Request, action: 'login' | 'register') {
  const originError = checkOrigin(request);
  if (originError) return originError;
  const raw = await request.text();
  if (raw.length > 4096) return jsonError('Request is too large.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return jsonError('Enter your account details.', 400); }
  if (!body || typeof body.email !== 'string' || body.email.length > 254 ||
      typeof body.password !== 'string' || !body.password.length || body.password.length > 128 ||
      (action === 'register' && (body.password.length < 12 || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100))) {
    return jsonError(action === 'register' ? 'Enter your name, email, and a password of 12–128 characters.' : 'Enter your email and password.', 400);
  }
  try {
    const upstream = await fetch(backendUrl(`/api/auth/${action}`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: body.email, password: body.password, ...(action === 'register' ? { name: body.name } : {}) }),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(70000),
    });
    const payload = await upstream.json();
    if (!upstream.ok) {
      const message = typeof payload.detail === 'string' ? payload.detail : 'Check your account details and try again.';
      return jsonError(message, upstream.status);
    }
    if (typeof payload.token !== 'string' || !payload.user || !Number.isInteger(payload.expires_in) || payload.expires_in <= 0) {
      return jsonError('Invalid authentication response.', 502);
    }
    (await cookies()).set(SESSION_COOKIE, payload.token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: payload.expires_in,
    });
    return NextResponse.json(payload.user, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
  } catch { return jsonError('Sign-in service is temporarily unavailable. Please try again.', 503); }
}
