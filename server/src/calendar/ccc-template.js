'use strict';
let cached;
async function renderCccTemplate(){
 if(!cached)cached=(async()=>{
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();book.creator='PAWS';
  const sheet=book.addWorksheet('CCC',{views:[{state:'frozen',ySplit:1}]});
  sheet.addRow(['Faculty ID','Faculty Name','Start Date','End Date','Course Code','Label']);
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF263650'}};
  sheet.columns.forEach((column,i)=>{column.width=[39,32,18,18,18,30][i];column.numFmt='@';});sheet.autoFilter='A1:F1';
  return Object.freeze({fileName:'CCC-template.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',fileBase64:Buffer.from(await book.xlsx.writeBuffer()).toString('base64')});
 })().catch(error=>{cached=null;throw error;});
 return cached;
}
module.exports={renderCccTemplate};
