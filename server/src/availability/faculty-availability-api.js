'use strict';
const { backendFailure } = require('../http/backend-error');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const validDate=v=>DATE.test(v)&&v>='0001-01-01'&&v<='9999-12-31'&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const fail=(status,code,message)=>({status,body:{error:{code,message}}});
function createFacultyAvailabilityApi({verifyToken,findUser,repository}={}){
 if(!verifyToken||!findUser||!repository)throw Error('Availability dependencies required.');
 return Object.freeze({
  async list(token,facultyId,query={}){
   if(!token)return fail(401,'UNAUTHENTICATED','Sign in to check availability.');
   let decoded;try{decoded=await verifyToken(token);}catch(_){return fail(401,'UNAUTHENTICATED','Sign in to check availability.');}
   if(!decoded?.uid)return fail(401,'UNAUTHENTICATED','Sign in to check availability.');
   let profile;try{profile=await findUser(decoded.uid);}catch(caught){return backendFailure(caught) || fail(503,'SERVICE_UNAVAILABLE','Profile verification unavailable.');}
   const role=String(profile?.baseRole||profile?.role||'').toLowerCase(),admin=['developer','owner','administrator','admin','adfa_general','adfa_regular'].includes(role);
   if(!profile?.active||profile?.mustChangePassword||(!admin&&!['faculty','hicc','visc'].includes(role)))return fail(403,'ROLE_DENIED','Availability is not authorized.');
   if(!UUID.test(facultyId))return fail(400,'INVALID_FACULTY','Select a valid faculty.');
   if(!admin&&String(profile.facultyId||'').toLowerCase()!==facultyId.toLowerCase())return fail(403,'ROLE_DENIED','Only your own availability can be viewed.');
   const keys=['mode','startDate','endDate','kind','cursor','limit'];
   if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(k=>!keys.includes(k)))return fail(400,'INVALID_QUERY','Invalid availability filters.');
   const mode=query.mode||'upcoming',start=query.startDate||null,end=query.endDate||null,kind=query.kind||'all';
   const cursor=Number(query.cursor??0),limit=Number(query.limit??50);
   if(!['upcoming','from','range'].includes(mode)||!['all','teaching','work','afc','pending','role'].includes(kind)
      ||(mode==='upcoming'&&(start||end))||(mode==='from'&&(!start||end))||(mode==='range'&&(!start||!end||start>end))
      ||(start&&!validDate(start))||(end&&!validDate(end))
      ||!Number.isSafeInteger(cursor)||cursor<0||cursor>100000||!Number.isSafeInteger(limit)||limit<1||limit>100)
     return fail(400,'INVALID_QUERY','Choose a valid date range.');
   try{
    const value=await repository.list({actorFirebaseUid:decoded.uid,facultyId,mode,startDate:start,endDate:end,kind,cursor,limit});
    if(!value||!Array.isArray(value.items)||!Number.isInteger(value.total)||value.total<value.items.length||value.items.length>limit)
      throw Error('Invalid availability response.');
    if(!value.coverage||!['undatedSessions','undatedRoles'].every(k=>Number.isInteger(value.coverage[k])&&value.coverage[k]>=0)
      ||(value.nextCursor!==null&&(!/^\d+$/.test(value.nextCursor)||Number(value.nextCursor)<=cursor)))throw Error('Incomplete availability coverage.');
    const fields=['eventKey','kind','label','startDate','endDate','startTime','endTime','availability','timeStatus','courseCode','sessionId','detail'];
    const items=value.items.map(row=>{
     if(!row||typeof row.eventKey!=='string'||typeof row.label!=='string')throw Error('Invalid availability item.');
     const clean=Object.fromEntries(fields.map(k=>[k,row[k]??null]));
     clean.timeEvidence=Array.isArray(row.timeEvidence)?row.timeEvidence.map(t=>({date:t.date,startTime:t.startTime,endTime:t.endTime})):[];
     return clean;
    });
    return {status:200,body:{items,total:value.total,nextCursor:value.nextCursor,today:value.today,coverage:{undatedSessions:value.coverage.undatedSessions,undatedRoles:value.coverage.undatedRoles},facultyId,mode}};
   }catch(error){
    const number=Number(error?.number??error?.originalError?.info?.number);
    if(number===55603)return fail(403,'ROLE_DENIED','Availability is not authorized.');
    if(number===55604)return fail(404,'FACULTY_NOT_FOUND','Faculty is not found.');
    if(number===55601)return fail(400,'INVALID_QUERY','Choose a valid date range.');
    return fail(503,'SERVICE_UNAVAILABLE','Availability cannot be verified. Try again.');
   }
  }
 });
}
module.exports={createFacultyAvailabilityApi,validDate};
