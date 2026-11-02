import { checkOrigin, requireBackendSession } from '../../../lib/backend';
import { NextResponse } from 'next/server';
import { demoAlerts } from '../_demo-data';

export async function GET(request: Request) {
  const authError = await requireBackendSession(); if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status');
  const limitParam = Number(searchParams.get('limit') ?? '100');

  let alerts = [...demoAlerts];
  if (statusFilter && statusFilter.toLowerCase() !== 'all') {
    alerts = alerts.filter((alert) => alert.status.toLowerCase() === statusFilter.toLowerCase());
  }

  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 100;
  return NextResponse.json(alerts.slice(0, limit));
}
