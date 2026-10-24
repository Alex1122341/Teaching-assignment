'use strict';
function createSqlCccScheduleRepository(db){
 if(typeof db?.query!=='function')throw new TypeError('SQL query required.');
 return Object.freeze({
  async list({actorFirebaseUid,academicYear}){
   const rows=await db.query(
    'EXEC paws_api.ListCccSchedule @ActorFirebaseUid=@actorFirebaseUid, @AcademicYear=@academicYear',
    {actorFirebaseUid,academicYear}
   );
   let result;try{result=JSON.parse(rows[0]?.responseJson);}catch(_){throw Error('Invalid CCC SQL response.');}
   if(!result||!Array.isArray(result.entries))throw Error('Invalid CCC SQL response.');
   return {entries:result.entries};
  }
 });
}
module.exports={createSqlCccScheduleRepository};
