'use client';
import {useEffect,useState} from 'react';
import type {ApiProject} from '../lib/apiClient';
import {hasCoordinates} from '../lib/coordinates';
export default function ProjectMap({projects,onSelect,interactive=true,selectedProject}:{projects:ApiProject[];onSelect?:(p:ApiProject)=>void;interactive?:boolean;selectedProject?:ApiProject|null}){
 const [selected,setSelected]=useState<ApiProject|null>(null),[terrain,setTerrain]=useState(false);
 useEffect(()=>{setSelected(selectedProject||null);},[selectedProject]);
 const query=selected?(hasCoordinates(selected)?selected.latitude+','+selected.longitude:selected.name+', '+selected.state+', India'):'India';
 return <div style={{height:'100%',minHeight:320,position:'relative'}}>
 <iframe title="Google Maps India road map" src={'https://maps.google.com/maps?hl=en&gl=IN&q='+encodeURIComponent(query)+'&z='+(selected?'11':'5')+'&t='+(terrain?'k':'m')+'&output=embed'} style={{width:'100%',height:'100%',minHeight:320,border:0}} loading="lazy" allowFullScreen referrerPolicy="no-referrer-when-downgrade"/>
 {interactive&&<div style={{position:'absolute',top:10,left:10,maxWidth:'70%',background:'var(--surface)',padding:8,borderRadius:6}}><button className="btn" onClick={()=>{setSelected(null);setTerrain(false);}}>India overview</button><button className="btn" onClick={()=>setTerrain(v=>!v)}>{terrain?'Road map':'Satellite'}</button><select className="btn" aria-label="Locate project on Google Maps" value={selected?.id||''} onChange={e=>{const p=projects.find(p=>p.id===e.target.value)||null;setSelected(p);if(p)onSelect?.(p);}}><option value="">Select project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
 </div>;
}
