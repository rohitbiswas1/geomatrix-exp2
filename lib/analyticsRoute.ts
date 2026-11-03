import { NextResponse } from 'next/server';
import { proxyBackend } from './backend';
import { portfolioSummary } from './portfolio';
import type { ApiProject } from './apiClient';

export async function analyticsResponse(request: Request, kind: 'overview' | 'drivers' | 'stages') {
  const upstream = await proxyBackend(new Request(new URL('/api/projects?limit=500', request.url)));
  if (!upstream.ok) return upstream;
  const projects = await upstream.json() as ApiProject[];
  const summary = portfolioSummary(projects);
  return NextResponse.json(kind === 'overview' ? summary : { data: summary[kind], total_projects: summary.total_projects }, { headers: { 'Cache-Control': 'no-store' } });
}
