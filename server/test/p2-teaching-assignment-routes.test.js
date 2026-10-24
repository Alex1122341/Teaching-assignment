'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createTeachingAssignmentFunctions}=require('../src/runtime/swa-teaching-assignment-functions');

test('contribution target route is authenticated API delegation with explicit method handling',async()=>{
  const seen=[];
  const api={contributionTargets:async(token,args)=>{seen.push({token,args});return {status:200,body:{targets:[]}};}};
  const route=createTeachingAssignmentFunctions({api});
  const response=await route({url:'https://paws.invalid/api/v1/teaching-assignments/contribution-targets?academicYear=2026-27',method:'GET',headers:new Headers({authorization:'Bearer verified-token'})});
  assert.equal(response.status,200);
  assert.deepEqual(response.jsonBody,{targets:[]});
  assert.deepEqual(seen,[{token:'verified-token',args:{academicYear:'2026-27'}}]);
  const method=await route({url:'https://paws.invalid/api/v1/teaching-assignments/contribution-targets?academicYear=2026-27',method:'POST',headers:new Headers()});
  assert.equal(method.status,405);
  assert.equal(method.headers.Allow,'GET');
  assert.equal(seen.length,1);
});
