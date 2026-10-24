'use strict';
const ExcelJS=require('exceljs'),{createHash}=require('node:crypto');
const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'];
async function fixture({mutate,extraSheets=29}={}){
 const book=new ExcelJS.Workbook();
 const h=book.addWorksheet('HICCs');h.getRow(2).values=['Course','HICC',null,'Course Units','DOE %','HICC DOE Notes',null,null,'Start Date','End Date'];h.getRow(3).values=['VTMD 300: Example','Example, Alex',null,3,6,'Starts June 2026'];
 const v=book.addWorksheet('VISCs');v.getRow(2).values=['Subject Area','VISC','DOE %','VISC DOE Notes - Clean for Hub',null,null,'Start Date','End Date'];v.getRow(3).values=['Example / Area','Example, Blair',5];v.getRow(4).values=['Unassigned Area',null,5];
 const r=book.addWorksheet('Rotations');r.getRow(1).values=['Rotation','Rotation Participant','Weeks','Rotation Details','DOE %','Notes',null,'Designated Clinical Rotation','Designated Clinical Rotation Coordinator','Details','DOE %'];r.getRow(2).values=['100 EXAMPLE','Example, Alex',2,'Dates TBD; roughly February',5,null,null,'100 EXAMPLE','Example, Blair','Dates TBD',2];
 const c=book.addWorksheet('CCC');c.getCell('N1').value='CCC Faculty';c.getCell('Q1').value='# of shifts';c.getCell('S1').value='shifts DOE';c.getRow(5).values=['CCC Date','Is this a 4th Year Rotation?','Faculty #1','Faculty #2','Faculty #3 (if applicable)','Notes','Day of the week','Holidays, Closures'];c.getCell('A6').value=new Date('2026-11-02T00:00:00Z');c.getCell('A6').numFmt='yyyy-mm-dd';c.getCell('C6').value='Example, Alex';c.getCell('D6').value='Example, Blair';c.getCell('E6').value='Locum';c.getCell('N2').value='Example, Alex';c.getCell('Q2').value={formula:'COUNTIF(C6:E6,N2)',result:1};c.getCell('S2').value=.5;c.getCell('U2').value=0;
 const t=book.addWorksheet('# Trainees');t.getCell('A1').value='HR FULL Name';t.getCell('B1').value='TOTAL Number of Trainees';t.getCell('AA1').value='Trainee DOE (Sum)';t.getRow(2).values=[1,2,3,4,5,6,7,8];t.getCell('A3').value='Example, Alex';t.getCell('D3').value=1;t.getCell('H3').value=53;t.getCell('B3').value={formula:'D3+H3',result:54};t.getCell('AA3').value=40.75;t.getCell('E3').value='private trainee note';t.getCell('A4').value='Example, Blair';t.getCell('B4').value=0;t.getCell('H5').value={formula:'SUM(H2:H4)',result:61};
 for(let i=0;i<extraSheets;i++)book.addWorksheet('Other '+i);
 if(mutate)await mutate(book);
 const bytes=Buffer.from(await book.xlsx.writeBuffer());
 return {bytes,context:{academicYear:'2026-27',expectedSourceSha256:createHash('sha256').update(bytes).digest('hex'),faculty:[{facultyId:ids[0],displayName:'Alex Example',firstName:'Alex',lastName:'Example',active:true},{facultyId:ids[1],displayName:'Blair Example',firstName:'Blair',lastName:'Example',active:true}],roles:[],aliases:[]}};
}
module.exports={fixture,ids};
