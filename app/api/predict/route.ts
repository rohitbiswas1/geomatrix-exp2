import { checkOrigin, requireBackendSession } from '../../../lib/backend';
import { NextResponse } from 'next/server';

export async function POST() {
  const authError = await requireBackendSession(); if (authError) return authError;

  return NextResponse.json(
    {
      error: 'Model not trained — insufficient real labeled data.',
      message: 'Model not trained — insufficient real labeled data.'
    },
    { status: 503 }
  );
}

export async function GET() {
  const authError = await requireBackendSession(); if (authError) return authError;

  return NextResponse.json(
    {
      error: 'Model not trained — insufficient real labeled data.',
      message: 'Model not trained — insufficient real labeled data.'
    },
    { status: 503 }
  );
}
