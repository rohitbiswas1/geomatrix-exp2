import type { ApiProject } from '../lib/apiClient';

const labels: Record<string, string> = {
  as_of: 'Report snapshot', source_pdf_page: 'PDF page', source_annexure: 'Annexure',
  approval_month: 'Approval month', original_cost_cr: 'Original cost (₹ crore)',
  anticipated_cost_cr: 'Anticipated cost (₹ crore)', cumulative_expenditure_cr: 'Cumulative expenditure (₹ crore)',
  original_commissioning: 'Original commissioning', anticipated_commissioning: 'Anticipated commissioning',
  reported_schedule_slippage_months: 'Reported schedule slippage (months)', delay_reason: 'Reported delay reason',
  label_scope: 'What the reported delay measures',
};
export default function SourceDetails({ project }: { project: ApiProject }) {
  const details = project.source_details;
  if (!details?.as_of) return null;
  const missing = Array.isArray(details.missing_fields) ? details.missing_fields : [];
  return <section className="panel" aria-label="Official source details" style={{ marginBottom: 18 }}>
    <div className="paneltitle">Official source details</div>
    <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
      {project.source_name}. Historical snapshot; costs and dates reflect this report, rather than current live progress.
      {' '}{project.source_url?.startsWith('https://') && <a className="link" href={project.source_url} target="_blank" rel="noreferrer">Open source page</a>}
    </p>
    <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
      {Object.entries(labels).map(([key, label]) => <div key={key}>
        <dt className="muted" style={{ fontSize: 11 }}>{label}</dt>
        <dd style={{ margin: '4px 0 0', fontSize: 13, overflowWrap: 'anywhere' }}>{details[key] == null ? 'Not reported' : String(details[key])}</dd>
      </div>)}
    </dl>
    {missing.length > 0 && <details style={{ marginTop: 14, fontSize: 12 }}><summary>Acquisition fields not reported ({missing.length})</summary>
      <p style={{ lineHeight: 1.8 }}>{missing.join(', ')}.</p>
      <p>Blank acquisition values are unknown. They are not evidence of zero families, no disputes or granted clearances. Add verified acquisition inputs before running a prediction.</p>
    </details>}
  </section>;
}
