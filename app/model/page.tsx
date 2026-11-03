'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchModelStatus, fetchTrainingDataSummary, fetchProjects, trainModel, type ModelStatus, type TrainingDataSummary, type ApiProject } from '../../lib/apiClient';
export default function ModelIntelligence() {
  const [status,setStatus]=useState<ModelStatus|null>(null),[summary,setSummary]=useState<TrainingDataSummary|null>(null),[projects,setProjects]=useState<ApiProject[]>([]);
  const [loading,setLoading]=useState(true),[training,setTraining]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [tab,setTab]=useState('Overview');
  const load=useCallback(async()=>{setLoading(true);setError('');try{const [s,t,p]=await Promise.all([fetchModelStatus(),fetchTrainingDataSummary(),fetchProjects({limit:500})]);setStatus(s);setSummary(t);setProjects(p);}catch(e){setError(e instanceof Error?e.message:'Could not load model information.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  async function train(){setTraining(true);setError('');setNotice('');try{const response=await trainModel();setNotice(response.message);await load();}catch(e){setError(e instanceof Error?e.message:'Training failed.');}finally{setTraining(false);}}
  const percent=(value?:number|null)=>status?.trained&&value!=null?(value*100).toFixed(1)+'%':'Unavailable';
  const scored=projects.filter(p=>p.risk_score!=null);
  const metrics=[['Precision',percent(status?.precision)],['Recall',percent(status?.recall)],['F1 score',percent(status?.f1_score)],['ROC-AUC',percent(status?.roc_auc)]] as const;
  return <div className="page">
    <div className="head"><div><div className="eyebrow">AI model intelligence</div><h1 className="h1">Model Intelligence</h1><p className="sub">Training status and metrics reported by the active model. Unmeasured values are never estimated.</p></div>
    <div className="actions"><button className="btn" onClick={load} disabled={loading||training}>Refresh</button><button className="btn primary" onClick={train} disabled={loading||training||!summary?.ready_to_train}>{training?'Training Model…':'Train Model'}</button></div></div>
    {error&&<p role="alert" className="error-alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {loading?<p role="status">Loading model information…</p>:status&&<>
      <section className="panel"><h2>{status.trained?'Model Active':'Not Trained'}</h2><p>{status.message}</p><p>{summary?.message}</p>{summary&&!summary.ready_to_train&&<p>Training requires at least 10 eligible labeled records, at least two examples of each outcome, and varying observed acquisition inputs. <Link href="/data">Upload historical records</Link>.</p>}
      <dl><dt>Algorithm</dt><dd>{status.algorithm||'Not trained'}</dd><dt>Trained at</dt><dd>{status.trained_at?new Date(status.trained_at).toLocaleString('en-IN'):'Unavailable'}</dd><dt>Training samples</dt><dd>{status.n_samples??'Unavailable'}</dd><dt>Eligible historical records</dt><dd>{summary?.total_records??'Unavailable'}</dd></dl></section>
      <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:14,marginTop:16}}>{metrics.map(([label,value])=><div className="kpi" key={label}><div className="label">{label}</div><div className="value" style={{fontSize:24}}>{value}</div></div>)}</div>
      <div className="actions" style={{margin:'16px 0',flexWrap:'wrap'}}>{['Overview','Features','Validation','Drift'].map(t=><button className="btn" aria-pressed={tab===t} key={t} onClick={()=>setTab(t)}>{t}</button>)}</div>
      {tab==='Overview'&&<section className="panel"><h2 className="paneltitle">Stored prediction distribution</h2><p>{scored.length} projects with predictions; {projects.length-scored.length} unclassified.</p><div className="tablewrap"><table className="table"><thead><tr><th>Risk range</th><th>Projects</th></tr></thead><tbody>{[['Low',0,25],['Medium',25,50],['High',50,75],['Critical',75,101]].map(([label,low,high])=><tr key={label}><td>{label}</td><td>{scored.filter(p=>p.risk_score!>=Number(low)&&p.risk_score!<Number(high)).length}</td></tr>)}</tbody></table></div></section>}
      {tab==='Features'&&<section className="panel"><h2>Model inputs</h2>{status.feature_names?.length?<ul>{status.feature_names.map(name=><li key={name}>{name.replaceAll('_',' ')}</li>)}</ul>:<p>No active model feature metadata. Train on eligible historical data first.</p>}<p>Feature importance ranks are unavailable; no default ranks are shown.</p></section>}
      {tab==='Validation'&&<section className="panel"><h2>Validation metrics</h2><p>The metrics above come from the active model metadata. A confusion matrix and fold-level validation results have not been published by the service.</p><p>Delay-day regression error: {status.trained&&status.rmse!=null?status.rmse.toFixed(2):'Unavailable'}</p></section>}
      {tab==='Drift'&&<section className="panel"><h2>Drift monitoring</h2><p>Drift measurements are not collected by the current service. No healthy, watch, or alert status can be inferred without a measured baseline.</p><button className="btn" disabled={loading} onClick={load}>Refresh model status</button></section>}
    </>}
  </div>;
}
