"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { fetchProjects, type ApiProject } from '../../lib/apiClient';
import ProjectMap from '../../components/ProjectMap';
import { hasCoordinates } from '../../lib/coordinates';
export default function MapPage() {
  const [projects,setProjects] = useState<ApiProject[]>([]), [selected,setSelected] = useState<ApiProject|null>(null);
  const [query,setQuery] = useState(''), [state,setState] = useState('All'), [risk,setRisk] = useState('All');
  const [error,setError] = useState(''), [loading,setLoading] = useState(true);
  const load = useCallback(async()=>{setLoading(true);setError('');try{setProjects(await fetchProjects({limit:500}));}catch(e){setError(e instanceof Error?e.message:'Could not load projects.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  const filtered=useMemo(()=>projects.filter(p=>(!query || (p.name+' '+p.project_code+' '+p.district).toLowerCase().includes(query.toLowerCase())) && (state==='All'||p.state===state) && (risk==='All'||(p.risk_level||'Unclassified')===risk)),[projects,query,state,risk]);
  const located=filtered.filter(hasCoordinates);
  return <div className="page">
    <div className="head"><div><div className="eyebrow">GIS Spatial Intelligence</div><h1 className="h1">Spatial Risk Overview</h1><p className="sub">Only recorded coordinates are plotted. Grey markers have no stored prediction.</p></div><button className="btn" disabled={loading} onClick={load}>Refresh</button></div>
    {error && <p role="alert" className="error-alert">{error}</p>}
    <div className="maplayout"><section className="mapbox" style={{height:560,minHeight:320,overflow:'hidden'}}><ProjectMap projects={filtered} onSelect={setSelected}/></section>
    <aside className="mapside"><label>Search projects<input aria-label="Search map projects" className="btn" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, code, district"/></label>
      <div className="form" style={{marginTop:12}}><label>State<select aria-label="Map state" value={state} onChange={e=>setState(e.target.value)}><option value="All">All States</option>{[...new Set(projects.map(p=>p.state))].sort().map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Risk<select aria-label="Map risk" value={risk} onChange={e=>setRisk(e.target.value)}>{['All','Critical','High','Medium','Low','Unclassified'].map(r=><option key={r}>{r}</option>)}</select></label></div>
      <p role="status">{loading?'Loading projects…':filtered.length+' projects · '+located.length+' mapped · '+(filtered.length-located.length)+' without coordinates'}</p>
      <div style={{maxHeight:320,overflowY:'auto'}}>{filtered.map(p=><button key={p.id} className="btn" onClick={()=>setSelected(p)} style={{display:'block',width:'100%',textAlign:'left',marginBottom:6}}>{p.name}<small style={{display:'block'}}>{p.state} · {hasCoordinates(p)?'Recorded location':'Location not recorded'}</small></button>)}</div>
    </aside></div>
    {selected && <section className="panel" style={{marginTop:16}}><button className="btn" onClick={()=>setSelected(null)} aria-label="Close project map details">Close</button><h2>{selected.name}</h2><p>{selected.project_code} · {selected.district}, {selected.state}</p>
      <p>Risk: {selected.risk_score==null?'Unclassified':(selected.risk_level||'Stored score')+' · '+selected.risk_score+'/100'}</p>
      <p>{hasCoordinates(selected)?'Recorded coordinates: '+selected.latitude+', '+selected.longitude:'Location not recorded. Edit the project to add coordinates.'}</p>
      <Link className="btn primary" href={'/projects/'+selected.id}>View project</Link>
      {hasCoordinates(selected) && <a className="btn" href={'https://www.google.com/maps/search/?api=1&query='+selected.latitude+','+selected.longitude} target="_blank" rel="noreferrer">Open location</a>}
    </section>}
  </div>;
}
