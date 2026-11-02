import { checkOrigin, requireBackendSession } from '../../../../lib/backend';
import { NextResponse } from 'next/server';
import { demoAlerts } from '../../_demo-data';

export async function GET() {
  const authError = await requireBackendSession(); if (authError) return authError;

  const total = demoAlerts.length;
  const open = demoAlerts.filter((item) => item.status === 'Open').length;
  const critical = demoAlerts.filter((item) => item.severity === 'Critical').length;
  const high = demoAlerts.filter((item) => item.severity === 'High').length;

  return NextResponse.json({ total, open, critical, high });
}
