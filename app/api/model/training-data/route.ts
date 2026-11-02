import { checkOrigin, requireBackendSession } from '../../../../lib/backend';
import { NextResponse } from 'next/server';

function backendUrl() {
  return (process.env.MODEL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
}

export async function GET() {
  const authError = await requireBackendSession(); if (authError) return authError;

  try {
    const response = await fetch(`${backendUrl()}/api/model/training-data`, { cache: 'no-store' });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({
      total_records: 0,
      delayed_count: 0,
      on_time_count: 0,
      ready_to_train: false,
      message: 'Model backend is unavailable. Start the FastAPI backend to load training data.',
    }, { status: 503 });
  }
}
