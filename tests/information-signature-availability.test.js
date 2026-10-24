const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('main dashboard loads information centre, availability lookup, and lazy AFC approval dependencies',()=>{
 const html=read('web/index.html');
 for(const file of ['js/timetable/information-center.js','js/timetable/availability-lookup.js','js/absence-from-campus/signature-capture.js','js/absence-from-campus/afc-actions.js','js/core/asset-loader.js'])assert.match(html,new RegExp(file.replace('.','\\.')));
 assert.doesNotMatch(html,/afc-pdf-browser\.js/);
 assert.match(html,/Information Center/i);
});

test('signature chooser supports typed, drawn, and uploaded signatures with evidence',()=>{
 const js=read('web/js/absence-from-campus/signature-capture.js');
 for(const mode of ['typed','drawn','uploaded'])assert.match(js,new RegExp(mode));
 for(const evidence of ['signedAt','email','fingerprint'])assert.match(js,new RegExp(evidence));
});

test('ADFA queue includes AFC requests and availability lookup cross-checks both sources',()=>{
 const queue=read('web/js/approvals/approval-workflow.js'),lookup=read('web/js/timetable/availability-lookup.js'),admin=read('web/faculty-admin.html');
 assert.match(queue,/afc_requests/);assert.match(queue,/AFC requests/);assert.match(queue,/UCVM_AFC_ACTIONS/);
 assert.match(queue,/location\.hash==='#approvals'/);assert.match(admin,/href="index\.html#approvals"/);
 assert.match(queue,/requestsReady=false,afcRequestsReady=false/);
 assert.match(queue,/if\(!openApprovalFromHash\|\|!isOfficeApprover\(\)\|\|!requestsReady\|\|!afcRequestsReady\)return/);
 assert.match(queue,/const isApprover=isAdfaApprover/);
 assert.match(queue,/if\(!isAdfaApprover\(\)\)return/);
 assert.match(lookup,/awayFromCampusRecords/);assert.match(lookup,/sessions/);assert.match(lookup,/Available faculty/);
});

test('bulk import controls and handlers require highest permission',()=>{
 const html=read('web/faculty-admin.html'),js=read('web/js/faculty/faculty-admin.js');
 assert.match(html,/data-general-only/);
 assert.match(js,/requireGeneralImport/);
 const rules=read('firebase/firestore.rules');
 assert.match(rules,/bulkFacultyImportChange/);
 assert.match(rules,/public_info/);
});
