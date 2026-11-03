import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkOrigin, proxyBackend, SESSION_COOKIE } from '../../../../lib/backend';

export const maxDuration = 150;

export async function POST(request: Request) {
  const originError = checkOrigin(request);
  if (originError) return originError;
  const response = await proxyBackend(request);
  if (!response.ok && response.status !== 401) return response;
  (await cookies()).delete(SESSION_COOKIE);
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
