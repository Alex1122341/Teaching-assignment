'use strict';
const crypto=require('node:crypto');
const {ApiError}=require('../http/errors.js');
const scheduling=require('../../../scheduling-core.js');

const text=value=>String(value??'').trim();
const finite=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null};
const round=value=>Number(Number(value).toFixed(6));
const DOE_FIELDS=['doeCredit','doePolicyVersionId','doeRuleId','doeRuleKey','doeCalculationId','doeRate','resultDoe','policyVersionId','ruleId','ruleKey','calculationId'];
const clone=value=>structuredClone(value??null);
function academicYearForSession(session={}){
  const explicit=text(session.academicYear);if(explicit)return explicit;
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text(session.date));
  if(!match)throw new ApiError('ACADEMIC_YEAR_REQUIRED','A valid session date is required to resolve Academic Year.',422);
  const year=Number(match[1]),month=Number(match[2]),semester=text(session.semester).toLowerCase();
  const start=semester==='winter'?year-1:(semester==='spring'||semester==='fall'?year:(month<=4?year-1:year));
  return`${start}-${String(start+1).slice(-2)}`;
}
function assignmentId(session,assignment,index){return text(assignment?.assignmentId)||`${text(session?.sessionId||session?.id)||'session'}--assignment--${index+1}`}
function stripClientDoe(assignment={}){const next={...assignment};for(const key of DOE_FIELDS)delete next[key];return next}
function assignmentHours(session,assignment){
  const explicit=finite(assignment?.creditedHours);if(explicit!==null)return explicit;
  return scheduling.durationHours(session?.start,session?.end,{timeUnknown:session?.timeUnknown===true});
}
function assignmentFacts(session,assignment,index){
  const id=assignmentId(session,assignment,index),faculty=text(assignment?.facultyId||assignment?.ucid),role=text(assignment?.teachingRole||assignment?.role||session?.type);
  return{
    academicYear:academicYearForSession(session),category:'teaching',activityType:text(assignment?.activityType||session?.type),teachingRole:role,role,
    hours:assignmentHours(session,assignment),creditedHours:assignmentHours(session,assignment),shifts:finite(assignment?.shifts)??1,weeks:finite(assignment?.weeks),
    course:text(assignment?.course||assignment?.courseCode||session?.course||session?.courseCode),courseCode:text(assignment?.courseCode||session?.courseCode||session?.course),
    date:text(session?.date),topic:text(assignment?.topic||session?.topic),semester:text(session?.semester),week:finite(session?.week),year:finite(session?.year),
    facultyId:faculty,sessionId:text(session?.sessionId||session?.id),assignmentId:id,assignment:text(assignment?.assignment||assignment?.assignmentLabel)
  };
}
function relevantFields(bundle={}){
  const fields=new Set(['academicYear']);
  for(const rule of Array.isArray(bundle.rules)?bundle.rules:[]){
    if(rule?.enabled===false||text(rule.category)!=='teaching')continue;
    for(const selector of Array.isArray(rule.selectors)?rule.selectors:[])if(text(selector?.field))fields.add(text(selector.field));
    for(const input of Array.isArray(rule.inputs)?rule.inputs:[]){
      const name=typeof input==='string'?text(input):text(input?.inputName);if(name)fields.add(name);
      const source=typeof input==='string'?'':text(input?.source);
      if(source.startsWith('course_mapping.')){fields.add('course');fields.add('courseCode')}
      if(source.startsWith('subject_mapping.'))fields.add('subjectKey');
    }
  }
  for(const exception of Array.isArray(bundle.exceptions)?bundle.exceptions:[]){
    if(exception?.enabled===false)continue;
    if(text(exception?.facultyId))fields.add('facultyId');
    if(text(exception?.effectiveStart)||text(exception?.effectiveEnd))fields.add('date');
    const scope=text(exception?.scopeType).toLowerCase();
    if(scope==='assignment'){fields.add('assignmentId');fields.add('assignment')}
    else if(scope==='faculty')fields.add('facultyId');
    else if(scope==='session')fields.add('sessionId');
    else if(scope==='course'){fields.add('course');fields.add('courseCode')}
    else if(scope==='role'){fields.add('roleType');fields.add('teachingRole');fields.add('role')}
  }
  return fields;
}
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
function factsChanged(fields,before,after){for(const field of fields)if(!same(before?.[field],after?.[field]))return true;return false}
function assignmentById(rows,id,index){return(Array.isArray(rows)?rows:[]).find(row=>text(row?.assignmentId)&&text(row.assignmentId)===id)||(Array.isArray(rows)?rows:[])[index]||null}
function impactRow(worksheet,delta){
  const current=finite(worksheet?.totals?.assignedTeachingDoe),target=finite(worksheet?.totals?.effectiveTargetDoe),projected=current===null?null:round(current+delta);
  return{facultyId:text(worksheet?.facultyId),currentAssignedDoe:current,projectedAssignedDoe:projected,effectiveTargetDoe:target,remainingDoe:projected===null||target===null?null:round(target-projected),deltaDoe:round(delta),status:text(worksheet?.status)};
}

function createWorkflowPreviewService({repository,calculationService,worksheetService,auditIdFactory=()=>`session-doe-${crypto.randomUUID()}`,clock=()=>new Date()}={}){
  if(!repository?.getSession)throw new Error('workflow preview repository.getSession is required.');
  if(!repository?.getActivePolicyBundle)throw new Error('workflow preview repository.getActivePolicyBundle is required.');
  if(!calculationService?.prepareAssignmentCalculation&&!calculationService?.calculateAssignment)throw new Error('workflow preview calculation service is required.');
  if(!worksheetService?.buildFacultyWorksheet)throw new Error('workflow preview worksheet service is required.');

  async function preparedCalculation({actor,academicYear,facts,trigger}){
    if(calculationService.prepareAssignmentCalculation)return calculationService.prepareAssignmentCalculation({actor,academicYear,facts,trigger});
    const result=await calculationService.calculateAssignment({actor,academicYear,facts,persist:false});
    return{calculation:result,calculationRecord:null};
  }

  async function previewSessionChange({actor={},academicYear='',sessionId='',beforeSession=null,afterSession=null,patch=null,trigger='session_updated'}={}){
    const id=text(sessionId||afterSession?.id||afterSession?.sessionId||beforeSession?.id||beforeSession?.sessionId);
    if(!id)throw new ApiError('SESSION_ID_REQUIRED','Session ID is required.',422);
    const canonical=await repository.getSession(id);
    if(!canonical&&!(afterSession&&typeof afterSession==='object'))throw new ApiError('SESSION_NOT_FOUND','The timetable session was not found.',404,{sessionId:id});
    const before=canonical?clone(canonical):null;
    const requested=afterSession&&typeof afterSession==='object'?afterSession:{...(before||{}),...(patch&&typeof patch==='object'?patch:{})};
    const candidate={...(before||{}),...clone(requested),id,sessionId:id};
    const year=text(academicYear)||academicYearForSession(candidate),bundle=await repository.getActivePolicyBundle(year),fields=relevantFields(bundle);
    const beforeAssignments=Array.isArray(before?.assignments)?before.assignments:[],requestedAssignments=Array.isArray(candidate.assignments)?candidate.assignments:[];
    const preparedAssignments=[],calculationRecords=[],doeChanges=[];
    for(const [index,raw] of requestedAssignments.entries()){
      const clean=stripClientDoe(raw||{}),idValue=assignmentId(candidate,clean,index),previous=assignmentById(beforeAssignments,idValue,index);
      clean.assignmentId=idValue;
      if(previous&&same(clean.creditedHours,previous.creditedHours)){
        const beforeDuration=scheduling.durationHours(before?.start,before?.end,{timeUnknown:before?.timeUnknown===true});
        const afterDuration=scheduling.durationHours(candidate.start,candidate.end,{timeUnknown:candidate.timeUnknown===true});
        if(!same(beforeDuration,afterDuration))clean.creditedHours=afterDuration;
      }
      const afterFacts=assignmentFacts(candidate,clean,index),beforeFacts=previous?assignmentFacts(before,previous,index):null;
      if(!text(afterFacts.facultyId)){preparedAssignments.push(clean);continue}
      if(previous&&!factsChanged(fields,beforeFacts,afterFacts)){
        const preserved={...clean};
        for(const key of ['doeCredit','doePolicyVersionId','doeRuleId','doeRuleKey','doeCalculationId'])if(Object.prototype.hasOwnProperty.call(previous,key))preserved[key]=previous[key];
        delete preserved.doeRate;preparedAssignments.push(preserved);continue;
      }
      const prepared=await preparedCalculation({actor,academicYear:year,facts:{...afterFacts,sourceEntityType:'session_assignment',sourceEntityId:id,trigger},trigger});
      const result=prepared.calculation||prepared,calcId=text(result.calculationId||prepared.calculationRecord?.calculationId);
      const next={...clean,creditedHours:afterFacts.hours,doeCredit:Number(result.resultDoe),doePolicyVersionId:text(result.policyVersionId),doeRuleId:text(result.ruleId),doeRuleKey:text(result.ruleKey),doeCalculationId:calcId,source:'DOE API'};
      delete next.doeRate;preparedAssignments.push(next);
      if(prepared.calculationRecord)calculationRecords.push(prepared.calculationRecord);
      doeChanges.push({assignmentId:idValue,facultyId:afterFacts.facultyId,oldDoeCredit:finite(previous?.doeCredit),newDoeCredit:Number(result.resultDoe),oldPolicyVersionId:text(previous?.doePolicyVersionId),newPolicyVersionId:text(result.policyVersionId),oldCalculationId:text(previous?.doeCalculationId),newCalculationId:calcId,ruleId:text(result.ruleId),ruleKey:text(result.ruleKey)});
    }
    const preparedSession={...candidate,academicYear:year,assignments:preparedAssignments,facultyIds:[...new Set(preparedAssignments.map(row=>text(row.facultyId||row.ucid)).filter(Boolean))],instructor:preparedAssignments.map(row=>text(row.name)).filter(Boolean).join('; ')};
    const deltas=new Map();
    for(const row of beforeAssignments){const fid=text(row?.facultyId||row?.ucid),credit=finite(row?.doeCredit);if(fid&&credit!==null)deltas.set(fid,(deltas.get(fid)||0)-credit)}
    for(const row of preparedAssignments){const fid=text(row?.facultyId||row?.ucid),credit=finite(row?.doeCredit);if(fid&&credit!==null)deltas.set(fid,(deltas.get(fid)||0)+credit)}
    const facultyImpacts=[];
    for(const [facultyId,delta] of [...deltas.entries()].sort(([a],[b])=>a.localeCompare(b))){
      const worksheet=await worksheetService.buildFacultyWorksheet({facultyId,academicYear:year});
      facultyImpacts.push(impactRow(worksheet,delta));
    }
    return{academicYear:year,session:preparedSession,calculationRecords,doeChanges,facultyImpacts};
  }

  async function previewFacultyTransfer({actor={},academicYear='',sessionId,assignmentId:requestedAssignmentId,incomingFacultyId}={}){
    const session=await repository.getSession(text(sessionId));
    if(!session)throw new ApiError('SESSION_NOT_FOUND','The timetable session was not found.',404,{sessionId:text(sessionId)});
    const rows=Array.isArray(session.assignments)?session.assignments:[],index=rows.findIndex((row,i)=>assignmentId(session,row,i)===text(requestedAssignmentId));
    if(index<0)throw new ApiError('ASSIGNMENT_NOT_FOUND','The timetable assignment was not found.',404,{sessionId:text(sessionId),assignmentId:text(requestedAssignmentId)});
    const outgoing=rows[index],incoming=text(incomingFacultyId);if(!incoming)throw new ApiError('FACULTY_ID_REQUIRED','Incoming faculty ID is required.',422);
    const after=clone(session),replacement={...stripClientDoe(outgoing),assignmentId:assignmentId(session,outgoing,index),facultyId:incoming,ucid:incoming};after.assignments[index]=replacement;
    const preview=await previewSessionChange({actor,academicYear,sessionId,beforeSession:session,afterSession:after,trigger:'faculty_transfer_preview'});
    const outgoingId=text(outgoing.facultyId||outgoing.ucid),outImpact=preview.facultyImpacts.find(row=>row.facultyId===outgoingId)||null,inImpact=preview.facultyImpacts.find(row=>row.facultyId===incoming)||null;
    const incomingAssignment=preview.session.assignments[index];
    return{...preview,assignmentId:replacement.assignmentId,outgoingFacultyId:outgoingId,incomingFacultyId:incoming,sessionDoeCredit:finite(outgoing.doeCredit),incomingDoeCredit:finite(incomingAssignment?.doeCredit),outgoing:outImpact,incoming:inImpact};
  }

  async function saveSessionChange({actor={},academicYear='',sessionId='',beforeSession=null,afterSession=null,patch=null,trigger='session_updated'}={}){
    if(!repository.saveSessionCalculationBundle)throw new ApiError('SESSION_WRITE_REPOSITORY_REQUIRED','Authoritative timetable DOE persistence is unavailable.',500);
    const preview=await previewSessionChange({actor,academicYear,sessionId,beforeSession,afterSession,patch,trigger});
    const savedAt=clock().toISOString(),session={...preview.session,updatedBy:text(actor.uid),updatedByName:text(actor.name),updatedByEmail:text(actor.email),updatedAt:savedAt};
    const auditRecord={
      auditId:text(auditIdFactory()),policyVersionId:text(preview.calculationRecords[0]?.policyVersionId||session.assignments?.find(row=>text(row?.doePolicyVersionId))?.doePolicyVersionId),
      action:'session_doe_saved',entityType:'session',entityId:text(session.sessionId||session.id),academicYear:text(preview.academicYear),
      doeChanges:clone(preview.doeChanges||[]),changedBy:text(actor.uid),changedByName:text(actor.name),changedByEmail:text(actor.email),changedAt:savedAt
    };
    await repository.saveSessionCalculationBundle({session,calculationRecords:preview.calculationRecords,auditRecord});
    return{...preview,session,auditRecord};
  }

  return Object.freeze({previewSessionChange,previewFacultyTransfer,saveSessionChange});
}

module.exports={createWorkflowPreviewService,academicYearForSession,assignmentFacts,relevantFields,stripClientDoe};
