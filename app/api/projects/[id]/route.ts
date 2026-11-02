import { checkOrigin, requireBackendSession } from '../../../../lib/backend';
import { NextResponse } from 'next/server';
import { demoProjects } from '../../_demo-data';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireBackendSession(); if (authError) return authError;

  const { id } = await params;
  const project = demoProjects.find((item) => item.id === id || item.project_code === id);

  if (!project) {
    return NextResponse.json({ message: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = checkOrigin(request); if (originError) return originError;
const authError = await requireBackendSession(); if (authError) return authError;

  const { id } = await params;
  const payload = await request.json();
  const index = demoProjects.findIndex((item) => item.id === id || item.project_code === id);

  if (index === -1) {
    return NextResponse.json({ message: 'Project not found' }, { status: 404 });
  }

  const updated = { ...demoProjects[index], ...payload, updated_at: new Date().toISOString() };
  demoProjects[index] = updated;
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = checkOrigin(_); if (originError) return originError;
const authError = await requireBackendSession(); if (authError) return authError;

  const { id } = await params;
  const index = demoProjects.findIndex((item) => item.id === id || item.project_code === id);

  if (index === -1) {
    return NextResponse.json({ message: 'Project not found' }, { status: 404 });
  }

  demoProjects.splice(index, 1);
  return new NextResponse(null, { status: 204 });
}
