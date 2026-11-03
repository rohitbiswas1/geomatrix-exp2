'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ApiProject } from '../lib/apiClient';
import { hasCoordinates, projectRiskColor } from '../lib/coordinates';
export default function ProjectMap({ projects, onSelect, interactive = true }: { projects: ApiProject[]; onSelect?: (project: ApiProject) => void; interactive?: boolean }) {
  const container = useRef<HTMLDivElement>(null), map = useRef<LeafletMap | null>(null), layer = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setError(''); setReady(false);
    void import('leaflet').then(L => {
      if (disposed || !container.current) return;
      const instance = L.map(container.current, { center: [22.8,79.5], zoom: 4, scrollWheelZoom: interactive, dragging: interactive, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, zoomControl: interactive });
      map.current = instance;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).on('tileerror', () => { if (!disposed) setError('Map tiles could not load. Project locations are still available in the list.'); }).addTo(instance);
      layer.current = L.layerGroup().addTo(instance);
      setReady(true); instance.invalidateSize();
    }).catch(() => { if (!disposed) setError('The map could not load. Please retry.'); });
    return () => { disposed = true; map.current?.remove(); map.current = null; layer.current = null; };
  }, [interactive, retry]);
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    void import('leaflet').then(L => {
      if (disposed || !layer.current || !map.current) return;
      layer.current.clearLayers();
      const located = projects.filter(hasCoordinates);
      for (const project of located) {
        const label = document.createElement('span');
        label.textContent = project.name + ' · ' + (project.risk_score == null ? 'Unclassified' : project.risk_level || 'Stored prediction');
        L.circleMarker([project.latitude, project.longitude], { radius: 7, color: '#fff', weight: 2, fillColor: projectRiskColor(project), fillOpacity: 0.9 }).bindTooltip(label).on('click', () => onSelect?.(project)).addTo(layer.current);
      }
      if (located.length) map.current.fitBounds(L.latLngBounds(located.map(p => [p.latitude, p.longitude] as [number,number])), { padding: [25,25], maxZoom: 10 });
    });
    return () => { disposed = true; };
  }, [projects, ready, onSelect]);
  return <div style={{position:'relative',height:'100%',minHeight:320}}>
    <div ref={container} aria-label="Project locations map" style={{height:'100%',minHeight:320,width:'100%',zIndex:0}}/>
    {error && <div role="status" style={{position:'absolute',bottom:30,left:10,right:10,zIndex:1,background:'var(--surface)',padding:10,borderRadius:6}}>{error} <button className="btn" onClick={()=>setRetry(n=>n+1)}>Retry map</button></div>}
    {!projects.some(hasCoordinates) && <p role="status" style={{position:'absolute',top:10,left:50,zIndex:1,background:'var(--surface)',padding:8}}>No recorded project coordinates. Add latitude and longitude in Projects to plot locations.</p>}
  </div>;
}
