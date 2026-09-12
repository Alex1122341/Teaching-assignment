'use strict';

const HOLIDAYS=new Set([
 '2026-01-01','2026-02-16','2026-04-03','2026-04-06','2026-05-18','2026-07-01','2026-08-03','2026-09-07','2026-09-30','2026-10-12','2026-11-11','2026-12-25','2026-12-28','2026-12-29','2026-12-30','2026-12-31',
 '2027-01-01','2027-02-15','2027-03-26','2027-03-29','2027-05-24','2027-07-01','2027-08-02','2027-09-06','2027-09-30','2027-10-11','2027-11-11','2027-12-27','2027-12-28','2027-12-29','2027-12-30','2027-12-31'
]);
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const parse=s=>{if(!DATE_RE.test(String(s||'')))throw Error('A valid start and end date are required.');const d=new Date(`${s}T12:00:00Z`);if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s)throw Error('A valid start and end date are required.');return d};
const ymd=d=>d.toISOString().slice(0,10);
function workDays(startDate,endDate){const start=parse(startDate),end=parse(endDate);if(end<start)throw Error('End date must be on or after start date.');let count=0;for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1)){const day=d.getUTCDay(),key=ymd(d);if(day!==0&&day!==6&&!HOLIDAYS.has(key))count++}return count}
function validateDraft(d){
 const days=workDays(d.startDate,d.endDate);if(days<1)throw Error('The selected range contains no work days.');
 if((new Date(`${d.endDate}T12:00:00Z`)-new Date(`${d.startDate}T12:00:00Z`))/86400000>366)throw Error('An AFC request cannot span more than one year.');
 if(!['vacation','business_other'].includes(d.reason))throw Error('Select Vacation or Business / Other.');
 if(d.reason==='business_other'&&!String(d.purposeDestination||'').trim())throw Error('Please provide the purpose and destination for Business / Other.');
 if((d.teachingSessions||[]).length&&!String(d.coverage||'').trim())throw Error('Coverage details are required because teaching assignments occur during this absence.');
 if(!String(d.signatureName||'').trim()||d.attested!==true)throw Error('Type your name and accept the electronic signature statement.');
 return days;
}
function nextStatus(action,request){
 if(action==='submit')return request.reportToUid?'pending_report_to':'pending_admin';
 if(action==='recommend'&&request.status==='pending_report_to')return'pending_admin';
 if(action==='approve'&&request.status==='pending_admin')return'approved';
 if(action==='reject'&&['pending_report_to','pending_admin'].includes(request.status))return'rejected';
 throw Error('This AFC request cannot make that transition.');
}
module.exports={HOLIDAYS,workDays,validateDraft,nextStatus};
