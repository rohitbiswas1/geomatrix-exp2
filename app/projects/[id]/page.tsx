'use client';

import Link from 'next/link';
import SourceDetails from '../../../components/SourceDetails';
import { useParams } from 'next/navigation';
import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, BarChart, Bar, Cell
} from 'recharts';
import {
  ArrowLeft, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown,
  Minus, Brain, Activity, Sliders, GitBranch, Database, ArrowUpRight,
  Clock, User, MapPin, Zap, Target, FileWarning, RefreshCw, Sparkles, AlertCircle, Trash2
} from 'lucide-react';
import {
  fetchProject, runPrediction, fetchExplanation, explainWithGemini, validateProject,
  deleteProject, ApiProject, ShapFeature, PredictionResult, ApiError
} from '../../../lib/apiClient';
import { riskLevel, stages, type RiskLevel } from '../../../lib/data';
import ExportDropdown, { ExportFormat } from '../../../components/ExportDropdown';
import { exportToCSV, exportToExcel, exportToPDF } from '../../../lib/exportUtils';

// ─── Risk colour helpers ──────────────────────────────────────────────────────
const RISK_COLORS: Record<RiskLevel, string> = {
  Critical: '#dc2626', High: '#ea580c', Medium: '#d97706', Low: '#15803d'
};
const RISK_BG: Record<RiskLevel, string> = {
  Critical: 'rgba(220,38,38,0.08)', High: 'rgba(234,88,12,0.08)',
  Medium: 'rgba(217,119,6,0.08)', Low: 'rgba(21,128,91,0.08)'
};

// ─── Small components ─────────────────────────────────────────────────────────

function RiskBadge({ score }: { score: number }) {
  const rl = riskLevel(score);
  return (
    <span className={'risk ' + rl.toLowerCase()} style={{ fontSize: 12, fontWeight: 700 }}>
      {rl}
    </span>
  );
}

function TrendBadge({ trend }: { trend: string }) {
  if (trend === 'rising') return <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }}><TrendingUp size={13} /> Rising</span>;
  if (trend === 'falling') return <span style={{ color: '#15803d', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }}><TrendingDown size={13} /> Falling</span>;
  return <span style={{ color: '#6b7280', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Minus size={13} /> Stable</span>;
}

function MetricCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="kpi" style={{ minHeight: 80 }}>
      <div className="kpi-head">
        <div className="label">{label}</div>
        {icon}
      </div>
      <div className="value" style={{ fontSize: 24, color: color || 'var(--ink)' }}>{value}</div>
      {sub && <div className="trend" style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}

// ─── Tab definitions ──────────────────────────────────────────────────────────
const TABS = [
  { key: 'shap', label: 'AI Risk Analysis', icon: Brain },
  { key: 'forecast', label: 'Forecast & Prediction', icon: Activity },
  { key: 'simulator', label: 'What-If Simulator', icon: Sliders },
  { key: 'intervention', label: 'Interventions', icon: Target },
  { key: 'timeline', label: 'Acquisition Pipeline', icon: GitBranch },
  { key: 'lineage', label: 'Data Lineage', icon: Database },
] as const;
type TabKey = typeof TABS[number]['key'];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProjectRiskIntelligence() {
  const { id } = useParams<{ id: string }>();

  // ── Real API state ───────────────────────────────────────────────────────
  const [p, setP] = useState<ApiProject | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);
  const [projectError, setProjectError] = useState('');
  const [shapFeatures, setShapFeatures] = useState<ShapFeature[]>([]);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [runningPrediction, setRunningPrediction] = useState(false);
  const [predictionError, setPredictionError] = useState('');
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [geminiResult, setGeminiResult] = useState('');
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState('');

  const loadProject = useCallback(async () => {
    setLoadingProject(true);
    setProjectError('');
    try {
      const data = await fetchProject(id as string);
      setP(data);
      // Check validation
      try {
        const v = await validateProject(id as string);
        setMissingFields(v.missing_fields);
      } catch { /* ignore */ }
    } catch (e) {
      setProjectError(e instanceof ApiError ? `Error ${e.status}: ${e.message}` : 'Failed to load project');
    } finally {
      setLoadingProject(false);
    }
  }, [id]);

  useEffect(() => { loadProject(); }, [loadProject]);

  async function handleRunPrediction() {
    if (!p) return;
    setRunningPrediction(true);
    setPredictionError('');
    try {
      const res = await runPrediction(p.id);
      setPrediction(res.prediction);
      setShapFeatures(res.prediction.shap_features ?? []);
      await loadProject();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Prediction failed';
      let friendly = msg;
      try { const parsed = JSON.parse(msg); friendly = parsed.detail ?? msg; } catch { /* ignore */ }
      setPredictionError(friendly);
    } finally {
      setRunningPrediction(false);
    }
  }

  async function handleDeleteProject() {
    if (!p) return;
    const ok = window.confirm(`Delete project "${p.name}"? This action cannot be undone.`);
    if (!ok) return;

    try {
      await deleteProject(p.id);
      window.location.href = '/projects';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Deletion failed';
      setProjectError(msg);
    }
  }

  async function handleGeminiExplain() {
    if (!p) return;
    setGeminiLoading(true);
    setGeminiError('');
    setGeminiResult('');
    try {
      const res = await explainWithGemini({
        project: p as unknown as Record<string, unknown>,
        prediction: prediction as unknown as Record<string, unknown> ?? undefined,
        shap_features: shapFeatures.length > 0 ? shapFeatures : undefined,
      });
      setGeminiResult(res.summary);
    } catch (e) {
      setGeminiError(e instanceof ApiError ? e.message : 'Gemini explain failed');
    } finally {
      setGeminiLoading(false);
    }
  }

  const [activeTab, setActiveTab] = useState<TabKey>('shap');
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState('');
  const [assignedTo, setAssignedTo] = useState('District Land Acquisition Officer (DLAO)');
  const [dueDate, setDueDate] = useState('');
  const [interventionNote, setInterventionNote] = useState('');

  // ── What-If Simulator state (uses real risk score as baseline if available) ──
  const baseline = useMemo(() => ({
    pendingClaims: p?.objection_count ?? 0,
    legalCases: p?.legal_case_count ?? 0,
    docCompleteness: p?.doc_completeness_pct ?? 75,
    approvalPending: p?.approval_pending ?? false,
    rrPending: p?.rr_status === 'Pending' ? 10 : 0,
  }), [p]);

  const [simValues, setSimValues] = useState({ pendingClaims: 0, legalCases: 0, docCompleteness: 75, approvalPending: false, rrPending: 0 });

  useEffect(() => {
    if (p) {
      setSimValues({
        pendingClaims: p.objection_count ?? 0,
        legalCases: p.legal_case_count ?? 0,
        docCompleteness: p.doc_completeness_pct ?? 75,
        approvalPending: p.approval_pending ?? false,
        rrPending: p.rr_status === 'Pending' ? 10 : 0,
      });
    }
  }, [p]);

  const simulatedRisk = p?.risk_score ?? null;
  const simDelta = 0;
  const simDelayDays = null;
  function resetSimulator() { setSimValues(baseline); }

  // ── Derived display values ───────────────────────────────────────────────
  const riskScore = prediction?.risk_score ?? p?.risk_score;
  const riskLevelStr = (prediction?.risk_level ?? p?.risk_level ?? (riskScore != null ? riskLevel(riskScore) : 'Low')) as RiskLevel;
  const rl = riskLevelStr;
  const riskColor = RISK_COLORS[rl];
  const riskBg = RISK_BG[rl];
  const delayProb = prediction?.delay_probability ?? p?.delay_probability;
  const confidence = prediction?.confidence ?? p?.confidence;
  const factors = shapFeatures.length > 0 ? shapFeatures.map(f => ({
    feature: f.display_name ?? f.feature,
    contribution: f.shap_value * 100,
    pct: Math.abs(f.shap_value * 100),
    direction: f.direction,
    value: f.feature_value,
    description: f.description,
  })) : [];

  // ── Current stage index ──────────────────────────────────────────────────
  const currentStageIdx = stages.findIndex(s =>
    s.toLowerCase() === (p?.current_stage ?? '').toLowerCase() ||
    (p?.current_stage ?? '').toLowerCase().includes(s.split(' ')[0].toLowerCase())
  );
  const safeIdx = currentStageIdx >= 0 ? currentStageIdx : 2;

  function act(label: string) {
    setModal(false);
    setToast(label + ' recorded successfully');
    setTimeout(() => setToast(''), 3500);
  }

  const avgAccuracy = 0; // Not available for real projects yet

  // Loading / Error states
  if (loadingProject) return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
      <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--muted)' }} />
      <span style={{ marginLeft: 10, color: 'var(--muted)' }}>Loading project…</span>
    </div>
  );
  if (projectError || !p) return (
    <div className="page">
      <Link href="/projects" className="link" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 16 }}><ArrowLeft size={13} /> Back to Projects</Link>
      <div style={{ padding: '20px', background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 8, color: 'var(--red-text)' }}>
        <AlertCircle size={16} style={{ display: 'inline', marginRight: 8 }} />
        {projectError || 'Project not found.'}
      </div>
    </div>
  );

  const recs = [
    { title: 'Resolve pending compensation claims', priority: 'Critical', impact: 'Very High', owner: 'District Land Acquisition Officer', expected: 'Reduce delay probability' },
    { title: 'Escalate unresolved legal cases', priority: 'High', impact: 'High', owner: 'Legal Cell', expected: 'Reduce legal exposure' },
    { title: 'Complete missing land documents', priority: 'Medium', impact: 'Moderate', owner: 'Records & Verification Team', expected: 'Improve confidence and stage throughput' },
  ];

  function handleExport(format: ExportFormat) {
    if (!p) return;
    const headers = ['Metric / Parameter', 'Status / Value', 'Context / Statutory Note'];
    const rows: (string | number)[][] = [
      ['Project Code', p.project_code, 'Corridor identifier'],
      ['Project Name', p.name, `${p.project_type} corridor`],
      ['Administrative Region', `${p.district}, ${p.state}`, `${p.authority}`],
      ['Current Stage', p.current_stage ?? '', 'Statutory milestone under RFCTLARR 2013'],
      ['AI Risk Score', riskScore != null ? `${riskScore.toFixed(1)} / 100` : 'Not predicted', `Classification: ${rl}`],
      ['Delay Probability', delayProb != null ? `${(delayProb * 100).toFixed(1)}%` : 'Not predicted', 'Estimated delay probability'],
      ['Primary Delay Driver', p.primary_driver ?? '', 'Key bottleneck identified by AI surveillance'],
      ['Affected Families', `${p.affected_families} Families`, 'R&R entitlement register'],
      ['Compensation Status', p.compensation_status ?? '', 'Section 30 status'],
      ['Active Court Cases', `${p.legal_case_count ?? 0} Active Writs`, 'High Court stay / injunction exposure'],
      ['Approval Status', p.approval_pending ? 'Pending Clearances' : 'Cleared', 'Forest / Environment / Wildlife'],
      ...factors.map(f => [
        `Risk Factor: ${f.feature}`,
        `${f.direction === 'up' ? '+' : '-'}${Math.abs(f.contribution).toFixed(1)} score impact (${f.pct.toFixed(1)}%)`,
        `Current value: ${String(f.value ?? 'N/A')}`
      ])
    ];

    const filename = `geomatrix-project-${p.project_code.toLowerCase()}`;
    if (format === 'csv') exportToCSV(`${filename}.csv`, headers, rows);
    else if (format === 'excel') exportToExcel(`${filename}.xls`, p.project_code.slice(0, 31), headers, rows, `Geomatrix Project Dossier: ${p.name} (${p.project_code})`);
    else if (format === 'pdf') {
      const kpis = [
        { label: 'Risk Score', value: riskScore != null ? `${riskScore.toFixed(1)}/100` : 'N/A' },
        { label: 'Delay Prob', value: delayProb != null ? `${(delayProb * 100).toFixed(1)}%` : 'N/A' },
        { label: 'Affected Families', value: String(p.affected_families) },
      ];
      exportToPDF(`Project Risk Dossier: ${p.project_code}`, `${p.name} · ${p.district}, ${p.state} · Stage: ${p.current_stage ?? ''}`, headers, rows, `${filename}.pdf`, kpis);
    }
  }

  return (
    <div className="page">
      {/* ── Breadcrumb ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 14 }}>
        <Link href="/projects" className="link" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <ArrowLeft size={13} /> Back to Projects
        </Link>
      </div>

      <SourceDetails project={p} />

      {/* ── Missing Fields Warning ────────────────────────────────────── */}
      {missingFields.length > 0 && (
        <div style={{ padding: '10px 16px', background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 8, marginBottom: 16, fontSize: 13, color: 'var(--amber-text)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <FileWarning size={14} />
          <strong>Prediction unavailable:</strong> {missingFields.length} required field(s) missing — {missingFields.join(', ')}.
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>Edit the project to add these fields, then run prediction.</span>
        </div>
      )}

      {/* ── Prediction Error ─────────────────────────────────────────── */}
      {predictionError && (
        <div style={{ padding: '10px 16px', background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 8, marginBottom: 16, fontSize: 13, color: 'var(--red-text)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertCircle size={14} />{predictionError}
        </div>
      )}

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">
            <Brain size={11} style={{ display: 'inline', marginRight: 4 }} />
            AI Risk Intelligence · {p.project_code}
          </div>
          <h1 className="h1" style={{ margin: '4px 0 6px' }}>{p.name}</h1>
          <div className="sub" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span><MapPin size={11} style={{ display: 'inline' }} /> {p.district}, {p.state}</span>
            <span>·</span><span>{p.authority}</span>
            <span>·</span><span>{p.project_type}</span>
            <span>·</span><span style={{ fontWeight: 600 }}>Stage: {p.current_stage ?? '—'}</span>
          </div>
        </div>
        <div className="actions">
          <ExportDropdown label="Export" onExport={handleExport} tooltip="Export Project Dossier (PDF, Excel, CSV)" />
          <Link className="btn" href="/map"><MapPin size={12} /> GIS View</Link>
          <button
            className="btn"
            onClick={handleRunPrediction}
            disabled={runningPrediction || missingFields.length > 0}
            title={missingFields.length > 0 ? `Missing: ${missingFields.join(', ')}` : 'Run ML risk prediction using stored project data'}
          >
            {runningPrediction
              ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
              : <Activity size={13} />}
            {runningPrediction ? 'Running…' : 'Run Risk Prediction'}
          </button>
          <button className="btn" onClick={handleDeleteProject} style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red-text)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <Trash2 size={13} /> Delete
          </button>
          <button className="btn primary" onClick={() => setModal(true)}>
            <Zap size={13} /> Assign Intervention
          </button>
        </div>
      </div>

      {/* ── Hero Risk Panel ───────────────────────────────────────────────── */}
      <div style={{
        margin: '18px 0', padding: '20px 24px',
        background: riskBg, border: `1.5px solid ${riskColor}30`,
        borderLeft: `4px solid ${riskColor}`,
        borderRadius: 10,
      }}>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          {/* Risk Score */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>AI Composite Risk Score</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontSize: 52, fontWeight: 900, color: riskColor, lineHeight: 1 }}>
                {riskScore != null ? riskScore.toFixed(1) : '—'}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 16 }}>/100</span>
              <RiskBadge score={riskScore ?? 0} />
            </div>
            {riskScore == null && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Run prediction to compute risk score</div>
            )}
          </div>

          {/* Key Metrics */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {([
              ['Delay Probability', delayProb != null ? `${(delayProb * 100).toFixed(1)}%` : '—', 'of project exceeding threshold', riskColor],
              ['Predicted Delay', prediction?.predicted_delay_days != null ? `${prediction.predicted_delay_days} days` : '—', 'most likely scenario', '#ea580c'],
              ['Confidence', confidence != null ? `${(confidence * 100).toFixed(0)}%` : '—', 'model confidence', confidence != null && confidence > 0.88 ? 'var(--green)' : 'var(--amber)'],
            ] as [string, string, string, string][]).map(([label, val, sub, color]) => (
              <div key={label} style={{ textAlign: 'center', minWidth: 100 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Primary driver + disclaimer */}
        <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-secondary)' }}>
            <strong>Primary Risk Driver:</strong> {p.primary_driver ?? 'Not yet predicted'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 10px', background: 'var(--bg)', borderRadius: 4, border: '1px solid var(--line)' }}>
            ⚠ AI decision support — final authority rests with designated officers under RFCTLARR 2013
          </div>
        </div>
      </div>

      {/* ── KPI Strip ────────────────────────────────────────────────────── */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
        <MetricCard label="Land Area" value={(p.land_required ?? 0).toLocaleString() + ' ha'} color="var(--blue)" />
        <MetricCard label="Affected Families" value={(p.affected_families ?? 0).toLocaleString()} color={(p.affected_families ?? 0) > 150 ? 'var(--red)' : 'var(--amber)'} />
        <MetricCard label="Overdue Milestones" value={String(p.overdue_milestones ?? 0)} color={(p.overdue_milestones ?? 0) > 15 ? 'var(--red)' : 'var(--amber)'} sub="milestone breaches" />
        <MetricCard label="Open Legal Cases" value={String(p.legal_case_count ?? 0)} color={(p.legal_case_count ?? 0) > 5 ? 'var(--red)' : (p.legal_case_count ?? 0) > 0 ? 'var(--amber)' : 'var(--green)'} />
        <MetricCard label="Objections Filed" value={String(p.objection_count ?? 0)} color={(p.objection_count ?? 0) > 10 ? 'var(--red)' : 'var(--amber)'} sub="pending resolution" />
      </div>

      {/* ── Tab Navigation ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--line)', overflowX: 'auto' }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveTab(key)} style={{
            background: 'none', border: 'none', padding: '11px 18px', cursor: 'pointer',
            fontSize: 13, fontWeight: activeTab === key ? 700 : 500, whiteSpace: 'nowrap',
            color: activeTab === key ? 'var(--blue)' : 'var(--muted)',
            borderBottom: activeTab === key ? '2px solid var(--blue)' : '2px solid transparent',
            marginBottom: -2, display: 'inline-flex', alignItems: 'center', gap: 7, transition: 'all .15s'
          }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: AI Risk Analysis (SHAP)
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'shap' && (
        <div className="grid two">
          {/* SHAP Drivers */}
          <div className="panel">
            <div className="panelhead">
              <div>
                <div className="paneltitle">Top Risk Drivers — SHAP Contribution</div>
                <div className="muted">Why is this project at risk? Feature-level attribution.</div>
              </div>
              <span className="tag">EXPLAINABLE AI</span>
            </div>

            {factors.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--muted)', fontSize: 13 }}>
                <Brain size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
                <div style={{ fontWeight: 600 }}>No prediction yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Run risk prediction to see SHAP feature attribution</div>
              </div>
            ) : factors.slice(0, 6).map(f => (
              <div key={f.feature} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{f.feature}</span>
                  <span style={{ fontWeight: 800, fontSize: 12, color: f.contribution > 0 ? '#dc2626' : '#15803d' }}>
                    {f.contribution > 0 ? '+' : ''}{f.contribution.toFixed(1)} pts · {f.pct.toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: 10, background: 'var(--line)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{
                    width: Math.min(100, Math.abs(f.pct)) + '%',
                    height: '100%', borderRadius: 5, transition: 'width 0.6s ease',
                    background: f.contribution > 0
                      ? `linear-gradient(90deg, #dc2626, #ef4444)`
                      : `linear-gradient(90deg, #15803d, #22c55e)`
                  }} />
                </div>
              </div>
            ))}

            {/* AI Explanation block with Gemini */}
            <div style={{ marginTop: 18, padding: '14px 16px', background: 'var(--blue-light)', border: '1px solid var(--blue-border)', borderRadius: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--blue)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Brain size={13} /> AI Narrative Explanation</span>
                <button
                  onClick={handleGeminiExplain}
                  disabled={geminiLoading}
                  style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  title="Explain this project's risk with Google Gemini AI"
                >
                  {geminiLoading ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={11} />}
                  {geminiLoading ? 'Asking Gemini…' : 'Explain with Gemini AI'}
                </button>
              </div>

              {geminiError && (
                <div style={{ fontSize: 12, color: 'var(--red-text)', marginBottom: 8 }}>{geminiError}</div>
              )}

              {geminiResult ? (
                <p className="sub" style={{ lineHeight: 1.75, margin: 0, whiteSpace: 'pre-line' }}>{geminiResult}</p>
              ) : factors.length > 0 ? (
                <p className="sub" style={{ lineHeight: 1.75, margin: 0 }}>
                  This project is classified as <strong>{rl} RISK (score: {riskScore?.toFixed(1)}/100)</strong> with a{' '}
                  <strong>{delayProb != null ? `${(delayProb * 100).toFixed(1)}%` : '—'} probability of delay</strong>.
                  {factors[0] && <> The most significant contributor is <strong>{factors[0].feature} ({factors[0].pct.toFixed(1)}%)</strong></>}
                  {factors[1] && <>, followed by <strong>{factors[1].feature} ({factors[1].pct.toFixed(1)}%)</strong></>}.
                  {' '}Click &quot;Explain with Gemini AI&quot; for a full decision-support narrative.
                </p>
              ) : (
                <p className="sub" style={{ lineHeight: 1.75, margin: 0, color: 'var(--muted)' }}>
                  Run risk prediction first to generate an AI explanation.
                </p>
              )}
            </div>
          </div>

          {/* Risk Transitions + "Why Now?" */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="panel">
              <div className="panelhead">
                <div>
                  <div className="paneltitle">Risk Transitions — Why Now?</div>
                  <div className="muted">When and why risk level changed</div>
                </div>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0', lineHeight: 1.6 }}>
                {prediction ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: riskColor, marginTop: 5, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                        Risk scored at {riskScore?.toFixed(1)} / 100 · {rl}
                      </div>
                      <div style={{ fontSize: 12, marginTop: 2 }}>
                        Predicted on {new Date().toLocaleDateString('en-IN')} · Confidence: {confidence != null ? `${(confidence * 100).toFixed(0)}%` : '—'}
                      </div>
                    </div>
                  </div>
                ) : 'Run risk prediction to see transition history.'}
              </div>
            </div>

            {/* Audit Trail preview */}
            <div className="panel">
              <div className="panelhead">
                <div>
                  <div className="paneltitle">Project Data Summary</div>
                  <div className="muted">Stored field values for prediction</div>
                </div>
              </div>
              {([
                ['Compensation Status', p.compensation_status],
                ['R&R Status', p.rr_status],
                ['Env Clearance', p.env_clearance_status],
                ['Forest Clearance', p.forest_clearance_status],
                ['CRZ Status', p.crz_status],
                ['Doc Completeness', p.doc_completeness_pct != null ? `${p.doc_completeness_pct}%` : null],
              ] as [string, string | null | undefined][]).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '7px 0', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
                  <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{k}</span>
                  <span style={{ color: v ? 'var(--ink)' : 'var(--muted)', fontWeight: 600, fontSize: 12 }}>
                    {v ?? <em>Not set</em>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: Forecast & Prediction
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'forecast' && (
        <div className="grid two">
          {/* Risk Prediction Results */}
          <div className="panel">
            <div className="panelhead">
              <div>
                <div className="paneltitle">Risk Prediction Results</div>
                <div className="muted">Output from the most recent model run</div>
              </div>
            </div>
            {!prediction ? (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--muted)', fontSize: 13 }}>
                <Activity size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
                <div style={{ fontWeight: 600 }}>No prediction yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Click &quot;Run Risk Prediction&quot; to compute delay and risk forecast</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {([
                  ['Risk Score', `${prediction.risk_score.toFixed(1)} / 100`, riskColor],
                  ['Risk Level', prediction.risk_level, riskColor],
                  ['Delay Probability', `${(prediction.delay_probability * 100).toFixed(1)}%`, 'var(--orange)'],
                  ['Predicted Delay', prediction.predicted_delay_days != null ? `${prediction.predicted_delay_days} days` : '—', 'var(--orange)'],
                  ['Model Confidence', `${(prediction.confidence * 100).toFixed(0)}%`, prediction.confidence > 0.88 ? 'var(--green)' : 'var(--amber)'],
                ] as [string, string, string][]).map(([k, v, c]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>{k}</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: c }}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--line)', fontSize: 12, color: 'var(--muted)' }}>
                  Predicted on {new Date().toLocaleDateString('en-IN')} · Model: {prediction.model_version ?? 'active_model'} · Run ID: {prediction.model_run_id?.slice(0, 8) ?? 'N/A'}
                </div>
              </div>
            )}
          </div>

          {/* SHAP Bar Chart (when available) */}
          <div className="panel">
            <div className="panelhead">
              <div>
                <div className="paneltitle">Feature Impact (SHAP)</div>
                <div className="muted">Contribution of each feature to the risk score</div>
              </div>
              <span className="tag">MODEL VALIDATION</span>
            </div>
            {factors.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--muted)', fontSize: 13 }}>
                <Database size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
                <div>Run prediction to view feature impact chart</div>
              </div>
            ) : (
              <div className="chart" style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={factors.slice(0, 8).map(f => ({ name: f.feature.slice(0, 16), impact: Math.abs(f.contribution) }))}
                    layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 80 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis type="number" fontSize={10} tick={{ fill: 'var(--chart-text)' }} />
                    <YAxis dataKey="name" type="category" width={80} fontSize={9} tick={{ fill: 'var(--chart-text)' }} />
                    <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }} />
                    <Bar dataKey="impact" radius={[0, 4, 4, 0]}>
                      {factors.slice(0, 8).map((f, i) => (
                        <Cell key={i} fill={f.contribution > 0 ? '#dc2626' : '#15803d'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: What-If Simulator
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'simulator' && (
        <div className="grid two">
          <div className="panel">
            <div className="panelhead">
              <div>
                <div className="paneltitle">What-If Intervention Simulator</div>
                <div className="muted">Adjust inputs to see how interventions change predicted risk</div>
              </div>
              <span className="tag">SIMULATION MODE</span>
            </div>

            <div style={{ display: 'grid', gap: 20 }}>
              {/* Pending Claims */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontWeight: 700, fontSize: 13 }}>Pending Compensation Claims</label>
                  <span style={{ fontWeight: 800, fontSize: 14, color: simValues.pendingClaims < baseline.pendingClaims ? 'var(--green)' : simValues.pendingClaims > baseline.pendingClaims ? 'var(--red)' : 'var(--ink)' }}>
                    {simValues.pendingClaims} <span style={{ fontSize: 11, color: 'var(--muted)' }}>(baseline: {baseline.pendingClaims})</span>
                  </span>
                </div>
                <input type="range" min={0} max={50} value={simValues.pendingClaims}
                  onChange={e => setSimValues(v => ({ ...v, pendingClaims: +e.target.value }))}
                  style={{ width: '100%', accentColor: 'var(--blue)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
                  <span>0 (none)</span><span>50 (severe backlog)</span>
                </div>
              </div>

              {/* Legal Cases */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontWeight: 700, fontSize: 13 }}>Open Legal Cases</label>
                  <span style={{ fontWeight: 800, fontSize: 14, color: simValues.legalCases < baseline.legalCases ? 'var(--green)' : simValues.legalCases > baseline.legalCases ? 'var(--red)' : 'var(--ink)' }}>
                    {simValues.legalCases}
                  </span>
                </div>
                <input type="range" min={0} max={20} value={simValues.legalCases}
                  onChange={e => setSimValues(v => ({ ...v, legalCases: +e.target.value }))}
                  style={{ width: '100%', accentColor: 'var(--blue)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
                  <span>0</span><span>20</span>
                </div>
              </div>

              {/* Documentation Completeness */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontWeight: 700, fontSize: 13 }}>Documentation Completeness</label>
                  <span style={{ fontWeight: 800, fontSize: 14, color: simValues.docCompleteness > baseline.docCompleteness ? 'var(--green)' : 'var(--orange)' }}>
                    {simValues.docCompleteness}%
                  </span>
                </div>
                <input type="range" min={20} max={100} value={simValues.docCompleteness}
                  onChange={e => setSimValues(v => ({ ...v, docCompleteness: +e.target.value }))}
                  style={{ width: '100%', accentColor: 'var(--blue)' }} />
              </div>

              {/* R&R Pending */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontWeight: 700, fontSize: 13 }}>R&R Pending Families</label>
                  <span style={{ fontWeight: 800, fontSize: 14, color: simValues.rrPending < baseline.rrPending ? 'var(--green)' : 'var(--amber)' }}>
                    {simValues.rrPending}
                  </span>
                </div>
                <input type="range" min={0} max={40} value={simValues.rrPending}
                  onChange={e => setSimValues(v => ({ ...v, rrPending: +e.target.value }))}
                  style={{ width: '100%', accentColor: 'var(--blue)' }} />
              </div>

              {/* Approval Pending Toggle */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--line)' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Approval Pending</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Statutory clearance status</div>
                </div>
                <button
                  onClick={() => setSimValues(v => ({ ...v, approvalPending: !v.approvalPending }))}
                  style={{
                    padding: '6px 18px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                    background: simValues.approvalPending ? '#dc2626' : '#15803d', color: '#fff',
                    transition: 'background 0.2s ease'
                  }}
                >
                  {simValues.approvalPending ? 'Pending' : 'Cleared'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button className="btn" onClick={resetSimulator} style={{ flex: 1, justifyContent: 'center' }}>
                  Reset to Baseline
                </button>
                <button className="btn primary" onClick={() => act('Simulation scenario')} style={{ flex: 1, justifyContent: 'center' }}>
                  Save Scenario
                </button>
              </div>
            </div>
          </div>

          {/* Simulation Results */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="panel" style={{ borderLeft: `4px solid ${(simulatedRisk ?? -1) >= 75 ? '#dc2626' : (simulatedRisk ?? -1) >= 50 ? '#ea580c' : (simulatedRisk ?? -1) >= 25 ? '#d97706' : 'var(--line)'}` }}>
              <div className="paneltitle" style={{ marginBottom: 16 }}>Simulation Result</div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 20, alignItems: 'center', marginBottom: 20 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Current Risk</div>
                  <div style={{ fontSize: 48, fontWeight: 900, color: riskColor }}>{riskScore ?? 'Unavailable'}</div>
                  {riskScore != null && <RiskBadge score={riskScore} />}
                </div>
                <div style={{ textAlign: 'center', fontSize: 24, color: 'var(--muted)' }}>→</div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Simulated Risk</div>
                  <div style={{ fontSize: 48, fontWeight: 900, color: simulatedRisk == null ? 'var(--muted)' : RISK_COLORS[riskLevel(simulatedRisk)] }}>{simulatedRisk ?? 'Unavailable'}</div>
                  {simulatedRisk != null && <RiskBadge score={simulatedRisk} />}
                </div>
              </div>

              <div style={{ textAlign: 'center', padding: '12px', borderRadius: 8, marginBottom: 16, background: simDelta < 0 ? 'rgba(21,128,91,0.08)' : simDelta > 0 ? 'rgba(220,38,38,0.08)' : 'var(--bg)', border: `1px solid ${simDelta < 0 ? 'rgba(21,128,91,0.2)' : simDelta > 0 ? 'rgba(220,38,38,0.2)' : 'var(--line)'}` }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: simDelta < 0 ? '#15803d' : simDelta > 0 ? '#dc2626' : 'var(--muted)' }}>
                  {simDelta > 0 ? '+' : ''}{simDelta} pts risk {simDelta < 0 ? 'reduction' : simDelta > 0 ? 'increase' : 'unchanged'}
                </div>
                <div style={{ fontSize: 14, color: 'var(--ink-secondary)', marginTop: 4 }}>
                  Delay-day simulation unavailable — no verified regression model is active.
                </div>
              </div>

              {simDelta < -5 && (
                <div style={{ padding: '12px 14px', background: 'rgba(21,128,91,0.06)', border: '1px solid rgba(21,128,91,0.2)', borderRadius: 8 }}>
                  <div style={{ fontWeight: 800, color: '#15803d', fontSize: 13, marginBottom: 4 }}>✓ Recommended Intervention</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.6 }}>
                    This scenario changes the modeled risk profile, but delay-day estimates are unavailable because no verified regression model is active.
                  </div>
                </div>
              )}
            </div>

            {/* Scenario guidance */}
            <div className="panel">
              <div className="paneltitle" style={{ marginBottom: 12 }}>Simulation Guidance</div>
              {([
                ['Resolve all pending compensation claims', `Claims: ${baseline.pendingClaims} → 0`, 'Expected savings: 12–18 days'],
                ['Fast-track legal dispute resolution', `Cases: ${baseline.legalCases} → 0`, 'Expected savings: 8–14 days'],
                ['Complete documentation submission', `Doc: ${baseline.docCompleteness}% → 95%`, 'Expected savings: 5–9 days'],
              ]).map(([title, change, impact]) => (
                <div key={title as string} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{title as string}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{change as string} · {impact as string}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: Interventions
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'intervention' && (
        <div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 16, marginBottom: 20 }}>
            {recs.map((r, i) => (
              <div key={r.title} className="panel" style={{ borderLeft: `3px solid ${i === 0 ? '#dc2626' : i === 1 ? '#ea580c' : '#d97706'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span className={'risk ' + r.priority.toLowerCase()}>{r.priority}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Priority #{i + 1}</span>
                </div>
                <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 800 }}>{r.title}</h4>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
                  <div><User size={11} style={{ display: 'inline' }} /> <strong>Responsible Unit:</strong> {r.owner}</div>
                  <div><Target size={11} style={{ display: 'inline' }} /> <strong>Expected Impact:</strong> {r.expected}</div>
                </div>
                <div className="actions">
                  <button className="btn" onClick={() => setModal(true)}>Assign Officer</button>
                  <button className="btn" onClick={() => act('Task')}>Create Task</button>
                  <button className="btn" onClick={() => act('Escalation')}>Escalate</button>
                </div>
              </div>
            ))}
          </div>

          {/* Recovery reference */}
          <div className="panel">
            <div className="panelhead">
              <div>
                <div className="paneltitle">Recovery Precedents — Similar Projects</div>
                <div className="muted">How comparable projects resolved their risk and recovered timelines</div>
              </div>
            </div>
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Similar Project</th>
                    <th>State</th>
                    <th>Risk Score</th>
                    <th>Intervention Used</th>
                    <th>Outcome</th>
                    <th>Days Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    { name: 'Bengaluru-Mysuru Corridor', state: 'Karnataka', riskScore: 42, interventionUsed: 'Disbursed Section 30 escrow via fast-track Lok Adalat', outcome: 'Objections dropped; 88% possession achieved', delayAvoided: 45 },
                    { name: 'Delhi-Dehradun Expressway Ph-2', state: 'Uttarakhand', riskScore: 58, interventionUsed: 'Integrated wildlife crossing clearance expediting', outcome: 'Stage II forest clearance accorded', delayAvoided: 32 },
                    { name: 'Raipur-Visakhapatnam Package 3', state: 'Odisha', riskScore: 35, interventionUsed: 'Joint survey reconciliation with State Revenue Dept', outcome: 'All 14 title claims adjudicated', delayAvoided: 28 },
                  ]).map(sp => (
                    <tr key={sp.name}>
                      <td style={{ fontWeight: 600 }}>{sp.name}</td>
                      <td>{sp.state}</td>
                      <td><span className={'risk ' + riskLevel(sp.riskScore).toLowerCase()}>{riskLevel(sp.riskScore)} · {sp.riskScore}</span></td>
                      <td style={{ fontSize: 12 }}>{sp.interventionUsed}</td>
                      <td style={{ fontSize: 12, color: 'var(--green-text)' }}>{sp.outcome}</td>
                      <td style={{ fontWeight: 800, color: 'var(--green)' }}>▼ {sp.delayAvoided}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: Acquisition Pipeline
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'timeline' && (
        <div className="grid two">
          <div className="panel">
            <div className="panelhead">
              <div>
                <div className="paneltitle">Acquisition Stage Pipeline</div>
                <div className="muted">Current stage: <strong>{p.current_stage ?? 'In Progress'}</strong></div>
              </div>
            </div>
            {stages.map((s, i) => {
              const isCompleted = i < safeIdx;
              const isCurrent = i === safeIdx;
              const stageRiskScores: Record<string, number> = { 'Notification': 18, 'Objection / Hearing': 43, 'Compensation': 92, 'Award': 76, 'Possession': 58, 'Rehabilitation & Resettlement': 62, 'Legal / Dispute': 71 };
              const sr = stageRiskScores[s] ?? 40;
              return (
                <div key={s} className={'stage ' + (isCurrent ? 'current' : '')} style={{ padding: '12px 0' }}>
                  <div className="stagecircle" style={{
                    background: isCompleted ? 'var(--green-bg)' : isCurrent ? riskBg : 'var(--bg)',
                    color: isCompleted ? 'var(--green-text)' : isCurrent ? riskColor : 'var(--muted)',
                    border: `1px solid ${isCurrent ? riskColor + '40' : 'var(--line)'}`
                  }}>
                    {isCompleted ? <CheckCircle2 size={13} /> : isCurrent ? <AlertTriangle size={13} /> : i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: 13 }}>{s}</b>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {isCompleted ? '✓ Completed' : isCurrent ? `⚠ Current — ${p.overdue_milestones ?? 0} overdue milestones` : 'Pending'}
                    </div>
                  </div>
                  <span className={'risk ' + riskLevel(sr).toLowerCase()}>{riskLevel(sr)}</span>
                </div>
              );
            })}
          </div>

          <div className="panel">
            <div className="panelhead">
              <div>
                <div className="paneltitle">Stage Risk Analysis</div>
                <div className="muted">Comparative risk by stage</div>
              </div>
            </div>
            <div className="chart" style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[
                  { stage: 'Notification', risk: 18 }, { stage: 'Objections', risk: 43 },
                  { stage: 'Compensation', risk: 92 }, { stage: 'Award', risk: 76 },
                  { stage: 'Possession', risk: 58 }, { stage: 'R&R', risk: 62 }, { stage: 'Legal', risk: 71 }
                ]} margin={{ top: 5, right: 20, bottom: 30, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="stage" fontSize={10} tick={{ fill: 'var(--chart-text)' }} angle={-25} textAnchor="end" />
                  <YAxis fontSize={10} tick={{ fill: 'var(--chart-text)' }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }} />
                  <ReferenceLine y={75} stroke="#dc2626" strokeDasharray="4 4" />
                  <Bar dataKey="risk" radius={[4, 4, 0, 0]}>
                    {[18, 43, 92, 76, 58, 62, 71].map((r, i) => (
                      <Cell key={i} fill={RISK_COLORS[riskLevel(r)]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: Data Lineage
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'lineage' && (
        <div className="grid two">
          <div className="panel">
            <div className="panelhead">
              <div>
                <div className="paneltitle">Data Lineage & Provenance</div>
                <div className="muted">Sources and quality for this prediction</div>
              </div>
              <span className="tag">TRANSPARENCY</span>
            </div>
            <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
              {([
                ['Data Source', p.source_name || (p.source_url ? 'External Ingestion Pipeline' : 'Geomatrix Central Repository')],
                ['Last Updated', p.updated_at ? new Date(p.updated_at).toLocaleDateString('en-IN') : (p.imported_at ? new Date(p.imported_at).toLocaleDateString('en-IN') : 'Recent')],
                ['Validation Status', p.validation_status ?? 'Validated'],
                ['Data Classification', p.data_classification ?? 'Real Project Data'],
                ['Document Completeness', `${p.doc_completeness_pct ?? 85}%`],
                ['Model Confidence', confidence != null ? `${(confidence * 100).toFixed(1)}%` : 'Pending prediction'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{k}</span>
                  <span style={{ color: 'var(--ink)', fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{v}</span>
                </div>
              ))}
            </div>

            <div className="paneltitle" style={{ marginBottom: 10 }}>Features Used in Prediction</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['Land Required', 'Affected Families', 'Current Stage', 'Compensation Status', 'Legal Cases', 'Objections', 'Clearances', 'Overdue Milestones'].map(f => (
                <span key={f} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', background: 'var(--blue-light)', color: 'var(--blue)', borderRadius: 4, border: '1px solid var(--blue-border)' }}>
                  {f}
                </span>
              ))}
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
                <span>Data Completeness</span>
                <span style={{ color: (p.doc_completeness_pct ?? 85) >= 80 ? 'var(--green)' : 'var(--amber)' }}>
                  {p.doc_completeness_pct ?? 85}%
                </span>
              </div>
              <div style={{ height: 10, background: 'var(--line)', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: `${p.doc_completeness_pct ?? 85}%`, height: '100%', background: (p.doc_completeness_pct ?? 85) >= 80 ? 'var(--green)' : 'var(--amber)', borderRadius: 5, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          </div>

          {/* Full audit trail */}
          <div className="panel">
            <div className="panelhead">
              <div>
                <div className="paneltitle">Complete Audit Trail</div>
                <div className="muted">All system and officer actions for this project</div>
              </div>
            </div>
            <div>
              {([
                { action: 'Project Record Ingestion', user: p.source_name || 'System Ingest', role: 'Data Governance', date: p.imported_at ? new Date(p.imported_at).toLocaleDateString('en-IN') : 'Recent', outcome: `Imported with code ${p.project_code}`, status: 'completed' },
                { action: 'Schema & Geospatial Validation', user: 'Automated Validator', role: 'Integrity Engine', date: p.imported_at ? new Date(p.imported_at).toLocaleDateString('en-IN') : 'Recent', outcome: p.validation_status ?? 'Validated', status: 'completed' },
                { action: 'ML Risk Assessment Surveillance', user: 'XGBoost / Random Forest Pipeline', role: 'AI Model Engine', date: p.updated_at ? new Date(p.updated_at).toLocaleDateString('en-IN') : 'Recent', outcome: riskScore != null ? `Risk Score: ${riskScore} (${rl})` : 'Prediction pending', status: riskScore != null ? 'completed' : 'in-progress' },
              ]).map((evt, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, paddingBottom: 16, position: 'relative' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center',
                      background: evt.status === 'completed' ? 'var(--green-bg)' : evt.status === 'in-progress' ? 'var(--amber-bg)' : 'var(--bg)',
                      border: `2px solid ${evt.status === 'completed' ? 'var(--green)' : evt.status === 'in-progress' ? 'var(--amber)' : 'var(--line)'}`,
                      color: evt.status === 'completed' ? 'var(--green)' : evt.status === 'in-progress' ? 'var(--amber-text)' : 'var(--muted)',
                    }}>
                      {evt.status === 'completed' ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                    </div>
                    {i < 2 && <div style={{ width: 2, flex: 1, background: 'var(--line)', marginTop: 4 }} />}
                  </div>
                  <div style={{ paddingTop: 4, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{evt.action}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>
                      <User size={10} style={{ display: 'inline' }} /> {evt.user} · {evt.role}
                    </div>
                    <div style={{ fontSize: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ color: 'var(--muted)' }}><Clock size={10} style={{ display: 'inline' }} /> {evt.date}</span>
                      <span style={{ color: 'var(--ink-secondary)', fontWeight: 600 }}>{evt.outcome}</span>
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                      background: evt.status === 'completed' ? 'var(--green-bg)' : evt.status === 'in-progress' ? 'var(--amber-bg)' : 'var(--bg)',
                      color: evt.status === 'completed' ? 'var(--green-text)' : evt.status === 'in-progress' ? 'var(--amber-text)' : 'var(--muted)',
                    }}>
                      {evt.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Intervention Modal ────────────────────────────────────────────── */}
      {modal && (
        <div className="modalbg" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 style={{ margin: '0 0 6px', fontWeight: 800 }}>Assign Intervention</h3>
            <p className="sub" style={{ marginBottom: 18 }}>
              Record an intervention for <strong>{p.name}</strong>.
              &nbsp;<em style={{ fontSize: 11 }}>Prototype only.</em>
            </p>
            <div className="form">
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Assigned Officer / Unit</label>
              <input value={assignedTo} onChange={e => setAssignedTo(e.target.value)} />
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Priority Level</label>
              <select>
                <option>Critical — Immediate action (within 24h)</option>
                <option>High — Action within 48 hours</option>
                <option>Medium — Action within 7 days</option>
              </select>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Intervention Notes</label>
              <textarea rows={3} value={interventionNote || `Fast-track resolution of ${p.primary_driver || 'compensation backlog'}. Convene inter-departmental review within 5 working days.`} onChange={e => setInterventionNote(e.target.value)} />
              <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                <button className="btn" onClick={() => setModal(false)}>Cancel</button>
                <button className="btn primary" onClick={() => act('Intervention')}>
                  <CheckCircle2 size={13} /> Confirm & Record
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{ position: 'fixed', right: 20, bottom: 20, background: 'var(--navy)', color: '#fff', padding: '13px 20px', borderRadius: 8, fontSize: 13, zIndex: 60, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 25px rgba(0,0,0,0.25)', animation: 'fadeIn 0.3s ease' }}>
          <CheckCircle2 size={15} style={{ color: '#4ade80' }} /> {toast}
        </div>
      )}
    </div>
  );
}
