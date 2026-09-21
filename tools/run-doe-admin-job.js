'use strict';

const LAB_PROJECT_ID='vista-teaching-lab';
const OPERATIONS=new Set(['validate-policy','impact-preview','publish-policy','recalculate-preview','recalculate','recalculate-queue']);
const DESTRUCTIVE=new Set(['publish-policy','recalculate','recalculate-queue']);
const text=value=>String(value??'').trim();

function readArg(argv,name,fallback=''){
  const index=argv.indexOf(name);
  return index>=0&&argv[index+1]!==undefined?argv[index+1]:fallback;
}

function parseArgs(argv=process.argv.slice(2)){
  return{
    operation:text(readArg(argv,'--operation')),
    policyVersionId:text(readArg(argv,'--policy-version-id')),
    academicYear:text(readArg(argv,'--academic-year')),
    scope:text(readArg(argv,'--scope','all'))||'all',
    confirmation:text(readArg(argv,'--confirmation'))
  };
}

function expectedConfirmation(options={}){
  if(options.operation==='publish-policy')return `PUBLISH:${text(options.policyVersionId)}`;
  if(options.operation==='recalculate')return `RECALCULATE:${text(options.policyVersionId)}:${text(options.academicYear)}`;
  if(options.operation==='recalculate-queue')return'PROCESS-QUEUE';
  return'';
}

function validateOptions(options,{projectId=process.env.FIREBASE_PROJECT_ID}={}){
  const normalized={...options,operation:text(options?.operation),policyVersionId:text(options?.policyVersionId),academicYear:text(options?.academicYear),scope:text(options?.scope)||'all',confirmation:text(options?.confirmation)};
  if(text(projectId)!==LAB_PROJECT_ID)throw Error(`DOE admin job is locked to Firebase project "${LAB_PROJECT_ID}".`);
  if(!OPERATIONS.has(normalized.operation))throw Error('Unknown DOE admin operation.');
  if(normalized.operation!=='recalculate-queue'&&!normalized.policyVersionId)throw Error('Policy Version ID is required.');
  if(['recalculate-preview','recalculate'].includes(normalized.operation)&&!normalized.academicYear)throw Error('Academic Year is required for DOE recalculation.');
  if(DESTRUCTIVE.has(normalized.operation)){
    const expected=expectedConfirmation(normalized);
    if(normalized.confirmation!==expected)throw Error(`Destructive DOE operation requires exact confirmation "${expected}".`);
  }
  return normalized;
}

function actorFromEnv(env=process.env){
  const runId=text(env.GITHUB_RUN_ID)||'local';
  const login=text(env.GITHUB_ACTOR)||'github-actions';
  return{uid:`github-actions:${runId}`,name:`GitHub Actions DOE Admin (${login})`,email:'',role:'owner'};
}

function academicYearForSession(session={}){
  const explicit=text(session.academicYear);if(explicit)return explicit;
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text(session.date));
  if(!match)throw Object.assign(Error('A valid session date is required to resolve Academic Year.'),{code:'ACADEMIC_YEAR_REQUIRED'});
  const year=Number(match[1]),month=Number(match[2]),semester=text(session.semester).toLowerCase();
  const start=semester==='winter'?year-1:(semester==='spring'||semester==='fall'?year:(month<=4?year-1:year));
  return`${start}-${String(start+1).slice(-2)}`;
}

function currentSessionScope(session={},sessionId=''){
  const id=text(sessionId||session.sessionId||session.id);
  const sourceEntityIds=[],facultyIds=[];
  for(const [index,row] of (Array.isArray(session.assignments)?session.assignments:[]).entries()){
    const facultyId=text(row?.facultyId||row?.ucid);if(!facultyId)continue;
    sourceEntityIds.push(text(row?.assignmentId)||`${id}--assignment--${index+1}`);facultyIds.push(facultyId);
  }
  return{sourceEntityIds,facultyIds:[...new Set(facultyIds)]};
}
function durationHours(start,end,timeUnknown=false){
  if(timeUnknown===true)return null;
  const parse=value=>{const match=/^(\d{1,2}):(\d{2})$/.exec(text(value));if(!match)return null;const h=Number(match[1]),m=Number(match[2]);return h>=0&&h<=23&&m>=0&&m<=59?h*60+m:null};
  const from=parse(start),to=parse(end);return from===null||to===null||to<=from?null:(to-from)/60;
}

function adjustSessionCreditedHours(session={},request={}){
  const before=durationHours(request.previousStart,request.previousEnd,request.previousTimeUnknown===true);
  const after=durationHours(session.start,session.end,session.timeUnknown===true);
  if(before===null||Object.is(before,after)||Math.abs(Number(before)-Number(after))<1e-9)return{changed:false,count:0,session};
  let count=0;
  const assignments=(Array.isArray(session.assignments)?session.assignments:[]).map(row=>{
    const current=row?.creditedHours===null||row?.creditedHours===undefined||row?.creditedHours===''?null:Number(row.creditedHours);
    if(current===null||!Number.isFinite(current)||Math.abs(current-before)>1e-9)return{...row};
    count++;return{...row,creditedHours:after};
  });
  return{changed:count>0,count,session:{...session,assignments}};
}


async function processRecalculationQueue({firestore,policyAdminService,actor,limit=50,clock=()=>new Date().toISOString()}={}){
  if(!firestore?.collection)throw Error('Firestore is required to process the DOE recalculation queue.');
  if(!policyAdminService?.getPolicyYear||!policyAdminService?.runRecalculate)throw Error('DOE policy admin service is required to process the recalculation queue.');
  let query=firestore.collection('doe_recalculation_requests').where('status','==','pending');
  if(typeof query.limit==='function')query=query.limit(Math.max(1,Math.min(Number(limit)||50,200)));
  const snapshot=await query.get(),docs=Array.isArray(snapshot?.docs)?snapshot.docs:[];
  const summary={operation:'recalculate-queue',processed:0,completed:0,failed:0,noOp:0,requests:[]};
  for(const doc of docs){
    const row={requestId:text(doc.id),...(doc.data?.()||{})},ref=doc.ref||firestore.collection('doe_recalculation_requests').doc(doc.id),attemptCount=Number(row.attemptCount||0)+1,attemptedAt=clock();
    summary.processed++;
    try{
      const sessionId=text(row.sessionId);if(!sessionId)throw Object.assign(Error('Queued DOE request is missing sessionId.'),{code:'SESSION_ID_REQUIRED'});
      const sessionRef=firestore.collection('sessions').doc(sessionId),sessionSnap=await sessionRef.get();
      if(!sessionSnap?.exists)throw Object.assign(Error(`Queued DOE session "${sessionId}" was not found.`),{code:'SESSION_NOT_FOUND'});
      let session={id:sessionSnap.id,...sessionSnap.data()};
      const adjustment=adjustSessionCreditedHours(session,row);
      if(adjustment.changed){await sessionRef.set({assignments:adjustment.session.assignments},{merge:true});session=adjustment.session}
      const academicYear=academicYearForSession(session),scope=currentSessionScope(session,sessionId);
      if(!scope.sourceEntityIds.length){
        await ref.set({status:'completed',attemptCount,lastAttemptAt:attemptedAt,completedAt:attemptedAt,completedBy:text(actor?.uid),completedByName:text(actor?.name),academicYear,actualSourceEntityIds:[],actualFacultyIds:[],completedRows:0,completionNote:'No current faculty assignments require DOE recalculation.',creditedHoursAdjusted:adjustment.count},{merge:true});
        summary.completed++;summary.noOp++;summary.requests.push({requestId:row.requestId,status:'completed',sessionId,academicYear,completedRows:0});continue;
      }
      const policyYear=await policyAdminService.getPolicyYear({actor,academicYear}),policyVersionId=text(policyYear?.policy?.currentActiveVersionId);
      if(!policyVersionId)throw Object.assign(Error(`No Active DOE policy exists for Academic Year ${academicYear}.`),{code:'ACTIVE_POLICY_REQUIRED'});
      const result=await policyAdminService.runRecalculate({actor,academicYear,policyVersionId,scope:{sourceEntityTypes:['session_assignment'],sourceEntityIds:scope.sourceEntityIds}});
      await ref.set({status:'completed',attemptCount,lastAttemptAt:attemptedAt,completedAt:clock(),completedBy:text(actor?.uid),completedByName:text(actor?.name),academicYear,policyVersionId,batchId:text(result?.batchId),actualSourceEntityIds:scope.sourceEntityIds,actualFacultyIds:scope.facultyIds,completedRows:Number(result?.completedRows||0),creditedHoursAdjusted:adjustment.count,lastErrorCode:'',lastErrorMessage:''},{merge:true});
      summary.completed++;summary.requests.push({requestId:row.requestId,status:'completed',sessionId,academicYear,policyVersionId,batchId:text(result?.batchId),completedRows:Number(result?.completedRows||0),creditedHoursAdjusted:adjustment.count});
    }catch(error){
      await ref.set({status:'pending',attemptCount,lastAttemptAt:attemptedAt,lastErrorCode:text(error?.code)||'DOE_QUEUE_PROCESSING_FAILED',lastErrorMessage:text(error?.message).slice(0,500)},{merge:true});
      summary.failed++;summary.requests.push({requestId:row.requestId,status:'pending',errorCode:text(error?.code)||'DOE_QUEUE_PROCESSING_FAILED'});
    }
  }
  return summary;
}

function summarize(operation,result={}){
  if(operation==='validate-policy')return{operation,policyVersionId:text(result.policyVersionId),valid:result.valid===true,errorCount:Number(result.errors?.length||0),warningCount:Number(result.warnings?.length||0),policyRevision:Number(result.policyRevision||0)};
  if(operation==='impact-preview')return{operation,impactRunId:text(result.impactRunId),policyVersionId:text(result.policyVersionId),status:text(result.status),facultyCount:Number(result.facultyCount||0),calculationCount:Number(result.calculationCount||0),changedFacultyCount:Number(result.changedFacultyCount||0),errorCount:Number(result.errorCount||0),warningCount:Number(result.warningCount||0)};
  if(operation==='publish-policy')return{operation,policyVersionId:text(result.policyVersionId||result.version?.policyVersionId),status:text(result.status||result.version?.status),publicationId:text(result.publicationId||result.publication?.publicationId)};
  if(operation==='recalculate-preview')return{operation,academicYear:text(result.academicYear),policyVersionId:text(result.policyVersionId),scope:result.scope??'all',facultyAffected:Number(result.facultyAffected||0),assignmentsAffected:Number(result.assignmentsAffected||0),changedDoeCount:Number(result.changedDoeCount||0),errorCount:Number(result.errors?.length||0),warningCount:Number(result.warnings?.length||0)};
  if(operation==='recalculate')return{operation,academicYear:text(result.academicYear),policyVersionId:text(result.policyVersionId),scope:result.scope??'all',batchId:text(result.batchId),totalRows:Number(result.totalRows||0),completedRows:Number(result.completedRows||0),changedDoeCount:Number(result.changedDoeCount||0)};
  if(operation==='recalculate-queue')return result;
  return{operation};
}

async function execute(options,{env=process.env}={}){
  const normalized=validateOptions(options,{projectId:env.FIREBASE_PROJECT_ID});
  if(!text(env.FIREBASE_SERVICE_ACCOUNT_JSON))throw Error('FIREBASE_SERVICE_ACCOUNT_JSON is required for the DOE admin job.');
  const {createProductionDependencies,createProductionServices}=require('../server/src/server.js');
  const deps=createProductionDependencies({env}),services=createProductionServices({firestore:deps.firestore}),actor=actorFromEnv(env);
  let result;
  try{
    if(normalized.operation==='validate-policy')result=await services.policyAdminService.validateDraft({actor,policyVersionId:normalized.policyVersionId});
    else if(normalized.operation==='impact-preview')result=await services.policyAdminService.runImpactPreview({actor,policyVersionId:normalized.policyVersionId});
    else if(normalized.operation==='publish-policy')result=await services.policyAdminService.publish({actor,policyVersionId:normalized.policyVersionId});
    else if(normalized.operation==='recalculate-preview')result=await services.policyAdminService.previewRecalculate({actor,policyVersionId:normalized.policyVersionId,academicYear:normalized.academicYear,scope:normalized.scope});
    else if(normalized.operation==='recalculate')result=await services.policyAdminService.runRecalculate({actor,policyVersionId:normalized.policyVersionId,academicYear:normalized.academicYear,scope:normalized.scope,onProgress:progress=>process.stdout.write(`DOE recalculation ${progress.status}: ${progress.completedRows}/${progress.totalRows}\n`)});
    else if(normalized.operation==='recalculate-queue'){
      result=await processRecalculationQueue({firestore:deps.firestore,policyAdminService:services.policyAdminService,actor});
      if(result.failed){const error=Error(`DOE recalculation queue completed with ${result.failed} failed request(s); failed requests remain pending for retry.`);error.code='DOE_QUEUE_PARTIAL_FAILURE';error.details=result;throw error}
    }
    return summarize(normalized.operation,result);
  }finally{
    if(typeof deps.firestore?.terminate==='function')await deps.firestore.terminate().catch(()=>{});
  }
}

async function main(){const options=parseArgs(),summary=await execute(options);process.stdout.write(JSON.stringify(summary,null,2)+'\n')}

if(require.main===module){
  main().catch(error=>{console.error(`DOE admin job failed: ${error.message}`);if(error?.code)console.error(`Code: ${error.code}`);if(error?.details)console.error(JSON.stringify(error.details,null,2));process.exit(1)});
}

module.exports={LAB_PROJECT_ID,OPERATIONS,DESTRUCTIVE,parseArgs,expectedConfirmation,validateOptions,actorFromEnv,academicYearForSession,currentSessionScope,durationHours,adjustSessionCreditedHours,processRecalculationQueue,summarize,execute,main};
