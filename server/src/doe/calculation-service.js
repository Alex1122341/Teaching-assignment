'use strict';
const crypto=require('node:crypto');
const {ApiError}=require('../http/errors.js');
const temporalRoles=require('../../../temporal-role-assignment.js');

const text=value=>String(value??'').trim();
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
const blockedFactKeys=new Set([
  'doeCredit','resultDoe','doeCalculatedCredit','doePolicyVersionId','doeRuleId','doeRuleKey','doeCalculationId',
  'calculationId','policyVersionId','ruleId','ruleKey','parameters','ruleSnapshot'
]);
const persistRoles=new Set(['developer','owner','administrator','admin','adfa_general','adfa_regular']);

function cleanFacts(raw={}){
  const facts={};
  for(const [key,value] of Object.entries(raw&&typeof raw==='object'?raw:{})){
    if(!blockedFactKeys.has(key))facts[key]=value;
  }
  return facts;
}

function enabled(rows){return(Array.isArray(rows)?rows:[]).filter(row=>row?.enabled!==false)}
function findCourseMapping(bundle,courseCode){
  const code=text(courseCode).toUpperCase();
  if(!code)return null;
  const rows=enabled(bundle?.courseMappings).filter(row=>text(row?.courseCode).toUpperCase()===code);
  if(rows.length>1)throw new ApiError('COURSE_MAPPING_AMBIGUOUS','Multiple enabled course mappings match this assignment.',409,{courseCode:code});
  return rows[0]||null;
}
function findSubjectMapping(bundle,subjectKey){
  const key=text(subjectKey).toLowerCase();
  if(!key)return null;
  const rows=enabled(bundle?.subjectMappings).filter(row=>text(row?.subjectKey).toLowerCase()===key);
  if(rows.length>1)throw new ApiError('SUBJECT_MAPPING_AMBIGUOUS','Multiple enabled subject mappings match this assignment.',409,{subjectKey:key});
  return rows[0]||null;
}

function mapContext(bundle,facts){
  const context={...facts};
  const courseMapping=findCourseMapping(bundle,context.courseCode||context.course);
  const subjectMapping=findSubjectMapping(bundle,context.subjectKey||context.subject);
  if(courseMapping){
    for(const [key,value] of Object.entries(courseMapping)){
      if(['mappingId','policyVersionId','academicYear','referenceId','reviewStatus','enabled'].includes(key))continue;
      if(!own(context,key))context[key]=value;
    }
    if(!own(context,'units')&&Number.isFinite(Number(courseMapping.unitCount)))context.units=Number(courseMapping.unitCount);
  }
  if(subjectMapping){
    for(const [key,value] of Object.entries(subjectMapping)){
      if(['mappingId','policyVersionId','academicYear','referenceId','reviewStatus','enabled'].includes(key))continue;
      if(!own(context,key))context[key]=value;
    }
  }
  return{context,courseMapping,subjectMapping};
}

function sourceValue(source,{context,courseMapping,subjectMapping}){
  const [scope,...rest]=text(source).split('.');
  const key=rest.join('.');
  if(!scope||!key)return undefined;
  const sourceObject=scope==='course_mapping'?courseMapping:scope==='subject_mapping'?subjectMapping:scope==='facts'?context:null;
  if(!sourceObject)return undefined;
  return key.split('.').reduce((value,part)=>value&&typeof value==='object'?value[part]:undefined,sourceObject);
}

function sourceError(source,inputName,context){
  if(text(source).startsWith('course_mapping.'))return new ApiError('COURSE_MAPPING_REQUIRED','Course mapping is required to calculate DOE.',422,{courseCode:text(context.courseCode||context.course),inputName});
  if(text(source).startsWith('subject_mapping.'))return new ApiError('SUBJECT_MAPPING_REQUIRED','Subject mapping is required to calculate DOE.',422,{subjectKey:text(context.subjectKey||context.subject),inputName});
  return new ApiError('REQUIRED_INPUT_MISSING','Required DOE input is missing.',422,{inputName});
}

function ensureDeclaredMapping(rule,mapped){
  const requirement=text(rule?.mappingRequirement).toLowerCase();
  if(requirement==='course'&&!mapped.courseMapping)throw new ApiError('COURSE_MAPPING_REQUIRED','Course mapping is required to calculate DOE.',422,{courseCode:text(mapped.context.courseCode||mapped.context.course)});
  if(requirement==='subject'&&!mapped.subjectMapping)throw new ApiError('SUBJECT_MAPPING_REQUIRED','Subject mapping is required to calculate DOE.',422,{subjectKey:text(mapped.context.subjectKey||mapped.context.subject)});
}

function enrichRequiredInputs(rule,mapped){
  const context={...mapped.context};
  for(const input of Array.isArray(rule?.inputs)?rule.inputs:[]){
    const name=typeof input==='string'?text(input):text(input?.inputName);
    if(!name||input?.required===false)continue;
    if(own(context,name)&&context[name]!==''&&context[name]!==null&&context[name]!==undefined)continue;
    const source=typeof input==='string'?'':text(input?.source);
    const value=sourceValue(source,{...mapped,context});
    if(value===undefined||value===null||value==='')throw sourceError(source,name,context);
    context[name]=value;
  }
  return context;
}

function referenceFor(bundle,match){
  if(match?.source==='exception'){
    const sourceReference=text(match.exception?.sourceReference);
    return sourceReference?{referenceId:'',title:sourceReference}:null;
  }
  const referenceId=text(match?.rule?.referenceId);
  const reference=(Array.isArray(bundle?.references)?bundle.references:[]).find(row=>text(row?.referenceId)===referenceId);
  if(reference)return{...reference};
  const fallback=text(match?.rule?.sourceReference||match?.rule?.guidelineReference);
  return fallback?{referenceId,title:fallback}:null;
}

function calculationText(result,rule){
  if(result?.source==='exception')return`Fixed approved DOE ${Number(result.resultDoe).toFixed(2)}%`;
  const inputs=result?.inputs||{},parameters=result?.parameters||{};
  const rate=Number(parameters.rate);
  const inputEntries=Object.entries(inputs).filter(([,value])=>Number.isFinite(Number(value)));
  if(inputEntries.length&&Number.isFinite(rate)){
    const [name,value]=inputEntries[0];
    return`${Number(value)} ${name} × ${rate}% = ${Number(result.resultDoe).toFixed(2)}%`;
  }
  if(text(rule?.calculationMode)==='fixed')return`${Number(result.resultDoe).toFixed(2)}% fixed`;
  return`${text(rule?.calculationMode)||'rule'} = ${Number(result.resultDoe).toFixed(2)}%`;
}

function createCalculationService({repository,engine,idFactory=()=>`calc-${crypto.randomUUID()}`,assignmentIdFactory=()=>`role-${crypto.randomUUID()}`,auditIdFactory=()=>`audit-${crypto.randomUUID()}`,clock=()=>new Date()}={}){
  if(!repository?.getActivePolicyBundle)throw new Error('DOE calculation repository is required.');
  if(!engine?.matchRule||!engine?.calculate)throw new Error('DOE policy engine is required.');

  async function computeAssignment({academicYear,facts={}}={}){
    const year=text(academicYear);
    if(!year)throw new ApiError('ACADEMIC_YEAR_REQUIRED','Academic Year is required.',422);
    const bundle=await repository.getActivePolicyBundle(year);
    const clean=cleanFacts(facts);
    const mapped=mapContext(bundle,{...clean,academicYear:year});
    const match=engine.matchRule(bundle,mapped.context);
    if(match.source==='rule')ensureDeclaredMapping(match.rule,mapped);
    const context=match.source==='rule'?enrichRequiredInputs(match.rule,mapped):mapped.context;
    const result=engine.calculate(bundle,context);
    const reference=referenceFor(bundle,match);
    const publicResult={
      status:'calculated',academicYear:year,policyVersionId:text(result.policyVersionId),
      ruleId:text(result.ruleId),ruleKey:text(result.ruleKey),exceptionId:text(result.exceptionId),source:text(result.source),
      resultDoe:Number(result.resultDoe),inputs:{...(result.inputs||{})},parameters:{...(result.parameters||{})},
      calculationText:calculationText(result,match.rule),reference
    };
    return{year,bundle,clean,match,result,reference,publicResult};
  }

  function calculationRecordFor(computed,{actor={},calculationId,calculatedAt,trigger}={}){
    const {year,clean,match,result,reference,publicResult}=computed;
    return{
      calculationId,academicYear:year,policyVersionId:publicResult.policyVersionId,ruleId:publicResult.ruleId,
      ruleKey:publicResult.ruleKey,exceptionId:publicResult.exceptionId,source:publicResult.source,
      category:text(clean.category||match.rule?.category||result.ruleSnapshot?.category),
      facultyId:text(clean.facultyId),sessionId:text(clean.sessionId),assignmentId:text(clean.assignmentId),
      sourceEntityType:text(clean.sourceEntityType),sourceEntityId:text(clean.sourceEntityId),
      factsSnapshot:structuredClone(clean),inputsSnapshot:{...publicResult.inputs},parameterSnapshot:{...publicResult.parameters},
      ruleSnapshot:structuredClone(result.ruleSnapshot||{}),referenceSnapshot:reference?structuredClone(reference):null,
      calculationText:publicResult.calculationText,resultDoe:publicResult.resultDoe,trigger:text(trigger||clean.trigger)||'api_calculation',
      calculatedBy:text(actor.uid),calculatedByName:text(actor.name),calculatedByEmail:text(actor.email),calculatedAt
    };
  }

  async function prepareAssignmentCalculation({actor={},academicYear,facts={},trigger='api_calculation'}={}){
    const computed=await computeAssignment({academicYear,facts});
    const calculationId=text(idFactory()),calculatedAt=clock().toISOString();
    const calculationRecord=calculationRecordFor(computed,{actor,calculationId,calculatedAt,trigger});
    return{calculation:{...computed.publicResult,calculationId,calculatedAt},calculationRecord};
  }

  async function calculateAssignment({actor={},academicYear,facts={},persist=false}={}){
    if(persist&&!persistRoles.has(text(actor.role).toLowerCase()))throw new ApiError('FORBIDDEN','This account cannot persist authoritative DOE calculations.',403);
    if(!persist)return(await computeAssignment({academicYear,facts})).publicResult;
    if(!repository.createCalculationRecord)throw new ApiError('CALCULATION_REPOSITORY_REQUIRED','Calculation evidence repository is unavailable.',500);
    const prepared=await prepareAssignmentCalculation({actor,academicYear,facts});
    await repository.createCalculationRecord(prepared.calculationRecord);
    return prepared.calculation;
  }

  async function saveRoleAssignment({actor={},academicYear,facultyId,facts={}}={}){
    if(!persistRoles.has(text(actor.role).toLowerCase()))throw new ApiError('FORBIDDEN','This account cannot save authoritative DOE role assignments.',403);
    if(!repository.saveDoeAssignmentCalculation)throw new ApiError('CALCULATION_REPOSITORY_REQUIRED','Atomic DOE assignment persistence is unavailable.',500);
    const year=text(academicYear),faculty=text(facultyId);
    if(!year)throw new ApiError('ACADEMIC_YEAR_REQUIRED','Academic Year is required.',422);
    if(!faculty)throw new ApiError('FACULTY_ID_REQUIRED','Faculty ID is required.',422);
    const cleanRoleFacts=cleanFacts(facts),assignmentFactId=text(cleanRoleFacts.assignmentFactId)||text(assignmentIdFactory());
    let window;
    try{window=temporalRoles.normalizeWindow({academicYear:year,activeDate:cleanRoleFacts.activeDate,expirationDate:cleanRoleFacts.expirationDate})}
    catch(error){throw new ApiError('ROLE_DATE_WINDOW_INVALID',error.message,422)}
    let doeOverride;
    try{doeOverride=temporalRoles.normalizeDoeOverride(cleanRoleFacts.doeOverride)}
    catch(error){throw new ApiError('ROLE_DOE_OVERRIDE_INVALID',error.message,422)}
    const policyFacts={...cleanRoleFacts};
    for(const field of ['assignmentFactId','activeDate','expirationDate','doeOverride'])delete policyFacts[field];
    const calculationFacts={...policyFacts,assignmentFactId,academicYear:year,facultyId:faculty,category:'role',assignmentId:assignmentFactId,sourceEntityType:'doe_assignment',sourceEntityId:assignmentFactId,trigger:'role_assignment_save'};
    const prepared=await prepareAssignmentCalculation({actor,academicYear:year,facts:calculationFacts,trigger:'role_assignment_save'});
    const policyCalculatedDoe=Number(prepared.calculation.resultDoe);
    const appliedDoe=temporalRoles.effectiveDoe(policyCalculatedDoe,doeOverride);
    const calculationText=doeOverride===null?prepared.calculation.calculationText:`${prepared.calculation.calculationText}; manual role override = ${Number(appliedDoe).toFixed(2)}%`;
    const computed={publicResult:{...prepared.calculation,calculatedDoe:policyCalculatedDoe,overrideDoe:doeOverride,resultDoe:appliedDoe,calculationText}};
    const calculationId=text(prepared.calculation.calculationId),calculatedAt=text(prepared.calculation.calculatedAt);
    const calculationRecord={...prepared.calculationRecord,resultDoe:appliedDoe,policyCalculatedDoe,overrideDoe:doeOverride,calculationText,
      factsSnapshot:{...prepared.calculationRecord.factsSnapshot,activeDate:window.activeDate,expirationDate:window.expirationDate,doeOverride}};
    const persistedFacts=cleanFacts(cleanRoleFacts);
    delete persistedFacts.assignmentFactId;
    persistedFacts.activeDate=window.activeDate;persistedFacts.expirationDate=window.expirationDate;persistedFacts.doeOverride=doeOverride;
    const assignment={
      assignmentFactId,academicYear:year,facultyId:faculty,category:'role',...persistedFacts,facts:structuredClone(persistedFacts),active:true,
      activeDate:window.activeDate,expirationDate:window.expirationDate,doeCalculatedCredit:policyCalculatedDoe,doeOverride,
      doeCredit:appliedDoe,doePolicyVersionId:computed.publicResult.policyVersionId,
      doeRuleId:computed.publicResult.ruleId,doeRuleKey:computed.publicResult.ruleKey,doeCalculationId:calculationId,
      updatedBy:text(actor.uid),updatedByName:text(actor.name),updatedByEmail:text(actor.email),updatedAt:calculatedAt
    };
    const auditRecord={
      auditId:`role-save-${assignmentFactId}-${calculationId}`,policyVersionId:computed.publicResult.policyVersionId,
      action:'doe_assignment_saved',entityType:'doe_assignment',entityId:assignmentFactId,academicYear:year,facultyId:faculty,
      activeDate:window.activeDate,expirationDate:window.expirationDate,calculatedDoe:policyCalculatedDoe,overrideDoe:doeOverride,
      resultDoe:appliedDoe,ruleId:computed.publicResult.ruleId,ruleKey:computed.publicResult.ruleKey,
      changedBy:text(actor.uid),changedByName:text(actor.name),changedByEmail:text(actor.email),changedAt:calculatedAt
    };
    await repository.saveDoeAssignmentCalculation({assignment,calculationRecord,auditRecord});
    return{assignment,calculation:{...computed.publicResult,calculationId,calculatedAt}};
  }

  async function listRoleAssignments({actor={},facultyId,academicYear}={}){
    if(!persistRoles.has(text(actor.role).toLowerCase()))throw new ApiError('FORBIDDEN','This account cannot read authoritative DOE role assignments.',403);
    if(!repository.listFacultyRoleAssignments)throw new ApiError('ASSIGNMENT_REPOSITORY_REQUIRED','DOE role assignment repository is unavailable.',500);
    const faculty=text(facultyId),year=text(academicYear);
    if(!faculty)throw new ApiError('FACULTY_ID_REQUIRED','Faculty ID is required.',422);
    if(!year)throw new ApiError('ACADEMIC_YEAR_REQUIRED','Academic Year is required.',422);
    const rows=await repository.listFacultyRoleAssignments(faculty,year),asOf=clock().toISOString().slice(0,10);
    return rows.map(row=>({...row,effectiveStatus:temporalRoles.statusAt({academicYear:year,...row},asOf)}));
  }

  async function deactivateRoleAssignment({actor={},assignmentFactId}={}){
    if(!persistRoles.has(text(actor.role).toLowerCase()))throw new ApiError('FORBIDDEN','This account cannot deactivate DOE role assignments.',403);
    if(!repository.getDoeAssignment||!repository.deactivateDoeAssignment)throw new ApiError('ASSIGNMENT_REPOSITORY_REQUIRED','DOE role assignment repository is unavailable.',500);
    const id=text(assignmentFactId);
    if(!id)throw new ApiError('ASSIGNMENT_ID_REQUIRED','DOE assignmentFactId is required.',422);
    const current=await repository.getDoeAssignment(id);
    if(!current)throw new ApiError('ASSIGNMENT_NOT_FOUND','DOE assignment was not found.',404,{assignmentFactId:id});
    if(text(current.category).toLowerCase()!=='role')throw new ApiError('ASSIGNMENT_NOT_ROLE','Only DOE role assignments can be deactivated from the Faculty editor.',409,{assignmentFactId:id});
    if(current.active===false)return current;
    const changedAt=clock().toISOString();
    const auditRecord={
      auditId:text(auditIdFactory()),action:'doe_assignment_deactivated',entityType:'doe_assignment',entityId:id,
      academicYear:text(current.academicYear),facultyId:text(current.facultyId),policyVersionId:text(current.doePolicyVersionId||current.policyVersionId),
      previousResultDoe:Number.isFinite(Number(current.doeCredit))?Number(current.doeCredit):null,
      changedBy:text(actor.uid),changedByName:text(actor.name),changedByEmail:text(actor.email),changedAt
    };
    return repository.deactivateDoeAssignment({assignmentFactId:id,auditRecord});
  }

  return Object.freeze({calculateAssignment,prepareAssignmentCalculation,saveRoleAssignment,listRoleAssignments,deactivateRoleAssignment});
}

module.exports={cleanFacts,createCalculationService};
