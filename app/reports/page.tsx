"use client";
import PortfolioEvidence from '../../components/PortfolioEvidence';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchProjects, fetchAlerts, type ApiProject, type ApiAlert } from '../../lib/apiClient';
import {sourceNumber,sourceDate} from '../../lib/projectEvidence';
import { portfolioSummary } from '../../lib/portfolio';
import { exportToCSV, exportToPDF } from '../../lib/exportUtils';
type SavedIntervention={id:string;project_name:string;action:string;assigned_to:string;priority:string;due_date?:string;note:string};
const types=['Executive Risk Summary','District Risk Report','Project Risk Report','Delay Driver Report','Intervention Report'];
export default function Reports(){
 const [projects,setProjects]=useState<ApiProject[]>([]),[alerts,setAlerts]=useState<ApiAlert[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [interventions,setInterventions]=useState<SavedIntervention[]>([]);
 const [selected,setSelected]=useState(types[0]);const preview=useRef<HTMLElement>(null);
 const [supportLoading,setSupportLoading]=useState(true),[supportError,setSupportError]=useState('');
 const load=useCallback(async()=>{
  setLoading(true);setError('');setSupportLoading(true);setSupportError('');
  const support=Promise.allSettled([fetchAlerts('all',500),fetch('/api/projects/interventions/all/records',{cache:'no-store',signal:AbortSignal.timeout(25000)}).then(async r=>{if(!r.ok)throw new Error('Saved interventions unavailable.');return r.json() as Promise<SavedIntervention[]>;})]);
  try{setProjects(await fetchProjects({limit:500}));}catch(e){setError(e instanceof Error?e.message:'Could not load project reports.');}finally{setLoading(false);}
  const [a,i]=await support;
  if(a.status==='fulfilled')setAlerts(a.value);if(i.status==='fulfilled')setInterventions(i.value);
  if(a.status==='rejected'||i.status==='rejected')setSupportError('Some alert or intervention records could not load. Refresh to retry. Project and source reports remain available.');
  setSupportLoading(false);
 },[]);
 useEffect(()=>{void load();},[load]);
 const summary=useMemo(()=>portfolioSummary(projects),[projects]);
 function report(type:string):{headers:string[];rows:(string|number)[][]}{
  if(type==='District Risk Report')return {headers:['State / district','Projects','Required land (ha)','Average stored risk'],rows:summary.districts.map(d=>[d.district,d.projects,d.land,d.average_risk??'Not predicted'])};
  if(type==='Delay Driver Report')return {headers:['Project','Reported schedule slippage (months)','Source-reported reason','Source date','Source URL'],rows:projects.filter(p=>sourceNumber(p,'reported_schedule_slippage_months')!=null).map(p=>[p.name,sourceNumber(p,'reported_schedule_slippage_months')??'Not reported',String(p.source_details?.delay_reason||'Not reported'),sourceDate(p),p.source_url||''])};
  if(type==='Intervention Report')return {headers:['Record type','Project','Priority','Status','Action / notes','Assigned to','Due date','Outcome'],rows:[...interventions.map(i=>['Intervention',i.project_name,i.priority,'Recorded',i.action+': '+i.note,i.assigned_to,i.due_date||'','']),...alerts.map(a=>['Alert',a.project_name||a.project_id,a.severity,a.status,a.recommended_action||a.reason,a.assigned_to||'',a.due_date||'',a.outcome||''])]};
  return {headers:['Project','Code','State','Status','Risk','Risk score','Reported schedule slippage (months)','Source date','Source URL'],rows:projects.map(p=>[p.name,p.project_code,p.state,p.status||'Unknown',p.risk_level||'Unclassified',p.risk_score??'Not predicted',sourceNumber(p,'reported_schedule_slippage_months')??'Not reported',sourceDate(p),p.source_url||''])};
 }
 const current=report(selected);
 function download(type:string,format:'csv'|'pdf'){const data=report(type);const name=type.toLowerCase().replaceAll(' ','-');if(format==='csv')exportToCSV(name+'.csv',data.headers,data.rows);else exportToPDF(type,'Saved project records; unclassified values have no model prediction',data.headers,data.rows,name+'.pdf');}
 return <div className="page"><div className="head"><div><div className="eyebrow">Decision reports</div><h1 className="h1">Reports</h1><p className="sub">Preview and export saved portfolio records. Reports do not invent missing predictions.</p></div><div className="actions"><button className="btn" disabled={loading} onClick={load}>Refresh</button><button className="btn primary" disabled={loading||!!error||!current.rows.length} onClick={()=>download(selected,'pdf')}>Download PDF</button></div></div>
 <PortfolioEvidence mode="summary"/>
 {supportLoading&&<p role="status">Loading saved alerts and interventions…</p>}{supportError&&<p role="alert">{supportError}</p>}
 {error&&<p role="alert" className="error-alert">{error}</p>}{loading?<p role="status">Loading reports…</p>:!error&&<>
 <div className="grid cards">{types.map(type=><section className="panel" key={type}><h2 style={{fontSize:15}}>{type}</h2><p className="sub">{type==='Intervention Report'?'Saved project interventions, alert statuses, and officer assignments.':type==='Delay Driver Report'?'Source-reported schedule slippage and reasons, with provenance. These are not model attributions.':type==='District Risk Report'?'Portfolio totals grouped by recorded district.':'Project records and stored risk predictions.'}</p><div className="actions"><button className="btn primary" aria-pressed={selected===type} onClick={()=>{setSelected(type);preview.current?.scrollIntoView({behavior:'smooth'});}}>Preview</button><button className="btn" disabled={!report(type).rows.length||(type==='Intervention Report'&&supportLoading)} onClick={()=>download(type,'csv')}>CSV</button></div></section>)}</div>
 <section className="panel" ref={preview} style={{marginTop:16}} aria-label="Report preview"><h2>{selected}</h2><p>{summary.total_projects} project records · {summary.classified_projects} with stored predictions · {summary.unclassified_projects} unclassified.</p>{current.rows.length?<div className="tablewrap"><table className="table"><thead><tr>{current.headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{current.rows.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j}>{value}</td>)}</tr>)}</tbody></table></div>:<p role="status">No records are available for this report. Predictions and alerts require an eligible trained model.</p>}</section>
 </>}
 </div>;
}
