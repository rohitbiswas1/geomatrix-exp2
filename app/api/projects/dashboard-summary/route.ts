import { checkOrigin, requireBackendSession } from '../../../../lib/backend';
import { NextResponse } from 'next/server';
import { buildDashboardSummary } from '../../_demo-data';

export async function GET() {
  const authError = await requireBackendSession(); if (authError) return authError;

  return NextResponse.json(buildDashboardSummary());
}
