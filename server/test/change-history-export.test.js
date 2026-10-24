'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {renderHistoryExport,COLUMNS}=require('../src/history/change-history-export');
test('CSV quotes Unicode/newlines and neutralizes formula prefixes including leading whitespace',async()=>{
 const out=await renderHistoryExport([{changeDate:'2026-10-16T00:00:00Z',previousValue:' \t=HYPERLINK("bad")',updatedValue:'你好,\nnew',field:'Room'}],'csv');
 const csv=out.bytes.toString('utf8');assert.match(csv,/"' \t=HYPERLINK\(""bad""\)"/);assert.match(csv,/"你好,\nnew"/);assert.equal(out.contentType,'text/csv; charset=utf-8');
});
test('real XLSX preserves all 202 rows, same columns, string values and no formulas',async()=>{
 const rows=Array.from({length:202},(_,i)=>({field:'Topic',previousValue:'=2+2',updatedValue:'中文 '+i,changeDate:'2026-10-16T00:00:00Z'}));
 const out=await renderHistoryExport(rows,'xlsx');assert.equal(out.bytes.subarray(0,2).toString(),'PK');
 const ExcelJS=require('exceljs'),wb=new ExcelJS.Workbook();await wb.xlsx.load(out.bytes);const ws=wb.worksheets[0];assert.equal(ws.rowCount,203);assert.equal(ws.columnCount,COLUMNS.length);assert.equal(ws.getCell(1,1).value,'Time (UTC)');
 const oldColumn=COLUMNS.findIndex(c=>c.key==='previousValue')+1;assert.equal(ws.getCell(2,oldColumn).value,"'=2+2");assert.equal(typeof ws.getCell(2,oldColumn).value,'string');
 assert.equal(ws.getCell(203,COLUMNS.findIndex(c=>c.key==='updatedValue')+1).value,'中文 201');
});
test('oversized cells and unsupported formats fail explicitly, never cut data silently',async()=>{
 await assert.rejects(()=>renderHistoryExport([{updatedValue:'x'.repeat(32768)}],'xlsx'),{code:'HISTORY_LIMIT'});
 await assert.rejects(()=>renderHistoryExport([],'xls'),{code:'INVALID_FORMAT'});
});

test('Dashboard CSV uses one operation row and includes every authorized field in its details cell',async()=>{
 const operation={changeDate:'2026-10-20T15:00:00Z',title:'2 AFC Records Created',domain:'AFC',recordCount:2,changeCount:4,
  affectedFaculty:'Faculty A; Faculty B',startDate:'2026-11-09',endDate:'2026-11-10',actor:'Admin',
  records:[
   {affectedFaculty:'Faculty A',startDate:'2026-11-09',endDate:'2026-11-09',changes:[{field:'Purpose',previousValue:'Not recorded',updatedValue:'University Travel'},{field:'Start date',previousValue:'Not recorded',updatedValue:'2026-11-09'}]},
   {affectedFaculty:'Faculty B',startDate:'2026-11-10',endDate:'2026-11-10',changes:[{field:'Purpose',previousValue:'Not recorded',updatedValue:'Vacation'},{field:'End date',previousValue:'Not recorded',updatedValue:'2026-11-10'}]}
  ]};
 const out=await renderHistoryExport([operation],'csv',{grouped:true});
 const csv=out.bytes.toString('utf8');
 assert.equal((csv.match(/\r\n/g)||[]).length,2);
 for(const value of ['Operations','A, Faculty','B, Faculty','University Travel','Vacation','Purpose','Start date','End date'])if(value!=='Operations')assert.ok(csv.includes(value),value);
 assert.doesNotMatch(csv,/batchRequestId|actorFirebaseUid/);
});
test('Dashboard Excel separates one operation row from its complete Change Details',async()=>{
 const op={changeDate:'2026-10-20T15:00:00Z',title:'1 AFC Record Created',domain:'AFC',recordCount:1,changeCount:2,
  records:[{affectedFaculty:'Faculty A',startDate:'2026-11-09',endDate:'2026-11-09',changes:[
   {field:'Purpose',previousValue:'old',updatedValue:'=HYPERLINK("bad")'},
   {field:'Notes',previousValue:'-bad',updatedValue:'中文测试'}]}]};
 const out=await renderHistoryExport([op],'xlsx',{grouped:true});
 assert.equal(out.bytes.subarray(0,2).toString(),'PK');
 const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(out.bytes);
 assert.deepEqual(book.worksheets.map(s=>s.name),['Operations','Change Details']);
 assert.equal(book.getWorksheet('Operations').rowCount,2);
 assert.equal(book.getWorksheet('Change Details').rowCount,3);
 assert.equal(book.getWorksheet('Change Details').getCell(2,10).value,"'=HYPERLINK(\"bad\")");
 assert.equal(book.getWorksheet('Change Details').getCell(3,9).value,"'-bad");
 assert.equal(book.getWorksheet('Change Details').getCell(3,10).value,'中文测试');
});
