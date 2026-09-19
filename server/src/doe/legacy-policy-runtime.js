'use strict';
const text=value=>String(value??'').trim();
const finite=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null};

function buildImpactDataset(data={},academicYear=''){
  const year=text(academicYear),calculations=[],scheduledByFaculty=new Map();
  for(const session of Array.isArray(data.sessions)?data.sessions:[]){
    if(year&&text(session?.academicYear)&&text(session.academicYear)!==year)continue;
    const sessionId=text(session?.id||session?.sessionId);
    for(const [index,assignment] of (Array.isArray(session?.assignments)?session.assignments:[]).entries()){
      const facultyId=text(assignment?.facultyId||assignment?.ucid);if(!facultyId)continue;
      const assignmentId=text(assignment?.assignmentId)||`${sessionId||'session'}--assignment--${index+1}`;
      const currentDoe=finite(assignment?.doeCredit);
      if(currentDoe!==null)scheduledByFaculty.set(facultyId,(scheduledByFaculty.get(facultyId)||0)+currentDoe);
      calculations.push({
        sourceEntityType:'session_assignment',sourceEntityId:sessionId||assignmentId,sessionId,assignmentId,facultyId,currentDoe,
        currentPolicyVersionId:text(assignment?.doePolicyVersionId),
        context:{
          category:'teaching',activityType:text(assignment?.activityType||session?.type||session?.activityType),
          teachingRole:text(assignment?.teachingRole||assignment?.role),role:text(assignment?.role||assignment?.teachingRole),
          hours:finite(assignment?.creditedHours),shifts:finite(assignment?.shifts)??1,course:text(assignment?.courseCode||session?.courseCode||session?.course),
          date:text(session?.date),topic:text(session?.topic),semester:text(session?.semester),week:finite(session?.week)
        }
      });
    }
  }
  for(const assignment of Array.isArray(data.assignments)?data.assignments:[]){
    if(year&&text(assignment?.academicYear)!==year)continue;
    if(assignment?.active===false)continue;
    const id=text(assignment?.assignmentFactId||assignment?.assignmentId||assignment?.sourceEntityId),facultyId=text(assignment?.facultyId);
    if(!id||!facultyId)continue;
    calculations.push({
      sourceEntityType:'doe_assignment',sourceEntityId:id,assignmentId:id,facultyId,currentDoe:finite(assignment?.doeCredit),
      currentPolicyVersionId:text(assignment?.doePolicyVersionId),
      context:{...assignment,academicYear:year,category:text(assignment?.category||'role'),course:text(assignment?.courseCode||assignment?.course)}
    });
  }
  for(const person of Array.isArray(data.faculty)?data.faculty:[]){
    const facultyId=text(person?.__id||person?.facultyId||person?.ucid||person?.id);if(!facultyId)continue;
    const summary=person?.facultySummary2026_27&&typeof person.facultySummary2026_27==='object'?person.facultySummary2026_27:{};
    const fixed=finite(summary.sourceNonTimetableTeachingDOE),sourceAssigned=finite(summary.assignedTeachingDOE);
    const reconciliation=fixed!==null?fixed:(sourceAssigned!==null?sourceAssigned-(scheduledByFaculty.get(facultyId)||0):null);
    if(reconciliation!==null){
      const assignmentId=`${facultyId}--source-non-timetable-teaching`;
      calculations.push({
        sourceEntityType:'source_reconciliation',sourceEntityId:assignmentId,assignmentId,facultyId,currentDoe:reconciliation,
        currentPolicyVersionId:text(summary.sourceNonTimetableTeachingDOEPolicyVersionId),
        context:{category:'teaching',activityType:'SOURCE_RECONCILIATION',teachingRole:'Source Reconciliation',assignment:'Source non-timetable teaching DOE'}
      });
    }
    for(const [index,managed] of (Array.isArray(person?.managedRoles2026_27)?person.managedRoles2026_27:[]).entries()){
      const credit=Math.abs(finite(managed?.doeCredit)??0);
      if(!credit&&!text(managed?.assignment)&&!text(managed?.type))continue;
      const signed=text(managed?.action).toLowerCase()==='remove'?-credit:credit,assignmentId=`${facultyId}--managed-role--${index+1}`;
      calculations.push({
        sourceEntityType:'managed_role',sourceEntityId:assignmentId,assignmentId,facultyId,currentDoe:signed,
        currentPolicyVersionId:text(managed?.doePolicyVersionId),
        context:{category:'role',roleType:text(managed?.type),assignment:text(managed?.assignment),action:text(managed?.action)||'add'}
      });
    }
  }
  return{academicYear:year,calculations};
}

function sourceOrdinal(sourceEntityId,label){
  const match=text(sourceEntityId).match(new RegExp(`--${label}--(\\d+)$`));return match?Number(match[1])-1:-1;
}

function provenance(row,record){
  return{doeCredit:Number(row.resultDoe),doePolicyVersionId:text(row.policyVersionId),doeRuleId:text(row.ruleId),doeRuleKey:text(row.ruleKey),doeCalculationId:text(record?.calculationId)};
}

function applyRecalculationRowsToSource(source={},rows=[],calculationRecords=[]){
  const next={...source};
  if(Array.isArray(source.assignments))next.assignments=source.assignments.map(row=>({...row}));
  if(Array.isArray(source.managedRoles2026_27))next.managedRoles2026_27=source.managedRoles2026_27.map(row=>({...row}));
  if(source.facultySummary2026_27&&typeof source.facultySummary2026_27==='object')next.facultySummary2026_27={...source.facultySummary2026_27};
  rows.forEach((row,index)=>{
    const fields=provenance(row,calculationRecords[index]);
    if(row.sourceEntityType==='doe_assignment'){Object.assign(next,fields);return}
    if(row.sourceEntityType==='session_assignment'){
      let at=text(row.assignmentId)?(next.assignments||[]).findIndex(item=>text(item?.assignmentId)===text(row.assignmentId)):-1;
      if(at<0)at=sourceOrdinal(row.sourceEntityId,'assignment');
      if(at<0||at>=(next.assignments||[]).length)throw Object.assign(Error('DOE recalculation could not locate the source session assignment.'),{code:'RECALCULATION_SOURCE_NOT_FOUND'});
      next.assignments[at]={...next.assignments[at],...fields};return;
    }
    if(row.sourceEntityType==='managed_role'){
      const at=sourceOrdinal(row.sourceEntityId,'managed-role');
      if(at<0||at>=(next.managedRoles2026_27||[]).length)throw Object.assign(Error('DOE recalculation could not locate the source managed role.'),{code:'RECALCULATION_SOURCE_NOT_FOUND'});
      next.managedRoles2026_27[at]={...next.managedRoles2026_27[at],...fields};return;
    }
    if(row.sourceEntityType==='source_reconciliation'){
      const summary={...(next.facultySummary2026_27||{})};
      summary.sourceNonTimetableTeachingDOE=Number(row.resultDoe);
      summary.sourceNonTimetableTeachingDOEPolicyVersionId=text(row.policyVersionId);
      summary.sourceNonTimetableTeachingDOERuleId=text(row.ruleId);
      summary.sourceNonTimetableTeachingDOERuleKey=text(row.ruleKey);
      summary.sourceNonTimetableTeachingDOECalculationId=text(calculationRecords[index]?.calculationId);
      next.facultySummary2026_27=summary;return;
    }
    throw Object.assign(Error(`Unsupported DOE recalculation source type: ${text(row.sourceEntityType)||'unknown'}`),{code:'RECALCULATION_SOURCE_UNSUPPORTED'});
  });
  return next;
}

async function loadRows(db,collectionName,field='',value=''){
  let query=db.collection(collectionName);if(field)query=query.where(field,'==',value);
  const snap=await query.get();return(snap.docs||[]).map(doc=>({id:String(doc.id),...doc.data()}));
}

function createDatasetProvider({db}={}){
  if(!db?.collection)throw new Error('Firestore db is required.');
  return async bundle=>{
    const year=text(bundle?.version?.academicYear);
    const [sessions,faculty,assignments]=await Promise.all([
      loadRows(db,'sessions','academicYear',year),loadRows(db,'faculty'),loadRows(db,'doe_assignments','academicYear',year)
    ]);
    return buildImpactDataset({sessions,faculty,assignments},year);
  };
}

function createRecalculationWriter({db,repository,clock=()=>new Date()}={}){
  if(!db?.collection)throw new Error('Firestore database is required.');
  if(!repository?.stageCalculationRecord)throw new Error('DOE calculation staging repository is required.');
  const stamp=()=>{const v=clock();return(v instanceof Date?v:new Date(v)).toISOString()};
  return async payload=>{
    const groups=new Map();
    for(const [index,row] of (payload.rows||[]).entries()){
      const type=text(row.sourceEntityType);
      const collection=type==='session_assignment'?'sessions':type==='doe_assignment'?'doe_assignments':'faculty';
      const id=type==='session_assignment'?text(row.sessionId):type==='doe_assignment'?text(row.sourceEntityId):text(row.facultyId);
      if(!id)throw Object.assign(Error('DOE recalculation source document ID is required.'),{code:'RECALCULATION_SOURCE_NOT_FOUND'});
      const key=`${collection}/${id}`;if(!groups.has(key))groups.set(key,{collection,id,rows:[],records:[]});
      groups.get(key).rows.push(row);groups.get(key).records.push((payload.calculationRecords||[])[index]);
    }
    const loaded=[];
    for(const group of groups.values()){
      const ref=db.collection(group.collection).doc(group.id),snap=await ref.get();
      if(!snap.exists)throw Object.assign(Error(`DOE recalculation source ${group.collection}/${group.id} was not found.`),{code:'RECALCULATION_SOURCE_NOT_FOUND'});
      loaded.push({...group,ref,source:snap.data()});
    }
    if(typeof db.batch!=='function')throw new Error('Firestore batch writes are required for DOE recalculation.');
    const when=stamp(),batch=db.batch(),actor=payload.actor||{};
    for(const group of loaded){
      const next=applyRecalculationRowsToSource(group.source,group.rows,group.records);
      Object.assign(next,{doeRecalculationBatchId:text(payload.batchId),doeRecalculationPolicyVersionId:text(payload.policyVersionId),doeRecalculatedBy:text(actor.uid),doeRecalculatedAt:when,updatedBy:text(actor.uid),updatedByName:text(actor.name),updatedAt:when});
      batch.set(group.ref,next);
    }
    for(const record of payload.calculationRecords||[])repository.stageCalculationRecord(batch,record);
    batch.set(db.collection('doe_recalculation_batches').doc(text(payload.batchId)),{recalculationBatchId:text(payload.batchId),academicYear:text(payload.academicYear),policyVersionId:text(payload.policyVersionId),status:'running',completedRows:Number(payload.end||0),totalRows:Number(payload.totalRows||0),changedBy:text(actor.uid),changedByName:text(actor.name),updatedAt:when},{merge:true});
    await batch.commit();
  };
}

module.exports={buildImpactDataset,applyRecalculationRowsToSource,createDatasetProvider,createRecalculationWriter};
