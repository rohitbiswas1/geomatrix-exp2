"use client";
import PortfolioEvidence from '../../components/PortfolioEvidence';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import { type ApiProject, fetchProjects } from '../../lib/apiClient';
import { portfolioSummary, riskTrend } from '../../lib/portfolio';

export default function Analytics() {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [period, setPeriod] = useState<'Monthly' | 'Weekly' | 'Quarterly'>('Monthly');
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [dateFilter, setDateFilter] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setProjects(await fetchProjects({ limit: 500 })); }
    catch(e) { setError(e instanceof Error ? e.message : 'Could not load analytics.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => projects.filter(p => {
    if (!dateFilter || (!start && !end)) return true;
    if (!p.updated_at) return false;
    const date = p.updated_at.slice(0,10);
    return (!start || date >= start) && (!end || date <= end);
  }), [projects, dateFilter, start, end]);
  const summary = useMemo(() => portfolioSummary(filtered), [filtered]);
  const trend = useMemo(() => riskTrend(filtered, period), [filtered, period]);
  return <div className="page">
    <div className="head"><div><div className="eyebrow">Portfolio intelligence</div><h1 className="h1">Analytics</h1><p className="sub">Calculated from saved project records and stored predictions.</p></div>
      <div className="actions"><select className="btn" aria-label="Analytics period" value={period} onChange={e => setPeriod(e.target.value as typeof period)}><option>Monthly</option><option>Weekly</option><option>Quarterly</option></select>
      <button className="btn" aria-expanded={dateFilter} onClick={() => setDateFilter(v => !v)}>Date filter</button><button className="btn" disabled={loading} onClick={load}>Refresh</button></div></div>
    <PortfolioEvidence mode="summary"/>
    {dateFilter && <div className="panel actions"><label>Updated from <input type="date" aria-label="Updated from" value={start} onChange={e=>setStart(e.target.value)} /></label><label>Updated through <input type="date" aria-label="Updated through" value={end} min={start} onChange={e=>setEnd(e.target.value)} /></label><button className="btn" onClick={()=>{setStart('');setEnd('');}}>Clear dates</button></div>}
    {error && <p role="alert" className="error-alert">{error}</p>}
    {loading ? <p role="status">Loading analytics…</p> : !error && <>
      <div className="grid three">{[['Projects',summary.total_projects],['Stored predictions',summary.classified_projects],['Average risk',summary.average_risk == null ? 'Not predicted' : summary.average_risk.toFixed(1)],['Critical + High',summary.classified_projects ? summary.critical_high : 'Not predicted'],['Land required',filtered.some(p=>!Array.isArray(p.source_details?.observed_fields)||p.source_details.observed_fields.includes('land_required'))?summary.land_required.toLocaleString('en-IN')+' ha':'Not recorded'],['Land acquired',filtered.some(p=>!Array.isArray(p.source_details?.observed_fields)||p.source_details.observed_fields.includes('land_acquired'))?summary.land_acquired.toLocaleString('en-IN')+' ha':'Not recorded']].map(([label,value])=><div className="kpi" key={label}><div className="label">{label}</div><div className="value" style={{fontSize:22}}>{value}</div></div>)}</div>
      <div className="grid two" style={{marginTop:16}}><div className="panel"><h2 className="paneltitle">Risk by latest project update</h2><p className="sub">Average stored scores grouped by update period; this is not prediction history.</p><div className="chart">{trend.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={trend}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="label" fontSize={10}/><YAxis domain={[0,100]}/><Tooltip/><Line dataKey="risk" name="Average risk" stroke="#1769aa"/></LineChart></ResponsiveContainer> : <p className="command-empty">No stored predictions available.</p>}</div></div>
      <div className="panel"><h2 className="paneltitle">Delay probability by district</h2><div className="chart">{summary.districts.some(d=>d.probability!=null) ? <ResponsiveContainer width="100%" height="100%"><BarChart data={summary.districts.filter(d=>d.probability!=null)}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="district" fontSize={9}/><YAxis domain={[0,100]} unit="%"/><Tooltip/><Bar dataKey="probability" name="Delay probability" fill="#7048c6"/></BarChart></ResponsiveContainer> : <p className="command-empty">No stored district delay predictions available.</p>}</div></div></div>
      <div className="panel" style={{marginTop:16}}><h2 className="paneltitle">Acquisition stages</h2><div className="tablewrap"><table className="table"><thead><tr><th>Stage</th><th>Projects</th></tr></thead><tbody>{summary.stages.map(s=><tr key={s.stage}><td>{s.stage}</td><td>{s.projects}</td></tr>)}</tbody></table></div></div>
    </>}
  </div>;
}
