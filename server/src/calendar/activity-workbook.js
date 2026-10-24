'use strict';
const path=require('node:path');const {Worker}=require('node:worker_threads');const {createHash}=require('node:crypto');
let activeWorkers=0;
const fail=code=>Object.assign(new Error(({IMPORT_LIMIT:'The workbook exceeds import limits.',IMPORT_BUSY:'The workbook parser is busy.',IMPORT_PARSE_TIMEOUT:'Workbook parsing exceeded its time limit.',APPROVED_SOURCE_REQUIRED:'An approved workbook is required.'})[code]||'The workbook could not be validated.'),{code});
function runActivityWorkbookWorker(buffer,policy,{WorkerClass=Worker,deadlineMs=10000}={}){
 if(activeWorkers>=2)return Promise.reject(fail('IMPORT_BUSY'));
 activeWorkers++;
 return new Promise((resolve,reject)=>{
  let worker,timer,settled=false;
  const finish=(error,result)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   // Reclaim the worker before admitting another import, including on errors.
   Promise.resolve().then(()=>worker?.terminate()).catch(()=>{}).finally(()=>{activeWorkers--;error?reject(error):resolve(result);});
  };
  try{
   worker=new WorkerClass(path.join(__dirname,'activity-workbook-worker.js'),{workerData:{bytes:buffer,policy},resourceLimits:{maxOldGenerationSizeMb:128,stackSizeMb:4}});
   worker.on('message',message=>{if(message?.ok===true)finish(null,message.result);else finish(fail(['IMPORT_LIMIT','INVALID_SOURCE','APPROVED_SOURCE_REQUIRED'].includes(message?.code)?message.code:'INVALID_SOURCE'));});
   worker.on('error',()=>finish(fail('INVALID_SOURCE')));
   worker.on('exit',()=>finish(fail('INVALID_SOURCE')));
   timer=setTimeout(()=>finish(fail('IMPORT_PARSE_TIMEOUT')),Math.max(1,Math.min(10000,deadlineMs)));
  }catch(_){finish(fail('INVALID_SOURCE'));}
 });
}
async function parseActivityWorkbook(buffer,policy){
 if(!Buffer.isBuffer(buffer)||!buffer.length)throw fail('INVALID_SOURCE');
 if(buffer.length>524288)throw fail('IMPORT_LIMIT');
 const hash=createHash('sha256').update(buffer).digest('hex').toUpperCase();
 if(!policy||policy.sourceSha256!==hash||policy.sheetName!=='AFC records'||!Array.isArray(policy.excludedRows))throw fail('APPROVED_SOURCE_REQUIRED');
 return runActivityWorkbookWorker(buffer,policy);
}
module.exports={parseActivityWorkbook,runActivityWorkbookWorker};
