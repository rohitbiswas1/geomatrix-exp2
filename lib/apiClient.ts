import { authErrorMessage } from './authErrors';
import { validateUpload } from './uploads';

/**
 * Geomatrix API Client
 * Typed fetch client for all FastAPI backend calls.
 * Uses same-origin /api routes in the browser and during server rendering.
 * All functions here are the real-data replacements for lib/data.ts exports.
 */

// Keep the HttpOnly session on the application origin.
const BASE = '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const fallback = res.status === 413 ? 'Files must be 4 MB or smaller. Split larger files before uploading.' :
      res.status === 401 ? 'Your session has expired. Sign in again, then retry.' :
      res.status === 503 ? 'The service is starting or temporarily unavailable. Please retry in a moment.' : 'The request could not be completed. Please try again.';
    throw new ApiError(res.status, authErrorMessage(body, fallback));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ApiProject {
  id: string;
  project_code: string;
  name: string;
  state: string;
  district: string;
  authority: string;
  project_type: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  land_required: number;
  land_acquired: number;
  affected_families: number;
  current_stage?: string;
  status?: string;
  // Extended prediction fields
  compensation_status?: string;
  objection_count?: number;
  legal_case_count?: number;
  rr_status?: string;
  env_clearance_status?: string;
  forest_clearance_status?: string;
  crz_status?: string;
  doc_completeness_pct?: number;
  approval_pending?: boolean;
  overdue_milestones?: number;
  // ML outputs
  risk_score?: number;
  risk_level?: string;
  delay_probability?: number;
  predicted_delay_days?: number;
  confidence?: number;
  primary_driver?: string;
  source_details?: Record<string, string | number | boolean | string[] | null>;

  // Provenance
  source_url?: string;
  source_name?: string;
  source_record_id?: string;
  validation_status?: string;
  data_classification?: string;
  imported_at?: string;
  updated_at?: string;
}

export interface ProjectCreatePayload {
  project_code: string;
  name: string;
  state: string;
  district: string;
  authority: string;
  project_type: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  land_required?: number;
  land_acquired?: number;
  affected_families?: number;
  current_stage?: string;
  status?: string;
  compensation_status?: string;
  objection_count?: number;
  legal_case_count?: number;
  rr_status?: string;
  env_clearance_status?: string;
  forest_clearance_status?: string;
  crz_status?: string;
  doc_completeness_pct?: number;
  approval_pending?: boolean;
  overdue_milestones?: number;
}

export interface ShapFeature {
  feature: string;
  display_name?: string;
  shap_value: number;
  direction: 'up' | 'down';
  description: string;
  feature_value?: number;
}

export interface PredictionResult {
  status: string;
  risk_score: number;
  risk_level: string;
  delay_probability: number;
  predicted_delay_days?: number;
  confidence: number;
  model_run_id?: string;
  model_version?: string;
  message: string;
  shap_features: ShapFeature[];
}

export interface DashboardSummary {
  total_projects: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  total_land_ha: number;
  total_families: number;
  avg_risk_score?: number;
  alerts_open: number;
  data_available: boolean;
  message: string;
}

export interface ApiAlert {
  id: string;
  project_id: string;
  project_name?: string;
  severity: string;
  reason: string;
  risk_change?: number;
  expected_impact?: string;
  detected_at: string;
  recommended_action?: string;
  status: string;
  assigned_to?: string;
  due_date?: string;
  outcome?: string;
}

export interface IngestResult {
  records_duplicated?: number;
  records_failed?: number;
  warnings?: string[];
  missing_fields?: number;
  completeness_pct?: number;
  source: string;
  records_fetched: number;
  records_saved: number;
  records_skipped: number;
  errors: string[];
  status: string;
}

export interface IngestionLogEntry {
  id: string;
  source: string;
  source_url?: string;
  started_at: string;
  finished_at?: string;
  records_fetched: number;
  records_saved: number;
  records_skipped: number;
  errors?: unknown;
  status: string;
}

export interface ModelStatus {
  trained: boolean;
  algorithm?: string;
  trained_at?: string;
  n_samples?: number;
  precision?: number;
  recall?: number;
  f1_score?: number;
  roc_auc?: number;
  rmse?: number;
  feature_names?: string[];
  message: string;
}

export interface TrainingDataSummary {
  total_records: number;
  delayed_count: number;
  on_time_count: number;
  ready_to_train: boolean;
  message: string;
}

export interface TrainResponse {
  success: boolean;
  message: string;
  model_run_id?: string;
  metrics?: Record<string, number>;
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, unknown>;
  }>;
}

export interface ProjectValidation {
  project_id: string;
  missing_fields: string[];
  can_predict: boolean;
  message: string;
}

// â”€â”€ Project endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function fetchProjects(params?: {
  dataset?: "production" | "all" | "excluded";
  state?: string;
  district?: string;
  stage?: string;
  risk_level?: string;
  limit?: number;
}): Promise<ApiProject[]> {
  const qs = new URLSearchParams();
  if (params?.dataset) qs.set('dataset', params.dataset);
  if (params?.state) qs.set('state', params.state);
  if (params?.district) qs.set('district', params.district);
  if (params?.stage) qs.set('stage', params.stage);
  if (params?.risk_level) qs.set('risk_level', params.risk_level);
  if (params?.limit) qs.set('limit', String(params.limit));
  const rows=await apiFetch<ApiProject[]>(`/api/projects${qs.toString() ? '?' + qs.toString() : ''}`);
  return params?.dataset === 'all' ? rows : params?.dataset === 'excluded' ? rows.filter(p=>p.data_classification !== 'REAL') : rows.filter(p=>p.data_classification === 'REAL');
}

export async function fetchProject(id: string): Promise<ApiProject> {
  return apiFetch<ApiProject>(`/api/projects/${id}`);
}

export async function createProject(data: ProjectCreatePayload): Promise<ApiProject> {
  return apiFetch<ApiProject>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateProject(id: string, data: Partial<ProjectCreatePayload>): Promise<ApiProject> {
  return apiFetch<ApiProject>(`/api/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' });
}

export async function validateProject(id: string): Promise<ProjectValidation> {
  return apiFetch<ProjectValidation>(`/api/projects/${id}/validate`);
}

export async function runPrediction(projectId: string): Promise<{ project_id: string; prediction: PredictionResult }> {
  return apiFetch(`/api/projects/${projectId}/predict-risk`, { method: 'POST' });
}

export async function fetchExplanation(projectId: string): Promise<{ project_id: string; shap_features: ShapFeature[] }> {
  return apiFetch(`/api/projects/${projectId}/explain`);
}

// â”€â”€ Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/api/projects/dashboard-summary');
}

// â”€â”€ Alerts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function fetchAlerts(status = 'Open', limit = 100): Promise<ApiAlert[]> {
  return apiFetch<ApiAlert[]>(`/api/alerts?status=${encodeURIComponent(status.toLowerCase() === 'all' ? 'all' : status)}&limit=${limit}`);
}

export async function fetchAlertsSummary() {
  return apiFetch<{ total: number; open: number; critical: number; high: number }>('/api/alerts/summary');
}

// â”€â”€ GIS Map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function fetchGeojson(riskLevel?: string): Promise<GeoJsonFeatureCollection> {
  const qs = riskLevel ? `?risk_level=${riskLevel}` : '';
  return apiFetch<GeoJsonFeatureCollection>(`/api/map/geojson${qs}`);
}

// â”€â”€ Data Ingestion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function uploadFile(file: File, dataType: 'projects' | 'historical'): Promise<IngestResult> {
  const validation = validateUpload(file);
  if (validation) throw new ApiError(400, validation);
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/api/ingest/upload?data_type=${dataType}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const fallback = res.status === 413 ? 'Files must be 4 MB or smaller. Split larger files before uploading.' :
      res.status === 401 ? 'Your session has expired. Sign in again, then retry the upload.' :
      'The request could not be completed. Please try again.';
    throw new ApiError(res.status, authErrorMessage(body, fallback));
  }
  const result: IngestResult = await res.json();
  if (!result || typeof result.records_saved !== 'number' || !Array.isArray(result.errors)) {
    throw new ApiError(502, 'The upload service returned an unexpected response. Please retry.');
  }
  return result;
}

export async function fetchIngestionLog(limit = 20): Promise<IngestionLogEntry[]> {
  return apiFetch<IngestionLogEntry[]>(`/api/ingest/log?limit=${limit}`);
}

// â”€â”€ Model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function fetchModelStatus(): Promise<ModelStatus> {
  return apiFetch<ModelStatus>('/api/model/status');
}

export async function fetchTrainingDataSummary(): Promise<TrainingDataSummary> {
  return apiFetch<TrainingDataSummary>('/api/model/training-data');
}

export async function trainModel(algorithm: 'RandomForest' | 'XGBoost' = 'RandomForest'): Promise<TrainResponse> {
  return apiFetch<TrainResponse>(`/api/model/train?algorithm=${algorithm}`, { method: 'POST' });
}

// â”€â”€ Gemini (server-side proxy route in Next.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function explainWithGemini(payload: {
  project: Record<string, unknown>;
  prediction?: Record<string, unknown>;
  shap_features?: ShapFeature[];
}): Promise<{ status: string; label: string; summary: string; source: string }> {
  // Calls the Next.js server-side API route which proxies to FastAPI
  const res = await fetch('/api/gemini/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const fallback = res.status === 413 ? 'Files must be 4 MB or smaller. Split larger files before uploading.' :
      res.status === 401 ? 'Your session has expired. Sign in again, then retry the upload.' :
      'The request could not be completed. Please try again.';
    throw new ApiError(res.status, authErrorMessage(body, fallback));
  }
  return res.json();
}

