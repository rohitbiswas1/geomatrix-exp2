import { checkOrigin, requireBackendSession } from '../../../../../lib/backend';
import { NextResponse } from 'next/server';
import { demoProjects } from '../../../_demo-data';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function riskLevelFromScore(score: number) {
  if (score >= 75) return 'Critical';
  if (score >= 60) return 'High';
  if (score >= 35) return 'Medium';
  return 'Low';
}

function computePrediction(project: (typeof demoProjects)[number]) {
  const objectionPenalty = (project.objection_count ?? 0) * 1.2;
  const legalPenalty = (project.legal_case_count ?? 0) * 3.5;
  const docPenalty = (100 - (project.doc_completeness_pct ?? 50)) * 0.6;
  const approvalPenalty = project.approval_pending ? 12 : 0;
  const rrPenalty = project.rr_status === 'Pending' ? 9 : project.rr_status === 'In progress' ? 5 : 0;
  const forestPenalty = project.forest_clearance_status === 'Pending' ? 10 : 0;
  const compensationPenalty = project.compensation_status === 'Pending' ? 8 : project.compensation_status === 'Partial' ? 5 : 0;
  const overduePenalty = (project.overdue_milestones ?? 0) * 5;

  const rawScore = 16 + objectionPenalty + legalPenalty + docPenalty + approvalPenalty + rrPenalty + forestPenalty + compensationPenalty + overduePenalty;
  const risk_score = clamp(Math.round(rawScore), 0, 100);
  const risk_level = riskLevelFromScore(risk_score);
  const delay_probability = clamp(Number(((risk_score / 100) * 0.82 + (project.approval_pending ? 0.08 : 0.02)).toFixed(2)), 0.08, 0.96);
  const predicted_delay_days = clamp(Math.round(risk_score / 3.1 + (project.overdue_milestones ?? 0) * 4), 4, 120);
  const confidence = clamp(Number((0.71 + (project.doc_completeness_pct ?? 50) / 140).toFixed(2)), 0.62, 0.96);

  const shap_features = [
    { feature: 'objection_count', display_name: 'Pending Objections', shap_value: Number(((project.objection_count ?? 0) / 15).toFixed(3)), direction: 'up' as const, description: 'Higher objection volumes raise the chance of delayed resolution.', feature_value: project.objection_count ?? 0 },
    { feature: 'legal_case_count', display_name: 'Open Legal Cases', shap_value: Number(((project.legal_case_count ?? 0) / 10).toFixed(3)), direction: 'up' as const, description: 'Litigation creates procedural delay and decision uncertainty.', feature_value: project.legal_case_count ?? 0 },
    { feature: 'doc_completeness_pct', display_name: 'Document Completeness', shap_value: Number((((100 - (project.doc_completeness_pct ?? 50)) / 30)).toFixed(3)), direction: 'up' as const, description: 'Incomplete records make review and award slower.', feature_value: project.doc_completeness_pct ?? 0 },
    { feature: 'approval_pending', display_name: 'Approval Pending', shap_value: project.approval_pending ? 0.22 : -0.09, direction: project.approval_pending ? 'up' : 'down', description: 'Pending statutory clearances elevate risk exposure.', feature_value: project.approval_pending ? 1 : 0 },
    { feature: 'rr_status', display_name: 'R&R Status', shap_value: project.rr_status === 'Pending' ? 0.17 : project.rr_status === 'Completed' ? -0.12 : 0.04, direction: project.rr_status === 'Pending' || project.rr_status === 'In progress' ? 'up' : 'down', description: 'Land rehabilitation progress affects schedule certainty.', feature_value: project.rr_status ?? 'Not started' },
    { feature: 'forest_clearance_status', display_name: 'Forest Clearance', shap_value: project.forest_clearance_status === 'Pending' ? 0.18 : -0.08, direction: project.forest_clearance_status === 'Pending' ? 'up' : 'down', description: 'Forest clearance friction often delays the corridor timeline.', feature_value: project.forest_clearance_status ?? 'Not required' },
  ];

  return {
    status: 'success',
    risk_score,
    risk_level,
    delay_probability,
    predicted_delay_days,
    confidence,
    model_run_id: `demo-${Date.now().toString(36)}`,
    model_version: 'demo-gradient-risk-v1',
    message: 'Risk prediction generated from the local demo model.',
    shap_features,
  };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireBackendSession(); if (authError) return authError;

  const { id } = await params;
  const project = demoProjects.find((item) => item.id === id || item.project_code === id);

  if (!project) {
    return NextResponse.json({ message: 'Project not found' }, { status: 404 });
  }

  const prediction = computePrediction(project);
  return NextResponse.json({ project_id: project.id, prediction });
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = checkOrigin(_); if (originError) return originError;
const authError = await requireBackendSession(); if (authError) return authError;

  const { id } = await params;
  const projectIndex = demoProjects.findIndex((item) => item.id === id || item.project_code === id);

  if (projectIndex === -1) {
    return NextResponse.json({ message: 'Project not found' }, { status: 404 });
  }

  const project = demoProjects[projectIndex];
  const prediction = computePrediction(project);

  demoProjects[projectIndex] = {
    ...project,
    risk_score: prediction.risk_score,
    risk_level: prediction.risk_level,
    delay_probability: prediction.delay_probability,
    predicted_delay_days: prediction.predicted_delay_days,
    confidence: prediction.confidence,
    primary_driver: prediction.shap_features[0]?.display_name ?? project.primary_driver,
    updated_at: new Date().toISOString(),
  };

  return NextResponse.json({ project_id: project.id, prediction });
}
