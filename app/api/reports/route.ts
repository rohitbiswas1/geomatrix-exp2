import { NextResponse } from 'next/server';
import { requireBackendSession } from '../../../lib/backend';

export async function GET() {
  const authError = await requireBackendSession();
  if (authError) return authError;
  return NextResponse.json({ reports: ['Executive Risk Summary', 'District Risk Report', 'Project Risk Report', 'Delay Driver Report', 'Intervention Report'] }, { headers: { 'Cache-Control': 'no-store' } });
}
