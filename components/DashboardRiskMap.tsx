'use client';
import type { ApiProject } from '../lib/apiClient';
import ProjectMap from './ProjectMap';
import { hasCoordinates } from '../lib/coordinates';
export default function DashboardRiskMap({ projects }: { projects: ApiProject[] }) {
  return <div className="command-map-board" style={{position:'relative',overflow:'hidden'}}>
    <ProjectMap projects={projects} interactive={false}/>
    <div className="command-map-count"><strong>{projects.filter(hasCoordinates).length}</strong><span>Recorded locations</span></div>
  </div>;
}
