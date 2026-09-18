'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const indexes=require('../firestore.indexes.json');
function fields(name){return indexes.indexes.filter(i=>i.collectionGroup===name).map(i=>i.fields.map(f=>f.fieldPath));}
test('office approval queue and requester request queries have composite indexes',()=>{
  assert.ok(fields('change_request_approvals').some(f=>f.join(',')==='office,status,updatedAt'));
  assert.ok(fields('change_requests').some(f=>f.join(',')==='requesterUid,requestedAt'));
});
