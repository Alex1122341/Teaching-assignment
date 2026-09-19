'use strict';
const {ApiError}=require('../http/errors.js');

const adminRoles=new Set(['owner','administrator','admin','adfa_general','adfa_regular']);
const text=value=>String(value??'').trim().toLowerCase();

function requireAdmin(actor){
  if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot administer DOE policy.',403);
}

function oneRuleBundle(rule){
  const normalized={...(rule||{})};
  return{
    version:{academicYear:String(normalized.academicYear||''),policyVersionId:String(normalized.policyVersionId||'draft-rule-test')},
    rules:[normalized],exceptions:[]
  };
}


const clean=value=>String(value??'').trim();
const number=value=>{if(value===null||value===undefined||value==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null};
function assignmentDoe(assignment={}){return number(assignment.doeCredit)}
function buildImpactDataset(data={},academicYear=''){
  const calculations=[],scheduledByFaculty=new Map(),sessions=Array.isArray(data?.sessions)?data.sessions:[];
  for(const session of sessions){
    const assignments=Array.isArray(session?.assignments)?session.assignments:[];
    assignments.forEach((assignment,index)=>{
      const facultyId=clean(assignment?.ucid||assignment?.facultyId);if(!facultyId)return;
      const hours=number(assignment?.creditedHours),role=clean(assignment?.role||assignment?.teachingRole),currentDoe=assignmentDoe(assignment);
      if(currentDoe!==null)scheduledByFaculty.set(facultyId,(scheduledByFaculty.get(facultyId)||0)+currentDoe);
      calculations.push({
        sourceEntityType:'session_assignment',sourceEntityId:`${clean(session?.id||session?.sessionId)||'session'}--assignment--${index+1}`,
        sessionId:clean(session?.id||session?.sessionId),assignmentId:clean(assignment?.assignmentId)||`${clean(session?.id||session?.sessionId)||'session'}--assignment--${index+1}`,
        facultyId,currentDoe,currentPolicyVersionId:clean(assignment?.doePolicyVersionId),
        context:{category:'teaching',activityType:clean(session?.type||session?.activityType),teachingRole:role,role,hours,shifts:1,course:clean(session?.course||session?.courseCode),date:clean(session?.date),topic:clean(session?.topic),semester:clean(session?.semester),week:number(session?.week)}
      });
    });
  }
  const faculty=Array.isArray(data?.faculty)?data.faculty:[];
  for(const person of faculty){
    const facultyId=clean(person?.__id||person?.ucid||person?.id||person?.facultyId);if(!facultyId)continue;
    const summary=person?.facultySummary2026_27&&typeof person.facultySummary2026_27==='object'?person.facultySummary2026_27:{};
    const fixed=number(summary.sourceNonTimetableTeachingDOE),sourceAssigned=number(summary.assignedTeachingDOE);
    const reconciliation=fixed!==null?fixed:(sourceAssigned!==null?sourceAssigned-(scheduledByFaculty.get(facultyId)||0):null);
    if(reconciliation!==null){const assignmentId=`${facultyId}--source-non-timetable-teaching`;calculations.push({sourceEntityType:'source_reconciliation',sourceEntityId:assignmentId,assignmentId,facultyId,currentDoe:reconciliation,currentPolicyVersionId:clean(summary.sourceNonTimetableTeachingDOEPolicyVersionId),context:{category:'teaching',activityType:'SOURCE_RECONCILIATION',teachingRole:'Source Reconciliation',assignment:'Source non-timetable teaching DOE'}})}
    const roles=Array.isArray(person?.managedRoles2026_27)?person.managedRoles2026_27:[];
    roles.forEach((managed,index)=>{const credit=Math.abs(number(managed?.doeCredit)??0);if(!credit&&!clean(managed?.assignment)&&!clean(managed?.type))return;const signed=clean(managed?.action).toLowerCase()==='remove'?-credit:credit;const assignmentId=`${facultyId}--managed-role--${index+1}`;calculations.push({sourceEntityType:'managed_role',sourceEntityId:assignmentId,assignmentId,facultyId,currentDoe:signed,currentPolicyVersionId:clean(managed?.doePolicyVersionId),context:{category:'role',roleType:clean(managed?.type),assignment:clean(managed?.assignment),action:clean(managed?.action)||'add'}})});
  }
  return{academicYear:clean(academicYear),calculations};
}
function sourceOrdinal(sourceEntityId,label){const match=clean(sourceEntityId).match(new RegExp(`--${label}--(\\d+)$`));return match?Number(match[1])-1:-1}
function applyRecalculationRowsToSource(source={},rows=[],calculationRecords=[]){
  const next={...source};if(Array.isArray(source.assignments))next.assignments=source.assignments.map(row=>({...row}));if(Array.isArray(source.managedRoles2026_27))next.managedRoles2026_27=source.managedRoles2026_27.map(row=>({...row}));if(source.facultySummary2026_27&&typeof source.facultySummary2026_27==='object')next.facultySummary2026_27={...source.facultySummary2026_27};
  rows.forEach((row,index)=>{const record=calculationRecords[index]||{},provenance={doeCredit:Number(row.resultDoe),doePolicyVersionId:clean(row.policyVersionId),doeRuleId:clean(row.ruleId),doeRuleKey:clean(row.ruleKey),doeCalculationId:clean(record.calculationId)};
    if(row.sourceEntityType==='session_assignment'){const assignments=next.assignments||[];let at=clean(row.assignmentId)?assignments.findIndex(item=>clean(item?.assignmentId)===clean(row.assignmentId)):-1;if(at<0)at=sourceOrdinal(row.sourceEntityId,'assignment');if(at<0||at>=assignments.length)throw Object.assign(Error('DOE recalculation could not locate the source session assignment.'),{code:'RECALCULATION_SOURCE_NOT_FOUND'});assignments[at]={...assignments[at],...provenance};return}
    if(row.sourceEntityType==='managed_role'){const roles=next.managedRoles2026_27||[],at=sourceOrdinal(row.sourceEntityId,'managed-role');if(at<0||at>=roles.length)throw Object.assign(Error('DOE recalculation could not locate the source managed role.'),{code:'RECALCULATION_SOURCE_NOT_FOUND'});roles[at]={...roles[at],...provenance};return}
    if(row.sourceEntityType==='source_reconciliation'){const summary={...(next.facultySummary2026_27||{})};summary.sourceNonTimetableTeachingDOE=Number(row.resultDoe);summary.sourceNonTimetableTeachingDOEPolicyVersionId=clean(row.policyVersionId);summary.sourceNonTimetableTeachingDOERuleId=clean(row.ruleId);summary.sourceNonTimetableTeachingDOERuleKey=clean(row.ruleKey);summary.sourceNonTimetableTeachingDOECalculationId=clean(record.calculationId);next.facultySummary2026_27=summary;return}
    throw Object.assign(Error(`Unsupported DOE recalculation source type: ${clean(row.sourceEntityType)||'unknown'}`),{code:'RECALCULATION_SOURCE_UNSUPPORTED'});
  });return next;
}
function createFirestoreRecalculationWriter({db,repository,clock=()=>new Date().toISOString()}={}){
  if(!db||!repository?.stageCalculationRecord)throw new Error('Firestore DOE recalculation writer requires db and repository staging support.');
  return async payload=>{const current=payload.actor||{},batchId=clean(payload.batchId);if(!batchId)throw new Error('DOE recalculation batchId is required.');const groups=new Map();
    (payload.rows||[]).forEach((row,index)=>{const isSession=row.sourceEntityType==='session_assignment',collection=isSession?'sessions':'faculty',id=isSession?clean(row.sessionId):clean(row.facultyId);if(!id)throw Object.assign(Error('DOE recalculation source document ID is required.'),{code:'RECALCULATION_SOURCE_NOT_FOUND'});const key=`${collection}/${id}`;if(!groups.has(key))groups.set(key,{collection,id,rows:[],records:[]});groups.get(key).rows.push(row);groups.get(key).records.push((payload.calculationRecords||[])[index])});
    const loaded=[];for(const group of groups.values()){const ref=db.collection(group.collection).doc(group.id),snapshot=await ref.get();if(!snapshot?.exists)throw Object.assign(Error(`DOE recalculation source ${group.collection}/${group.id} was not found.`),{code:'RECALCULATION_SOURCE_NOT_FOUND'});loaded.push({...group,ref,source:snapshot.data()})}
    const stamp=clock(),batch=db.batch();for(const group of loaded){const next=applyRecalculationRowsToSource(group.source,group.rows,group.records);Object.assign(next,{doeRecalculationBatchId:batchId,doeRecalculationPolicyVersionId:clean(payload.policyVersionId),doeRecalculatedBy:clean(current.uid),doeRecalculatedAt:stamp,updatedBy:clean(current.uid),updatedByName:clean(current.name),updatedAt:stamp});batch.set(group.ref,next)}
    for(const record of payload.calculationRecords||[])repository.stageCalculationRecord(batch,record);batch.set(db.collection('doe_recalculation_batches').doc(batchId),{recalculationBatchId:batchId,academicYear:clean(payload.academicYear),policyVersionId:clean(payload.policyVersionId),status:'running',completedRows:Number(payload.end||0),totalRows:Number(payload.totalRows||0),changedBy:clean(current.uid),changedByName:clean(current.name),updatedAt:stamp},{merge:true});await batch.commit();
  };
}
async function loadImpactDataset(db,academicYear){
  const load=async name=>{const snap=await db.collection(name).get();return(snap.docs||[]).map(doc=>({__id:doc.id,id:doc.id,...doc.data()}))};
  const [faculty,sessions]=await Promise.all([load('faculty'),load('sessions')]);return buildImpactDataset({faculty,sessions},academicYear);
}

function createPolicyAdminService({serviceFor,repositoryFor,engine,annualRulebookService}={}){
  if(typeof serviceFor!=='function')throw new Error('serviceFor(actor) is required.');
  if(!engine?.validatePolicy||!engine?.calculate)throw new Error('DOE policy engine is required.');
  const service=actor=>{requireAdmin(actor);const value=serviceFor(actor);if(!value)throw new Error('DOE policy service is unavailable.');return value};
  const repository=actor=>{requireAdmin(actor);if(typeof repositoryFor!=='function')throw new Error('repositoryFor(actor) is required.');const value=repositoryFor(actor);if(!value)throw new Error('DOE policy repository is unavailable.');return value};

  async function listPolicies({actor}={}){return repository(actor).listPolicies()}
  async function listVersions({actor,policyId}={}){return repository(actor).listVersions(policyId)}
  async function getPolicyYear({actor,academicYear}={}){
    const repo=repository(actor),year=clean(academicYear),policies=await repo.listPolicies(),matches=(policies||[]).filter(row=>clean(row.academicYear)===year);
    if(!matches.length)throw new ApiError('POLICY_NOT_FOUND','DOE policy was not found for Academic Year.',404,{academicYear:year});
    if(matches.length>1)throw new ApiError('POLICY_AMBIGUOUS','Multiple DOE policies exist for Academic Year.',409,{academicYear:year});
    const policy=matches[0],versions=await repo.listVersions(policy.policyId);
    return{policy,versions};
  }
  async function loadPolicyBundle({actor,policyVersionId}={}){return service(actor).loadPolicyBundle(policyVersionId)}
  async function getImpactPreview({actor,impactRunId}={}){
    const repo=repository(actor),run=await repo.getImpactRun(impactRunId);
    if(!run)throw new ApiError('IMPACT_RUN_NOT_FOUND','DOE Impact Preview was not found.',404,{impactRunId});
    return{...run,rows:await repo.listImpactRows(impactRunId)};
  }
  async function createPolicyYear({actor,academicYear}={}){return service(actor).createPolicyYear({academicYear})}
  async function cloneDraft({actor,policyVersionId}={}){return service(actor).cloneAsDraft(policyVersionId)}
  async function validateDraft({actor,policyVersionId}={}){
    requireAdmin(actor);
    if(annualRulebookService?.validateAnnualReview){const annual=await annualRulebookService.validateAnnualReview(policyVersionId,undefined,{actor});if(annual?.valid===false)return annual}
    return service(actor).validateDraft(policyVersionId);
  }
  async function runImpactPreview({actor,policyVersionId}={}){return service(actor).runImpactPreview(policyVersionId)}
  async function publish({actor,policyVersionId}={}){return service(actor).publish(policyVersionId)}
  async function archive({actor,policyVersionId}={}){return service(actor).archive(policyVersionId)}
  async function previewRecalculate({actor,...options}={}){return service(actor).previewRecalculate(options)}
  async function runRecalculate({actor,...options}={}){return service(actor).runRecalculate(options)}

  async function testRule({actor,rule,sample={}}={}){
    requireAdmin(actor);
    const bundle=oneRuleBundle(rule),validation=engine.validatePolicy(bundle);
    if(!validation.valid)throw new ApiError('RULE_INVALID','DOE rule is invalid.',400,{errors:validation.errors,warnings:validation.warnings});
    return engine.calculate(bundle,{...(sample||{}),category:String(rule?.category||'')});
  }

  async function saveRule({actor,policyVersionId,rule}={}){
    const repo=repository(actor),version=await repo.getVersion(policyVersionId);
    if(!version)throw new ApiError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',404,{policyVersionId});
    const normalized={...(rule||{}),policyVersionId:String(policyVersionId||'')};
    const validation=engine.validatePolicy({version,rules:[normalized],exceptions:[]});
    if(!validation.valid)throw new ApiError('RULE_INVALID','DOE rule is invalid.',400,{errors:validation.errors,warnings:validation.warnings});
    let revision=Number(version.revision||0),saved;
    const base={...normalized};delete base.selectors;delete base.inputs;delete base.parameters;delete base.tiers;
    saved=await repo.saveDraftRule(base,revision,actor);revision=Number(saved.version.revision||0);
    for(const row of normalized.selectors||[]){saved=await repo.saveSelector({...row,ruleId:normalized.ruleId,policyVersionId},revision,actor);revision=Number(saved.version.revision||0)}
    for(const row of normalized.inputs||[]){saved=await repo.saveRuleInput({...row,ruleId:normalized.ruleId,policyVersionId},revision,actor);revision=Number(saved.version.revision||0)}
    for(const row of normalized.parameters||[]){saved=await repo.saveParameter({...row,ruleId:normalized.ruleId,policyVersionId},revision,actor);revision=Number(saved.version.revision||0)}
    for(const row of normalized.tiers||[]){saved=await repo.saveTier({...row,ruleId:normalized.ruleId,policyVersionId},revision,actor);revision=Number(saved.version.revision||0)}
    return service(actor).loadPolicyBundle(policyVersionId);
  }

  async function saveException({actor,policyVersionId,exception}={}){
    const repo=repository(actor),version=await repo.getVersion(policyVersionId);
    if(!version)throw new ApiError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',404,{policyVersionId});
    await repo.saveException({...exception,policyVersionId},Number(version.revision||0),actor);
    return service(actor).loadPolicyBundle(policyVersionId);
  }

  return Object.freeze({
    listPolicies,listVersions,getPolicyYear,loadPolicyBundle,getImpactPreview,saveRule,saveException,
    createPolicyYear,cloneDraft,validateDraft,runImpactPreview,publish,archive,previewRecalculate,runRecalculate,testRule
  });
}

module.exports={createPolicyAdminService,buildImpactDataset,applyRecalculationRowsToSource,createFirestoreRecalculationWriter,loadImpactDataset};
