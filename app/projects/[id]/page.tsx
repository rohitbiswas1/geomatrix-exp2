'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import SourceDetails from '../../../components/SourceDetails';
import ExportDropdown, { type ExportFormat } from '../../../components/ExportDropdown';
import { exportToCSV, exportToExcel, exportToPDF } from '../../../lib/exportUtils';
import { fetchModelStatus, fetchProject, runPrediction, fetchExplanation, explainWithGemini, validateProject, deleteProject, type ApiProject, type ShapFeature, type PredictionResult } from '../../../lib/apiClient';

type Intervention = {id:string;action:string;assigned_to:string;priority:string;due_date?:string;note:string;created_at:string};
type Scenario = {objection_count:number;legal_case_count:number;doc_completeness_pct:number;approval_pending:boolean;rr_status:'Pending'|'Completed'};
async function workflow<T>(path:string,body?:unknown):Promise<T>{
 const res=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
 const data=await res.json().catch(()=>null);
 if(!res.ok)throw new Error(typeof data?.detail==='string'?data.detail:typeof data?.error==='string'?data.error:'This operation could not be completed. Please retry.');
 return data;
}
export default function ProjectRiskIntelligence(){
 const {id}=useParams<{id:string}>();
 const [project,setProject]=useState<ApiProject|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [tab,setTab]=useState('AI Risk Analysis'),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [missing,setMissing]=useState<string[]>([]),[factors,setFactors]=useState<ShapFeature[]>([]),[history,setHistory]=useState<Array<{id:string;risk_score:number;risk_level:string;predicted_at:string}>>([]);
 const [interventions,setInterventions]=useState<Intervention[]>([]),[workflowError,setWorkflowError]=useState('');
 const [assigned,setAssigned]=useState(''),[priority,setPriority]=useState('Medium'),[due,setDue]=useState(''),[note,setNote]=useState('');
 const [scenario,setScenario]=useState<Scenario>({objection_count:0,legal_case_count:0,doc_completeness_pct:50,approval_pending:false,rr_status:'Pending'});
 const [simulated,setSimulated]=useState<PredictionResult|null>(null),[summary,setSummary]=useState('');
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const p=await fetchProject(id);setProject(p);
   setScenario({objection_count:p.objection_count??0,legal_case_count:p.legal_case_count??0,doc_completeness_pct:p.doc_completeness_pct??50,approval_pending:p.approval_pending??false,rr_status:p.rr_status==='Completed'?'Completed':'Pending'});
   const validation=await validateProject(id);setMissing(validation.missing_fields);
   setHistory(await workflow('/api/projects/'+id+'/predictions'));
   if(p.risk_score!=null){try{setFactors((await fetchExplanation(id)).shap_features);}catch{setFactors([]);}}
   try{setInterventions(await workflow('/api/projects/'+id+'/interventions'));setWorkflowError('');}catch(e){setWorkflowError(e instanceof Error?e.message:'Could not load interventions.');}
  }catch(e){setError(e instanceof Error?e.message:'Could not load project.');}finally{setLoading(false);}
 },[id]);
 useEffect(()=>{void load();},[load]);
 async function action(run:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await run();}catch(e){setError(e instanceof Error?e.message:'Operation failed.');}finally{setBusy(false);}}
 function exportProject(format:ExportFormat){if(!project)return;const headers=['Code','Project','State','District','Status','Risk','Risk score','Delay probability'];const rows=[[project.project_code,project.name,project.state,project.district,project.status||'',project.risk_level||'Unclassified',project.risk_score??'',project.delay_probability??'']];if(format==='csv')exportToCSV(project.project_code+'.csv',headers,rows);else if(format==='excel')exportToExcel(project.project_code+'.xls','Project record',headers,rows);else exportToPDF(project.name,'Saved project record',headers,rows,project.project_code+'.pdf');}
 if(loading)return <div className="page" role="status">Loading project…</div>;
 if(!project)return <div className="page"><Link href="/projects">Back to Projects</Link><p role="alert">{error||'Project not found.'}</p><button className="btn" onClick={load}>Retry</button></div>;
 const p=project;
 return <div className="page">
  <Link href="/projects">← Back to Projects</Link><div className="head"><div><div className="eyebrow">{p.project_code}</div><h1 className="h1">{p.name}</h1><p className="sub">{p.district}, {p.state} · {p.authority}</p></div><div className="actions" style={{flexWrap:'wrap'}}>
   <button className="btn primary" disabled={busy} onClick={()=>action(async()=>{
    if(p.data_classification!=='REAL'){setNotice('This is a sample record, excluded from production predictions. Import a genuine project with source provenance in Data Management.');return;}
    if(missing.length){setNotice('Record the missing acquisition inputs below, then check Model Intelligence training readiness.');return;}
    const model=await fetchModelStatus();if(!model.trained){setNotice('No eligible trained model is available. Upload real labeled acquisition history in Data Management and train it in Model Intelligence.');return;}
    const r=await runPrediction(id);setFactors(r.prediction.shap_features||[]);await load();setNotice('Prediction saved.');})}>{busy?'Working…':'Run Prediction'}</button>
   <Link className="btn" href={'/projects?search='+encodeURIComponent(p.project_code)+'&dataset=all'}>Edit in Projects</Link><ExportDropdown onExport={exportProject}/>
   <button className="btn" disabled={busy} onClick={()=>{if(window.confirm('Delete audit or project record "'+p.name+'"?'))void action(async()=>{await deleteProject(id);window.location.assign('/projects');});}}>Delete Project</button>
  </div></div>
  {error&&<p role="alert" className="error-alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {p.data_classification!=='REAL'&&<p role="status" className="error-alert">Sample / non-production record. Excluded from dashboard totals and production predictions. <Link href="/data">Review data provenance</Link>.</p>}
  <p><Link href="/model">Check model readiness</Link> · <Link href="/data?type=historical">Upload real historical training records</Link></p>
  {missing.length>0&&<p role="status">Prediction needs recorded inputs: {missing.join(', ')}. Edit the project to supply them.</p>}
  <div className="grid three">{[['Risk score',p.risk_score==null?'Not predicted':p.risk_score+'/100'],['Risk level',p.risk_level||'Unclassified'],['Delay probability',p.delay_probability==null?'Not predicted':(p.delay_probability*100).toFixed(1)+'%'],['Current stage',p.current_stage||'Not recorded'],['Land required',p.land_required.toLocaleString('en-IN',{maximumFractionDigits:3})+' ha'],['Acquired land',p.land_acquired.toLocaleString('en-IN',{maximumFractionDigits:3})+' ha']].map(([label,value])=><div className="kpi" key={label}><div className="label">{label}</div><div className="value" style={{fontSize:20}}>{value}</div></div>)}</div>
  <div className="actions" style={{margin:'18px 0',flexWrap:'wrap'}}>{['AI Risk Analysis','Forecast & Prediction','What-If Simulator','Interventions','Acquisition Pipeline','Data Lineage'].map(t=><button className="btn" key={t} aria-pressed={t===tab} onClick={()=>setTab(t)}>{t}</button>)}</div>
  {tab==='AI Risk Analysis'&&<section className="panel"><h2>Risk explanation</h2>{factors.length?<ul>{factors.map(f=><li key={f.feature}>{f.display_name||f.feature}: {f.shap_value.toFixed(4)} · {f.description}</li>)}</ul>:<p>No active model explanation is available. Run a prediction after training the model on eligible historical data.</p>}<button className="btn" disabled={busy} onClick={()=>action(async()=>{const result=await explainWithGemini({project:p as unknown as Record<string,unknown>,shap_features:factors});setSummary(result.summary);})}>Generate AI explanation</button>{summary&&<p>{summary}</p>}</section>}
  {tab==='Forecast & Prediction'&&<section className="panel"><h2>Stored prediction history</h2>{history.length?<div className="tablewrap"><table className="table"><thead><tr><th>Generated</th><th>Risk score</th><th>Risk level</th></tr></thead><tbody>{history.map(h=><tr key={h.id}><td>{new Date(h.predicted_at).toLocaleString('en-IN')}</td><td>{h.risk_score}</td><td>{h.risk_level}</td></tr>)}</tbody></table></div>:<p>No predictions have been saved for this project.</p>}<p>Delay-day forecasts are unavailable without a validated regression model. No schedule savings are inferred.</p></section>}
  {tab==='What-If Simulator'&&<section className="panel"><h2>What-If Intervention Simulator</h2><p>Scenarios use the active trained model without changing the saved project.</p><div className="form">
   {(['objection_count','legal_case_count','doc_completeness_pct'] as const).map(key=><label key={key}>{key.replaceAll('_',' ')}<input aria-label={key.replaceAll('_',' ')} type="number" min={0} max={key==='doc_completeness_pct'?100:100000} value={scenario[key]} onChange={e=>{setScenario({...scenario,[key]:Number(e.target.value)});setSimulated(null);}}/></label>)}
   <label><input type="checkbox" checked={scenario.approval_pending} onChange={e=>{setScenario({...scenario,approval_pending:e.target.checked});setSimulated(null);}}/> Approval pending</label>
   <label>R&amp;R status<select value={scenario.rr_status} onChange={e=>{setScenario({...scenario,rr_status:e.target.value as Scenario['rr_status']});setSimulated(null);}}><option>Pending</option><option>Completed</option></select></label>
   <button className="btn primary" disabled={busy} onClick={()=>action(async()=>{const result=await workflow<{prediction:PredictionResult}>('/api/projects/'+id+'/simulate',scenario);setSimulated(result.prediction);})}>Run scenario</button>
   {simulated&&<p role="status">Scenario risk: {simulated.risk_score}/100 · {simulated.risk_level}. Current stored risk: {p.risk_score??'Not predicted'}.</p>}
   <button className="btn" disabled={busy||!simulated} onClick={()=>action(async()=>{await workflow('/api/projects/'+id+'/interventions',{action:'Scenario',assigned_to:'Scenario review',priority:'Medium',note:JSON.stringify({inputs:scenario,prediction:simulated})});await load();setNotice('Scenario saved for review.');})}>Save scenario</button>
  </div></section>}
  {tab==='Interventions'&&<section className="panel"><h2>Project interventions</h2>{workflowError&&<p role="alert">{workflowError}</p>}<form className="form" onSubmit={e=>{e.preventDefault();void action(async()=>{await workflow('/api/projects/'+id+'/interventions',{action:'Intervention',assigned_to:assigned,priority,due_date:due||null,note});setNote('');await load();setNotice('Intervention saved.');});}}>
   <label>Assigned officer / unit<input aria-label="Assigned officer / unit" required maxLength={200} value={assigned} onChange={e=>setAssigned(e.target.value)}/></label>
   <label>Priority<select aria-label="Intervention priority" value={priority} onChange={e=>setPriority(e.target.value)}>{['Critical','High','Medium','Low'].map(x=><option key={x}>{x}</option>)}</select></label>
   <label>Due date<input type="date" aria-label="Intervention due date" value={due} onChange={e=>setDue(e.target.value)}/></label>
   <label>Intervention notes<textarea aria-label="Intervention notes" required maxLength={4000} value={note} onChange={e=>setNote(e.target.value)}/></label>
   <button className="btn primary" disabled={busy}>Save intervention</button></form>
   <h3>Saved records</h3>{interventions.length?interventions.map(i=><article className="rec" key={i.id}><strong>{i.action} · {i.priority}</strong><p>{i.note}</p><p>Assigned to {i.assigned_to}{i.due_date?' · Due '+i.due_date:''} · {new Date(i.created_at).toLocaleString('en-IN')}</p></article>):<p>No saved interventions.</p>}
  </section>}
  {tab==='Acquisition Pipeline'&&<section className="panel"><h2>Recorded acquisition status</h2><p>Current stage: {p.current_stage||'Not recorded'}</p><p>Project status: {p.status||'Not recorded'}</p><p>Compensation: {p.compensation_status||'Not recorded'}</p><p>Overdue milestones: {p.overdue_milestones??'Not recorded'}</p><p>Stage-level dates and risk scores have not been recorded for this project.</p></section>}
  {tab==='Data Lineage'&&<section className="panel"><h2>Data lineage</h2><p>Source: {p.source_name||'Manual project record'}</p><p>Classification: {p.data_classification||'Not recorded'} · Validation: {p.validation_status||'Pending'}</p>{p.source_url&&<a href={p.source_url} target="_blank" rel="noreferrer">Open source</a>}<p>Imported: {p.imported_at?new Date(p.imported_at).toLocaleString('en-IN'):'Not recorded'}</p><p>Updated: {p.updated_at?new Date(p.updated_at).toLocaleString('en-IN'):'Not recorded'}</p><SourceDetails project={p}/></section>}
 </div>;
}
