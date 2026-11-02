import { checkOrigin, requireBackendSession } from '../../../lib/backend';
import { NextResponse } from 'next/server';
import { demoProjects } from '../_demo-data';
import { getImportedProjects } from '../../../lib/importedProjects';

export async function GET(request: Request) {
  const authError = await requireBackendSession(); if (authError) return authError;

  const { searchParams } = new URL(request.url);
  let list = [...demoProjects, ...getImportedProjects()];

  const state = searchParams.get('state');
  const district = searchParams.get('district');
  const stage = searchParams.get('stage');
  const riskLevel = searchParams.get('risk_level');
  const limitParam = Number(searchParams.get('limit') ?? '200');

  if (state) {
    list = list.filter((project) => project.state.toLowerCase().includes(state.toLowerCase()));
  }
  if (district) {
    list = list.filter((project) => project.district.toLowerCase().includes(district.toLowerCase()));
  }
  if (stage) {
    list = list.filter((project) => project.current_stage?.toLowerCase() === stage.toLowerCase());
  }
  if (riskLevel) {
    list = list.filter((project) => project.risk_level?.toLowerCase() === riskLevel.toLowerCase());
  }

  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 200;
  return NextResponse.json(list.slice(0, limit));
}

export async function POST(request: Request) {
  const originError = checkOrigin(request); if (originError) return originError;
const authError = await requireBackendSession(); if (authError) return authError;

  const body = await request.json();
  const project = {
    id: body.id || `proj-${Date.now()}`,
    project_code: body.project_code || `GEOM-${Date.now()}`,
    name: body.name || 'Untitled Project',
    state: body.state || 'Unknown',
    district: body.district || 'Unknown',
    authority: body.authority || 'Unknown',
    project_type: body.project_type || 'General',
    description: body.description || '',
    latitude: Number(body.latitude ?? 0),
    longitude: Number(body.longitude ?? 0),
    land_required: Number(body.land_required ?? 0),
    land_acquired: Number(body.land_acquired ?? 0),
    affected_families: Number(body.affected_families ?? 0),
    current_stage: body.current_stage || 'Notification',
    status: body.status || 'Active',
    compensation_status: body.compensation_status || 'Pending',
    objection_count: Number(body.objection_count ?? 0),
    legal_case_count: Number(body.legal_case_count ?? 0),
    rr_status: body.rr_status || 'Not started',
    env_clearance_status: body.env_clearance_status || 'Pending',
    forest_clearance_status: body.forest_clearance_status || 'Not required',
    crz_status: body.crz_status || 'Not applicable',
    doc_completeness_pct: Number(body.doc_completeness_pct ?? 50),
    approval_pending: Boolean(body.approval_pending),
    overdue_milestones: Number(body.overdue_milestones ?? 0),
    risk_score: Number(body.risk_score ?? 35),
    risk_level: body.risk_level || 'Medium',
    delay_probability: Number(body.delay_probability ?? 0.3),
    predicted_delay_days: Number(body.predicted_delay_days ?? 10),
    confidence: Number(body.confidence ?? 0.7),
    primary_driver: body.primary_driver || 'Manual entry',
    source_name: 'Manual entry',
    validation_status: 'pending',
    data_classification: 'REAL',
    imported_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return NextResponse.json(project, { status: 201 });
}
