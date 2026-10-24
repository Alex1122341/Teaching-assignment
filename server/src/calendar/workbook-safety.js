'use strict';
const unzipper=require('unzipper'),JSZip=require('jszip');
const failure=code=>Object.assign(new Error(code),{code});
async function verifyArchive(bytes){
 let zip;try{zip=await unzipper.Open.buffer(bytes);}catch(_){throw failure('INVALID_SOURCE');}
 if(zip.files.length>1024)throw failure('IMPORT_LIMIT');
 const seen=new Set();let total=0;
 for(const entry of zip.files){
  const name=entry.path;
  if(typeof name!=='string'||name.length>1024||name.startsWith('/')||/[\\:]/.test(name)||name.split('/').some(part=>part==='..'||part==='.')||seen.has(name)||/vbaproject\.bin$/i.test(name)||(entry.flags&1))throw failure('INVALID_SOURCE');
  seen.add(name);
  if(entry.type==='Directory')continue;
  const stream=entry.stream();let actual=0;
  try{
   for await(const chunk of stream){actual+=chunk.length;total+=chunk.length;if(total>16777216){stream.destroy();throw failure('IMPORT_LIMIT');}}
  }catch(error){stream.destroy();throw error.code==='IMPORT_LIMIT'?error:failure('INVALID_SOURCE');}
  if(actual!==entry.uncompressedSize)throw failure('INVALID_SOURCE');
 }
 try{await JSZip.loadAsync(bytes,{checkCRC32:true});}catch(_){throw failure('INVALID_SOURCE');}
 if(!seen.has('xl/workbook.xml'))throw failure('INVALID_SOURCE');
}
function hasFormula(value){return value&&typeof value==='object'&&(Object.hasOwn(value,'formula')||Object.hasOwn(value,'sharedFormula'));}
function dateValue(value){
 if(value instanceof Date){
  if(!Number.isFinite(value.getTime())||value.getUTCFullYear()<1901||value.getUTCHours()||value.getUTCMinutes()||value.getUTCSeconds()||value.getUTCMilliseconds())return null;
  return value.toISOString().slice(0,10);
 }
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
}
module.exports={verifyArchive,dateValue,hasFormula};
