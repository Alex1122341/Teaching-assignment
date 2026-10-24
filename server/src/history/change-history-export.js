'use strict';
const {endpoint}=require('./history-year');
const names=require('../domain/person-name');
const displayValue=(key,value)=>key==='actor'?names.format(value):key==='affectedFaculty'?names.formatList(value):value;

const COLUMNS=Object.freeze([
 ['changeDate','Time (UTC)'],['changeType','Type'],['domain','Domain'],
 ['course','Course'],['session','Session'],['field','Field'],
 ['previousValue','From'],['start','Start'],['end','End'],['updatedValue','To value'],['actor','By whom'],
 ['academicYear','Academic year'],['affectedFaculty','Affected faculty']
].map(([key,header])=>Object.freeze({key,header})));
const limit=()=>Object.assign(Error('Narrow the history filters before exporting.'),{code:'HISTORY_LIMIT'});
function safeCell(value){
 const text=value===null||value===undefined?'':String(value);
 if(text.length>32767)throw limit();
 // Also catches prefixes after whitespace/control characters used to hide formulas.
 return /^[\s\x00-\x1f]*[=+@-]/u.test(text)?"'"+text:text;
}

// Dashboard exports contain one summary row per user operation and separately
// preserve every authorized audit field, without exposing raw metadata or IDs.
const OP_COLUMNS=Object.freeze([
 ['index','Operation #'],['changeDate','Time (UTC)'],['title','Operation'],
 ['domain','Domain'],['recordCount','Records'],['changeCount','Field changes'],
 ['affectedFaculty','Affected faculty'],['startDate','Earliest start'],
 ['endDate','Latest end'],['actor','By whom']
].map(([key,header])=>Object.freeze({key,header})));
const DETAIL_COLUMNS=Object.freeze([
 ['index','Operation #'],['recordIndex','Record #'],['affectedFaculty','Affected faculty'],
 ['course','Course'],['session','Session'],['startDate','Start'],['endDate','End'],
 ['field','Field'],['previousValue','From'],['updatedValue','To']
].map(([key,header])=>Object.freeze({key,header})));
function detailRows(operations){
 const rows=[];
 for(const [index,operation] of operations.entries()){
  for(const [recordIndex,record] of (operation.records||[]).entries()){
   for(const change of record.changes||[])rows.push({
    index:index+1,recordIndex:recordIndex+1,affectedFaculty:names.formatList(record.affectedFaculty),
    course:record.course,session:record.session,startDate:record.startDate,endDate:record.endDate,
    field:change.field,previousValue:change.previousValue,updatedValue:change.updatedValue
   });
  }
 }
 return rows;
}
function summaryRows(operations){
 return operations.map((operation,index)=>({...operation,index:index+1,actor:names.format(operation.actor),affectedFaculty:names.formatList(operation.affectedFaculty)}));
}
function quote(value){return '"'+value.replaceAll('"','""')+'"';}
function writeSheet(book,title,columns,items){
 const sheet=book.addWorksheet(title,{views:[{state:'frozen',ySplit:1}]});
 sheet.addRow(columns.map(column=>column.header));
 sheet.addRows(items.map(row=>columns.map(column=>safeCell(row[column.key]??'N/A'))));
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
 sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF263650'}};
 for(let i=1;i<=columns.length;i++)sheet.getColumn(i).width=columns[i-1].key==='previousValue'||columns[i-1].key==='updatedValue'?48:24;
 sheet.autoFilter={from:{row:1,column:1},to:{row:items.length+1,column:columns.length}};
 sheet.eachRow(row=>{row.alignment={vertical:'top',wrapText:true};});
 return sheet;
}
async function renderOperationExport(operations,format){
 const summaries=summaryRows(operations);
 let bytes,contentType;
 if(format==='csv'){
  // CSV is intrinsically single-sheet: one row per operation with complete
  // authorized child details in a quoted multi-line cell.
  const columns=[...OP_COLUMNS,{key:'details',header:'Change details'}];
  const values=summaries.map((summary,i)=>{
   const details=(operations[i].records||[]).map((record,ri)=>{
    const prefix='Record '+(ri+1)+' | '+(names.formatList(record.affectedFaculty)||'N/A')+' | '+(record.startDate||'N/A')+' to '+(record.endDate||'N/A');
    const changes=(record.changes||[]).map(change=>String(change.field||'Change')+': '+String(change.previousValue??'N/A')+' → '+String(change.updatedValue??'N/A')).join(' ; ');
    return prefix+' | '+changes;
   }).join('\n');
   return columns.map(column=>safeCell(column.key==='details'?details:summary[column.key]??'N/A'));
  });
  bytes=Buffer.from('\uFEFF'+[columns.map(column=>column.header),...values].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n','utf8');
  contentType='text/csv; charset=utf-8';
 }else{
  const ExcelJS=require('exceljs');
  const book=new ExcelJS.Workbook();book.creator='PAWS';
  writeSheet(book,'Operations',OP_COLUMNS,summaries);
  writeSheet(book,'Change Details',DETAIL_COLUMNS,detailRows(operations));
  bytes=Buffer.from(await book.xlsx.writeBuffer());
  contentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 }
 if(bytes.length>6*1024*1024)throw limit();
 return {bytes,contentType,fileName:'paws-change-history.'+format};
}

async function renderHistoryExport(rows,format,{grouped=false}={}){
 if(!['csv','xlsx'].includes(format))throw Object.assign(Error('Unsupported format.'),{code:'INVALID_FORMAT'});
 if(!Array.isArray(rows)||rows.length>10000)throw limit();
 if(grouped||rows.some(row=>Array.isArray(row.records)))return renderOperationExport(rows,format);
 const values=rows.map(row=>COLUMNS.map(column=>safeCell(column.key==='start'?endpoint(row):column.key==='end'?endpoint(row,true):displayValue(column.key,row[column.key])??'N/A')));
 let bytes,contentType;
 if(format==='csv'){
  const quote=value=>'"'+value.replaceAll('"','""')+'"';
  bytes=Buffer.from('\uFEFF'+[COLUMNS.map(c=>c.header),...values].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n','utf8');
  contentType='text/csv; charset=utf-8';
 }else{
  // Preserve deferred loading: opening the timetable never loads ExcelJS.
  const ExcelJS=require('exceljs');
  const book=new ExcelJS.Workbook();
  book.creator='PAWS';
  const sheet=book.addWorksheet('Change History',{views:[{state:'frozen',ySplit:1}]});
  sheet.addRow(COLUMNS.map(c=>c.header));
  sheet.addRows(values);
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF263650'}};
  for(let i=1;i<=COLUMNS.length;i++)sheet.getColumn(i).width=[7,8].includes(i)?55:24;
  sheet.autoFilter={from:{row:1,column:1},to:{row:values.length+1,column:COLUMNS.length}};
  sheet.eachRow(row=>{row.alignment={vertical:'top',wrapText:true};});
  bytes=Buffer.from(await book.xlsx.writeBuffer());
  contentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 }
 if(bytes.length>6*1024*1024)throw limit();
 return {bytes,contentType,fileName:'paws-change-history.'+format};
}
module.exports={COLUMNS,OP_COLUMNS,DETAIL_COLUMNS,renderHistoryExport,renderOperationExport};
