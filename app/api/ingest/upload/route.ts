import { checkOrigin, requireBackendSession } from '../../../../lib/backend';
import { NextResponse } from 'next/server';
import { addImportedProjects, ImportedProjectRecord } from '../../../../lib/importedProjects';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['csv', 'json', 'geojson', 'xlsx', 'xls', 'pdf']);
const ingestionLogs: Array<Record<string, unknown>> = [];

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { values.push(value.trim()); value = ''; }
    else value += character;
  }

  values.push(value.trim());
  return values;
}

function rowValue(row: Record<string, string>, ...names: string[]) {
  const normalized = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replace(/[\s-]+/g, '_'), value?.trim() ?? '']),
  );
  for (const name of names) {
    const value = normalized[name];
    if (value) return value;
  }
  return '';
}

function numberValue(row: Record<string, string>, ...names: string[]) {
  const value = Number(rowValue(row, ...names));
  return Number.isFinite(value) ? value : 0;
}

function projectRows(text: string, sourceName: string): ImportedProjectRecord[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const importedAt = new Date().toISOString();
  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']));
    const projectCode = rowValue(row, 'project_code', 'project_id', 'source_record_id', 'id') || `IMPORT-${Date.now()}-${index + 1}`;
    const name = rowValue(row, 'name', 'project_name', 'canonical_project_name', 'source_project_name') || projectCode;
    const riskScore = numberValue(row, 'risk_score');
    return {
        id: `import-${Date.now()}-${index}`,
        project_code: projectCode,
        name,
        state: rowValue(row, 'state', 'state_or_region', 'state_name') || 'Unknown',
        district: rowValue(row, 'district', 'district_name') || 'Unknown',
        authority: rowValue(row, 'authority', 'implementing_agency', 'agency') || 'Unknown',
        project_type: rowValue(row, 'project_type', 'sector') || 'General',
        description: rowValue(row, 'description'),
        latitude: numberValue(row, 'latitude', 'lat'),
        longitude: numberValue(row, 'longitude', 'lon', 'lng'),
        land_required: numberValue(row, 'land_required', 'land_required_ha', 'land_area_ha'),
        land_acquired: numberValue(row, 'land_acquired', 'land_acquired_ha'),
        affected_families: numberValue(row, 'affected_families', 'families_affected', 'families'),
        current_stage: rowValue(row, 'current_stage', 'stage', 'current_acquisition_stage') || 'Unknown',
        status: rowValue(row, 'status', 'project_status') || 'Active',
        compensation_status: rowValue(row, 'compensation_status') || 'Pending',
        objection_count: numberValue(row, 'objection_count', 'pending_claims'),
        legal_case_count: numberValue(row, 'legal_case_count', 'legal_cases', 'case_count'),
        rr_status: rowValue(row, 'rr_status', 'rr_pending') || 'Not started',
        env_clearance_status: rowValue(row, 'env_clearance_status') || 'Pending',
        forest_clearance_status: rowValue(row, 'forest_clearance_status') || 'Not required',
        crz_status: rowValue(row, 'crz_status') || 'Not applicable',
        doc_completeness_pct: numberValue(row, 'doc_completeness_pct', 'document_completeness_pct') || 50,
        approval_pending: ['true', '1', 'yes'].includes(rowValue(row, 'approval_pending').toLowerCase()),
        overdue_milestones: numberValue(row, 'overdue_milestones', 'overdue_milestone_count'),
        risk_score: riskScore,
        risk_level: rowValue(row, 'risk_level') || (riskScore >= 75 ? 'High' : riskScore >= 50 ? 'Medium' : 'Low'),
        delay_probability: numberValue(row, 'delay_probability'),
        predicted_delay_days: numberValue(row, 'predicted_delay_days'),
        confidence: numberValue(row, 'confidence'),
        primary_driver: rowValue(row, 'primary_driver') || 'Imported dataset',
        source_name: sourceName,
        validation_status: 'validated',
        data_classification: 'REAL',
        imported_at: importedAt,
        updated_at: importedAt,
    };
  });
}

function csvQuality(text: string): { records: number; missingFields: number; completenessPct: number } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return { records: 0, missingFields: 0, completenessPct: 0 };
  const columns = parseCsvLine(lines[0]).length;
  const records = lines.length - 1;
  const missingFields = lines.slice(1).reduce((missing, line) => {
    const values = parseCsvLine(line);
    return missing + Math.max(0, columns - values.filter(Boolean).length);
  }, 0);
  const totalFields = records * columns;
  return { records, missingFields, completenessPct: totalFields ? Math.round(((totalFields - missingFields) / totalFields) * 1000) / 10 : 0 };
}

function jsonQuality(text: string): { records: number; missingFields: number; completenessPct: number } {
  const parsed: unknown = JSON.parse(text);
  let records: unknown[] = [];
  if (Array.isArray(parsed)) records = parsed;
  else if (parsed && typeof parsed === 'object') {
    const value = parsed as { records?: unknown; features?: unknown };
    if (Array.isArray(value.records)) records = value.records;
    else if (Array.isArray(value.features)) records = value.features;
    else records = [parsed];
  } else throw new Error('JSON must contain an object or an array of records.');

  const objects = records.filter((record): record is Record<string, unknown> => (
    Boolean(record) && typeof record === 'object' && !Array.isArray(record)
  ));
  const keys = Array.from(new Set(objects.flatMap((record) => Object.keys(record))));
  const missingFields = objects.reduce((missing, record) => (
    missing + keys.filter((key) => record[key] === undefined || record[key] === null || record[key] === '').length
  ), 0);
  const totalFields = objects.length * keys.length;
  return {
    records: records.length,
    missingFields,
    completenessPct: totalFields ? Math.round(((totalFields - missingFields) / totalFields) * 1000) / 10 : 0,
  };
}

export async function POST(request: Request) {
  const originError = checkOrigin(request); if (originError) return originError;
const authError = await requireBackendSession(); if (authError) return authError;

  const form = await request.formData();
  const file = form.get('file');
  const dataType = form.get('data_type') === 'historical' ? 'historical' : 'projects';

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A dataset file is required.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'The uploaded file is empty.' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'Dataset must be 10 MB or smaller.' }, { status: 413 });
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return NextResponse.json({ error: 'Supported formats are CSV, XLSX, GeoJSON, JSON, and PDF.' }, { status: 415 });
  }

  let records = 0;
  let missingFields = 0;
  let completenessPct = 0;
  let importedProjectRows: ImportedProjectRecord[] = [];
  const errors: string[] = [];
  try {
    if (extension === 'csv') {
      const text = await file.text();
      const quality = csvQuality(text);
      records = quality.records;
      missingFields = quality.missingFields;
      completenessPct = quality.completenessPct;
      if (dataType === 'projects') {
        importedProjectRows = projectRows(text, file.name);
        records = importedProjectRows.length;
        addImportedProjects(importedProjectRows);
      }
      if (records === 0) errors.push('CSV must include a header row and at least one data row.');
    } else if (extension === 'json' || extension === 'geojson') {
      const quality = jsonQuality(await file.text());
      records = quality.records;
      missingFields = quality.missingFields;
      completenessPct = quality.completenessPct;
    } else {
      records = 1;
    }
  } catch (error) {
    errors.push(`The ${extension.toUpperCase()} file could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const status = errors.length > 0 ? 'failed' : 'completed';
  const now = new Date().toISOString();
  ingestionLogs.unshift({
    id: crypto.randomUUID(), source: file.name, started_at: now, finished_at: now,
    records_fetched: records, records_saved: errors.length ? 0 : records,
    records_skipped: errors.length ? records : 0, errors, status,
  });

  return NextResponse.json({
    source: file.name,
    records_fetched: records,
    records_saved: errors.length ? 0 : records,
    records_skipped: errors.length ? records : 0,
    errors,
    status,
    data_type: dataType,
    missing_fields: missingFields,
    completeness_pct: completenessPct,
  }, { status: errors.length ? 422 : 200 });
}

export async function GET() {
  const authError = await requireBackendSession(); if (authError) return authError;

  return NextResponse.json(ingestionLogs.slice(0, 20));
}
