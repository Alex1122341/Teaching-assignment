'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const ExcelJS=require('exceljs');
const {verifyArchive,dateValue,hasFormula}=require('./workbook-safety');
const {normalizeActivityNameKey,classifyActivityPurpose}=require('./activity-import-policy');
const failure=code=>Object.assign(new Error(code),{code});
async function readWorkbook(bytes,policy){
 await verifyArchive(bytes);
 const book=new ExcelJS.Workbook();
 try{await book.xlsx.load(bytes);}catch(_){throw failure('INVALID_SOURCE');}
 const sheet=book.getWorksheet(policy.sheetName);
 if(!sheet||['Faculty Member','Start','End','Purpose'].some((header,index)=>typeof sheet.getRow(1).getCell(index+1).value!=='string'||sheet.getRow(1).getCell(index+1).value.trim()!==header))throw failure('INVALID_SOURCE');
 const rows=[],duplicates=new Map(),excluded=new Set(policy.excludedRows);
 sheet.eachRow((row,sourceRow)=>{
  if(sourceRow===1)return;
  const values=[1,2,3,4].map(column=>row.getCell(column).value);
  if(values.every(value=>value===null||value===undefined||typeof value==='string'&&!value.trim()))return;
  if(rows.length>=5000)throw failure('IMPORT_LIMIT');
  const [name,start,end,label]=values,issues=[];
  if(values.some(hasFormula))issues.push('FORMULA_NOT_ALLOWED');
  const facultySourceName=typeof name==='string'?name.trim():'';
  const originalLabel=typeof label==='string'?label.trim():'';
  const startDate=dateValue(start),endDate=dateValue(end);
  if(!facultySourceName)issues.push('MISSING_FACULTY');else if(facultySourceName.length>256)issues.push('FACULTY_NAME_TOO_LONG');
  if(!originalLabel)issues.push('MISSING_PURPOSE');else if(originalLabel.length>1000)issues.push('PURPOSE_TOO_LONG');
  if(!startDate)issues.push('INVALID_START_DATE');if(!endDate)issues.push('INVALID_END_DATE');
  if(startDate&&endDate&&endDate<startDate)issues.push('END_BEFORE_START');
  const classified=classifyActivityPurpose(originalLabel);
  if(originalLabel&&classified.treatment==='quarantined')issues.push('UNCLASSIFIED_PURPOSE');
  const value={sourceRow,facultySourceName,startDate,endDate,originalLabel,category:classified.category,treatment:excluded.has(sourceRow)?'excluded':issues.length?'quarantined':classified.treatment,issues};
  rows.push(value);
  if(value.treatment!=='excluded'&&!issues.length){
   const key=JSON.stringify([normalizeActivityNameKey(facultySourceName),startDate,endDate,normalizeActivityNameKey(originalLabel)]);
   if(!duplicates.has(key))duplicates.set(key,[]);duplicates.get(key).push(value);
  }
 });
 for(const group of duplicates.values())if(group.length>1)for(const row of group){row.treatment='quarantined';row.issues.push('DUPLICATE_SOURCE_ROW');}
 for(const row of rows){row.disposition=row.treatment==='excluded'?'excluded':row.treatment==='working_candidate'?'work':'away';row.needsReview=row.treatment==='quarantined';}
 if(!rows.length)throw failure('INVALID_SOURCE');
 return {sourceSha256:policy.sourceSha256,sheetName:policy.sheetName,policyVersion:policy.policyVersion,dataset:policy.dataset,rows};
}
readWorkbook(Buffer.from(workerData.bytes),workerData.policy).then(result=>parentPort.postMessage({ok:true,result})).catch(error=>parentPort.postMessage({ok:false,code:error.code||'INVALID_SOURCE'}));
