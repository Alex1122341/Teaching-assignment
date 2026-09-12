'use strict';
const fs=require('node:fs');
const {PDFDocument,StandardFonts,rgb}=require('pdf-lib');

async function renderAfcPdf(request,templatePath){
 const pdf=await PDFDocument.load(fs.readFileSync(templatePath));
 const form=pdf.getForm();
 const set=(name,value)=>{try{form.getTextField(name).setText(String(value??''))}catch(_){/* optional template field */}};
 const select=(name,value)=>{try{form.getDropdown(name).select(String(value??''))}catch(_){/* optional template field */}};
 const check=name=>{try{form.getCheckBox(name).check()}catch(_){/* optional template field */}};
 const date=v=>v?String(v).slice(0,10):'';
 const f=request.facultySnapshot||{},parts=String(request.facultyName||'').trim().split(/\s+/);
 set('Employee ID',f.ucid||request.facultyId);set('First Name',f.firstName||parts[0]||'');set('Last Name',f.lastName||parts.slice(1).join(' '));
 set('Number of Work Days',request.workDays);set('Start Date',request.startDate);set('End Date',request.endDate);
 select('Appt Type',f.appointmentType||'');select('Rank',f.rank||f.currentTitle||'');select('Primary Department',f.primaryDepartment||f.department||'');set('Expiry Date',f.expiryDate||'');
 if(request.reason==='vacation')check('Select reason');else check('Vacation');
 set('Please provide the purpose and destination business onlyRow1',request.purposeDestination||'');
 set('Please provide details of arrangements to cover absenceRow1',request.coverage||'No teaching assignments during this period.');
 set('Staff Member Name',request.facultyName);set('Date',date(request.applicantSignature?.signedAt));
 set('Name',request.reportToSignature?.name||request.reportToName||'');set('Date_2',date(request.reportToSignature?.signedAt));
 set('Name_2',request.adminSignature?.name||'');set('Date_3',date(request.adminSignature?.signedAt));
 set('Name_3',request.delegatedSignature?.name||'');set('Date_4',date(request.delegatedSignature?.signedAt));
 for(const n of ['Signature','Signature_2','Signature_3','Signature_4']){try{form.removeField(form.getField(n))}catch(_){}}
 try{form.flatten()}catch(_){/* Some official signature widgets cannot be flattened. */}
 const page=pdf.getPages()[0],font=await pdf.embedFont(StandardFonts.HelveticaOblique),bold=await pdf.embedFont(StandardFonts.HelveticaBold),ink=rgb(.05,.12,.25);
 page.drawText('X',{x:request.reason==='vacation'?445:496,y:570,size:11,font:bold,color:ink});
 const draw=(sig,x,y)=>{if(sig?.name)page.drawText(`/s/ ${sig.name}`,{x,y,size:9,font,color:ink,maxWidth:175})};
 draw(request.applicantSignature,330,258);draw(request.reportToSignature,280,214);draw(request.adminSignature,280,170);draw(request.delegatedSignature,280,126);
 pdf.setTitle(`AFC ${request.facultyName} ${request.startDate} to ${request.endDate}`);pdf.setSubject('Approved Absence from Campus request');pdf.setProducer('UCVM AFC workflow');
 return Buffer.from(await pdf.save({useObjectStreams:false}));
}
module.exports={renderAfcPdf};
