'use strict';
const calendarSession=require('../../../calendar-session.js');

const COLLECTIONS=Object.freeze({
  policies:'doe_policies',
  versions:'doe_policy_versions',
  rules:'doe_rules',
  selectors:'doe_rule_selectors',
  parameters:'doe_rule_parameters',
  tiers:'doe_rule_tiers',
  inputs:'doe_rule_inputs',
  exceptions:'doe_exceptions',
  references:'doe_reference_sources',
  courseMappings:'doe_course_mappings',
  subjectMappings:'doe_subject_mappings',
  calculations:'doe_calculation_records',
  audit:'doe_audit_log',
  assignments:'doe_assignments',
  targets:'doe_faculty_targets',
  faculty:'faculty',
  sessions:'sessions',
  calendarSessions:'calendar_sessions'
});

class RepositoryError extends Error{
  constructor(code,message,details={}){
    super(message);
    this.name='RepositoryError';
    this.code=code;
    this.details=details;
    this.statusCode=400;
  }
}

const text=value=>String(value??'').trim();
function rowFromDoc(doc,idField){
  const row={...(doc.data?.()||{})};
  delete row.id;
  if(idField&&!text(row[idField]))row[idField]=String(doc.id||'');
  return row;
}

function createRepository(db){
  if(!db?.collection)throw new Error('Firestore database is required.');

  const collection=key=>db.collection(COLLECTIONS[key]);

  async function getById(key,id,idField){
    const snap=await collection(key).doc(text(id)).get();
    return snap.exists?rowFromDoc(snap,idField):null;
  }

  async function listWhere(key,field,value,idField){
    const snap=await collection(key).where(field,'==',value).get();
    return(snap.docs||[]).map(doc=>rowFromDoc(doc,idField));
  }

  async function getPolicyForYear(academicYear){
    const rows=await listWhere('policies','academicYear',text(academicYear),'policyId');
    if(!rows.length)return null;
    if(rows.length>1)throw new RepositoryError('POLICY_AMBIGUOUS','Multiple DOE policies exist for the same Academic Year.',{academicYear:text(academicYear)});
    return rows[0];
  }

  async function getVersion(policyVersionId){
    return getById('versions',policyVersionId,'policyVersionId');
  }

  async function getFacultyRecord(facultyId){
    return getById('faculty',facultyId,'facultyId');
  }

  async function requireDraftVersion(policyVersionId){
    const version=await getVersion(policyVersionId);
    if(!version)throw new RepositoryError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',{policyVersionId:text(policyVersionId)});
    if(version.status!=='draft')throw new RepositoryError('POLICY_NOT_DRAFT','Only a Draft DOE policy can be edited.',{policyVersionId:text(policyVersionId),status:version.status});
    return version;
  }

  async function listRules(policyVersionId){
    const [rules,selectors,parameters,tiers,inputs]=await Promise.all([
      listWhere('rules','policyVersionId',text(policyVersionId),'ruleId'),
      listWhere('selectors','policyVersionId',text(policyVersionId),'selectorId'),
      listWhere('parameters','policyVersionId',text(policyVersionId),'parameterId'),
      listWhere('tiers','policyVersionId',text(policyVersionId),'tierId'),
      listWhere('inputs','policyVersionId',text(policyVersionId),'ruleInputId')
    ]);
    return rules.map(rule=>({
      ...rule,
      selectors:selectors.filter(row=>text(row.ruleId)===text(rule.ruleId)),
      parameters:parameters.filter(row=>text(row.ruleId)===text(rule.ruleId)),
      tiers:tiers.filter(row=>text(row.ruleId)===text(rule.ruleId)),
      inputs:inputs.filter(row=>text(row.ruleId)===text(rule.ruleId))
    }));
  }

  async function listReferencesForVersion(policyVersionId){
    return listWhere('references','policyVersionId',text(policyVersionId),'referenceId');
  }
  async function listCourseMappings(academicYear,policyVersionId=''){
    const rows=await listWhere('courseMappings','academicYear',text(academicYear),'mappingId');
    return text(policyVersionId)?rows.filter(row=>text(row.policyVersionId)===text(policyVersionId)):rows;
  }
  async function listSubjectMappings(academicYear,policyVersionId=''){
    const rows=await listWhere('subjectMappings','academicYear',text(academicYear),'mappingId');
    return text(policyVersionId)?rows.filter(row=>text(row.policyVersionId)===text(policyVersionId)):rows;
  }
  async function listExceptions(policyVersionId){
    return listWhere('exceptions','policyVersionId',text(policyVersionId),'exceptionId');
  }

  async function getActivePolicyBundle(academicYear){
    const policy=await getPolicyForYear(academicYear);
    if(!policy)throw new RepositoryError('POLICY_NOT_FOUND','DOE policy was not found for Academic Year.',{academicYear:text(academicYear)});
    const activeId=text(policy.currentActiveVersionId);
    if(!activeId)throw new RepositoryError('ACTIVE_POLICY_REQUIRED','No Active DOE policy exists for Academic Year.',{academicYear:text(academicYear)});
    const version=await getVersion(activeId);
    if(!version||version.status!=='active')throw new RepositoryError('ACTIVE_POLICY_REQUIRED','DOE policy active pointer is invalid.',{academicYear:text(academicYear),policyVersionId:activeId});
    const [rules,exceptions,references,courseMappings,subjectMappings]=await Promise.all([
      listRules(activeId),listExceptions(activeId),listReferencesForVersion(activeId),
      listCourseMappings(academicYear,activeId),listSubjectMappings(academicYear,activeId)
    ]);
    return{policy,version,rules,exceptions,references,courseMappings,subjectMappings};
  }


  async function getPolicyBundleByVersion(policyVersionId){
    const version=await getVersion(policyVersionId);
    if(!version)return null;
    const policy=await getById('policies',version.policyId,'policyId');
    if(!policy)throw new RepositoryError('POLICY_NOT_FOUND','DOE policy for version was not found.',{policyVersionId:text(policyVersionId),policyId:text(version.policyId)});
    const [rules,exceptions,references,courseMappings,subjectMappings]=await Promise.all([
      listRules(policyVersionId),listExceptions(policyVersionId),listReferencesForVersion(policyVersionId),
      listCourseMappings(version.academicYear,policyVersionId),listSubjectMappings(version.academicYear,policyVersionId)
    ]);
    return{policy,version,rules,exceptions,references,courseMappings,subjectMappings};
  }

  async function createPolicyYearDraft(payload,{actor={}}={}){
    const policy={...(payload?.policy||{})},version={...(payload?.version||{})};
    const policyId=text(policy.policyId),versionId=text(version.policyVersionId),academicYear=text(version.academicYear||policy.academicYear);
    if(!policyId||!versionId||!academicYear)throw new RepositoryError('POLICY_DRAFT_INVALID','Annual DOE draft requires policyId, policyVersionId, and Academic Year.');
    if(await getPolicyForYear(academicYear))throw new RepositoryError('POLICY_YEAR_EXISTS','A DOE policy already exists for the target Academic Year.',{academicYear});
    if(version.status!=='draft')throw new RepositoryError('POLICY_NOT_DRAFT','Annual policy creation must start as Draft.',{policyVersionId:versionId});
    const writes=[];
    const stage=(key,id,row)=>{if(!text(id))throw new RepositoryError('BUSINESS_ID_REQUIRED',`DOE ${key} row requires an ID.`);writes.push([collection(key).doc(text(id)),{...row}])};
    stage('policies',policyId,policy);stage('versions',versionId,version);
    for(const row of payload.references||[])stage('references',row.referenceId,row);
    for(const sourceRule of payload.rules||[]){
      const rule={...sourceRule};delete rule.selectors;delete rule.parameters;delete rule.tiers;delete rule.inputs;
      stage('rules',rule.ruleId,rule);
      for(const row of sourceRule.selectors||[])stage('selectors',row.selectorId,row);
      for(const row of sourceRule.parameters||[])stage('parameters',row.parameterId,row);
      for(const row of sourceRule.tiers||[])stage('tiers',row.tierId,row);
      for(const row of sourceRule.inputs||[])stage('inputs',row.ruleInputId,row);
    }
    for(const row of payload.courseMappings||[])stage('courseMappings',row.mappingId,row);
    for(const row of payload.subjectMappings||[])stage('subjectMappings',row.mappingId,row);
    for(const row of payload.exceptions||[])stage('exceptions',row.exceptionId,row);
    const auditId=`annual-copy-${versionId}`;
    stage('audit',auditId,{auditId,policyVersionId:versionId,action:'policy_year_copied',entityType:'policy_version',entityId:versionId,sourcePolicyVersionId:text(version.clonedFromVersionId),academicYear,changedBy:text(actor.uid),changedByName:text(actor.name),changedByEmail:text(actor.email),changedAt:text(version.createdAt)||new Date().toISOString()});
    if(writes.length>450)throw new RepositoryError('POLICY_COPY_TOO_LARGE','Annual DOE policy copy exceeds the safe Firestore batch size.',{writeCount:writes.length});
    if(typeof db.batch==='function'){
      const batch=db.batch();for(const [ref,row] of writes)batch.set(ref,row);await batch.commit();
    }else{
      for(const [ref,row] of writes)await ref.set(row);
    }
    return{...payload,policy,version};
  }

  async function loadAnnualValidationDataset(academicYear){
    const year=text(academicYear);
    const [assignmentRows,sessionSnap]=await Promise.all([
      listWhere('assignments','academicYear',year,'assignmentFactId'),
      db.collection('sessions').where('academicYear','==',year).get().catch(()=>({docs:[]}))
    ]);
    const activeFacts=assignmentRows.filter(row=>row?.active!==false).map(row=>({...row}));
    for(const doc of sessionSnap.docs||[]){
      const session=rowFromDoc(doc,'sessionId');
      for(const [index,assignment] of (Array.isArray(session.assignments)?session.assignments:[]).entries()){
        const facultyId=text(assignment?.facultyId||assignment?.ucid);if(!facultyId)continue;
        activeFacts.push({
          ...assignment,academicYear:year,facultyId,category:'teaching',sessionId:text(session.sessionId||doc.id),
          assignmentId:text(assignment.assignmentId)||`${text(session.sessionId||doc.id)}--assignment--${index+1}`,
          sourceEntityType:'session_assignment',sourceEntityId:text(session.sessionId||doc.id),
          activityType:text(assignment.activityType||session.type||session.activityType),teachingRole:text(assignment.teachingRole||assignment.role),
          courseCode:text(assignment.courseCode||session.courseCode||session.course)
        });
      }
    }
    return{activeFacts};
  }

  async function saveAnnualValidationResult(policyVersionId,report,{actor={}}={}){
    const version=await requireDraftVersion(policyVersionId);
    const validatedAt=new Date().toISOString();
    const patch={annualValidationValid:report?.valid===true,annualValidationErrors:Array.isArray(report?.errors)?report.errors:[],annualValidationWarnings:Array.isArray(report?.warnings)?report.warnings:[],annualValidatedAt:validatedAt,annualValidatedBy:text(actor.uid),annualValidatedByName:text(actor.name)};
    await collection('versions').doc(text(policyVersionId)).set(patch,{merge:true});
    return{...version,...patch};
  }

  async function getReference(referenceId){
    return getById('references',referenceId,'referenceId');
  }

  async function getCourseMapping(academicYear,courseCode,policyVersionId=''){
    const code=text(courseCode).toUpperCase();
    const rows=(await listCourseMappings(academicYear,policyVersionId)).filter(row=>row.enabled!==false&&text(row.courseCode).toUpperCase()===code);
    if(rows.length>1)throw new RepositoryError('COURSE_MAPPING_AMBIGUOUS','Multiple enabled DOE course mappings match the course.',{academicYear:text(academicYear),courseCode:code});
    return rows[0]||null;
  }

  async function getSession(sessionId){
    return getById('sessions',sessionId,'sessionId');
  }

  async function getSubjectMapping(academicYear,subjectKey,policyVersionId=''){
    const key=text(subjectKey).toLowerCase();
    const rows=(await listSubjectMappings(academicYear,policyVersionId)).filter(row=>row.enabled!==false&&text(row.subjectKey).toLowerCase()===key);
    if(rows.length>1)throw new RepositoryError('SUBJECT_MAPPING_AMBIGUOUS','Multiple enabled DOE subject mappings match the subject.',{academicYear:text(academicYear),subjectKey:key});
    return rows[0]||null;
  }

  function draftMutationPatch(version,{actor={}}={}){
    return{
      revision:Number(version?.revision||0)+1,
      lastValidationPassed:false,lastValidatedRevision:null,lastValidatedChecksum:'',rulesChecksum:'',
      lastImpactRunId:'',lastImpactRevision:null,lastImpactChecksum:'',lastImpactDatasetChecksum:'',lastInputDatasetChecksum:'',
      annualValidationValid:false,annualValidationErrors:[],annualValidationWarnings:[],annualValidatedAt:'',annualValidatedBy:'',annualValidatedByName:'',
      updatedBy:text(actor.uid),updatedByName:text(actor.name),updatedAt:new Date().toISOString()
    };
  }

  async function saveDraftConfigurationRow(key,idField,row,{actor={}}={}){
    const next={...(row||{})},id=text(next[idField]),policyVersionId=text(next.policyVersionId);
    if(!id)throw new RepositoryError(idField==='referenceId'?'REFERENCE_ID_REQUIRED':'MAPPING_ID_REQUIRED',`DOE ${idField} is required.`);
    if(!policyVersionId)throw new RepositoryError('POLICY_VERSION_REQUIRED','DOE policyVersionId is required.');
    const versionRef=collection('versions').doc(policyVersionId),rowRef=collection(key).doc(id);
    await db.runTransaction(async transaction=>{
      const snapshot=await transaction.get(versionRef),version=snapshot.exists?rowFromDoc(snapshot,'policyVersionId'):null;
      if(!version)throw new RepositoryError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',{policyVersionId});
      if(version.status!=='draft')throw new RepositoryError('POLICY_NOT_DRAFT','Only a Draft DOE policy can be edited.',{policyVersionId,status:version.status});
      transaction.set(rowRef,next,{merge:true});
      transaction.set(versionRef,draftMutationPatch(version,{actor}),{merge:true});
    });
    return next;
  }

  async function saveDraftReference(reference,options={}){
    return saveDraftConfigurationRow('references','referenceId',reference,options);
  }
  async function saveDraftCourseMapping(mapping,options={}){
    return saveDraftConfigurationRow('courseMappings','mappingId',mapping,options);
  }
  async function saveDraftSubjectMapping(mapping,options={}){
    return saveDraftConfigurationRow('subjectMappings','mappingId',mapping,options);
  }
  async function saveDraftReservePolicy(policyVersionId,reservePolicy,{actor={}}={}){
    const id=text(policyVersionId),versionRef=collection('versions').doc(id),next={...(reservePolicy||{})};
    if(!id)throw new RepositoryError('POLICY_VERSION_REQUIRED','DOE policyVersionId is required.');
    await db.runTransaction(async transaction=>{
      const snapshot=await transaction.get(versionRef),version=snapshot.exists?rowFromDoc(snapshot,'policyVersionId'):null;
      if(!version)throw new RepositoryError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',{policyVersionId:id});
      if(version.status!=='draft')throw new RepositoryError('POLICY_NOT_DRAFT','Only a Draft DOE policy can be edited.',{policyVersionId:id,status:version.status});
      transaction.set(versionRef,{...draftMutationPatch(version,{actor}),reservePolicy:next},{merge:true});
    });
    return next;
  }

  async function createCalculationRecord(record){
    const row={...record};
    const id=text(row.calculationId);
    if(!id)throw new RepositoryError('CALCULATION_ID_REQUIRED','DOE calculationId is required.');
    const ref=collection('calculations').doc(id);
    const existing=await ref.get();
    if(existing.exists)throw new RepositoryError('EVIDENCE_ALREADY_EXISTS','DOE calculation evidence already exists.',{calculationId:id});
    await ref.set(row);
    return row;
  }

  async function saveDoeAssignmentCalculation({assignment={},calculationRecord={},auditRecord={}}={}){
    const assignmentId=text(assignment.assignmentFactId),calculationId=text(calculationRecord.calculationId),auditId=text(auditRecord.auditId);
    if(!assignmentId)throw new RepositoryError('ASSIGNMENT_ID_REQUIRED','DOE assignmentFactId is required.');
    if(!calculationId)throw new RepositoryError('CALCULATION_ID_REQUIRED','DOE calculationId is required.');
    if(!auditId)throw new RepositoryError('AUDIT_ID_REQUIRED','DOE auditId is required.');
    if(typeof db.runTransaction!=='function')throw new RepositoryError('ATOMIC_WRITE_REQUIRED','DOE assignment persistence requires Firestore transactions.');
    const assignmentRef=collection('assignments').doc(assignmentId),calculationRef=collection('calculations').doc(calculationId),auditRef=collection('audit').doc(auditId);
    await db.runTransaction(async transaction=>{
      const [existingEvidence,existingAssignment]=await Promise.all([transaction.get(calculationRef),transaction.get(assignmentRef)]);
      if(existingEvidence.exists)throw new RepositoryError('EVIDENCE_ALREADY_EXISTS','DOE calculation evidence already exists.',{calculationId});
      if(existingAssignment.exists){
        const current=existingAssignment.data()||{};
        if(text(current.facultyId)!==text(assignment.facultyId)||text(current.academicYear)!==text(assignment.academicYear)){
          throw new RepositoryError('ASSIGNMENT_ID_CONFLICT','DOE assignmentFactId belongs to a different faculty member or Academic Year.',{assignmentFactId:assignmentId});
        }
      }
      transaction.set(assignmentRef,{...assignment},{merge:true});
      transaction.set(calculationRef,{...calculationRecord});
      transaction.set(auditRef,{...auditRecord});
    });
    return{...assignment};
  }

  async function getDoeAssignment(assignmentFactId){
    return getById('assignments',assignmentFactId,'assignmentFactId');
  }

  async function listFacultyRoleAssignments(facultyId,academicYear){
    const id=text(facultyId),year=text(academicYear);
    if(!id||!year)return[];
    const rows=await listWhere('assignments','academicYear',year,'assignmentFactId');
    return rows.filter(row=>text(row.facultyId)===id&&text(row.category).toLowerCase()==='role'&&row.active!==false)
      .sort((a,b)=>text(a.roleType||a.teachingRole).localeCompare(text(b.roleType||b.teachingRole))||text(a.assignmentFactId).localeCompare(text(b.assignmentFactId)));
  }

  async function deactivateDoeAssignment({assignmentFactId,auditRecord={}}={}){
    const id=text(assignmentFactId),auditId=text(auditRecord.auditId);
    if(!id)throw new RepositoryError('ASSIGNMENT_ID_REQUIRED','DOE assignmentFactId is required.');
    if(!auditId)throw new RepositoryError('AUDIT_ID_REQUIRED','DOE assignment deactivation audit requires auditId.');
    if(typeof db.runTransaction!=='function')throw new RepositoryError('ATOMIC_WRITE_REQUIRED','DOE assignment deactivation requires a Firestore transaction.');
    const assignmentRef=collection('assignments').doc(id),auditRef=collection('audit').doc(auditId);
    return db.runTransaction(async transaction=>{
      const snapshot=await transaction.get(assignmentRef);
      if(!snapshot.exists)throw new RepositoryError('ASSIGNMENT_NOT_FOUND','DOE assignment was not found.',{assignmentFactId:id});
      const before=rowFromDoc(snapshot,'assignmentFactId');
      const after={...before,active:false,updatedBy:text(auditRecord.changedBy),updatedByName:text(auditRecord.changedByName),updatedByEmail:text(auditRecord.changedByEmail),updatedAt:text(auditRecord.changedAt)};
      transaction.set(assignmentRef,after,{merge:true});
      transaction.set(auditRef,{...auditRecord,before,after});
      return after;
    });
  }

  async function saveSessionCalculationBundle({session={},calculationRecords=[],auditRecord={}}={}){
    const sessionId=text(session.sessionId||session.id),auditId=text(auditRecord.auditId);
    if(!sessionId)throw new RepositoryError('SESSION_ID_REQUIRED','Session ID is required.');
    if(!auditId)throw new RepositoryError('AUDIT_ID_REQUIRED','DOE session auditId is required.');
    if(typeof db.runTransaction!=='function')throw new RepositoryError('ATOMIC_WRITE_REQUIRED','DOE session persistence requires Firestore transactions.');
    const sessionRef=collection('sessions').doc(sessionId),calendarRef=collection('calendarSessions').doc(sessionId),auditRef=collection('audit').doc(auditId);
    const records=(Array.isArray(calculationRecords)?calculationRecords:[]).map(record=>{
      const calculationId=text(record?.calculationId);if(!calculationId)throw new RepositoryError('CALCULATION_ID_REQUIRED','DOE calculationId is required.');
      return{record,ref:collection('calculations').doc(calculationId)};
    });
    await db.runTransaction(async transaction=>{
      for(const item of records){const existing=await transaction.get(item.ref);if(existing.exists)throw new RepositoryError('EVIDENCE_ALREADY_EXISTS','DOE calculation evidence already exists.',{calculationId:text(item.record.calculationId)})}
      transaction.set(sessionRef,{...session,sessionId},{merge:true});
      transaction.set(calendarRef,calendarSession.fromSource(session,sessionId));
      for(const item of records)transaction.set(item.ref,{...item.record});
      transaction.set(auditRef,{...auditRecord});
    });
    return{...session,sessionId};
  }

  function finite(value){
    if(value===null||value===undefined||value==='')return null;
    const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;
  }
  async function saveFacultyTarget({target={},auditRecord={}}={}){
    const targetId=text(target.targetId),auditId=text(auditRecord.auditId);
    if(!targetId||!text(target.facultyId)||!text(target.academicYear))throw new RepositoryError('DOE_TARGET_INVALID','DOE Faculty target requires targetId, facultyId, and Academic Year.');
    if(!auditId)throw new RepositoryError('AUDIT_ID_REQUIRED','DOE Faculty target audit requires auditId.');
    const targetRef=collection('targets').doc(targetId),auditRef=collection('audit').doc(auditId);
    if(typeof db.runTransaction!=='function'){
      throw new RepositoryError('ATOMIC_WRITE_REQUIRED','DOE Faculty target persistence requires a Firestore transaction.');
    }
    await db.runTransaction(async tx=>{
      const beforeSnap=await tx.get(targetRef);
      const before=beforeSnap?.exists?rowFromDoc(beforeSnap,'targetId'):null;
      tx.set(targetRef,{...target});
      tx.set(auditRef,{...auditRecord,before,after:{...target}});
    });
    return{...target};
  }

  function calculationQuantity(record={}){
    const entries=Object.entries(record.inputsSnapshot||{}).filter(([,value])=>finite(value)!==null);
    if(!entries.length)return{quantity:null,quantityUnit:''};
    const [key,value]=entries[0];
    const units={hours:'hours',creditedHours:'hours',units:'units',weeks:'weeks',trainees:'trainees',shifts:'shifts'};
    return{quantity:finite(value),quantityUnit:units[key]||key};
  }
  function worksheetLine({row,evidence,category,sourceEntityType,sourceEntityId,lineId,label}={}){
    const sourceDoe=finite(row?.doeCredit??row?.resultDoe),evidenceDoe=finite(evidence?.resultDoe);
    const resultDoe=sourceDoe;
    const policyVersionId=text(row?.doePolicyVersionId||row?.policyVersionId||evidence?.policyVersionId);
    const calculationId=text(row?.doeCalculationId||row?.calculationId||evidence?.calculationId);
    const quantity=calculationQuantity(evidence||{});
    let status='calculated',errorCode='';
    if(sourceDoe===null||!policyVersionId||!calculationId){status='needs_review';errorCode='DOE_SOURCE_PROVENANCE_INCOMPLETE'}
    else if(!evidence){status='needs_review';errorCode='CALCULATION_EVIDENCE_MISSING'}
    else if(evidenceDoe===null||Math.abs(sourceDoe-evidenceDoe)>1e-9){status='error';errorCode='DOE_EVIDENCE_MISMATCH'}
    else if(text(evidence.policyVersionId)!==policyVersionId||text(evidence.ruleId)!==text(row?.doeRuleId||row?.ruleId)||text(evidence.ruleKey)!==text(row?.doeRuleKey||row?.ruleKey)){status='error';errorCode='DOE_PROVENANCE_MISMATCH'}
    return{
      lineId:text(lineId),category:text(evidence?.category||row?.category||category),label:text(row?.label||label),
      sourceEntityType:text(sourceEntityType),sourceEntityId:text(sourceEntityId),assignmentFactId:text(row?.assignmentFactId),roleType:text(row?.roleType),courseCode:text(row?.courseCode||row?.course),subjectKey:text(row?.subjectKey||row?.subject),teachingRole:text(row?.teachingRole),
      resultDoe,policyVersionId,ruleId:text(row?.doeRuleId||row?.ruleId||evidence?.ruleId),ruleKey:text(row?.doeRuleKey||row?.ruleKey||evidence?.ruleKey),
      exceptionId:text(row?.exceptionId||evidence?.exceptionId),calculationId,
      quantity:quantity.quantity,quantityUnit:quantity.quantityUnit,calculationText:text(evidence?.calculationText),
      reference:evidence?.referenceSnapshot?structuredClone(evidence.referenceSnapshot):null,
      calculatedAt:text(evidence?.calculatedAt),status,errorCode
    };
  }

  function composeFacultyWorksheetSource({faculty,id,year,targetRows,assignmentRows,calculationRows,sessions,versionById}){
    const targets=targetRows.filter(row=>text(row.facultyId)===id&&row?.active!==false);
    if(targets.length>1)throw new RepositoryError('DOE_TARGET_AMBIGUOUS','Multiple active DOE target rows exist for the same faculty and Academic Year.',{facultyId:id,academicYear:year});
    let target=targets[0]||null;
    if(!target&&year==='2026-27'){
      const contract=finite(faculty?.doe?.teaching??faculty?.doeTeaching??faculty?.teachingDOE??faculty?.contractTeachingDOE);
      const legacy=faculty?.doeOverride2026_27&&typeof faculty.doeOverride2026_27==='object'?faculty.doeOverride2026_27:null;
      const overrideDoe=finite(legacy?.value);
      target={targetId:'',facultyId:id,academicYear:year,contractTeachingDoe:contract,overrideDoe,overrideReason:text(legacy?.reason),overrideNotes:text(legacy?.notes),effectiveTargetDoe:overrideDoe!==null?overrideDoe:contract,source:overrideDoe!==null?'legacy_override':'legacy_contract',policyVersionId:''};
    }
    target=target||{};
    const evidenceById=new Map(calculationRows.filter(row=>text(row.facultyId)===id).map(row=>[text(row.calculationId),row]));
    const lines=[];
    for(const row of assignmentRows.filter(row=>text(row.facultyId)===id&&row?.active!==false)){
      const calcId=text(row.doeCalculationId||row.calculationId),evidence=evidenceById.get(calcId)||null;
      const assignmentId=text(row.assignmentFactId||row.assignmentId||row.sourceEntityId);
      const role=text(row.roleType||row.teachingRole||row.assignmentType),course=text(row.courseCode||row.course),subject=text(row.subjectKey||row.subject);
      lines.push(worksheetLine({row,evidence,category:row.category||'role',sourceEntityType:text(row.sourceEntityType)||'doe_assignment',sourceEntityId:assignmentId,lineId:assignmentId,label:text(row.label)||[role,course||subject].filter(Boolean).join(' · ')}));
    }
    for(const session of sessions){
      const sessionId=text(session.sessionId),course=text(session.courseCode||session.course);
      for(const [index,assignment] of (Array.isArray(session.assignments)?session.assignments:[]).entries()){
        if(text(assignment?.facultyId||assignment?.ucid)!==id)continue;
        const assignmentId=text(assignment?.assignmentId)||`${sessionId}--assignment--${index+1}`;
        const calcId=text(assignment?.doeCalculationId||assignment?.calculationId),evidence=evidenceById.get(calcId)||null;
        const label=[course,text(assignment?.teachingRole||session.type||session.activityType)].filter(Boolean).join(' ');
        lines.push(worksheetLine({row:assignment,evidence,category:'teaching',sourceEntityType:'session_assignment',sourceEntityId:sessionId,lineId:`${sessionId}--${assignmentId}`,label}));
      }
    }
    const versionIds=[...new Set([text(target.policyVersionId),...lines.map(row=>text(row.policyVersionId))].filter(Boolean))];
    let policyStatus='missing',reservePolicy=null;
    if(versionIds.length>1)policyStatus='mixed';
    else if(versionIds.length===1){
      const version=versionById.get(versionIds[0])||null;
      if(version){policyStatus='single';reservePolicy=version.reservePolicy&&typeof version.reservePolicy==='object'?structuredClone(version.reservePolicy):null}
      else policyStatus='missing_version';
    }
    return{
      facultyId:id,academicYear:year,displayName:text(faculty.preferredFullName||faculty.hrFirstLast||faculty.hrFullName||faculty.name||id),
      stream:text(faculty.academicStream||faculty.stream||faculty.appointmentStream),policyStatus,reservePolicy,
      target:{
        targetId:text(target.targetId),contractTeachingDoe:finite(target.contractTeachingDoe??target.contractTeachingDOE),
        overrideDoe:finite(target.overrideDoe),overrideReason:text(target.overrideReason),overrideNotes:text(target.overrideNotes),
        effectiveTargetDoe:finite(target.effectiveTargetDoe??target.effectiveTargetDOE),source:text(target.source||target.targetSource),policyVersionId:text(target.policyVersionId)
      },
      lines:lines.sort((a,b)=>a.category.localeCompare(b.category)||a.label.localeCompare(b.label)||a.lineId.localeCompare(b.lineId))
    };
  }

  async function loadAnnualWorksheetDataset(academicYear){
    const year=text(academicYear);
    const [targetRows,assignmentRows,calculationRows,sessionSnap]=await Promise.all([
      listWhere('targets','academicYear',year,'targetId'),
      listWhere('assignments','academicYear',year,'assignmentFactId'),
      listWhere('calculations','academicYear',year,'calculationId'),
      collection('sessions').where('academicYear','==',year).get()
    ]);
    const sessions=(sessionSnap.docs||[]).map(doc=>rowFromDoc(doc,'sessionId'));
    const versionIds=new Set();
    const addVersion=value=>{const id=text(value);if(id)versionIds.add(id)};
    targetRows.forEach(row=>addVersion(row.policyVersionId));
    assignmentRows.forEach(row=>addVersion(row.doePolicyVersionId||row.policyVersionId));
    calculationRows.forEach(row=>addVersion(row.policyVersionId));
    sessions.forEach(session=>(session.assignments||[]).forEach(row=>addVersion(row?.doePolicyVersionId||row?.policyVersionId)));
    const versionPairs=await Promise.all([...versionIds].map(async id=>[id,await getVersion(id)]));
    return{year,targetRows,assignmentRows,calculationRows,sessions,versionById:new Map(versionPairs)};
  }

  async function getFacultyWorksheetSource(facultyId,academicYear){
    const id=text(facultyId),year=text(academicYear);
    if(!id||!year)return null;
    const facultySnap=await collection('faculty').doc(id).get();
    if(!facultySnap.exists)return null;
    const faculty=rowFromDoc(facultySnap,'facultyId'),dataset=await loadAnnualWorksheetDataset(year);
    return composeFacultyWorksheetSource({faculty,id,year,...dataset});
  }

  async function listFacultyWorksheetSources(academicYear){
    const year=text(academicYear);if(!year)return[];
    const [facultySnap,dataset]=await Promise.all([collection('faculty').get(),loadAnnualWorksheetDataset(year)]);
    return(facultySnap.docs||[]).map(doc=>rowFromDoc(doc,'facultyId')).filter(row=>row?.active!==false&&text(row.facultyId)).sort((a,b)=>text(a.facultyId).localeCompare(text(b.facultyId))).map(faculty=>composeFacultyWorksheetSource({faculty,id:text(faculty.facultyId),year,...dataset}));
  }

  async function listFacultyIdsForDoe(){
    const snap=await collection('faculty').get();
    return(snap.docs||[]).map(doc=>rowFromDoc(doc,'facultyId')).filter(row=>row?.active!==false).map(row=>text(row.facultyId)).filter(Boolean).sort();
  }

  async function getAnnualReviewState(policyVersionId){
    const version=await getVersion(policyVersionId);
    if(!version)throw new RepositoryError('POLICY_VERSION_NOT_FOUND','DOE policy version was not found.',{policyVersionId:text(policyVersionId)});
    const [rules,references,courseMappings,subjectMappings]=await Promise.all([
      listRules(policyVersionId),listReferencesForVersion(policyVersionId),
      listCourseMappings(version.academicYear,policyVersionId),listSubjectMappings(version.academicYear,policyVersionId)
    ]);
    const item=row=>({id:text(row.ruleId||row.referenceId||row.mappingId),reviewStatus:text(row.reviewStatus)||'needs_review'});
    return{
      policyVersionId:text(policyVersionId),academicYear:text(version.academicYear),
      rules:rules.map(item),references:references.map(item),courseMappings:courseMappings.map(item),subjectMappings:subjectMappings.map(item)
    };
  }

  return Object.freeze({
    getPolicyForYear,getVersion,getFacultyRecord,listRules,listExceptions,getActivePolicyBundle,getPolicyBundleByVersion,getReference,getSession,
    listCourseMappings,listSubjectMappings,getCourseMapping,getSubjectMapping,
    saveDraftReference,saveDraftCourseMapping,saveDraftSubjectMapping,saveDraftReservePolicy,saveFacultyTarget,createCalculationRecord,saveDoeAssignmentCalculation,getDoeAssignment,listFacultyRoleAssignments,deactivateDoeAssignment,saveSessionCalculationBundle,getAnnualReviewState,
    createPolicyYearDraft,loadAnnualValidationDataset,saveAnnualValidationResult,getFacultyWorksheetSource,listFacultyWorksheetSources,listFacultyIdsForDoe
  });
}

module.exports={COLLECTIONS,RepositoryError,createRepository};
