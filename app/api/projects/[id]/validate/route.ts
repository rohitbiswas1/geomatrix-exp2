import { checkOrigin, requireBackendSession } from '../../../../../lib/backend';
import { NextResponse } from 'next/server';
import { demoProjects } from '../../../_demo-data';

const requiredFields = [
  'project_code',
  'name',
  'state',
  'district',
  'authority',
  'project_type',
  'land_required',
  'land_acquired',
  'affected_families',
  'current_stage',
  'compensation_status',
  'objection_count',
  'legal_case_count',
  'rr_status',
  'env_clearance_status',
  'forest_clearance_status',
  'crz_status',
  'doc_completeness_pct',
  'approval_pending',
  'overdue_milestones',
];

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireBackendSession(); if (authError) return authError;

  const { id } = await params;
  const project = demoProjects.find((item) => item.id === id || item.project_code === id);

  if (!project) {
    return NextResponse.json({ message: 'Project not found' }, { status: 404 });
  }

  const missing_fields = requiredFields.filter((field) => {
    const value = (project as Record<string, unknown>)[field];
    return value === null || value === undefined || value === '';
  });

  return NextResponse.json({
    project_id: project.id,
    missing_fields,
    can_predict: missing_fields.length === 0,
    message: missing_fields.length === 0 ? 'Project is ready for prediction.' : 'Required fields are missing for model execution.',
  });
}
