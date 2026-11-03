'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Upload, CheckCircle2, Database, AlertCircle, RefreshCw, FileText, Trash2 } from 'lucide-react';
import { uploadFile, fetchIngestionLog, fetchTrainingDataSummary, fetchDashboardSummary, IngestionLogEntry, type IngestResult } from '../../lib/apiClient';

import UploadSummary from '../../components/UploadSummary';
import { UPLOAD_ACCEPT } from '../../lib/uploads';

type FileStatus = 'uploading' | 'validating' | 'ready' | 'partial' | 'error';

interface UploadedFile {
  id: string;
  result?: IngestResult;
  name: string;
  size: string;
  type: string;
  status: FileStatus;
  rows?: number;
  errors?: number;
  missingFields?: number;
  completenessPct?: number;
  errorMessage?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function DataPage() {
  const uploadInFlight = useRef(false);
  const fileSequence = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'quality' | 'pipeline' | 'nlp'>('upload');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [uploadDataType, setUploadDataType] = useState<'projects' | 'historical'>('projects');
  const [uploadLogs, setUploadLogs] = useState<IngestionLogEntry[]>([]);
  const [realQuality, setRealQuality] = useState<{ totalProjects: number; historicalRecords: number } | null>(null);
  const [isEngineering, setIsEngineering] = useState(false);
  const [pipelineMessage, setPipelineMessage] = useState('');
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);

  const loadDataInfo = useCallback(async () => {
    try {
      const [logs, trainSummary, dashSummary] = await Promise.all([
        fetchIngestionLog(15), fetchTrainingDataSummary(), fetchDashboardSummary(),
      ]);
      setUploadLogs(logs);
      setRealQuality({
        totalProjects: dashSummary.total_projects,
        historicalRecords: trainSummary.total_records,
      });
      return true;
    } catch {
      setPipelineMessage('Unable to refresh import history. Please try again.');
      return false;
    }
  }, []);

  useEffect(() => {
    loadDataInfo();
  }, [loadDataInfo]);

  async function addFiles(selected: File[]) {
    if (!selected.length || uploadInFlight.current) return;
    uploadInFlight.current = true; setUploading(true);
    const dataType = uploadDataType;
    try {
      for (const file of selected) {
        const id = String(++fileSequence.current);
        setFiles(prev => [...prev, { id, name: file.name, size: formatSize(file.size), type: file.name.split('.').pop()?.toUpperCase() || 'FILE', status: 'uploading' }]);
        try {
          const result = await uploadFile(file, dataType);
          setFiles(prev => prev.map(entry => entry.id === id ? {
            ...entry, result, status: result.status === 'failed' ? 'error' : result.status === 'partial' ? 'partial' : 'ready',
            rows: result.records_saved, errors: result.records_failed ?? 0,
            missingFields: result.missing_fields, completenessPct: result.completeness_pct,
          } : entry));
        } catch (error) {
          setFiles(prev => prev.map(entry => entry.id === id ? { ...entry, status: 'error', errorMessage: error instanceof Error ? error.message : 'Upload failed. Please try again.' } : entry));
        }
      }
      await loadDataInfo();
    } finally { uploadInFlight.current = false; setUploading(false); }
  }

  async function handleFileAdd(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    try { await addFiles(Array.from(input.files || [])); } finally { input.value = ''; }
  }

  function removeFile(id: string) {
    setFiles(prev => prev.filter(file => file.id !== id));
  }

  function refreshQuality() {
    setIsRefreshing(true);
    loadDataInfo().finally(() => setIsRefreshing(false));
  }

  const readyFiles = useMemo(() => files.filter(f => (f.rows ?? 0) > 0).length, [files]);
  const qualityMetrics = useMemo(() => {
    const totalRecords = files.reduce((sum, file) => sum + (file.result?.records_fetched || 0), 0);
    const imported = files.reduce((sum, file) => sum + (file.rows || 0), 0);
    const duplicates = files.reduce((sum, file) => sum + (file.result?.records_duplicated || 0), 0);
    const failedRecords = files.reduce((sum, file) => sum + (file.errors || 0), 0);
    const hasData = files.length > 0;
    const validRecords = imported;
    const score = totalRecords > 0 ? Math.round((validRecords / totalRecords) * 1000) / 10 : 0;
    return [
      { label: 'Total Records', value: totalRecords.toLocaleString(), color: 'var(--ink)', note: hasData ? 'From uploaded datasets' : 'No data uploaded' },
      { label: 'Rejected Records', value: failedRecords.toLocaleString(), color: 'var(--amber)', note: hasData ? 'See row errors in the upload results' : 'Waiting for upload' },
      { label: 'Duplicates Found', value: duplicates.toLocaleString(), color: 'var(--orange)', note: hasData ? 'Existing records skipped' : 'Waiting for upload' },
      { label: 'Invalid Coordinates', value: 'N/A', color: 'var(--red)', note: hasData ? 'Invalid values are listed in row errors' : 'Waiting for upload' },
      { label: 'Import Success', value: hasData ? `${score}%` : 'N/A', color: 'var(--green)', note: hasData ? 'Imported / submitted records' : 'Waiting for upload' },
      { label: 'Records Imported', value: validRecords.toLocaleString(), color: 'var(--blue)', note: hasData ? 'Saved to the database' : 'No records imported' },
    ];
  }, [files]);
  const completenessRows = useMemo(() => files.map(file => ({
    id: file.id,
    label: file.name,
    pct: file.result?.records_fetched ? Math.round(file.result.records_saved / file.result.records_fetched * 100) : 0,
    color: file.status === 'ready' ? 'var(--green)' : 'var(--muted)',
  })), [files]);

  const latestResult = files.slice().reverse().find(file => file.result)?.result;
  const pipelineSteps = [
    { label: 'Uploaded', desc: 'A file was received', done: !!latestResult },
    { label: 'Parsed', desc: 'Source records were read', done: (latestResult?.records_fetched ?? 0) > 0 },
    { label: 'Validated', desc: 'At least one record accepted', done: (latestResult?.records_saved ?? 0) + (latestResult?.records_duplicated ?? 0) > 0 },
    { label: 'Saved', desc: 'New records committed to the database', done: (latestResult?.records_saved ?? 0) > 0 },
    { label: 'Risk Analysis', desc: 'Run separately from the model page', done: false },
  ];

  async function triggerPipelineRun() {
    if (isPipelineRunning) return;
    setIsPipelineRunning(true);
    try { if (await loadDataInfo()) setPipelineMessage('Import history refreshed. Model training and risk analysis run separately.'); setActiveTab('pipeline'); }
    finally { setIsPipelineRunning(false); }
  }

  async function runValidationAndEngineering() {
    if (isEngineering) return;
    setIsEngineering(true);
    try { if (await loadDataInfo()) setPipelineMessage('Import results refreshed. See each file for validation errors and skipped records.'); }
    finally { setIsEngineering(false); }
  }

  return (
    <div className="page">
      <div className="head">
        <div>
          <div className="eyebrow"><Database size={11} /> Data Operations</div>
          <h1 className="h1">Data Management</h1>
          <div className="sub">
            Validate, clean and engineer project, parcel, compensation, legal and document datasets
            before AI risk prediction. Monitor data quality and pipeline status.
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={refreshQuality} disabled={isRefreshing}>
            <RefreshCw size={13} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            {isRefreshing ? 'Refreshing' : 'Refresh Status'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16, borderBottom: '2px solid var(--line)' }}>
        {([
          ['upload', 'File Upload', Upload],
          ['quality', 'Data Quality', CheckCircle2],
          ['pipeline', 'Processing Pipeline', RefreshCw],
          ['nlp', 'Document Intelligence', FileText],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              background: 'none', border: 'none', padding: '10px 16px', cursor: 'pointer',
              fontSize: 13, fontWeight: activeTab === key ? 700 : 500,
              color: activeTab === key ? 'var(--blue)' : 'var(--muted)',
              borderBottom: activeTab === key ? '2px solid var(--blue)' : '2px solid transparent',
              marginBottom: -2, display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Icon size={13} /> {label}
            {key === 'upload' && files.length > 0 && (
              <span style={{ background: 'var(--blue)', color: '#fff', borderRadius: 999, fontSize: 10, padding: '1px 5px', fontWeight: 700 }}>
                {files.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {pipelineMessage && activeTab === 'pipeline' && (
        <div role="status" style={{ marginBottom: 16, color: 'var(--green-text)', fontSize: 12 }}>
          {pipelineMessage}
        </div>
      )}

      {/* Tab: Upload */}
      {activeTab === 'upload' && (
        <div className="grid two">
          <div className="panel">
            <div className="paneltitle" style={{ marginBottom: 14 }}>Upload Datasets</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <button
                type="button"
                disabled={uploading} onClick={() => setUploadDataType('projects')}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  background: uploadDataType === 'projects' ? 'var(--blue)' : 'var(--bg)',
                  color: uploadDataType === 'projects' ? '#fff' : 'var(--ink)',
                  border: `1px solid ${uploadDataType === 'projects' ? 'var(--blue)' : 'var(--line)'}`
                }}
              >
                Project Records (CSV / JSON)
              </button>
              <button
                type="button"
                disabled={uploading} onClick={() => setUploadDataType('historical')}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  background: uploadDataType === 'historical' ? 'var(--blue)' : 'var(--bg)',
                  color: uploadDataType === 'historical' ? '#fff' : 'var(--ink)',
                  border: `1px solid ${uploadDataType === 'historical' ? 'var(--blue)' : 'var(--line)'}`
                }}
              >
                Historical Training Records (CSV / JSON)
              </button>
            </div>
            <label
              className="btn"
              onDragOver={event => event.preventDefault()}
              onDrop={event => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                padding: '32px 20px', borderStyle: 'dashed', cursor: 'pointer', width: '100%',
                textAlign: 'center', borderRadius: 8, marginBottom: 16,
                background: 'var(--bg)', transition: 'all 0.2s ease',
              }}
            >
              <Upload size={28} style={{ color: 'var(--blue)' }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Click to upload or drag &amp; drop</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  CSV or JSON · up to 4 MB / 5,000 records
                </div>
              </div>
              <input
                type="file"
                multiple
                aria-label="Upload datasets"
                disabled={uploading}
                accept={UPLOAD_ACCEPT}
                style={{ display: 'none' }}
                onChange={handleFileAdd}
              />
            </label>

            {files.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 13 }}>
                No files uploaded yet. Upload project records as CSV or JSON to begin.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {files.map(f => (
                  <div key={f.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center',
                    padding: '10px 14px', background: 'var(--bg)', borderRadius: 6,
                    border: '1px solid var(--line)', gap: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 6, display: 'grid', placeItems: 'center',
                        background: f.status === 'ready' ? 'var(--green-bg)' : f.status === 'error' ? 'var(--red-bg)' : 'var(--blue-light)',
                        color: f.status === 'ready' ? 'var(--green-text)' : f.status === 'error' ? 'var(--red-text)' : 'var(--blue)',
                        fontSize: 10, fontWeight: 800
                      }}>
                        {f.type.slice(0, 4)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {f.size}
                          {f.status === 'uploading' && '  Uploading'}
                          {f.status === 'validating' && '  Validating schema'}
                          {f.status === 'ready' && '  Import complete'}
                          {f.status === 'partial' && '  Imported with row errors'}
                          {f.status === 'error' && '  Import failed'}
                        </div>
                        {f.result && <UploadSummary result={f.result} />}
                        {f.errorMessage && <p role="alert" style={{ color: 'var(--red-text)', fontSize: 12 }}>{f.errorMessage}</p>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {f.status === 'ready' && <CheckCircle2 size={16} style={{ color: 'var(--green)' }} />}
                      {f.status === 'uploading' && <RefreshCw size={14} style={{ color: 'var(--blue)', animation: 'spin 1s linear infinite' }} />}
                      {f.status === 'validating' && <RefreshCw size={14} style={{ color: 'var(--amber)', animation: 'spin 1s linear infinite' }} />}
                      {(f.status === 'error' || f.status === 'partial') && <AlertCircle size={16} style={{ color: 'var(--red)' }} />}
                      <button
                        onClick={() => removeFile(f.id)} disabled={uploading}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}
                        title="Dismiss this upload result"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {readyFiles > 0 && (
                  <button
                    className="btn primary"
                    onClick={runValidationAndEngineering}
                    disabled={isEngineering}
                    style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
                  >
                    {isEngineering ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={13} />}
                    {isEngineering ? 'Refreshing import results' : `Refresh import results (${readyFiles} file${readyFiles > 1 ? 's' : ''})`}
                  </button>
                )}
                {pipelineMessage && (
                  <div role="status" style={{ marginTop: 10, color: 'var(--green-text)', fontSize: 12 }}>
                    {pipelineMessage}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="paneltitle" style={{ marginBottom: 14 }}>Import guidance</div>
            <p className="muted" style={{ fontSize: 12 }}>Projects require an ID, name, and state. Other missing text fields use Unknown.</p>
            <a className="btn" href="/templates/project-records.csv" download>Download project CSV template</a>
            {([
              ['CSV', 'Project records, compensation tables, legal case registers', 'var(--green)'],
              ['Excel', 'Save the worksheet as UTF-8 CSV before importing.', 'var(--blue)'],
              ['JSON', 'An array of project records or an object with a records array', 'var(--amber)'],

            ] as [string, string, string][]).map(([fmt, desc, color]) => (
              <div key={fmt} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)', alignItems: 'flex-start' }}>
                <div style={{ width: 42, height: 32, display: 'grid', placeItems: 'center', background: color + '20', color, borderRadius: 5, fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
                  {fmt.split(' / ')[0]}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{fmt}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Data Quality */}
      {activeTab === 'quality' && (
        <div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 }}>
            {qualityMetrics.map(({ label, value, color, note }) => (
              <div key={label} className="kpi">
                <div className="kpi-head"><div className="label">{label}</div></div>
                <div className="value" style={{ color }}>{value}</div>
                <div className="trend" style={{ fontSize: 12 }}>{note}</div>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panelhead">
              <div>
                <div className="paneltitle">New Records Saved per Upload</div>
                <div className="muted">Saved / submitted records in this session; duplicates are skipped</div>
              </div>
            </div>
            {completenessRows.length > 0 ? completenessRows.map(({ id, label, pct, color }) => (
              <div key={id} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  <span>{label}</span><span style={{ color }}>{pct}%</span>
                </div>
                <div style={{ height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 4 }} />
                </div>
              </div>
            )) : <div style={{ color: 'var(--muted)', fontSize: 13 }}>No uploaded datasets to analyze yet.</div>}
          </div>
        </div>
      )}

      {/* Tab: Pipeline */}
      {activeTab === 'pipeline' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0, marginBottom: 20 }}>
            {pipelineSteps.map((step, i) => (
              <div key={step.label} style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  className="panel"
                  style={{
                    flex: 1, textAlign: 'center', padding: '20px 12px',
                    borderLeft: step.done ? '3px solid var(--green)' : '3px solid var(--line)',
                    background: step.done ? 'var(--green-bg)' : 'var(--bg)',
                  }}
                >
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{step.done ? '' : ''}</div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: step.done ? 'var(--green-text)' : 'var(--muted)' }}>{step.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{step.desc}</div>
                </div>
                {i < pipelineSteps.length - 1 && (
                  <div style={{ width: 20, height: 2, background: 'var(--line-strong)', flexShrink: 0 }} />
                )}
              </div>
            ))}
          </div>

          <div className="grid two">
            <div className="panel">
              <div className="paneltitle" style={{ marginBottom: 14 }}>Pipeline Run History</div>
              {uploadLogs.length > 0 ? (
                uploadLogs.map(log => (
                  <div key={log.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)', alignItems: 'center', fontSize: 13 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>{log.finished_at ? new Date(log.finished_at).toLocaleTimeString('en-IN') : new Date(log.started_at).toLocaleTimeString('en-IN')}</span>
                    <span style={{ fontWeight: 600 }}>{log.source}</span>
                    <span style={{ color: 'var(--muted)' }}>{log.records_saved} saved ({log.records_skipped} skipped)</span>
                    <span className={'risk ' + (log.status === 'success' ? 'low' : log.status === 'partial' ? 'medium' : 'critical')}>
                      {log.status}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>No pipeline runs recorded for uploaded data yet.</div>
              )}
            </div>

            <div className="panel">
              <div className="paneltitle" style={{ marginBottom: 14 }}>Import status</div>
              <div className="form">
                <p>Uploads are parsed, validated, and saved when submitted. Refresh to inspect persisted import history. Training runs separately in Model Intelligence.</p>
                <button
                  className="btn primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={triggerPipelineRun}
                  disabled={isPipelineRunning}
                >
                  <RefreshCw size={13} style={{ animation: isPipelineRunning ? 'spin 1s linear infinite' : 'none' }} />
                  {isPipelineRunning ? 'Refreshing…' : 'Refresh import history'}
                </button>
                {pipelineMessage && (
                  <div role="status" style={{ marginTop: 10, color: 'var(--green-text)', fontSize: 12 }}>
                    {pipelineMessage}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'nlp' && <section className="panel"><h2>Document extraction</h2><p>PDF and image extraction is not available. Upload structured CSV or JSON project and historical records using File Upload.</p><button className="btn primary" onClick={()=>setActiveTab('upload')}>Open File Upload</button></section>}
    </div>
  );
}
