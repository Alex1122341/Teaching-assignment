'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {toTrustedCccRows}=require('../../tools/master-refresh/ccc-master-adapter.cjs');
const {manifestHash}=require('../src/master-refresh/master-source-domain');
const {createSqlCccReplacementRepository}=require('../src/data/sql-ccc-replacement-repository');
const id='11111111-1111-4111-8111-111111111111';
function fixture(){
 const source={schemaVersion:1,academicYear:'2026-27',sourceSha256:'A'.repeat(64),appointments:[],rotations:[],cccAllocations:[],roleDefinitions:[],trainees:[],issues:[],cccSlots:['C','D','E'].map((column,i)=>({slotKey:`CCC!${column}2`,sourceRef:{sha256:'A'.repeat(64),sheet:'CCC',row:2,column},facultyId:i===1?null:id,sourceName:i===1?'Locum':'Example Faculty',identityStatus:i===1?'unassigned':'resolved',staffingKind:i===1?'unassigned':'assigned',staffingLabel:i===1?'Locum':null,startDate:'2026-10-20',endDate:'2026-10-20',blockLabel:'Example Block',privateNotes:'Private source note',closureText:null}))};
 source.manifestSha256=manifestHash(source);return source;
}
test('trusted adapter retains all staffing cells on a physical row with distinct staging ordinals',()=>{
 const parsed=toTrustedCccRows(fixture());assert.equal(parsed.schemaVersion,2);assert.equal(parsed.rows.length,3);assert.equal(new Set(parsed.rows.map(r=>r.sourceRow)).size,3);assert.deepEqual(parsed.rows.map(r=>r.sourceRef.column),['C','D','E']);assert.deepEqual(parsed.slotCounts,{total:3,assigned:2,unassigned:1});assert.equal(parsed.rows[1].facultySourceId,null);assert.equal(parsed.rows[1].staffingLabel,'Locum');
});
test('discarding a Locum slot or mutating source provenance invalidates the complete source',()=>{
 const source=fixture();source.cccSlots.splice(1,1);assert.throws(()=>toTrustedCccRows(source),{code:'SOURCE_MANIFEST_MISMATCH'});
 const changed=fixture();changed.cccSlots[0].sourceRef.row=7;const {manifestSha256,...body}=changed;changed.manifestSha256=manifestHash(body);assert.throws(()=>toTrustedCccRows(changed),{code:'INVALID_CCC_MASTER_SOURCE'});
});
test('unknown or inactive faculty never become a Locum placeholder',()=>{
 const source=fixture();source.cccSlots[1].sourceName='Unresolved Named Person';const {manifestSha256,...body}=source;source.manifestSha256=manifestHash(body);assert.throws(()=>toTrustedCccRows(source),{code:'INVALID_CCC_MASTER_SOURCE'});
});
test('trusted SQL stage is distinct from the public workbook procedure and binds the full payload',async()=>{
 let seen;const repo=createSqlCccReplacementRepository({query:async(q,p)=>{seen={q,p};return[{responseJson:'{"batchId":"staged"}'}];}});
 const parsed=toTrustedCccRows(fixture());await repo.stageTrustedMaster({actorFirebaseUid:'admin',requestId:id,fileName:'private-master.xlsx',byteLength:1500000,parsed});
 assert.match(seen.q,/StageMasterCccReplacement/);assert.deepEqual(JSON.parse(seen.p.PayloadJson),parsed);assert.equal(seen.p.ByteLength,1500000);assert.equal(seen.q.includes('Private source note'),false);
});
