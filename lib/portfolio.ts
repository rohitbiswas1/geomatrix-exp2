import type { ApiProject } from './apiClient';

export function portfolioSummary(projects: ApiProject[]) {
  const scored = projects.filter(p => p.risk_score != null);
  const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const districts = new Map<string, { district: string; projects: number; scores: number[]; probabilities: number[]; land: number }>();
  const drivers = new Map<string, number>();
  const stages = new Map<string, number>();
  for (const p of projects) {
    const key = [p.state, p.district].filter(Boolean).join(' · ') || 'Location not recorded';
    const d = districts.get(key) || { district: key, projects: 0, scores: [], probabilities: [], land: 0 };
    d.projects++; d.land += p.land_required || 0;
    if (p.risk_score != null) d.scores.push(p.risk_score);
    if (p.delay_probability != null) d.probabilities.push(p.delay_probability * 100);
    districts.set(key, d);
    if (p.primary_driver) drivers.set(p.primary_driver, (drivers.get(p.primary_driver) || 0) + 1);
    const stage = p.current_stage || 'Not recorded';
    stages.set(stage, (stages.get(stage) || 0) + 1);
  }
  return {
    total_projects: projects.length, classified_projects: scored.length,
    unclassified_projects: projects.length - scored.length,
    average_risk: average(scored.map(p => p.risk_score!)),
    critical_high: scored.filter(p => p.risk_score! >= 50).length,
    land_required: projects.reduce((sum, p) => sum + (p.land_required || 0), 0),
    land_acquired: projects.reduce((sum, p) => sum + (p.land_acquired || 0), 0),
    districts: [...districts.values()].map(d => ({ district: d.district, projects: d.projects, land: d.land, average_risk: average(d.scores), probability: average(d.probabilities) })),
    drivers: [...drivers].map(([driver, projects]) => ({ driver, projects })).sort((a, b) => b.projects - a.projects),
    stages: [...stages].map(([stage, projects]) => ({ stage, projects })),
  };
}

export function riskTrend(projects: ApiProject[], period: 'Monthly' | 'Weekly' | 'Quarterly') {
  const groups = new Map<string, number[]>();
  for (const project of projects) {
    if (project.risk_score == null || !project.updated_at) continue;
    const date = new Date(project.updated_at);
    if (Number.isNaN(date.getTime())) continue;
    let key = date.toISOString().slice(0, 7);
    if (period === 'Quarterly') key = date.getUTCFullYear() + '-Q' + (Math.floor(date.getUTCMonth() / 3) + 1);
    if (period === 'Weekly') {
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = date.toISOString().slice(0, 10);
    }
    groups.set(key, [...(groups.get(key) || []), project.risk_score]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, scores]) => ({ label, risk: scores.reduce((a,b) => a+b,0) / scores.length, projects: scores.length }));
}
