'use strict';
const {UUID,validChanges,onlyKeys}=require('./swap-domain');
const {writeDisabled}=require('../data/write-gates');
const {isAdministratorRole}=require('../auth/role-policy');
const approvalView=require('./swap-view');
const fail=(status,code,message)=>({status,body:{error:{code,message}}});
const number=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
const doeSummary=value=>({status:value?.status==='calculated'?'calculated':'needs_review',contractDoe:number(value?.target?.contractTeachingDoe??value?.contractDoe),currentDoe:value?.status==='calculated'?number(value.totals?.assignedTeachingDoe):null,targetDoe:value?.status==='calculated'?number(value.totals?.effectiveTargetDoe):null,remainingDoe:value?.status==='calculated'?number(value.totals?.remainingDoe):null});
const doePair=value=>{const current=doeSummary(value?.current),projected=value?.projected?doeSummary(value.projected):null;return{current,projected,deltaDoe:current.currentDoe!==null&&projected?.currentDoe!=null?Number((projected.currentDoe-current.currentDoe).toFixed(6)):null};};
function createSwapApi({verifyToken,findUser,repository,workflowPreviewService,worksheetService,writeGates={}}){
  async function auth(token){
    let decoded;try{decoded=token&&await verifyToken(token);}catch(_){return {response:fail(401,'UNAUTHENTICATED','A valid bearer token is required.')};}
    if(!decoded?.uid)return {response:fail(401,'UNAUTHENTICATED','A bearer token is required.')};
    const user=await findUser(decoded.uid);
    if(!user||user.active!==true)return {response:fail(403,'PROFILE_REQUIRED','An active SQL profile is required.')};
    if(user.mustChangePassword===true)return {response:fail(403,'PASSWORD_CHANGE_REQUIRED','Change your password before accessing SWAP.')};
    return {uid:decoded.uid,user};
  }
  async function call(token,method,params={},gate){
    const a=await auth(token);if(a.response)return a.response;
    if(gate&&writeGates[gate]!==true)return writeDisabled();
    try{const value=await repository[method]({...params,actorFirebaseUid:a.uid});const body=value&&(method==='queue'?approvalView.queue(value):method==='context'?value:approvalView.detail(value));return body?{status:200,body}:fail(404,'NOT_FOUND','The request or session is unavailable in your scope.');}
    catch(error){const n=Number(error.number||error.code);if(n>=53000&&n<53100)return fail([53009,53010,53011].includes(n)?409:n===53003?403:n===53004?404:400,n===53009?'REVISION_CONFLICT':n===53010?'STALE_SESSION':'SWAP_REJECTED',error.message);return fail(503,'SERVICE_UNAVAILABLE','The SWAP service is unavailable.');}
  }
  return Object.freeze({
    async facultyPreview(token,payload){
      const actor=await auth(token);if(actor.response)return actor.response;
      if(!isAdministratorRole(actor.user.baseRole))return fail(403,'ROLE_DENIED','ADFA permission is required for DOE preview.');
      if(!onlyKeys(payload,['sessionId','assignmentId','candidateKey','snapshotToken'])||!UUID.test(payload.sessionId||'')||!UUID.test(payload.assignmentId||'')||(payload.candidateKey!=null&&!UUID.test(payload.candidateKey))||!/^[0-9a-f]{64}$/i.test(payload.snapshotToken||''))return fail(400,'INVALID_PREVIEW','Choose an assignment and reload its current session.');
      try{
        const args={actorFirebaseUid:actor.uid,...payload},context=await repository.facultyPreviewContext(args);
        if(!context)return fail(404,'NOT_FOUND','The assignment or candidate is unavailable.');
        let result;
        if(payload.candidateKey){
          result=await workflowPreviewService.previewFacultyTransfer({sessionId:payload.sessionId,outgoingFacultyId:context.outgoingFacultyId,incomingFacultyId:context.incomingFacultyId});
        }else{
          const current=await worksheetService.buildFacultyWorksheet({facultyId:context.outgoingFacultyId,academicYear:context.academicYear});
          result={status:current.status,outgoing:{current},incoming:null,sessionDoeCredit:null};
        }
        // Re-read authorization, identity and the session after calculation; this preview reserves nothing.
        const live=await repository.facultyPreviewContext(args);
        if(!live||live.outgoingFacultyId!==context.outgoingFacultyId||live.incomingFacultyId!==context.incomingFacultyId)return fail(409,'STALE_SESSION','The assignment changed; reload before previewing.');
        const status=['Available','Unavailable','Needs Review'].includes(live.availabilityStatus)?live.availabilityStatus:'Needs Review';
        return {status:200,body:{preview:{status:result.status==='calculated'?'calculated':'needs_review',academicYear:context.academicYear,
          assignment:{assignmentId:payload.assignmentId,displayName:context.outgoingDisplayName,teachingRole:context.teachingRole,persistedDoeCredit:number(context.persistedDoeCredit)},
          availability:{status,conflicts:(Array.isArray(live.conflicts)?live.conflicts:[]).map(row=>({courseCode:row.courseCode,date:row.date,startTime:row.startTime,endTime:row.endTime,topic:row.topic}))},
          outgoing:doePair(result.outgoing),
          incoming:result.incoming?doePair(result.incoming):null,
          sessionDoeCredit:result.status==='calculated'?number(result.sessionDoeCredit):null,checkedAtUtc:new Date().toISOString(),evidencePersisted:false}}};
      }catch(error){
        const n=Number(error.number||error.code);
        if(n===53003)return fail(403,'ROLE_DENIED','ADFA permission is required for DOE preview.');
        if(n===53004)return fail(404,'NOT_FOUND','The assignment or candidate is unavailable.');
        if(n===53010)return fail(409,'STALE_SESSION','The assignment changed; reload before previewing.');
        return fail(503,'SERVICE_UNAVAILABLE','The SWAP preview is temporarily unavailable.');
      }
    },
    async capabilities(token){const a=await auth(token);return a.response||{status:200,body:{canPreviewDoe:isAdministratorRole(a.user.baseRole),writeCapabilities:Object.fromEntries(['swapRequest','swapDecision','swapApply'].map(key=>[key,writeGates[key]===true]))}};},
    context:(token,{sessionId})=>UUID.test(sessionId||'')?call(token,'context',{sessionId}):Promise.resolve(fail(400,'INVALID_SESSION_ID','A canonical session identifier is required.')),
    queue:token=>call(token,'queue'),
    detail:(token,requestId)=>UUID.test(requestId||'')?call(token,'detail',{requestId}):Promise.resolve(fail(400,'INVALID_REQUEST_ID','A request identifier is required.')),
    create(token,payload){if(!onlyKeys(payload,['requestId','sessionId','assignmentId','snapshotToken','changes','notifyReplacement','note'])||!UUID.test(payload.requestId||'')||!UUID.test(payload.sessionId||'')||(payload.assignmentId!=null&&!UUID.test(payload.assignmentId))||!/^[0-9a-f]{64}$/i.test(payload.snapshotToken||'')||!validChanges(payload.changes)||typeof payload.notifyReplacement!=='boolean'||typeof payload.note!=='string'||payload.note.length>2000)return Promise.resolve(fail(400,'INVALID_REQUEST','The SWAP request contains invalid fields.'));return call(token,'create',{payload},'swapRequest');},
    revise(token,requestId,payload){if(!UUID.test(requestId||'')||!onlyKeys(payload,['expectedRevision','assignmentId','changes','notifyReplacement','note'])||!Number.isInteger(payload.expectedRevision)||payload.expectedRevision<1||(payload.assignmentId!=null&&!UUID.test(payload.assignmentId))||!validChanges(payload.changes)||typeof payload.notifyReplacement!=='boolean'||typeof payload.note!=='string'||payload.note.length>2000)return Promise.resolve(fail(400,'INVALID_REVISION','The revision contains invalid fields.'));return call(token,'revise',{requestId,payload},'swapRequest');},
    decide(token,requestId,payload){if(!UUID.test(requestId||'')||!onlyKeys(payload,['expectedRevision','decision','comment','overrideReason'])||!Number.isInteger(payload.expectedRevision)||payload.expectedRevision<1||!['approve','reject','push_back'].includes(payload.decision)||(payload.comment!=null&&(typeof payload.comment!=='string'||payload.comment.length>2000))||(payload.overrideReason!=null&&(typeof payload.overrideReason!=='string'||payload.overrideReason.length>2000))||(payload.decision!=='approve'&&!String(payload.comment||'').trim()))return Promise.resolve(fail(400,'INVALID_DECISION','A revision and decision with a reason are required.'));return call(token,'decide',{requestId,payload,applyEnabled:writeGates.swapApply===true},'swapDecision');},
    withdraw(token,requestId,payload){if(!UUID.test(requestId||'')||!onlyKeys(payload,['expectedRevision','comment'])||!Number.isInteger(payload.expectedRevision)||payload.expectedRevision<1||(payload.comment!=null&&(typeof payload.comment!=='string'||payload.comment.length>2000)))return Promise.resolve(fail(400,'INVALID_WITHDRAWAL','A current revision is required.'));return call(token,'withdraw',{requestId,payload},'swapRequest');}
  });
}
module.exports={createSwapApi};
