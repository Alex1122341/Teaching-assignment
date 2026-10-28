'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {renderReportExport}=require('../src/reports/report-export');
const table=()=>({source:'workload',label:'Faculty annual workload',columns:[{id:'facultyName',label:'Faculty',type:'text'},{id:'remainingDoe',label:'Remaining DOE',type:'number',unit:'%'},{id:'status',label:'Note',type:'text'}],rows:[['Example, Alex',-2,null],[' =SUM(1,1)',0,'line1\nline2']],total:2});
test('Excel numeric cells stay right aligned after wrapping and header styling',async()=>{
 const result=await renderReportExport([table()],{format:'xlsx',academicYear:'2026-27'}),book=new(require('exceljs').Workbook)();await book.xlsx.load(result.bytes);
 assert.equal(book.worksheets[0].getCell('B2').alignment.horizontal,'right');assert.equal(book.worksheets[0].getCell('B2').alignment.wrapText,true);
});
test('CSV quotes exact selected values, protects text formulas and preserves typed zero/negative numbers',async()=>{
 const t=table(),before=JSON.stringify(t),result=await renderReportExport([t],{format:'csv',academicYear:'2026-27'});
 assert.equal(result.bytes.toString('utf8'),'\uFEFF"Faculty","Remaining DOE (%)","Note"\r\n"Example, Alex","-2","N/A"\r\n"\' =SUM(1,1)","0","line1\nline2"\r\n');
 assert.equal(result.fileName,'paws-reports-2026-27-workload.csv');assert.equal(JSON.stringify(t),before);
});
test('Excel contains exactly the selected result sheets and full numeric precision, with literal text cells',async()=>{
 const first=table();first.rows[0][1]=-2.123456;const second={source:'roles',label:'Appointments / roles',columns:[{id:'facultyName',label:'Faculty',type:'text'}],rows:[['de la Cruz, Ana']],total:1};
 const result=await renderReportExport([first,second],{format:'xlsx',academicYear:'2026-27'}),ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(result.bytes);
 assert.equal(book.worksheets.length,2);assert.equal(book.worksheets[0].rowCount,3);assert.equal(book.worksheets[0].getCell('B2').value,-2.123456);assert.equal(book.worksheets[0].getCell('B3').value,0);assert.equal(book.worksheets[0].getCell('C2').value,'N/A');assert.equal(book.worksheets[0].getCell('A3').value,"' =SUM(1,1)");assert.equal(book.worksheets[1].getCell('A2').value,'de la Cruz, Ana');assert.equal(book.worksheets[0].views[0].state,'frozen');assert.match(book.worksheets[0].getCell('B2').numFmt,/%/);
});
test('unsafe dimensions, unsupported formats and oversized cells fail before a partial artifact is returned',async()=>{
 await assert.rejects(renderReportExport([table(),table()],{format:'csv',academicYear:'2026-27'}),{code:'INVALID_REPORT_QUERY'});
 await assert.rejects(renderReportExport([table()],{format:'pdf',academicYear:'2026-27'}),{code:'INVALID_REPORT_QUERY'});
 const t=table();t.rows[0][0]='a'.repeat(32768);await assert.rejects(renderReportExport([t],{format:'xlsx',academicYear:'2026-27'}),{code:'REPORT_LIMIT'});
});
