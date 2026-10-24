'use strict';
const {Worker}=require('node:worker_threads');
const MAX_FORM_BYTES=2097152;
let running=0;
const failure=code=>Object.assign(new Error(code==='PDF_BUSY'?'PDF validation is busy. Retry shortly.':'Choose a supported PDF with at most100 pages and2MiB.'),{code});
function validateAfcFormPdf(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_FORM_BYTES)return Promise.reject(failure('PDF_LIMIT'));
 if(running>=2)return Promise.reject(failure('PDF_BUSY'));
 running++;
 return new Promise((resolve,reject)=>{
  let done=false,worker,timer;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);Promise.resolve().then(()=>worker?.terminate()).catch(()=>{}).finally(()=>{running--;if(error)reject(error);else resolve(value);});};
  try{
   worker=new Worker(require.resolve('./afc-form-pdf-worker'),{workerData:bytes,resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16}});
   timer=setTimeout(()=>finish(failure('INVALID_PDF')),5000);
   worker.once('message',m=>m?.ok?finish(null,m.metadata):finish(failure('INVALID_PDF')));
   worker.once('error',()=>finish(failure('INVALID_PDF')));worker.once('exit',()=>finish(failure('INVALID_PDF')));
  }catch(_){finish(failure('INVALID_PDF'));}
 });
}
module.exports={validateAfcFormPdf,MAX_FORM_BYTES};
