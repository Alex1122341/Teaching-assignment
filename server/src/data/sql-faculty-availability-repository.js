'use strict';
function createSqlFacultyAvailabilityRepository(db){
 if(typeof db?.query!=='function')throw new TypeError('SQL query required.');
 return Object.freeze({
  async list({actorFirebaseUid,facultyId,mode,startDate,endDate,kind,cursor,limit}){
   const rows=await db.query(
    'EXEC paws_api.ListFacultyAvailability @ActorFirebaseUid=@actorFirebaseUid, @FacultyId=@facultyId, @Mode=@mode, @StartDate=@startDate, @EndDate=@endDate, @Kind=@kind, @Cursor=@cursor, @Limit=@limit',
    {actorFirebaseUid,facultyId,mode,startDate,endDate,kind,cursor,limit}
   );
   let result;try{result=JSON.parse(rows[0]?.responseJson);}catch(_){throw Error('Invalid availability SQL response.');}
   if(!result||!Array.isArray(result.items))throw Error('Invalid availability SQL response.');
   return result;
  }
 });
}
module.exports={createSqlFacultyAvailabilityRepository};
