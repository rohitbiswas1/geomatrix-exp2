import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
const origin = 'http://127.0.0.1:3000';
const csv = { name: 'projects.csv', mimeType: 'text/csv', buffer: Buffer.from('project_id,project_name,state\nP-1,Uploaded project,West Bengal\n') };
const project = { id:'p1', project_code:'P-1', name:'Uploaded project', state:'West Bengal', district:'Unknown', authority:'Unknown', project_type:'Unknown', land_required:0, land_acquired:0, affected_families:0 };
const success = { source:'csv_projects', records_fetched:1, records_saved:1, records_skipped:0, records_failed:0, records_duplicated:0, errors:[], warnings:[], status:'success' };
const failed = { ...success, records_saved:0, records_skipped:1, records_failed:1, errors:['Row 2: missing required fields: state'], status:'failed' };
async function setup(path='/projects', onUpload) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const state = { projects:[], uploads:0, reads:0 };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({json:{user:{name:'Officer',email:'officer@example.com',role:'Project Officer'}}});
    if (url.pathname === '/api/projects') { state.reads++; return route.fulfill({json:state.projects}); }
    if (url.pathname === '/api/ingest/upload') {
      state.uploads++;
      assert.equal(url.searchParams.get('data_type'),'projects');
      assert.match(route.request().headers()['content-type'],/multipart\/form-data; boundary=/);
      if(onUpload) return onUpload(route,state);
      state.projects=[project];return route.fulfill({json:success});
    }
    const json = url.pathname.endsWith('dashboard-summary') ? {total_projects:state.projects.length,alerts_open:0,data_available:false} :
      url.pathname.endsWith('training-data') ? {total_records:0,ready_to_train:false} :
      url.pathname.endsWith('/model/status') ? {trained:false,message:'No model'} :
      url.pathname.endsWith('/alerts/summary') ? {total:0,open:0,critical:0,high:0} : [];
    return route.fulfill({json});
  });
  await page.goto(origin+path,{waitUntil:'domcontentloaded'});
  return {context,page,state};
}
async function visible(locator) { await locator.waitFor({state:'visible',timeout:20000}); }

test('project upload refreshes persisted rows and clears filters hiding new projects',async()=>{
  const {context,page,state}=await setup();
  try {
    await page.getByRole('combobox').nth(1).selectOption('High');
    await page.getByLabel('Upload project records').setInputFiles(csv);
    await visible(page.getByText('1 of 1 records imported.',{exact:true}));
    await visible(page.getByRole('link',{name:'Uploaded project',exact:true}));
    assert.equal(state.uploads,1); assert.ok(state.reads>=2);
    assert.equal(await page.getByRole('combobox').nth(1).inputValue(),'All');
  } finally { await context.close(); }
});

test('all rejected rows show reasons and never show a false success toast',async()=>{
  const {context,page,state}=await setup('/projects',route=>route.fulfill({json:failed}));
  try {
    await page.getByLabel('Upload project records').setInputFiles(csv);
    await visible(page.getByText(failed.errors[0],{exact:true}));
    await visible(page.getByText('0 of 1 records imported.',{exact:true}));
    assert.equal(await page.getByText('Imported 0 projects',{exact:true}).count(),0);
    assert.equal(state.projects.length,0); // React Strict Mode may repeat initial reads.
  } finally { await context.close(); }
});

test('oversized and unsupported files are rejected before transmission and can retry',async()=>{
  const {context,page,state}=await setup();
  try {
    const input=page.getByLabel('Upload project records');
    await input.setInputFiles({...csv,buffer:Buffer.alloc(4*1024*1024+1)});
    await visible(page.getByRole('alert').filter({hasText:'4 MB'}));
    assert.equal(state.uploads,0);
    await input.setInputFiles({...csv,name:'projects.xlsx'});
    await visible(page.getByRole('alert').filter({hasText:'Save Excel sheets as CSV'}));
    assert.equal(state.uploads,0);
    await input.setInputFiles(csv);
    await visible(page.getByRole('link',{name:'Uploaded project',exact:true}));
    assert.equal(state.uploads,1);
  } finally { await context.close(); }
});

test('structured server errors are readable and retrying the same file works',async()=>{
  const {context,page,state}=await setup('/projects',(route,state)=>{
    if(state.uploads===1) return route.fulfill({status:503,json:{error:{message:'Upload service is starting. Please retry.'}}});
    state.projects=[project]; return route.fulfill({json:success});
  });
  try {
    const input=page.getByLabel('Upload project records');
    await input.setInputFiles(csv);
    await visible(page.getByText('Upload service is starting. Please retry.',{exact:true}));
    await input.setInputFiles(csv);
    await visible(page.getByRole('link',{name:'Uploaded project',exact:true}));
    assert.equal(state.uploads,2);
    assert.equal(await page.getByText('[object Object]',{exact:true}).count(),0);
  } finally { await context.close(); }
});

test('data uploads keep same-name file results separate and show failed rows',async()=>{
  const {context,page}=await setup('/data',(route,state)=>route.fulfill({json:state.uploads===1?success:failed}));
  try {
    await page.getByLabel('Upload datasets').setInputFiles([csv,{...csv,buffer:Buffer.from('project_id,project_name,state\nP-2,Missing state,\n')}]);
    await visible(page.getByText('1 of 1 records imported.',{exact:true}));
    await visible(page.getByText('0 of 1 records imported.',{exact:true}));
    await visible(page.getByText(failed.errors[0],{exact:true}));
    assert.equal(await page.getByText('projects.csv',{exact:true}).count(),2);
  } finally { await context.close(); }
});

test('data drop zone actually uploads dropped files',async()=>{
  const {context,page,state}=await setup('/data');
  try {
    const zone=page.locator('label').filter({hasText:'Click to upload or drag & drop'});
    await zone.evaluate(element=>{
      const transfer=new DataTransfer();
      transfer.items.add(new File(['project_id,project_name,state\nP-1,Project,WB\n'],'drop.csv',{type:'text/csv'}));
      element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    });
    await visible(page.getByText('1 of 1 records imported.',{exact:true}));
    assert.equal(state.uploads,1);
  } finally { await context.close(); }
});
