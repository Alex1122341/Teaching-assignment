'use strict';
const {Worker}=require('node:worker_threads'),{createHash}=require('node:crypto');
const {canonicalAcademicYear}=require('../data/academic-year');let active=0;
const fail=code=>Object.assign(new Error('The CCC workbook could not be validated.'),{code});
function parseCccWorkbook(bytes,year){
 let academicYear;try{academicYear=canonicalAcademicYear(year);}catch(_){return Promise.reject(fail('INVALID_CCC_SOURCE'));}
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>524288)return Promise.reject(fail('IMPORT_LIMIT'));
 if(active>=2)return Promise.reject(fail('IMPORT_BUSY'));active++;
 return new Promise((resolve,reject)=>{
  let worker,timer,done=false;const finish=(e,r)=>{if(done)return;done=true;clearTimeout(timer);Promise.resolve().then(()=>worker?.terminate()).catch(()=>{}).finally(()=>{active--;e?reject(e):resolve(r);});};
  try{worker=new Worker(require.resolve('./ccc-workbook-worker'),{workerData:{bytes,academicYear},resourceLimits:{maxOldGenerationSizeMb:128,stackSizeMb:4}});
   worker.once('message',m=>m?.ok?finish(null,{...m.result,sourceSha256:createHash('sha256').update(bytes).digest('hex').toUpperCase()}):finish(fail(m?.code==='IMPORT_LIMIT'?'IMPORT_LIMIT':'INVALID_CCC_SOURCE')));worker.once('error',()=>finish(fail('INVALID_CCC_SOURCE')));worker.once('exit',()=>finish(fail('INVALID_CCC_SOURCE')));timer=setTimeout(()=>finish(fail('IMPORT_PARSE_TIMEOUT')),10000);
  }catch(_){finish(fail('INVALID_CCC_SOURCE'));}
 });
}
module.exports={parseCccWorkbook};
