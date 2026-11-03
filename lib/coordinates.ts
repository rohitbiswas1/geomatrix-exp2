import type { ApiProject } from './apiClient';
export function hasCoordinates(project: ApiProject): project is ApiProject & { latitude: number; longitude: number } {
  return typeof project.latitude === 'number' && Number.isFinite(project.latitude) && Math.abs(project.latitude) <= 90 &&
    typeof project.longitude === 'number' && Number.isFinite(project.longitude) && Math.abs(project.longitude) <= 180;
}
export function projectRiskColor(project: Pick<ApiProject, 'risk_score' | 'risk_level'>) {
  if (project.risk_score == null) return '#64748b';
  return project.risk_score >= 75 ? '#dc2626' : project.risk_score >= 50 ? '#ea580c' : project.risk_score >= 25 ? '#ca8a04' : '#16a34a';
}
