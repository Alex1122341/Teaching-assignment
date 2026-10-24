'use strict';
function createSqlMasterRefreshRepository(db){
 if(typeof db?.query!=='function')throw new TypeError('A SQL query adapter is required.');
 async function exec(name,params){
  const rows=await db.query(`EXEC paws_api.${name} ${Object.keys(params).map(k=>`@${k}=@${k}`).join(',')}`,params);
  try{const r=JSON.parse(rows[0]?.responseJson);if(!r||typeof r!=='object'||Array.isArray(r))throw Error();return r;}
  catch(_){throw Object.assign(new Error('Invalid MASTER refresh response.'),{code:'INVALID_MASTER_REFRESH_RESPONSE'});}
 }
 return Object.freeze({
  async loadDoeContext({academicYear,candidatePolicyVersionId}){
   const read=async()=>{
    const snapshot=async()=>{const [r]=await db.query("SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',paws_api.MasterRefreshSnapshot(@academicYear)),2) contextHash",{academicYear});return r?.contextHash;};
    const contextHash=await snapshot();
    const currentRoles=await db.query(`SELECT RoleAssignmentId roleId,FacultyId facultyId,RoleType roleType,CourseOrSubjectOrRotation scope,
      CourseName courseName,Details details,DoeMappedValue mappedDoe,DoeOverrideValue overrideDoe,DoeOverrideReason overrideReason,SpecialNotes notes,
      (SELECT f.Units units,f.Weeks weeks,f.SubjectCount subjectCount,f.UniqueRotationTypes uniqueRotationTypes,f.Shifts shifts,f.HalfDayDeduction halfDayDeduction FROM paws.vMasterRoleFacts f WHERE f.RoleAssignmentId=paws.RoleAssignment.RoleAssignmentId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) sourceFactsJson
      FROM paws.RoleAssignment WHERE AcademicYear=@academicYear ORDER BY RoleAssignmentId`,{academicYear});
    const supervision=await db.query('SELECT SnapshotId snapshotId,FacultyId facultyId,RawDoe rawDoe,EvidenceJson evidenceJson,SourceReference sourceReference,SourceSha256 sourceSha256 FROM paws.DoeSupervisionSourceSnapshot WHERE AcademicYear=@academicYear ORDER BY SnapshotId',{academicYear});
    const {createSqlDoeEngineRepository}=require('./sql-doe-engine-repository');
    const activeBundle=await createSqlDoeEngineRepository(db).loadActivePolicy(academicYear);
    let candidateBundle=activeBundle;
    if(candidatePolicyVersionId){const {createSqlDoePolicyRepository}=require('./sql-doe-policy-repository');candidateBundle=await createSqlDoePolicyRepository(db).getPolicyVersion(candidatePolicyVersionId);}
    const {createSqlDoeWorksheetRepository}=require('./sql-doe-worksheet-repository');
    const worksheetSources=await createSqlDoeWorksheetRepository(db).listFacultyWorksheetSources(academicYear);
    if(!contextHash||contextHash!==await snapshot())throw Object.assign(Error('DOE source changed during comparison.'),{code:'MASTER_DOE_CONTEXT_CHANGED'});
    return{currentRoles,supervision,worksheetSources,activeBundle,candidateBundle,contextHash};
   };
   return typeof db.transaction==='function'&&!db.isTransactionActive?.()?db.transaction(read):read();
  },
  preview:({domain,academicYear,source,actorFirebaseUid,doeGuard})=>exec('PreviewMasterRefresh',{Domain:domain,AcademicYear:academicYear,SourceJson:JSON.stringify(source),ActorFirebaseUid:actorFirebaseUid,DoeGuardJson:doeGuard?JSON.stringify(doeGuard):null}),
  apply:({domain,batchId,expectedVersion,manifestSha256,sourceSha256,idempotencyKey,actorFirebaseUid,confirm})=>exec('CommitMasterRefresh',{Domain:domain,BatchId:batchId,ExpectedVersion:expectedVersion,ManifestSha256:manifestSha256,SourceSha256:sourceSha256,IdempotencyKey:idempotencyKey,ActorFirebaseUid:actorFirebaseUid,Confirm:confirm}),
  recover:({receiptId,actorFirebaseUid,confirm})=>exec('RecoverMasterRefresh',{ReceiptId:receiptId,ActorFirebaseUid:actorFirebaseUid,Confirm:confirm})
 });
}
module.exports={createSqlMasterRefreshRepository};
