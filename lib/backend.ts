import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const SESSION_COOKIE = 'geomatrix_session';
const MAX_BODY_BYTES = 11 * 1024 * 1024;

export function backendUrl(path: string): string {
  const base = process.env.MODEL_API_URL || process.env.NEXT_PUBLIC_API_URL ||
    (process.env.NODE_ENV !== 'production' ? 'http://127.0.0.1:8000' : '');
  if (!base) throw new Error('MODEL_API_URL is not configured.');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid backend URL.');
  }
  return `${base.replace(/\/$/, '')}${path}`;
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Cookie-authenticated writes must originate from this application, including login.
export function checkOrigin(request: Request): NextResponse | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  const expected = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
  if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site') {
    return jsonError('Request origin is not allowed.', 403);
  }
  return null;
}

export async function requireBackendSession(): Promise<NextResponse | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return jsonError('Sign in required.', 401);
  try {
    const response = await fetch(backendUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return jsonError(response.status === 401 ? 'Session is invalid or expired.' : 'Authentication service unavailable.', response.status === 401 ? 401 : 503);
    return null;
  } catch {
    return jsonError('Authentication service unavailable.', 503);
  }
}

export async function proxyBackend(request: Request): Promise<Response> {
  const originError = checkOrigin(request);
  if (originError) return originError;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return jsonError('Sign in required.', 401);
  const url = new URL(request.url);
  if (!/^\/api\/[a-zA-Z0-9_/-]+$/.test(url.pathname)) return jsonError('Invalid API path.', 400);

  let body: ArrayBuffer | undefined;
  if (!['GET', 'HEAD'].includes(request.method) && request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return jsonError('Request body is too large.', 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = bytes.buffer;
  }
  try {
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);
    const upstream = await fetch(backendUrl(`${url.pathname}${url.search}`), {
      method: request.method, headers, body, cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(url.pathname === '/api/model/train' ? 120000 : url.pathname === '/api/auth/me' ? 70000 : 30000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return jsonError('Backend service is unavailable. Please try again later.', 503);
  }
}
