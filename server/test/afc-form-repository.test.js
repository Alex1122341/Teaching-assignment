'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('AFC upload SQL is additive, gated by live authorization and immutable idempotent storage',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../../database/azure-sql/048_afc_form_upload.sql'),'utf8');
 for(const name of ['AfcFormDocument','UploadAfcForm','ListAfcForms','GetAfcForm','paws_runtime_afc_form'])assert.ok(sql.includes(name));
 assert.match(sql,/HASHBYTES\('SHA2_256',\s*@PdfBytes\)/);assert.match(sql,/UPDLOCK,HOLDLOCK/);assert.match(sql,/MustChangePassword=0/);assert.match(sql,/afc_form_uploaded/);assert.match(sql,/afc_form_downloaded/);
 assert.doesNotMatch(sql,/ALTER ROLE.*ADD MEMBER|DELETE\s+(?:FROM\s+)?paws\.(?:AfcRecord|AfcManualRecord|CalendarActivity)|INSERT\s+paws\.AfcArtifact/i);
});
test('AFC form repository binds actor, SQL parameters and parses only bounded metadata',async()=>{
 const {createSqlAfcFormRepository}=require('../src/data/sql-afc-form-repository');let call;
 const r=createSqlAfcFormRepository({query:async(sql,params)=>{call={sql,params};return [{responseJson:'{"documents":[],"nextCursor":null}'}];}});
 assert.deepEqual(await r.list({actorFirebaseUid:'actor',facultyId:'id',limit:10,cursor:null}),{documents:[],nextCursor:null});assert.match(call.sql,/paws_api.ListAfcForms/);assert.equal(call.params.ActorFirebaseUid,'actor');
});
test('AFC form gate accepts only exact lowercase true and permissions are three exact procedure grants',()=>{
 const {createWriteGates}=require('../src/data/write-gates');for(const value of [undefined,'false','True','TRUE','1',' true','true '])assert.equal(createWriteGates({PAWS_AFC_FORM_UPLOAD_ENABLED:value}).afcFormUpload,false);
 const gates=createWriteGates({PAWS_AFC_FORM_UPLOAD_ENABLED:'true'});assert.equal(gates.afcFormUpload,true);assert.equal(Object.values(gates).filter(Boolean).length,1);
 const sql=fs.readFileSync(path.join(__dirname,'../../database/azure-sql/048_afc_form_upload.sql'),'utf8');const grants=[...sql.matchAll(/GRANT EXECUTE ON OBJECT::([\w.]+) TO paws_runtime_afc_form/g)].map(m=>m[1]);
 assert.deepEqual(grants,['paws_api.UploadAfcForm','paws_api.ListAfcForms','paws_api.GetAfcForm']);assert.match(sql,/DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::paws.AfcFormDocument/);
});
