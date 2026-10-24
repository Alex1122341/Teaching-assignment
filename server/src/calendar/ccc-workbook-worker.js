'use strict';
const {parentPort,workerData}=require('node:worker_threads'),ExcelJS=require('exceljs');
const {verifyArchive,dateValue,hasFormula}=require('./workbook-safety'),{UUID}=require('../swap/swap-domain');
const fail=code=>Object.assign(Error(code),{code});
async function parse(bytes,academicYear){
 await verifyArchive(bytes);const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
 const sheet=book.getWorksheet('CCC'),headers=['Faculty ID','Faculty Name','Start Date','End Date','Course Code','Label'];
 if(!sheet||sheet.state!=='visible'||book.worksheets.length!==1||headers.some((h,i)=>sheet.getCell(1,i+1).value!==h)||sheet.getRow(1).values.slice(7).some(v=>v!=null&&v!==''))throw fail('INVALID_CCC_SOURCE');
 const start=academicYear.slice(0,4)+'-05-01',end=(Number(academicYear.slice(0,4))+1)+'-05-01',rows=[],groups=new Map();
 const text=v=>typeof v==='string'?v.trim():'';
 sheet.eachRow((row,sourceRow)=>{
  if(sourceRow===1)return;const values=[1,2,3,4,5,6].map(i=>row.getCell(i).value);
  const extra=row.values.slice(7).filter(v=>v!=null&&v!=='');
  if(values.every(v=>v==null||v==='')&&!extra.length)return;if(rows.length>=5000)throw fail('IMPORT_LIMIT');
  const issues=[];if([...values,...extra].some(hasFormula))issues.push('FORMULA_NOT_ALLOWED');
  if([0,1,5].some(i=>values[i]!=null&&typeof values[i]!=='string')||values[4]!=null&&typeof values[4]!=='string'&&!(typeof values[4]==='number'&&Number.isInteger(values[4])))issues.push('INVALID_CELL_TYPE');
  if(extra.length)issues.push('EXTRA_COLUMNS');
  const facultySourceId=text(values[0]),facultySourceName=text(values[1]),startDate=dateValue(values[2]),endDate=dateValue(values[3]),courseCode=typeof values[4]==='number'&&Number.isInteger(values[4])?String(values[4]):text(values[4]),label=text(values[5])||'CCC';
  if(!facultySourceId&&!facultySourceName)issues.push('MISSING_FACULTY');
  if(facultySourceId&&!UUID.test(facultySourceId))issues.push('INVALID_FACULTY_ID');
  if(facultySourceName.length>256||courseCode.length>64||label.length>300)issues.push('TEXT_LIMIT');
  if(!startDate||!endDate)issues.push('INVALID_DATE');else{if(startDate>endDate)issues.push('END_BEFORE_START');if(startDate<start||endDate>=end)issues.push('OUTSIDE_ACADEMIC_YEAR');}
  const r={sourceRow,facultySourceId:facultySourceId||null,facultySourceName:facultySourceName||null,startDate,endDate,courseCode:courseCode||null,label,issues};rows.push(r);
  const key=JSON.stringify([facultySourceId.toLowerCase()||facultySourceName.toUpperCase(),startDate,endDate,courseCode,label.toUpperCase()]);const group=groups.get(key)||[];group.push(r);groups.set(key,group);
 });
 if(!rows.length)throw fail('INVALID_CCC_SOURCE');for(const group of groups.values())if(group.length>1)for(const r of group)r.issues.push('DUPLICATE_SOURCE_ROW');
 return {academicYear,dataset:'ccc-calendar',sheetName:'CCC',rows};
}
parse(Buffer.from(workerData.bytes),workerData.academicYear).then(result=>parentPort.postMessage({ok:true,result}),e=>parentPort.postMessage({ok:false,code:e?.code}));
