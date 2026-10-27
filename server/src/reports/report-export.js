'use strict';
const {canonicalAcademicYear}=require('../data/academic-year');
const {REPORT_LIMITS,invalid,limit}=require('./report-definition');
function safeText(value){const text=String(value);if(text.length>32767)throw limit();return /^[\s\x00-\x1f]*[=+@-]/u.test(text)?"'"+text:text;}
function cell(value,column){
 if(value===null||value===undefined)return 'N/A';
 if(column.type==='number'){if(typeof value!=='number'||!Number.isFinite(value))throw invalid();return value;}
 if(column.type==='boolean'){if(typeof value!=='boolean')throw invalid();return value;}
 if(typeof value!=='string')throw invalid();return safeText(value);
}
async function renderReportExport(tables,{format,academicYear}={}){
 if(!['csv','xlsx'].includes(format)||!Array.isArray(tables)||tables.length<1||tables.length>4||format==='csv'&&tables.length!==1)throw invalid();
 let year;try{year=canonicalAcademicYear(academicYear);}catch(_){throw invalid();}
 const seen=new Set();let count=0,cells=0;
 const prepared=tables.map(table=>{
  if(!table||!['workload','schedule','roles','history'].includes(table.source)||seen.has(table.source)||!Array.isArray(table.columns)||!table.columns.length||table.columns.length>REPORT_LIMITS.columns||!Array.isArray(table.rows)||table.rows.length!==table.total)throw invalid();seen.add(table.source);
  if(table.total>REPORT_LIMITS.rowsPerSource)throw limit();count+=table.total;cells+=table.total*table.columns.length;
  const headers=table.columns.map(column=>safeText(column.label+(column.unit?' ('+column.unit+')':'')));
  const values=table.rows.map(row=>{if(!Array.isArray(row)||row.length!==table.columns.length)throw invalid();return row.map((value,index)=>cell(value,table.columns[index]));});
  return {source:table.source,label:table.label,columns:table.columns,headers,values};
 });
 if(count>REPORT_LIMITS.totalRows||cells>REPORT_LIMITS.cells)throw limit();
 let bytes,contentType;
 if(format==='csv'){
  const quote=value=>'"'+String(value).replaceAll('"','""')+'"',table=prepared[0];
  bytes=Buffer.from('\uFEFF'+[table.headers,...table.values].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n','utf8');contentType='text/csv; charset=utf-8';
 }else{
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();book.creator='PAWS';
  for(const table of prepared){
   const sheet=book.addWorksheet(String(table.label).replace(/[\\/:?*\[\]]/g,' ').slice(0,31),{views:[{state:'frozen',ySplit:1}]});
   sheet.addRow(table.headers);sheet.addRows(table.values);sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF263650'}};
   sheet.autoFilter={from:{row:1,column:1},to:{row:table.values.length+1,column:table.columns.length}};
   table.columns.forEach((column,index)=>{const c=sheet.getColumn(index+1);c.width=['fromValue','toValue','topic','details','timeEvidence'].includes(column.id)?45:column.type==='number'?22:27;if(column.type==='number'){c.numFmt=column.unit==='%'?'0.00"%"':column.id==='fte'?'0.00':'0.######';c.alignment={horizontal:'right',vertical:'top'};}});
   sheet.eachRow(row=>{row.eachCell((value,index)=>{value.alignment={vertical:'top',wrapText:true,...(table.columns[index-1].type==='number'?{horizontal:'right'}:{})};});});
  }
  bytes=Buffer.from(await book.xlsx.writeBuffer());contentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 }
 if(bytes.length>REPORT_LIMITS.bytes)throw limit();
 return {bytes,contentType,fileName:'paws-reports-'+year+(format==='csv'?'-'+prepared[0].source:'')+'.'+format};
}
module.exports={renderReportExport};
