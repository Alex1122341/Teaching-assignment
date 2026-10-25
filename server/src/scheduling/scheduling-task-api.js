'use strict';
const {validateAuthorizedProfile,normalizedRange}=require('../data/data-api');
const { backendFailure } = require('../http/backend-error');
const {isAdministratorRole}=require('../auth/role-policy');
const {writeDisabled}=require('../data/write-gates');
const {publicTask,publicQueue,TYPES}=require('../data/sql-scheduling-task-repository');
const fail=(status,code,message)=>({status,body:{error:{code,message}}});
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const year=value=>typeof value==='string'&&value.trim().length>0&&value.length<=32&&!/[\x00-\x1f]/.test(value);
const hex=(value,size)=>typeof value==='string'&&new RegExp('^[0-9a-f]{'+size+'}$','i').test(value);
const queryKeys=['academicYear','start','end','undated','facultyKey','courseCode','type','reviewStatus','cursor','limit'];
function validQuery(query){
 if(!closed(query,queryKeys)||!year(query.academicYear))return false;
 if(Object.entries(query).some(([key,value])=>key!=='limit'&&typeof value!=='string'))return false;
 if((query.start!==undefined||query.end!==undefined)&&(!query.start||!query.end||!normalizedRange(query)))return false;
 if(query.undated!==undefined&&!['include','only','exclude'].includes(query.undated))return false;
 if(query.facultyKey!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.facultyKey))return false;
 if(query.courseCode!==undefined&&(!query.courseCode.trim()||query.courseCode.length>32))return false;
 if(query.type!==undefined&&!TYPES.has(query.type))return false;
 if(query.reviewStatus!==undefined&&!['Unreviewed','Reviewed'].includes(query.reviewStatus))return false;
 if(query.cursor!==undefined&&!/^[0-9a-f]{64}:[1-9]\d{0,9}$/i.test(query.cursor))return false;
 if(query.limit!==undefined&&(!['string','number'].includes(typeof query.limit)||!/^\d+$/.test(String(query.limit))||Number(query.limit)<1||Number(query.limit)>100))return false;
 return true;
}
function failure(error){
  const typedFailure = backendFailure(error);
  if (typedFailure) return typedFailure;
 const number=Number(error?.number??error?.originalError?.info?.number);
 if(number===54310)return fail(409,'SCHEDULING_TASK_STALE','Scheduling data changed. Refresh the Tasks queue.');
 if(number===54303)return fail(403,'ROLE_DENIED','This account cannot access this scheduling operation.');
 if(number===54301)return fail(400,'INVALID_REQUEST','The scheduling request is invalid.');
 return fail(503,'SERVICE_UNAVAILABLE','The scheduling service is temporarily unavailable.');
}

function createSchedulingTaskApi({verifyToken,findUser,repository,writeGates={}}){
 async function authorize(token){
  if(typeof token!=='string'||!token)return fail(401,'UNAUTHENTICATED','Authentication required.');
  let decoded;
  try{decoded=await verifyToken(token);}catch(_){return fail(401,'UNAUTHENTICATED','Authentication required.');}
  let profile;
  try{profile=await findUser(decoded.uid);}catch(caught){return backendFailure(caught) || fail(503,'SERVICE_UNAVAILABLE','The scheduling service is temporarily unavailable.');}
  const validated=validateAuthorizedProfile(profile);
  if(validated.status)return validated;
  return {decoded,...validated};
 }
 return Object.freeze({
  async list(token,query){
   const auth=await authorize(token);if(auth.status)return auth;
   if(!validQuery(query))return fail(400,'INVALID_QUERY','Review the scheduling task filters.');
   try{
    const value=await repository.list({actorFirebaseUid:auth.decoded.uid,query:{...query,limit:query.limit===undefined?50:Number(query.limit)}});
    return {status:200,body:publicQueue(value,isAdministratorRole(auth.role)&&writeGates.schedulingTaskReview===true)};
   }catch(error){return failure(error);}
  },
  async review(token,issueKey,body){
   const auth=await authorize(token);if(auth.status)return auth;
   if(!isAdministratorRole(auth.role))return fail(403,'ROLE_DENIED','Only administrators can review scheduling tasks.');
   if(writeGates.schedulingTaskReview!==true)return writeDisabled();
   if(!hex(issueKey,64)||!closed(body,['academicYear','expectedEvidenceVersion','expectedReviewVersion','reviewStatus'])||!year(body.academicYear)||!hex(body.expectedEvidenceVersion,64)||!hex(body.expectedReviewVersion,16)||!['Unreviewed','Reviewed'].includes(body.reviewStatus))return fail(400,'INVALID_REQUEST','The scheduling review is invalid.');
   try{return {status:200,body:publicTask(await repository.review({actorFirebaseUid:auth.decoded.uid,issueKey,...body}))};}
   catch(error){return failure(error);}
  }
 });
}
module.exports={createSchedulingTaskApi};
