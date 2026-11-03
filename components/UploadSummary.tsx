import type { IngestResult } from '../lib/apiClient';

export default function UploadSummary({ result }: { result: IngestResult }) {
  const failed = result.records_failed ?? Math.max(0, result.records_skipped - (result.records_duplicated ?? 0));
  return <div role="status" aria-live="polite" style={{ fontSize: 12, lineHeight: 1.65, marginTop: 10 }}>
    <strong>{result.records_saved} new records saved from {result.records_fetched} submitted.</strong>{' '}
    {(result.records_duplicated ?? 0) > 0 && <span>{result.records_duplicated} already present; no duplicate copies created. </span>}
    {failed > 0 && <span style={{ color: 'var(--red-text)' }}>{failed} records could not be imported. </span>}
    {result.errors.length > 0 && <details open style={{ marginTop: 6 }}><summary>Row errors ({failed || result.errors.length})</summary><ul style={{ paddingLeft: 20, margin: '5px 0' }}>{result.errors.map((error, i) => <li key={i}>{error}</li>)}</ul>{failed > result.errors.length && <p>Showing the first {result.errors.length} errors. Correct the listed issues and upload again.</p>}</details>}
    {(result.warnings?.length ?? 0) > 0 && <details style={{ marginTop: 6 }}><summary>Import notes</summary><ul style={{ paddingLeft: 20, margin: '5px 0' }}>{result.warnings?.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
  </div>;
}
