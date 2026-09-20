'use strict';

const LAB_PROJECT_ID='vista-teaching-lab';
const OPERATIONS=new Set(['validate-policy','impact-preview','publish-policy','recalculate-preview','recalculate']);
const DESTRUCTIVE=new Set(['publish-policy','recalculate']);
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
  return'';
}

function validateOptions(options,{projectId=process.env.FIREBASE_PROJECT_ID}={}){
  const normalized={...options,operation:text(options?.operation),policyVersionId:text(options?.policyVersionId),academicYear:text(options?.academicYear),scope:text(options?.scope)||'all',confirmation:text(options?.confirmation)};
  if(text(projectId)!==LAB_PROJECT_ID)throw Error(`DOE admin job is locked to Firebase project "${LAB_PROJECT_ID}".`);
  if(!OPERATIONS.has(normalized.operation))throw Error('Unknown DOE admin operation.');
  if(!normalized.policyVersionId)throw Error('Policy Version ID is required.');
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
  return{
    uid:`github-actions:${runId}`,
    name:`GitHub Actions DOE Admin (${login})`,
    email:'',
    role:'owner'
  };
}

function summarize(operation,result={}){
  if(operation==='validate-policy')return{operation,policyVersionId:text(result.policyVersionId),valid:result.valid===true,errorCount:Number(result.errors?.length||0),warningCount:Number(result.warnings?.length||0),policyRevision:Number(result.policyRevision||0)};
  if(operation==='impact-preview')return{operation,impactRunId:text(result.impactRunId),policyVersionId:text(result.policyVersionId),status:text(result.status),facultyCount:Number(result.facultyCount||0),calculationCount:Number(result.calculationCount||0),changedFacultyCount:Number(result.changedFacultyCount||0),errorCount:Number(result.errorCount||0),warningCount:Number(result.warningCount||0)};
  if(operation==='publish-policy')return{operation,policyVersionId:text(result.policyVersionId||result.version?.policyVersionId),status:text(result.status||result.version?.status),publicationId:text(result.publicationId||result.publication?.publicationId)};
  if(operation==='recalculate-preview')return{operation,academicYear:text(result.academicYear),policyVersionId:text(result.policyVersionId),scope:result.scope??'all',facultyAffected:Number(result.facultyAffected||0),assignmentsAffected:Number(result.assignmentsAffected||0),changedDoeCount:Number(result.changedDoeCount||0),errorCount:Number(result.errors?.length||0),warningCount:Number(result.warnings?.length||0)};
  if(operation==='recalculate')return{operation,academicYear:text(result.academicYear),policyVersionId:text(result.policyVersionId),scope:result.scope??'all',batchId:text(result.batchId),totalRows:Number(result.totalRows||0),completedRows:Number(result.completedRows||0),changedDoeCount:Number(result.changedDoeCount||0)};
  return{operation};
}

async function execute(options,{env=process.env}={}){
  const normalized=validateOptions(options,{projectId:env.FIREBASE_PROJECT_ID});
  if(!text(env.FIREBASE_SERVICE_ACCOUNT_JSON))throw Error('FIREBASE_SERVICE_ACCOUNT_JSON is required for the DOE admin job.');
  const {createProductionDependencies,createProductionServices}=require('../server/src/server.js');
  const deps=createProductionDependencies({env});
  const services=createProductionServices({firestore:deps.firestore});
  const actor=actorFromEnv(env);
  let result;
  try{
    if(normalized.operation==='validate-policy')result=await services.policyAdminService.validateDraft({actor,policyVersionId:normalized.policyVersionId});
    else if(normalized.operation==='impact-preview')result=await services.policyAdminService.runImpactPreview({actor,policyVersionId:normalized.policyVersionId});
    else if(normalized.operation==='publish-policy')result=await services.policyAdminService.publish({actor,policyVersionId:normalized.policyVersionId});
    else if(normalized.operation==='recalculate-preview')result=await services.policyAdminService.previewRecalculate({actor,policyVersionId:normalized.policyVersionId,academicYear:normalized.academicYear,scope:normalized.scope});
    else if(normalized.operation==='recalculate')result=await services.policyAdminService.runRecalculate({
      actor,policyVersionId:normalized.policyVersionId,academicYear:normalized.academicYear,scope:normalized.scope,
      onProgress:progress=>process.stdout.write(`DOE recalculation ${progress.status}: ${progress.completedRows}/${progress.totalRows}\n`)
    });
    return summarize(normalized.operation,result);
  }finally{
    if(typeof deps.firestore?.terminate==='function')await deps.firestore.terminate().catch(()=>{});
  }
}

async function main(){
  const options=parseArgs();
  const summary=await execute(options);
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
}

if(require.main===module){
  main().catch(error=>{
    console.error(`DOE admin job failed: ${error.message}`);
    if(error?.code)console.error(`Code: ${error.code}`);
    process.exit(1);
  });
}

module.exports={LAB_PROJECT_ID,OPERATIONS,DESTRUCTIVE,parseArgs,expectedConfirmation,validateOptions,actorFromEnv,summarize,execute,main};
