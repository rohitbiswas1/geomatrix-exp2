'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Database,
  FileCheck2,
  Gauge,
  MapPinned,
  RefreshCw,
  ShieldAlert,
  Target,
  TriangleAlert,
  Users,
} from 'lucide-react';
import {
  ApiAlert,
  ApiProject,
  DashboardSummary,
  fetchAlerts,
  fetchDashboardSummary,
  fetchModelStatus,
  fetchProjects,
  ModelStatus,
} from '../../lib/apiClient';

const riskOrder = ['Critical', 'High', 'Medium', 'Low'];
const riskClass: Record<string, string> = {
  Critical: 'risk-critical',
  High: 'risk-high',
  Medium: 'risk-medium',
  Low: 'risk-low',
};

const pipelineStages = ['Notification', 'Objection / Hearing', 'Compensation', 'Award', 'Possession'];
const DashboardRiskMap = dynamic(() => import('../../components/DashboardRiskMap'), { ssr: false });

function unavailable(value: unknown) {
  return value === null || value === undefined || value === '' ? 'No verified data available' : String(value);
}

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? 'No verified data available' : value.toLocaleString('en-IN');
}

function formatDate(value?: string) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function severityClass(value?: string) {
  return riskClass[value ?? ''] ?? 'risk-unknown';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = 8000) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('Dashboard request timed out')), timeoutMs)),
  ]);
}

function StatCard({ label, value, detail, icon: Icon, tone = 'blue' }: {
  label: string;
  value: React.ReactNode;
  detail: string;
  icon: typeof Activity;
  tone?: string;
}) {
  return (
    <article className={`command-stat command-stat-${tone}`}>
      <div className="command-stat-icon"><Icon size={17} /></div>
      <div className="command-stat-label">{label}</div>
      <div className="command-stat-value">{value}</div>
      <div className="command-stat-detail">{detail}</div>
    </article>
  );
}

function EmptyState({ message = 'No verified data available' }: { message?: string }) {
  return <div className="command-empty">{message}</div>;
}

export default function CommandCenter() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [alerts, setAlerts] = useState<ApiAlert[]>([]);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setLoadError(false);
    const results = await Promise.allSettled([
      withTimeout(fetchDashboardSummary()),
      withTimeout(fetchProjects({ limit: 500 })),
      withTimeout(fetchAlerts('Open', 20)),
      withTimeout(fetchModelStatus()),
    ]);
    let received = 0;
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      received += 1;
      if (index === 0) setSummary(result.value as DashboardSummary);
      if (index === 1) setProjects(result.value as ApiProject[]);
      if (index === 2) setAlerts(result.value as ApiAlert[]);
      if (index === 3) setModel(result.value as ModelStatus);
    });
    setLoadError(received === 0);
    setLastRefresh(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const derived = useMemo(() => {
    const countByRisk = (level: string) => projects.filter((project) => project.risk_level === level).length;
    const totalProjects = projects.length;
    const critical = countByRisk('Critical');
    const high = countByRisk('High');
    const medium = countByRisk('Medium');
    const low = countByRisk('Low');
    const overdue = projects.length ? projects.reduce((total, project) => total + (project.overdue_milestones ?? 0), 0) : null;
    const legal = projects.length ? projects.reduce((total, project) => total + (project.legal_case_count ?? 0), 0) : null;
    const stages = projects.reduce<Record<string, number>>((result, project) => {
      if (project.current_stage) result[project.current_stage] = (result[project.current_stage] ?? 0) + 1;
      return result;
    }, {});
    return { totalProjects, critical, high, medium, low, overdue, legal, stages };
  }, [projects, summary]);

  const atRiskProjects = useMemo(() => projects
    .filter((project) => project.risk_score != null)
    .sort((a, b) => (b.risk_score ?? -1) - (a.risk_score ?? -1))
    .slice(0, 6), [projects]);

  const riskRows = [
    { label: 'Critical', value: derived.critical, icon: ShieldAlert },
    { label: 'High', value: derived.high, icon: TriangleAlert },
    { label: 'Medium', value: derived.medium, icon: AlertTriangle },
    { label: 'Low', value: derived.low, icon: CheckCircle2 },
  ];

  const modelMetrics = [
    ['Precision', model?.precision],
    ['Recall', model?.recall],
    ['F1 score', model?.f1_score],
    ['ROC-AUC', model?.roc_auc],
  ];
  const riskTotal = (derived.critical ?? 0) + (derived.high ?? 0) + (derived.medium ?? 0) + (derived.low ?? 0);
  const riskPercent = (value: number | null) => riskTotal > 0 && value != null ? (value / riskTotal) * 100 : 0;

  return (
    <div className="command-page">
      <section className="command-reference-hero">
        <div className="command-hero-copy">
          <div className="command-kicker"><Activity size={14} /> Government infrastructure intelligence</div>
          <h1>Welcome to <span>GEOMATRIX</span></h1>
          <p>Predictive intelligence for early detection of land acquisition delays</p>
          <div className="command-hero-tags"><span>AI-powered</span><span>Data-driven</span><span>Government ready</span><span>Real impact</span></div>
        </div>
        <div className="command-hero-slogan">Infrastructure<br />today.<br /><strong>A stronger India<br />tomorrow.</strong></div>
      </section>

      <p className="sub">Only production records are counted. Official imports are historical snapshots, not live project status. <Link href="/data">Review provenance and excluded sample records</Link>.</p>
      {loadError && <div className="command-system-warning"><AlertTriangle size={17} /> Data services did not return a verified response. Values below are withheld.</div>}
      {loading ? <div className="command-loading"><RefreshCw size={18} className="command-spin" /> Loading verified portfolio data</div> : (
        <>
          <section className="command-reference-kpis" aria-label="Portfolio summary">
            <StatCard label="Total projects" value={formatNumber(derived.totalProjects)} detail="Production records · samples excluded" icon={Target} />
            <StatCard label="Completed" value={formatNumber(projects.filter(p => p.status?.toLowerCase() === 'completed').length)} detail="Recorded completed status" icon={CheckCircle2} tone="green" />
            <StatCard label="At risk" value={riskTotal ? formatNumber((derived.critical ?? 0) + (derived.high ?? 0)) : 'Not predicted'} detail="Critical and high risk" icon={Clock3} tone="amber" />
            <StatCard label="Open interventions" value={formatNumber(summary?.alerts_open ?? (alerts.length || null))} detail="Require attention" icon={AlertTriangle} tone="red" />
          </section>

          <section className="command-reference-grid">
            <article className="command-panel command-map-panel">
              <div className="command-panel-heading"><div><span className="command-overline">Spatial oversight</span><h2>Project risk map</h2></div><Link href="/map" className="command-text-link">View full map <ArrowUpRight size={14} /></Link></div>
              <DashboardRiskMap projects={projects} />
            </article>

            <div className="command-reference-middle">
              <article className="command-panel command-distribution-panel">
                <div className="command-panel-heading"><div><span className="command-overline">Portfolio exposure</span><h2>Risk distribution</h2></div><Gauge size={19} /></div>
                <div className="command-distribution"><div className="command-donut-wrap"><div className="command-donut" style={{ background: riskTotal === 0 ? 'var(--line)' : undefined, '--critical-pct': `${riskPercent(derived.critical)}%`, '--high-pct': `${riskPercent(derived.high)}%`, '--medium-pct': `${riskPercent(derived.medium)}%`, '--low-pct': `${riskPercent(derived.low)}%` } as React.CSSProperties}><strong>{formatNumber(derived.totalProjects)}</strong></div><span>{riskTotal} predicted · {projects.length-riskTotal} unclassified</span></div><div className="command-distribution-legend">{riskRows.map(({ label, value }) => <div key={label}><i className={`risk-dot ${severityClass(label)}`} /><span>{label}</span><strong>{value == null || !derived.totalProjects ? 'N/A' : `${Math.round((value / derived.totalProjects) * 100)}%`}</strong></div>)}</div></div>
              </article>
              <article className="command-panel command-timeline-panel">
                <div className="command-panel-heading"><div><span className="command-overline">Operational flow</span><h2>Acquisition pipeline</h2></div><Link href="/projects" className="command-text-link">View details <ArrowUpRight size={14} /></Link></div>
                <div className="command-reference-timeline">{pipelineStages.map((stage) => <div key={stage} className="command-timeline-step"><span className="command-timeline-node" /><strong>{derived.stages[stage] ?? 0}</strong><small>{stage}</small></div>)}</div>
              </article>
            </div>

            <aside className="command-reference-aside">
              <article className="command-panel command-insights-panel"><div className="command-panel-heading"><div><span className="command-overline">Decision queue</span><h2>Predicted alerts</h2></div><Link href="/alerts" className="command-text-link">View all <ArrowUpRight size={14} /></Link></div>{alerts.length === 0 ? <EmptyState message="No model alerts. Open Alerts to review source-reported delays and missing inputs." /> : <div className="command-insight-list">{alerts.slice(0, 3).map((alert) => <Link href={`/projects/${alert.project_id}`} key={alert.id} className="command-insight"><span className={`command-insight-icon ${severityClass(alert.severity)}`}><AlertTriangle size={15} /></span><span><strong>{unavailable(alert.project_name)}</strong><small>{alert.reason}</small><em>{formatDate(alert.detected_at)}</em></span></Link>)}</div>}</article>
              <article className="command-panel command-actions-panel"><div className="command-panel-heading"><div><span className="command-overline">Workflow</span><h2>Quick actions</h2></div></div><div className="command-quick-actions"><Link href="/projects"><Target size={15} /> Project register</Link><Link href="/reports"><FileCheck2 size={15} /> Generate report</Link><Link href="/analytics"><Activity size={15} /> Run analysis</Link><Link href="/data"><Database size={15} /> Upload dataset</Link></div></article>
            </aside>
          </section>

          <section className="command-reference-bottom">
            <article className="command-panel command-table-panel"><div className="command-panel-heading"><div><span className="command-overline">Verified records</span><h2>Scored projects</h2></div><Link href="/projects" className="command-text-link">View all <ArrowUpRight size={14} /></Link></div>{atRiskProjects.length === 0 ? <EmptyState /> : <div className="command-table-wrap"><table className="command-table"><thead><tr><th>Project</th><th>State</th><th>Stage</th><th>Risk</th><th>Updated</th></tr></thead><tbody>{atRiskProjects.slice(0, 4).map((project) => <tr key={project.id}><td><strong>{project.name}</strong><span>{project.project_code}</span></td><td>{unavailable(project.state)}</td><td>{unavailable(project.current_stage)}</td><td><span className={`command-severity ${severityClass(project.risk_level)}`}>{project.risk_score == null ? 'Not available' : `${project.risk_score.toFixed(0)} · ${project.risk_level ?? 'Unclassified'}`}</span></td><td>{formatDate(project.updated_at)}</td></tr>)}</tbody></table></div>}</article>
            <article className="command-panel command-system-panel"><div className="command-panel-heading"><div><span className="command-overline">Platform health</span><h2>System status</h2></div><span className="command-live-dot" /> </div><div className="command-health-grid"><div><Database size={17} /><span>Data pipeline</span><strong>{summary ? 'Operational' : 'Not available'}</strong></div><div><Activity size={17} /><span>AI models</span><strong>{model ? (model.trained ? 'Operational' : 'Not trained') : 'Not available'}</strong></div><div><MapPinned size={17} /><span>Map services</span><strong>{projects.length ? 'Operational' : 'Not available'}</strong></div></div><div className="command-panel-foot">{lastRefresh ? `Last refreshed ${lastRefresh.toLocaleTimeString('en-IN')}` : 'Awaiting verification'}</div></article>
          </section>
        </>
      )}
    </div>
  );
}
