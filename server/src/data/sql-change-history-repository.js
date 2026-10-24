'use strict';

// UTC bounds on Dashboard queries are supplied by the server, never the browser.
const STRICT_UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function createSqlChangeHistoryRepository(db){
 return Object.freeze({
  list:({actorFirebaseUid,scope,start,end,startUtc,endUtc})=>{
   const dashboard=scope==='dashboard';
   if(dashboard&&(!STRICT_UTC.test(startUtc||'')||!STRICT_UTC.test(endUtc||'')||startUtc>=endUtc))
    throw Error('Dashboard History requires valid server-enforced UTC bounds.');
   return db.transaction(()=>db.query(
    'EXEC paws_api.ListChangeHistoryEvents @ActorFirebaseUid=@ActorFirebaseUid,@Scope=@Scope,@StartUtc=@StartUtc,@EndExclusiveUtc=@EndExclusiveUtc',
    {ActorFirebaseUid:actorFirebaseUid,Scope:scope,
     StartUtc:dashboard?startUtc:start+'T00:00:00.000Z',
     EndExclusiveUtc:dashboard?endUtc:end+'T00:00:00.000Z'}
   ));
  }
 });
}
module.exports={createSqlChangeHistoryRepository};
