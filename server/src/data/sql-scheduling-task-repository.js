'use strict';
const TYPES=new Set(['instructor_overlap','afc_unavailable','duplicate_assignment','duplicate_session_assignment','invalid_schedule','missing_schedule','calendar_activity_overlap','calendar_time_unknown']);
const hex=(value,size)=>typeof value==='string'&&new RegExp('^[0-9a-f]{'+size+'}$','i').test(value);
const scalar=value=>typeof value==='string'?value:null;
const invalid=()=>{throw Object.assign(Error('Invalid scheduling response.'),{code:'INVALID_SCHEDULING_RESPONSE'});};
function publicTask(row,canReview=true){
 if(!row||!hex(row.issueKey,64)||!hex(row.evidenceVersion,64)||!hex(row.reviewVersion,16)||!TYPES.has(row.type)||!['Conflict','Needs Review'].includes(row.severity)||!['Unreviewed','Reviewed'].includes(row.reviewStatus))invalid();
 const result=Object.fromEntries(['issueKey','facultyKey','displayName','courseCode','sessionId','date','startTime','endTime','type','severity','reviewStatus','evidenceVersion','reviewVersion'].map(key=>[key,scalar(row[key])]));
 result.canReview=canReview&&row.canReview===true;
 result.relatedSessions=(Array.isArray(row.relatedSessions)?row.relatedSessions:[]).map(session=>Object.fromEntries(['id','courseCode','date','startTime','endTime'].map(key=>[key,scalar(session?.[key])])));
 return result;
}
function publicQueue(value,canReview=true){
 if(!value||!Array.isArray(value.tasks)||value.tasks.length>100||!Number.isInteger(value.total)||value.total<value.tasks.length||!hex(value.snapshotVersion,64))invalid();
 return {
  tasks:value.tasks.map(task=>publicTask(task,canReview)),total:value.total,snapshotVersion:value.snapshotVersion,nextCursor:scalar(value.nextCursor),
  academicYears:(Array.isArray(value.academicYears)?value.academicYears:[]).map(row=>({academicYear:scalar(row?.academicYear)})),
  filters:{faculty:(Array.isArray(value.filters?.faculty)?value.filters.faculty:[]).map(row=>({facultyKey:scalar(row?.facultyKey),displayName:scalar(row?.displayName)})),courses:(Array.isArray(value.filters?.courses)?value.filters.courses:[]).map(row=>({courseCode:scalar(row?.courseCode)}))},
  capabilities:{canReview:canReview&&value.capabilities?.canReview===true}
 };
}
function createSqlSchedulingTaskRepository(db){
 async function exec(name,params){
  const rows=await db.query('EXEC paws_api.'+name+' '+Object.keys(params).map(key=>'@'+key+'=@'+key).join(','),params);
  try{return JSON.parse(rows[0]?.responseJson);}catch(_){invalid();}
 }
 return Object.freeze({
  async list({actorFirebaseUid,query}){return publicQueue(await exec('ListSchedulingTasks',{ActorFirebaseUid:actorFirebaseUid,QueryJson:JSON.stringify(query)}));},
  async review({actorFirebaseUid,issueKey,academicYear,expectedEvidenceVersion,expectedReviewVersion,reviewStatus}){
   return publicTask(await exec('ReviewSchedulingTask',{ActorFirebaseUid:actorFirebaseUid,IssueKey:issueKey,AcademicYear:academicYear,ExpectedEvidenceVersion:expectedEvidenceVersion,ExpectedReviewVersion:expectedReviewVersion,ReviewStatus:reviewStatus}));
  }
 });
}
module.exports={createSqlSchedulingTaskRepository,publicTask,publicQueue,TYPES};
