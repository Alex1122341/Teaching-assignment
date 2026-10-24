'use strict';
const {createTraineeService}=require('../trainees/trainee-service');
const {createWorksheetService}=require('../doe/doe-worksheet-service');
const {createSqlDoeWorksheetRepository}=require('./sql-doe-worksheet-repository');
const {isAdministratorRole}=require('../auth/role-policy');
function createSqlTraineeRepository(db,{worksheetService=createWorksheetService({repository:createSqlDoeWorksheetRepository(db)}),service=createTraineeService()}={}){
 async function dataset({actorFirebaseUid,academicYear,query='',category=null,expectedScope}){
  const [record]=await db.query('EXEC paws_api.ListTraineeSource @ActorFirebaseUid=@ActorFirebaseUid,@AcademicYear=@AcademicYear,@Query=@Query,@Category=@Category,@ExpectedRole=@ExpectedRole,@ExpectedFacultyId=@ExpectedFacultyId',{ActorFirebaseUid:actorFirebaseUid,AcademicYear:academicYear,Query:query,Category:category,ExpectedRole:expectedScope?.role??null,ExpectedFacultyId:expectedScope?.facultyId??null});
  const data=JSON.parse(record?.responseJson);
  if(!data||!Array.isArray(data.rows)||data.rows.length>500||!data.scope)throw Error('Invalid trainee dataset.');
  if(data.scope.actorUid!==actorFirebaseUid||Boolean(data.scope.administrator)!==isAdministratorRole(data.scope.role)||!isAdministratorRole(data.scope.role)&&data.rows.some(r=>String(r.facultyId).toLowerCase()!==String(data.scope.facultyId).toLowerCase()))throw Object.assign(Error('Invalid trainee scope.'),{code:'TRAINEE_SCOPE_INVALID'});
  if(!data.rows.length)return data;
  let doe;
  if(data.scope.administrator===true)doe=await worksheetService.listFacultyDoe({academicYear});
  else{
   const own=await worksheetService.buildFacultyWorksheet({facultyId:data.scope.facultyId,academicYear});
   doe=[{facultyId:data.scope.facultyId,supervisionLineCount:own.sections?.supervision?.lines?.length||0,...own.totals}];
  }
  const map=new Map(doe.map(r=>[String(r.facultyId).toLowerCase(),r]));
  data.rows=data.rows.map(r=>{const worksheet=map.get(String(r.facultyId).toLowerCase()),available=r.currentRawDoe!=null||worksheet?.supervisionLineCount>0;return {...r,currentRawDoe:available?worksheet?.rawSupervisionDoe??r.currentRawDoe:null,currentAppliedDoe:available?worksheet?.appliedSupervisionDoe??null:null};});
  return data;
 }
 return Object.freeze({
  async listTrainees(p){return service.page({dataset:await dataset(p),...p});},
  async exportTrainees(p){const data=await dataset(p);return service.csv(data.rows,{academicYear:p.academicYear});}
 });
}
module.exports={createSqlTraineeRepository};
