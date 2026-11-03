'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {fetchProjects,type ApiProject} from '../lib/apiClient';
import {missingInputs,sourceDate,sourceNumber} from '../lib/projectEvidence';
export default function PortfolioEvidence({mode='summary'}:{mode?:'summary'|'reviews'|'quality'}) {
 const [projects,setProjects]=useState<ApiProject[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [filter,setFilter]=useState('all');
 const load=useCallback(async()=>{setLoading(true);setError('');try{setProjects(await fetchProjects({limit:500,dataset:mode==='quality'?'all':'production'}));}catch(e){setError(e instanceof Error?e.message:'Could not load source records.');}finally{setLoading(false);}},[mode]);
 useEffect(()=>{void load();},[load]);
 const real=projects.filter(p=>p.data_classification==='REAL'),excluded=projects.filter(p=>p.data_classification!=='REAL');
 const delayed=real.filter(p=>(sourceNumber(p,'reported_schedule_slippage_months')??0)>0);
 const incomplete=real.filter(p=>missingInputs(p).length>0);
 const rows=(mode==='quality'&&filter==='excluded'?excluded:filter==='delays'?delayed:filter==='inputs'?incomplete:real);
 return <section className="panel" style={{margin:'16px 0'}} aria-label="Source evidence">
 <div className="panelhead"><h2>{mode==='reviews'?'Source-backed review queue':mode==='quality'?'Saved data and provenance':'Source-reported portfolio evidence'}</h2><button className="btn" onClick={load} disabled={loading}>Refresh evidence</button></div>
 <p>Official source records are historical snapshots. Reported schedule slippage concerns the overall project; it is not a predicted risk percentage or a measured land-acquisition delay. Samples are excluded from production totals.</p>
 {error&&<p role="alert">{error}</p>}{loading?<p role="status">Loading source evidence…</p>:!error&&<>
 <div className="grid three"><div className="kpi"><div className="label">Production records</div><div className="value">{real.length}</div></div><div className="kpi"><div className="label">Source-reported schedule delays</div><div className="value">{delayed.length}</div></div><div className="kpi"><div className="label">Need acquisition inputs</div><div className="value">{incomplete.length}</div></div></div>
 {mode==='quality'&&<p><strong>{excluded.length} sample or non-production records preserved separately.</strong> These records do not count toward model training or the production portfolio.</p>}
 <div className="actions" style={{margin:'12px 0',flexWrap:'wrap'}}><label>Review filter <select className="btn" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Production records</option><option value="delays">Source-reported delays</option><option value="inputs">Missing prediction inputs</option>{mode==='quality'&&<option value="excluded">Sample / excluded records</option>}</select></label><Link className="btn" href="/data?type=historical">Upload labeled historical records</Link></div>
 <div className="tablewrap" style={{maxHeight:460,overflow:'auto'}}><table className="table"><thead><tr><th>Project / provenance</th><th>Source date</th><th>Reported slippage</th><th>Original / anticipated cost (₹ crore)</th><th>Review needed</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td><Link href={'/projects/'+p.id}>{p.name}</Link><div>{p.data_classification} · {p.source_name||'Source not recorded'}</div>{p.source_url&&<a href={p.source_url} target="_blank" rel="noreferrer">Original source</a>}</td><td>{sourceDate(p)}</td><td>{sourceNumber(p,'reported_schedule_slippage_months')==null?'Not reported':sourceNumber(p,'reported_schedule_slippage_months')+' months'}</td><td>{sourceNumber(p,'original_cost_cr')?.toLocaleString('en-IN')??'Not reported'} / {sourceNumber(p,'anticipated_cost_cr')?.toLocaleString('en-IN')??'Not reported'}</td><td>{p.data_classification!=='REAL'?'Excluded sample. Import a genuine source record.':missingInputs(p).length?'Record '+missingInputs(p).join(', '):'Acquisition inputs recorded'}<div>{p.latitude==null||p.longitude==null?'Exact coordinates needed for a project marker.':''}</div><Link href={'/projects/'+p.id}>Review project and assign intervention</Link></td></tr>)}</tbody></table>{!rows.length&&<p>No records match this filter.</p>}</div>
 </>}
 </section>;
}
