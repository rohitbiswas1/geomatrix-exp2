'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Upload, Map as MapIcon, Search, ArrowUpDown, Filter, TrendingUp, TrendingDown, Minus, X, CheckCircle2, AlertCircle, RefreshCw, Trash2 } from 'lucide-react';
import { fetchProjects, createProject, updateProject, uploadFile, deleteProject, ApiProject, ApiError, type IngestResult } from '../../lib/apiClient';
import { riskLevel } from '../../lib/data';
import ExportDropdown, { ExportFormat } from '../../components/ExportDropdown';
import { exportToCSV, exportToExcel, exportToPDF } from '../../lib/exportUtils';

import UploadSummary from '../../components/UploadSummary';
import { UPLOAD_ACCEPT } from '../../lib/uploads';

type SortKey = 'risk_score' | 'delay_probability' | 'name' | 'project_code';
type SortDir = 'asc' | 'desc';

const ACQUISITION_STAGES = [
  'Notification', 'Objection / Hearing', 'Compensation', 'Award',
  'Possession', 'Rehabilitation & Resettlement', 'Legal / Dispute'
];

const EMPTY_FORM = {
  project_code: '', name: '', state: '', district: '', authority: '', project_type: '',
  description: '', latitude: '', longitude: '', land_required: '', land_acquired: '',
  affected_families: '', current_stage: '', status: 'Active',
  compensation_status: '', objection_count: '', legal_case_count: '',
  rr_status: '', env_clearance_status: '', forest_clearance_status: '',
  crz_status: '', doc_completeness_pct: '', approval_pending: false, overdue_milestones: '',
};

  function Field({ form, setForm, label, name, required, type = 'text', as, options }: {
    form: typeof EMPTY_FORM; setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
    label: string; name: string; required?: boolean; type?: string;
    as?: 'select' | 'textarea'; options?: string[];
  }) {
    const val = form[name as keyof typeof form] as string | boolean;
    if (as === 'select') return (
      <div>
        <label htmlFor={`project-${name}`} style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
          {label}{required && <span style={{ color: 'var(--red)' }}> *</span>}
        </label>
        <select id={`project-${name}`} aria-label={label}
          className="filter-select" style={{ width: '100%' }}
          value={val as string}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
        >
          <option value="">— Select —</option>
          {options?.map(o => <option key={o}>{o}</option>)}
        </select>
      </div>
    );
    if (as === 'textarea') return (
      <div>
        <label htmlFor={`project-${name}`} style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{label}</label>
        <textarea id={`project-${name}`} aria-label={label} rows={2} style={{ width: '100%', padding: '6px 10px', borderRadius: 5, border: '1px solid var(--line)', fontSize: 13 }}
          value={val as string}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
        />
      </div>
    );
    if (type === 'checkbox') return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input id={`project-${name}`} aria-label={label} type="checkbox" checked={val as boolean}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.checked }))} />
        <label htmlFor={`project-${name}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{label}</label>
      </div>
    );
    return (
      <div>
        <label htmlFor={`project-${name}`} style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
          {label}{required && <span style={{ color: 'var(--red)' }}> *</span>}
        </label>
        <input id={`project-${name}`} aria-label={label} type={type} style={{ width: '100%', padding: '6px 10px', borderRadius: 5, border: '1px solid var(--line)', fontSize: 13 }}
          value={val as string}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
        />
      </div>
    );
  }


export default function Projects() {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { setSearch(new URLSearchParams(window.location.search).get('search') || ''); }, []);
  const [riskFilter, setRiskFilter] = useState('All');
  const [stateFilter, setStateFilter] = useState('All');
  const [stageFilter, setStageFilter] = useState('All');
  const [compensationFilter, setCompensationFilter] = useState('All');
  const [legalFilter, setLegalFilter] = useState('All');
  const [sortKey, setSortKey] = useState<SortKey>('risk_score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Add Project modal state
  const [editingProject, setEditingProject] = useState<ApiProject | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const [csvError, setCsvError] = useState('');
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<IngestResult | null>(null);
  const csvInFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchProjects({ limit: 200 });
      setProjects(data);
    } catch (e) {
      setError(e instanceof ApiError ? `API Error (${e.status}): ${e.message}` : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file || csvInFlight.current) return;
    csvInFlight.current = true;
    setCsvError(''); setCsvResult(null); setCsvUploading(true);
    try {
      const result = await uploadFile(file, 'projects');
      setCsvResult(result);
      if (result.records_saved > 0) {
        showToast(`Imported ${result.records_saved} project${result.records_saved === 1 ? '' : 's'}`);
        setSearch(''); setRiskFilter('All'); setStateFilter('All'); setStageFilter('All');
        setCompensationFilter('All'); setLegalFilter('All');
        await load();
      }
    } catch (error) {
      setCsvError(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    } finally {
      setCsvUploading(false); csvInFlight.current = false; input.value = '';
    }
  }

  async function importOfficialRecords() {
    if (csvInFlight.current) return;
    csvInFlight.current = true; setCsvUploading(true); setCsvError(''); setCsvResult(null);
    try {
      const response = await fetch('/datasets/mospi-may2024-projects.json');
      if (!response.ok) throw new Error('Unable to load the official records. Please retry.');
      const file = new File([await response.blob()], 'mospi-may2024-projects.json', { type: 'application/json' });
      const result = await uploadFile(file, 'projects');
      setCsvResult(result);
      if (result.records_saved > 0) { resetFilters(); await load(); }
    } catch (error) {
      setCsvError(error instanceof Error ? error.message : 'Official import failed. Please retry.');
    } finally { csvInFlight.current = false; setCsvUploading(false); }
  }

  function editProject(project: ApiProject) {
    const next = { ...EMPTY_FORM };
    const missing = project.source_details?.missing_fields;
    for (const key of Object.keys(next) as (keyof typeof EMPTY_FORM)[]) {
      const value = project[key as keyof ApiProject];
      if (Array.isArray(missing) && missing.includes(key)) continue;
      if (key === 'approval_pending') next.approval_pending = value === true;
      else (next as Record<string, string | boolean>)[key] = value == null ? '' : String(value);
    }
    setForm(next); setEditingProject(project); setFormError(''); setShowAddModal(true);
  }

  async function handleSaveProject() {
    setFormError('');
    const required = ['project_code', 'name', 'state', 'district', 'authority', 'project_type'];
    const missing = required.filter(f => !form[f as keyof typeof form]);
    if (missing.length) { setFormError(`Required: ${missing.join(', ')}`); return; }

    setSaving(true);
    try {
      const payload = {
        project_code: form.project_code,
        name: form.name,
        state: form.state,
        district: form.district,
        authority: form.authority,
        project_type: form.project_type,
        description: form.description || undefined,
        latitude: form.latitude ? parseFloat(form.latitude) : undefined,
        longitude: form.longitude ? parseFloat(form.longitude) : undefined,
        land_required: form.land_required ? parseFloat(form.land_required) : 0,
        land_acquired: form.land_acquired ? parseFloat(form.land_acquired) : 0,
        affected_families: form.affected_families ? parseInt(form.affected_families) : 0,
        current_stage: form.current_stage || undefined,
        status: form.status || 'Active',
        compensation_status: form.compensation_status || undefined,
        objection_count: form.objection_count ? parseInt(form.objection_count) : 0,
        legal_case_count: form.legal_case_count ? parseInt(form.legal_case_count) : 0,
        rr_status: form.rr_status || undefined,
        env_clearance_status: form.env_clearance_status || undefined,
        forest_clearance_status: form.forest_clearance_status || undefined,
        crz_status: form.crz_status || undefined,
        doc_completeness_pct: form.doc_completeness_pct ? parseFloat(form.doc_completeness_pct) : 50,
        approval_pending: form.approval_pending,
        overdue_milestones: form.overdue_milestones ? parseInt(form.overdue_milestones) : 0,
      };
      if (editingProject) {
        const changes = Object.fromEntries(Object.entries(payload).filter(([key, value]) =>
          key !== 'project_code' && value !== undefined && form[key as keyof typeof form] !== '' &&
          (value !== editingProject[key as keyof ApiProject] || (key !== 'approval_pending' && Array.isArray(editingProject.source_details?.missing_fields) && editingProject.source_details.missing_fields.includes(key)))
        ));
        await updateProject(editingProject.id, changes);
      } else {
        await createProject(payload);
      }
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      showToast(editingProject ? 'Project details saved' : 'Project created successfully');
      setEditingProject(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setFormError(`Project code '${form.project_code}' already exists.`);
      } else {
        setFormError(e instanceof Error ? e.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProject(projectId: string, projectName: string) {
    const ok = window.confirm(`Delete project "${projectName}"? This action cannot be undone.`);
    if (!ok) return;

    try {
      await deleteProject(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      showToast(`Project deleted: ${projectName}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Deletion failed';
      setError(msg);
      showToast('Failed to delete project');
    }
  }

  const uniqueStates = useMemo(() => ['All', ...Array.from(new Set(projects.map(p => p.state))).sort()], [projects]);

  const rows = useMemo(() => {
    let list = projects.filter(p => {
      const matchSearch = `${p.project_code} ${p.name} ${p.district} ${p.authority}`.toLowerCase().includes(search.toLowerCase());
      const rl = p.risk_level ?? (p.risk_score != null ? riskLevel(p.risk_score) : null);
      const matchRisk = riskFilter === 'All' || rl === riskFilter;
      const matchState = stateFilter === 'All' || p.state === stateFilter;
      const matchStage = stageFilter === 'All' || p.current_stage === stageFilter;
      const matchComp = compensationFilter === 'All' ? true
        : compensationFilter === 'Pending' ? p.compensation_status === 'Pending'
        : p.compensation_status !== 'Pending';
      const matchLegal = legalFilter === 'All' ? true
        : legalFilter === 'Has Disputes' ? (p.legal_case_count ?? 0) > 0
        : (p.legal_case_count ?? 0) === 0;
      return matchSearch && matchRisk && matchState && matchStage && matchComp && matchLegal;
    });

    list = list.sort((a, b) => {
      let va: string | number = 0;
      let vb: string | number = 0;
      if (sortKey === 'risk_score') { va = a.risk_score ?? -1; vb = b.risk_score ?? -1; }
      else if (sortKey === 'delay_probability') { va = a.delay_probability ?? -1; vb = b.delay_probability ?? -1; }
      else if (sortKey === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (sortKey === 'project_code') { va = a.project_code.toLowerCase(); vb = b.project_code.toLowerCase(); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [projects, search, riskFilter, stateFilter, stageFilter, compensationFilter, legalFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function handleExport(format: ExportFormat) {
    const headers = ['Project ID', 'Project Name', 'State', 'District', 'Authority', 'Acquisition Stage', 'Risk Level', 'Risk Score', 'Delay Prob', 'Compensation', 'Legal Cases', 'Status'];
    const dataRows = rows.map(p => [
      p.project_code, p.name, p.state, p.district, p.authority, p.current_stage ?? '',
      p.risk_level ?? '-', p.risk_score?.toFixed(1) ?? '-',
      p.delay_probability != null ? `${(p.delay_probability * 100).toFixed(1)}%` : '-',
      p.compensation_status ?? '-', p.legal_case_count ?? 0, p.status ?? ''
    ]);
    if (format === 'csv') exportToCSV('geomatrix-projects.csv', headers, dataRows);
    else if (format === 'excel') exportToExcel('geomatrix-projects.xls', 'Projects', headers, dataRows, 'Geomatrix Land Acquisition Projects Portfolio');
    else if (format === 'pdf') {
      const kpis = [
        { label: 'Total Monitored', value: String(projects.length) },
        { label: 'Critical Risk', value: String(projects.filter(p => p.risk_level === 'Critical').length) },
        { label: 'Showing Filtered', value: String(rows.length) },
      ];
      exportToPDF('Geomatrix Portfolio Projects Register', 'National Land Acquisition Automated Risk Monitoring', headers, dataRows, 'geomatrix-projects.pdf', kpis);
    }
  }

  const activeFilters = [riskFilter, stateFilter, stageFilter, compensationFilter, legalFilter].filter(f => f !== 'All').length;

  function resetFilters() {
    setSearch(''); setRiskFilter('All'); setStateFilter('All');
    setStageFilter('All'); setCompensationFilter('All'); setLegalFilter('All');
  }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? <span style={{ color: 'var(--blue)', fontWeight: 700 }}>{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
      : <ArrowUpDown size={10} style={{ marginLeft: 4, opacity: 0.4 }} />;

  return (
    <div className="page">
      <div className="head">
        <div>
          <div className="eyebrow"><Filter size={11} /> Portfolio</div>
          <h1 className="h1">Projects</h1>
          <div className="sub">Monitor acquisition stage, risk, compensation and legal exposure across the portfolio.</div>
        </div>
        <div className="actions">
          <label className="btn" style={{ cursor: 'pointer' }}>
            <Upload size={13} /> {csvUploading ? 'Uploading…' : 'Upload CSV / JSON'}
            <input aria-label="Upload project records" type="file" accept={UPLOAD_ACCEPT} disabled={csvUploading} style={{ display: 'none' }} onChange={handleCsvUpload} />
          </label>
          <a className="btn" href="/templates/project-records.csv" download>CSV template</a>
          <ExportDropdown label="Export" onExport={handleExport} />
          <button className="btn" onClick={() => { setEditingProject(null); setForm(EMPTY_FORM); setShowAddModal(true); }}><Plus size={13} /> Add Project</button>
          <Link className="btn primary" href="/map"><MapIcon size={13} /> View GIS Map</Link>
        </div>
      </div>

      <section className="panel" aria-label="Official government project records" style={{ marginBottom: 16 }}>
        <strong>Official government project records</strong>
        <p className="muted" style={{ margin: '8px 0', lineHeight: 1.7 }}>Import 30 projects from MoSPI’s May 2024 Flash Report, with agencies, costs, commissioning schedules, reported slippage and source pages. This is a historical snapshot. Unreported land and family details remain unknown; reported slippage is separate from AI predictions.</p>
        <div className="actions" style={{ flexWrap: 'wrap' }}>
          <button className="btn" disabled={csvUploading} onClick={importOfficialRecords}>{csvUploading ? 'Importing…' : 'Import 30 official projects'}</button>
          <a className="btn" href="/datasets/mospi-may2024-projects.json" download>Download official records</a>
          <a className="link" href="https://www.mospi.gov.in/sites/default/files/publication_reports/FlashReport_May_2024.pdf" target="_blank" rel="noreferrer">Read MoSPI source report</a>
        </div>
      </section>
      {csvResult && <div className="panel" style={{ marginBottom: 16 }}><UploadSummary result={csvResult} /></div>}
      <p className="muted" style={{ marginBottom: 14, fontSize: 12 }}>CSV or JSON · up to 4 MB / 5,000 records. Required: project_code (or project_id), name (or project_name), state.</p>
      {csvError && (
        <div style={{ padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, marginBottom: 16, color: 'var(--red-text)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertCircle size={14} /><span role="alert">{csvError}</span>
        </div>
      )}

      {/* Loading / Error states */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
          <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />Loading projects from database…
        </div>
      )}
      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 8, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--red-text)' }}>
          <AlertCircle size={14} />{error}
          <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontWeight: 600, fontSize: 12, marginLeft: 'auto' }}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary KPIs */}
          <div className="grid kpis" style={{ marginBottom: 16 }}>
            {([
              ['Total Monitored', projects.length, 'kpi'],
              ['Critical', projects.filter(p => p.risk_level === 'Critical').length, 'kpi kpi-critical'],
              ['High Risk', projects.filter(p => p.risk_level === 'High').length, 'kpi kpi-high'],
              ['Medium Risk', projects.filter(p => p.risk_level === 'Medium').length, 'kpi kpi-medium'],
              ['Low Risk', projects.filter(p => p.risk_level === 'Low').length, 'kpi kpi-low'],
              ['Showing', rows.length, 'kpi'],
            ] as [string, number, string][]).map(([label, val, cls]) => (
              <div key={label} className={cls}>
                <div className="kpi-head"><div className="label">{label}</div></div>
                <div className="value">{val}</div>
              </div>
            ))}
          </div>

          {/* Filter Bar */}
          <div className="filter-bar" style={{ marginBottom: 14 }}>
            <div className="filter-group">
              <div className="filter-item" style={{ flex: 1, minWidth: 200 }}>
                <Search size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                <input
                  className="filter-select"
                  style={{ flex: 1, border: 'none', background: 'transparent', padding: '6px 0', fontSize: 13, outline: 'none' }}
                  placeholder="Search projects…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="filter-group">
              <div className="filter-item">
                <label className="filter-label">State</label>
                <select className="filter-select" value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
                  {uniqueStates.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="filter-item">
                <label className="filter-label">Risk</label>
                <select className="filter-select" value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
                  <option>All</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option>
                </select>
              </div>
              <div className="filter-item">
                <label className="filter-label">Stage</label>
                <select className="filter-select" value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
                  <option>All</option>
                  {ACQUISITION_STAGES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="filter-item">
                <label className="filter-label">Compensation</label>
                <select className="filter-select" value={compensationFilter} onChange={e => setCompensationFilter(e.target.value)}>
                  <option>All</option><option>Pending</option><option>Progressing</option>
                </select>
              </div>
              <div className="filter-item">
                <label className="filter-label">Legal</label>
                <select className="filter-select" value={legalFilter} onChange={e => setLegalFilter(e.target.value)}>
                  <option>All</option><option>Has Disputes</option><option>No Disputes</option>
                </select>
              </div>
              {activeFilters > 0 && (
                <button className="filter-reset-btn" onClick={resetFilters}>
                  ✕ Reset {activeFilters} filter{activeFilters > 1 ? 's' : ''}
                </button>
              )}
            </div>
            <div className="filter-meta">
              <div className="filter-meta-item">
                <strong style={{ color: 'var(--ink)' }}>{rows.length}</strong>&nbsp;of {projects.length} projects
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="panel" style={{ padding: 0 }}>
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Project ID</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>Project Name <SortIcon k="name" /></th>
                    <th>State / District</th>
                    <th>Authority</th>
                    <th>Stage</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('risk_score')}>Risk Score <SortIcon k="risk_score" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('delay_probability')}>Delay Prob. <SortIcon k="delay_probability" /></th>
                    <th>Compensation</th>
                    <th>Legal Cases</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                        {projects.length === 0 ? 'No projects in database. Add a project or import data.' : 'No projects match the current filters.'}{' '}
                        {projects.length > 0 && <button onClick={resetFilters} style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontWeight: 600 }}>Reset filters</button>}
                      </td>
                    </tr>
                  ) : rows.map(p => {
                    const rl = (p.risk_level ?? (p.risk_score != null ? riskLevel(p.risk_score) : null))?.toLowerCase() ?? '';
                    return (
                      <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/projects/' + p.id}>
                        <td onClick={e => e.stopPropagation()}>
                          <span className="code-pill">{p.project_code}</span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <Link className="link" href={'/projects/' + p.id}>{p.name}</Link>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.state}</div>
                          <div style={{ color: 'var(--muted)', fontSize: 12 }}>{p.district}</div>
                        </td>
                        <td style={{ color: 'var(--ink-secondary)', fontSize: 12 }}>{p.authority}</td>
                        <td style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>{p.current_stage ?? '—'}</td>
                        <td>
                          {p.risk_score != null ? (
                            <span className={'risk ' + rl}>
                              {p.risk_level ?? riskLevel(p.risk_score)} · {p.risk_score.toFixed(1)}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Not predicted</span>
                          )}
                        </td>
                        <td style={{ fontWeight: 700, color: (p.delay_probability ?? 0) >= 0.75 ? 'var(--red-text)' : (p.delay_probability ?? 0) >= 0.5 ? 'var(--orange)' : 'var(--ink)' }}>
                          {p.delay_probability != null ? `${(p.delay_probability * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td>
                          <span className="risk" style={p.compensation_status === 'Pending'
                            ? { background: 'var(--red-bg)', color: 'var(--red-text)', border: '1px solid rgba(196,61,61,.2)' }
                            : p.compensation_status === 'Partial' || p.compensation_status === 'In Progress'
                              ? { background: 'var(--amber-bg)', color: 'var(--amber-text)', border: '1px solid rgba(202,138,4,.25)' }
                              : { background: 'var(--green-bg)', color: 'var(--green-text)', border: '1px solid rgba(22,132,91,.2)' }
                          }>
                            {p.compensation_status ?? '—'}
                          </span>
                        </td>
                        <td>
                          <span className="risk" style={(p.legal_case_count ?? 0) > 5
                            ? { background: 'var(--red-bg)', color: 'var(--red-text)' }
                            : (p.legal_case_count ?? 0) > 0
                              ? { background: 'var(--amber-bg)', color: 'var(--amber-text)' }
                              : { background: 'var(--green-bg)', color: 'var(--green-text)' }
                          }>
                            {p.legal_case_count ?? 0} {(p.legal_case_count ?? 0) === 1 ? 'case' : 'cases'}
                          </span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: p.status === 'Intervention Required' ? 'var(--red-text)' : p.status === 'At Risk' ? 'var(--orange-text)' : p.status === 'Watch' ? 'var(--amber-text)' : 'var(--green-text)' }}>
                              {p.status ?? '—'}
                            </span>
                            <button className="btn" onClick={() => editProject(p)} aria-label={`Edit ${p.name}`} title="Edit project details"><Pencil size={11} /></button>
                            <button
                              className="btn"
                              onClick={() => handleDeleteProject(p.id, p.name)}
                              style={{ padding: '6px 8px', fontSize: 11, minWidth: 0, background: 'rgba(239,68,68,0.09)', color: 'var(--red-text)', border: '1px solid rgba(239,68,68,0.25)' }}
                              title={`Delete ${p.name}`}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--line)' }}>
              Showing {rows.length} project{rows.length !== 1 ? 's' : ''} · Sorted by {sortKey} ({sortDir}) · Click column headers to sort
            </div>
          </div>
        </>
      )}

      {/* Add Project Modal */}
      {showAddModal && (
        <div className="modalbg" onClick={() => { setShowAddModal(false); setForm(EMPTY_FORM); setFormError(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontWeight: 800 }}>{editingProject ? 'Edit Project Details' : 'Add New Project'}</h3>
              <button onClick={() => { setShowAddModal(false); setForm(EMPTY_FORM); setFormError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={18} /></button>
            </div>

            {formError && (
              <div style={{ padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, marginBottom: 14, fontSize: 13, color: 'var(--red-text)', display: 'flex', gap: 8 }}>
                <AlertCircle size={14} />{formError}
              </div>
            )}

            <div className="form" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field form={form} setForm={setForm} label="Project Code" name="project_code" required />
              <Field form={form} setForm={setForm} label="Project Name" name="name" required />
              <Field form={form} setForm={setForm} label="State" name="state" required />
              <Field form={form} setForm={setForm} label="District" name="district" required />
              <Field form={form} setForm={setForm} label="Authority" name="authority" required />
              <Field form={form} setForm={setForm} label="Project Type" name="project_type" required as="select"
                options={['Civil Aviation', 'Atomic Energy', 'Road / Highway', 'Railway', 'Power / Energy', 'Water / Irrigation', 'Industrial', 'Urban Development', 'Defence', 'Other']} />
              <Field form={form} setForm={setForm} label="Description" name="description" as="textarea" />
              <Field form={form} setForm={setForm} label="Current Acquisition Stage" name="current_stage" as="select" options={ACQUISITION_STAGES} />

              <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Land & Families</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field form={form} setForm={setForm} label="Land Required (ha)" name="land_required" type="number" />
                  <Field form={form} setForm={setForm} label="Land Acquired (ha)" name="land_acquired" type="number" />
                  <Field form={form} setForm={setForm} label="Affected Families" name="affected_families" type="number" />
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Risk Inputs</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field form={form} setForm={setForm} label="Compensation Status" name="compensation_status" as="select" options={['Pending', 'In Progress', 'Settled', 'Disputed']} />
                  <Field form={form} setForm={setForm} label="Objection Count" name="objection_count" type="number" />
                  <Field form={form} setForm={setForm} label="Legal Case Count" name="legal_case_count" type="number" />
                  <Field form={form} setForm={setForm} label="R&R Status" name="rr_status" as="select" options={['Pending', 'In Progress', 'Completed']} />
                  <Field form={form} setForm={setForm} label="Env Clearance" name="env_clearance_status" as="select" options={['Pending', 'Granted', 'NA']} />
                  <Field form={form} setForm={setForm} label="Forest Clearance" name="forest_clearance_status" as="select" options={['Pending', 'Granted', 'NA']} />
                  <Field form={form} setForm={setForm} label="CRZ Status" name="crz_status" as="select" options={['NA', 'Pending', 'Granted']} />
                  <Field form={form} setForm={setForm} label="Doc Completeness (%)" name="doc_completeness_pct" type="number" />
                  <Field form={form} setForm={setForm} label="Overdue Milestones" name="overdue_milestones" type="number" />
                  <Field form={form} setForm={setForm} label="Approval Pending" name="approval_pending" type="checkbox" />
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Location</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field form={form} setForm={setForm} label="Latitude" name="latitude" type="number" />
                  <Field form={form} setForm={setForm} label="Longitude" name="longitude" type="number" />
                  <Field form={form} setForm={setForm} label="Status" name="status" as="select" options={['Active', 'At Risk', 'Watch', 'Intervention Required', 'Completed', 'On Hold']} />
                </div>
              </div>
            </div>

            <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn" onClick={() => { setShowAddModal(false); setForm(EMPTY_FORM); setFormError(''); }}>Cancel</button>
              <button className="btn primary" onClick={handleSaveProject} disabled={saving}>
                {saving ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={13} />}
                {saving ? 'Saving…' : 'Save Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', right: 20, bottom: 20, background: 'var(--navy)', color: '#fff', padding: '13px 20px', borderRadius: 8, fontSize: 13, zIndex: 60, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 25px rgba(0,0,0,0.25)' }}>
          <CheckCircle2 size={15} style={{ color: '#4ade80' }} /> {toast}
        </div>
      )}
    </div>
  );
}
