import { checkOrigin, requireBackendSession } from '../../../../../lib/backend';
import { NextResponse } from 'next/server';
import { demoProjects } from '../../../_demo-data';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function buildShapFeatures(project: (typeof demoProjects)[number]) {
  const score = project.risk_score ?? 50;
  const completionGap = clamp(100 - (project.doc_completeness_pct ?? 50), 0, 100);
  const objectionImpact = (project.objection_count ?? 0) / 10;
  const legalImpact = (project.legal_case_count ?? 0) / 8;
  const approvalImpact = project.approval_pending ? 1.0 : -0.4;
  const rrImpact = project.rr_status === 'Pending' ? 0.9 : project.rr_status === 'Completed' ? -0.5 : 0.2;

  return [
    {
      feature: 'objection_count',
      display_name: 'Pending Objections',
      shap_value: Number((Math.min(0.32, objectionImpact * 0.07) + score / 400).toFixed(4)),
      direction: 'up',
      description: 'Objection volume is a strong predictor of delay risk.',
      feature_value: project.objection_count ?? 0,
    },
    {
      feature: 'legal_case_count',
      display_name: 'Legal Cases',
      shap_value: Number((Math.min(0.28, legalImpact * 0.08) + score / 500).toFixed(4)),
      direction: 'up',
      description: 'Court matters create procedural uncertainty and timeline disruption.',
      feature_value: project.legal_case_count ?? 0,
    },
    {
      feature: 'doc_completeness_pct',
      display_name: 'Document Completeness',
      shap_value: Number((Math.min(0.2, completionGap / 320) + score / 600).toFixed(4)),
      direction: 'up',
      description: 'Missing land and project records slow approvals and reduce predictability.',
      feature_value: project.doc_completeness_pct ?? 0,
    },
    {
      feature: 'approval_pending',
      display_name: 'Approval Pending',
      shap_value: Number((approvalImpact * 0.18 + score / 700).toFixed(4)),
      direction: approvalImpact > 0 ? 'up' : 'down',
      description: 'Unresolved approvals keep the project exposed to external regulatory delay.',
      feature_value: project.approval_pending ? 1 : 0,
    },
    {
      feature: 'rr_status',
      display_name: 'R&R Readiness',
      shap_value: Number((rrImpact * 0.14 + score / 800).toFixed(4)),
      direction: rrImpact > 0 ? 'up' : 'down',
      description: 'R&R progress directly affects the speed of land possession and award milestones.',
      feature_value: project.rr_status ?? 'Not started',
    },
  ];
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireBackendSession(); if (authError) return authError;

  const { id } = await params;
  const project = demoProjects.find((item) => item.id === id || item.project_code === id);

  if (!project) {
    return NextResponse.json({ message: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json({
    project_id: project.id,
    shap_features: buildShapFeatures(project),
    status: 'success',
  });
}
