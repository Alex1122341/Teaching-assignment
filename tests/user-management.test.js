'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('faculty-first account form derives name and email from the selected profile',()=>{
 const html=read('user-management.html'),source=read('user-management.js');
 assert.match(html,/id="account-faculty"[^>]*required/);
 assert.match(html,/id="account-identity"/);
 assert.doesNotMatch(html,/id="account-name"[^>]*required/);
 assert.doesNotMatch(html,/id="account-email"[^>]*required/);
 assert.doesNotMatch(html,/id="account-uid"[^>]*required/);
 assert.match(source,/function identityFromFaculty/);
 assert.match(source,/renderAccountIdentity/);
});

test('new accounts are created with secondary Firebase Auth without replacing the Owner session',()=>{
 const html=read('user-management.html'),source=read('user-management.js');
 assert.ok(html.indexOf('faculty-account-planner.js')<html.indexOf('user-management.js'));
 assert.match(source,/secondaryAuth/);
 assert.match(source,/createUserWithEmailAndPassword/);
 assert.match(source,/mustChangePassword:true/);
 assert.match(source,/secondaryAuth\.signOut/);
});

test('bulk provisioning requires a fresh preview and writes auditable results',()=>{
 const html=read('user-management.html'),source=read('user-management.js');
 assert.match(html,/id="account-bulk-preview"/);
 assert.match(html,/id="account-bulk-run"[^>]*disabled/);
 assert.match(html,/id="account-bulk-password"[^>]*type="password"/);
 assert.match(source,/function renderProvisionPlan/);
 assert.match(source,/account_provisioned/);
 assert.match(source,/previewRevision/);
 assert.doesNotMatch(source,/console\.(?:log|error)\([^\n]*password/i);
});

test('account table shows all faculty-facing roles while preserving one primary access role',()=>{
 const source=read('user-management.js');
 assert.match(source,/facultyRoles/);
 assert.match(source,/UCVM_ACCOUNT_PLANNER\.primaryRole/);
});

test('provisioned accounts receive a readable Change History action label',()=>{
 assert.match(read('faculty-access.js'),/account_provisioned:'Account provisioned'/);
});

test('setup guide documents reviewed profile-first provisioning without storing a shared password',()=>{
 const setup=read('SETUP.md');
 assert.match(setup,/Preview changes/);
 assert.match(setup,/faculty profile/);
 assert.match(setup,/Require password change on next dashboard sign-in/);
 assert.doesNotMatch(setup,/ucvm2026/i);
});

test('office setup exposes ADC/LAB identity and existing UID inputs',()=>{
 const html=read('user-management.html');
 for(const role of ['adc','lab'])assert.ok(html.includes(`<option value="${role}">${role.toUpperCase()}</option>`));
 for(const id of ['account-office-identity','account-office-name','account-office-email','account-existing-uid'])assert.ok(html.includes(`id="${id}"`),id);
 assert.ok(html.indexOf('account-profile.js')<html.indexOf('user-management.js'));
});
test('office profile save clears legacy faculty routing and checks existing UIDs on server',()=>{
 const source=read('user-management.js');
 assert.match(source,/UCVM_ACCOUNT_PROFILE/);assert.match(source,/resolveNewUid/);
 assert.match(source,/readProfile:[^\n]*source:'server'/);
 assert.match(source,/patch\.facultyId=firebase\.firestore\.FieldValue\.delete\(\)/);
});


test('Developer account hierarchy is enforced in User Management UI',()=>{
 const source=read('user-management.js');
 assert.match(source,/developerActor/);
 assert.match(source,/developerAccount/);
 assert.match(source,/Only Developer can create or modify Developer accounts/);
 assert.match(source,/Developer protected/);
 assert.match(source,/option\[value="developer"\]/);
});
