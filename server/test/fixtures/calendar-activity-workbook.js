'use strict';
const ExcelJS=require('exceljs');
const {createHash}=require('node:crypto');
async function makeWorkbook(rows,{date1904=false,headers=['Faculty Member','Start','End','Purpose '],ignoredFormula=false}={}){
 const book=new ExcelJS.Workbook();book.properties.date1904=date1904;
 const sheet=book.addWorksheet('AFC records');sheet.addRow(headers);
 rows.forEach((r,index)=>{
  const row=sheet.getRow(r.sourceRow||index+2);
  row.getCell(1).value=r.facultySourceName??null;
  for(const [column,field,raw] of [[2,'startDate','startValue'],[3,'endDate','endValue']]){
   row.getCell(column).value=Object.hasOwn(r,raw)?r[raw]:r[field]?new Date(r[field]+'T00:00:00Z'):null;
   row.getCell(column).numFmt='yyyy-mm-dd';
  }
  row.getCell(4).value=Object.hasOwn(r,'purposeValue')?r.purposeValue:r.purpose??null;
  if(r.auxiliary)row.getCell(6).value=r.auxiliary;
 });
 if(ignoredFormula){const data=book.addWorksheet('Data');data.getCell('A1').value={formula:"'[external.xlsx]Lookup'!A1",result:'private ignored content'};}
 return Buffer.from(await book.xlsx.writeBuffer());
}
function syntheticPolicyFor(bytes,changes={}){
 return {sourceSha256:createHash('sha256').update(bytes).digest('hex').toUpperCase(),dataset:'afc-working-activities',sheetName:'AFC records',excludedRows:[],policyVersion:'synthetic-v1',...changes};
}
module.exports={makeWorkbook,syntheticPolicyFor};
