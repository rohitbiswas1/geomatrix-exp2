import { checkOrigin, requireBackendSession } from '../../../../lib/backend';
import { NextResponse } from 'next/server';

function backendUrl() {
  return (process.env.MODEL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
}

export async function POST(request: Request) {
  const originError = checkOrigin(request); if (originError) return originError;
const authError = await requireBackendSession(); if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const algorithm = searchParams.get('algorithm') || 'RandomForest';

  try {
    const response = await fetch(`${backendUrl()}/api/model/train?algorithm=${encodeURIComponent(algorithm)}`, {
      method: 'POST',
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({
      success: false,
      message: `Model backend returned HTTP ${response.status}.`,
    }));
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({
      success: false,
      message: 'Model training backend is unavailable. Start the FastAPI backend and try again.',
    }, { status: 503 });
  }
}
