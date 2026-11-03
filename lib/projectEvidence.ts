import type { ApiProject } from './apiClient';
export function missingInputs(p: ApiProject): string[] {
 const observed=p.source_details?.observed_fields;
 return ['land_required','affected_families','current_stage'].filter(k => {
  const value=p[k as keyof ApiProject];
  return (Array.isArray(observed)&&!observed.includes(k)) || value==null || value==='' || (k==='land_required'&&Number(value)<=0) || (k==='current_stage'&&String(value).toLowerCase()==='unknown');
 });
}
export function sourceNumber(p:ApiProject,key:string):number|null { const v=p.source_details?.[key];return typeof v==='number'&&Number.isFinite(v)?v:null; }
export function sourceDate(p:ApiProject):string { return String(p.source_details?.as_of||'Not recorded'); }
export function sourceRows(projects:ApiProject[]) {return projects.filter(p=>p.data_classification==='REAL').map(p=>({p,months:sourceNumber(p,'reported_schedule_slippage_months'),missing:missingInputs(p)}));}
