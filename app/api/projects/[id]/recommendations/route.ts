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

  const recommendations = [
    {
      title: 'Escalate pending compensation approvals',
      priority: project.compensation_status === 'Pending' ? 'Critical' : 'High',
      impact: 'Very High',
      owner: 'District Land Acquisition Officer',
      expected: 'Reduce delay probability and improve award confidence.',
    },
    {
      title: 'Resolve pending legal and statutory clearances',
      priority: project.legal_case_count && project.legal_case_count > 5 ? 'High' : 'Medium',
      impact: 'High',
      owner: 'Legal & Regulatory Cell',
      expected: 'Limit litigation-driven schedule shocks.',
    },
    {
      title: 'Tighten document verification and hearing coordination',
      priority: 'Medium',
      impact: 'Moderate',
      owner: 'Project Coordination Office',
      expected: 'Increase document completeness and speed up hearing windows.',
    },
  ];

  return NextResponse.json({
    project_id: project.id,
    recommendations,
    status: 'success',
  });
}
