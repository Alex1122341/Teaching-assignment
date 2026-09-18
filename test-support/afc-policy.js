'use strict';

const closures=require('../university-closures');
const HOLIDAYS=new Set(closures.entries.map(row=>row.date));
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const parse=s=>{if(!DATE_RE.test(String(s||'')))throw Error('A valid start and end date are required.');const d=new Date(`${s}T12:00:00Z`);if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s)throw Error('A valid start and end date are required.');return d};
const ymd=d=>d.toISOString().slice(0,10);
function workDays(startDate,endDate){const start=parse(startDate),end=parse(endDate);if(end<start)throw Error('End date must be on or after start date.');return closures.countWorkingDays(ymd(start),ymd(end))}
function validateDraft(d){
 const days=workDays(d.startDate,d.endDate);if(days<1)throw Error('The selected range contains no work days.');
 if((new Date(`${d.endDate}T12:00:00Z`)-new Date(`${d.startDate}T12:00:00Z`))/86400000>366)throw Error('An AFC request cannot span more than one year.');
 if(!['vacation','business_other'].includes(d.reason))throw Error('Select Vacation or Business / Other.');
 if(d.reason==='business_other'&&!String(d.purposeDestination||'').trim())throw Error('Please provide the purpose and destination for Business / Other.');
 if((d.teachingSessions||[]).length&&!String(d.coverage||'').trim())throw Error('Coverage details are required because teaching assignments occur during this absence.');
 if(!String(d.contactAddress||'').trim())throw Error('A mailing address is required.');
 if(String(d.contactAddress||'').trim().length>500)throw Error('A mailing address cannot exceed 500 characters.');
 if(!String(d.contactPhone||'').trim())throw Error('A phone number is required.');
 if(String(d.contactPhone||'').trim().length>50)throw Error('A phone number cannot exceed 50 characters.');
 if(!String(d.signatureName||'').trim()||d.attested!==true)throw Error('Type your name and accept the electronic signature statement.');
 return days;
}
function nextStatus(action,request){
 if(action==='submit')return request.reportToUid?'pending_report_to':'pending_admin';
 if(action==='recommend'&&request.status==='pending_report_to')return'pending_admin';
 if(action==='approve'&&request.status==='pending_admin')return'approved';
 if(action==='reject'&&['pending_report_to','pending_admin'].includes(request.status))return'rejected';
 if(action==='withdraw'&&['pending_report_to','pending_admin'].includes(request.status))return'withdrawn';
 throw Error('This AFC request cannot make that transition.');
}
module.exports={HOLIDAYS,workDays,validateDraft,nextStatus};
