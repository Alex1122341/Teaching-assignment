'use strict';
// Frontend Demo only: Faculty lifecycle dates are simulated against a local
// clock. The real SQL/Firestore versions require their own trusted validation.
const invalid=(message,number=56551)=>Object.assign(new Error(message),{number});

function campusToday(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value=kind=>parts.find(p=>p.type===kind)?.value||'';
  return value('year')+'-'+value('month')+'-'+value('day');
}
function validDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function effectiveActive(faculty,now=new Date()){
  return faculty?.active===true&&(!faculty.activationDate||faculty.activationDate<=campusToday(now));
}
function facultyStatus(faculty,now=new Date()){
  return !faculty?.active?'inactive':effectiveActive(faculty,now)?'active':'pending';
}
function assertAssignable(store,facultyId,date){
  const member=store.tables.faculty.find(row=>row.facultyId===facultyId);
  if(!member||member.active!==true||
    (member.activationDate&&(!validDate(date)||date<member.activationDate)))
    throw invalid('Faculty is inactive or this course precedes their official start date.');
  return member;
}
function assertCanReschedule(store,session,date){
  for(const a of session.assignments||[])if(a.facultyId)assertAssignable(store,a.facultyId,date);
}
function assertActivationChange(store,facultyId,newDate) {
  if(!newDate)return;
  const before=(day)=>!validDate(day)||day<newDate;
  for(const s of store.tables.sessions) {
    if(before(s.date)&&(s.assignments||[]).some(a=>a.facultyId===facultyId))
      throw invalid('Existing Calendar teaching precedes the requested start date.',56552);
  }
  const records=store.tables.extra?.teachingAssignments;
  if(!records)return;
  for(const p of records.packages||[]) {
    for(const r of p.revisions||[])for(const s of r.sessions||[])
      if(before(s.sessionDate)&&(s.assignments||[]).some(a=>a.facultyId===facultyId))
        throw invalid('Existing teaching drafts precede the requested start date.',56552);
    for(const a of p.finalization||[]){
      const s=p.revisions?.at(-1)?.sessions?.find(row=>row.sessionId===a.sessionId);
      if(a.facultyId===facultyId&&(!s||before(s.sessionDate)))
        throw invalid('Final teaching precedes the requested start date.',56552);
    }
  }
  for(const release of records.releases||[])for(const s of release.sessions||[])
    if(before(s.sessionDate)&&(s.assignments||[]).some(a=>a.facultyId===facultyId))
      throw invalid('Published teaching precedes the requested start date.',56552);
}
module.exports={campusToday,validDate,effectiveActive,facultyStatus,assertAssignable,assertCanReschedule,assertActivationChange};
