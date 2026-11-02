import { checkOrigin, requireBackendSession } from '../../../../lib/backend';
import { NextResponse } from 'next/server';

export async function GET() {
  const authError = await requireBackendSession(); if (authError) return authError;

  return NextResponse.json({ data: [], message: 'Stage analytics require real project records in the database.' }, { status: 200 });
}
