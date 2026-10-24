'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {createSqlSwapRepository}=require('../src/data/sql-swap-repository');
for(const [status,available] of [['Available',true],['Unavailable',false],['Needs Review',false]]){
 test('SWAP context projects '+status+' without confidential candidate fields',async()=>{
  const repository=createSqlSwapRepository({query:async()=>[{responseJson:JSON.stringify({candidates:[{candidateKey:'synthetic-key',displayName:'Synthetic Faculty',availabilityStatus:status,available:true,notifyAvailable:false,notifyUnavailableReason:'One active linked account is required.',email:'private@example.test',ucid:'private-ucid',evidenceNote:'private evidence note',afcPurpose:'private purpose'}]})}]});
  const candidate=(await repository.context({actorFirebaseUid:'synthetic',sessionId:'synthetic-session'})).candidates[0];
  assert.equal(candidate.availabilityStatus,status);assert.equal(candidate.available,available);assert.doesNotMatch(JSON.stringify(candidate),/private/);
 });
}
test('unrecognized availability status stays blocked rather than becoming an available candidate',async()=>{
 const repository=createSqlSwapRepository({query:async()=>[{responseJson:'{"candidates":[{"candidateKey":"synthetic","availabilityStatus":"unexpected","available":true}]}'}]});
 const candidate=(await repository.context({actorFirebaseUid:'synthetic',sessionId:'synthetic'})).candidates[0];assert.equal(candidate.available,false);assert.equal(candidate.availabilityStatus,'Needs Review');
});
