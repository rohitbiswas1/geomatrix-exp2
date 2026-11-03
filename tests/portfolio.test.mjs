import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portfolioSummary, riskTrend } from '../lib/portfolio.ts';
import { hasCoordinates, projectRiskColor } from '../lib/coordinates.ts';
test('portfolio aggregates recorded predictions without treating missing scores as low risk',()=>{
 const projects=[{state:'A',district:'Central',risk_score:null,land_required:10},{state:'B',district:'Central',risk_score:80,delay_probability:0.8,land_required:20,current_stage:'Award'}];
 const s=portfolioSummary(projects);
 assert.equal(s.total_projects,2);assert.equal(s.classified_projects,1);assert.equal(s.unclassified_projects,1);assert.equal(s.average_risk,80);assert.equal(s.districts.length,2);assert.equal(s.land_required,30);
});
test('monthly and quarterly risk periods aggregate observations instead of relabeling individual rows',()=>{
 const rows=[{updated_at:'2026-01-05T00:00:00Z',risk_score:20},{updated_at:'2026-01-25T00:00:00Z',risk_score:40},{updated_at:'2026-02-01T00:00:00Z',risk_score:60}];
 assert.deepEqual(riskTrend(rows,'Monthly').map(r=>r.risk),[30,60]);
 assert.equal(riskTrend(rows,'Quarterly')[0].risk,40);
 assert.equal(riskTrend(rows,'Weekly').length,3);
});
test('coordinates are never invented and zero coordinates remain valid',()=>{
 assert.equal(hasCoordinates({latitude:null,longitude:null}),false);
 assert.equal(hasCoordinates({latitude:91,longitude:70}),false);
 assert.equal(hasCoordinates({latitude:0,longitude:0}),true);
 assert.equal(projectRiskColor({risk_score:null}),'#64748b');
});
