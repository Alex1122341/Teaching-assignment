'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {PDFDocument,PDFDict,PDFRawStream,PDFName}=require('pdf-lib');
const {createHash}=require('node:crypto');
async function inspect(bytes){
 require('./afc-form-pdf-guards').installPdfGuards();
 if(bytes.length>2097152||!/^%PDF-1\.[0-7]/.test(bytes.subarray(0,10).toString('ascii'))||!bytes.subarray(-2048).includes(Buffer.from('%%EOF')))throw Error();
 const pdf=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});
 const pageCount=pdf.getPageCount();if(pdf.isEncrypted||pageCount<1||pageCount>100)throw Error();
 const forbidden=new Set(['OpenAction','AA','A','JS','JavaScript','Launch','EmbeddedFiles','EmbeddedFile','EF','RF','FileAttachment','RichMedia','XFA','Encrypt','Rendition','GoToE']);
 const seen=new Set();let objects=0;
 function visit(value){
  if(!value||seen.has(value))return;seen.add(value);if(++objects>100000)throw Error();
  if(value instanceof PDFName&&forbidden.has(value.decodeText()))throw Error();
  const dict=value instanceof PDFRawStream?value.dict:value;
  if(dict instanceof PDFDict){for(const [key,item]of dict.entries()){if(forbidden.has(key.decodeText()))throw Error();visit(item);}}
  else if(typeof value.asArray==='function')for(const item of value.asArray())visit(item);
 }
 for(const [,object]of pdf.context.enumerateIndirectObjects())visit(object);
 return {pageCount,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
inspect(Buffer.from(workerData)).then(metadata=>parentPort.postMessage({ok:true,metadata}),()=>parentPort.postMessage({ok:false}));
