import { checkOrigin, requireBackendSession } from '../../../../../lib/backend';
import { NextResponse } from 'next/server';
import { demoProjects } from '../../../_demo-data';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireBackendSession(); if (authError) return authError;

  const { id } = await params;
  const project = demoProjects.find((item) => item.id === id || item.project_code === id);

  if (!project) {
    return NextResponse.json({ message: 'Project not found' }, { status: 404 });
  }

  const risk_score = project.risk_score ?? 50;
  const risk_level = project.risk_level ?? 'Medium';
  const delay_probability = project.delay_probability ?? 0.45;
  const predicted_delay_days = project.predicted_delay_days ?? 15;
  const confidence = project.confidence ?? 0.8;

  return NextResponse.json({
    project_id: project.id,
    status: 'success',
    risk_score,
    risk_level,
    delay_probability,
    predicted_delay_days,
    confidence,
    message: 'Latest risk summary loaded from demo project data.',
  });
}
