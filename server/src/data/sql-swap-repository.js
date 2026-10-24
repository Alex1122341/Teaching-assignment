'use strict';
function createSqlSwapRepository(db){
  const exec=async(name,args)=>{
    const rows=await db.query(`EXEC paws_api.${name} ${Object.keys(args).map(key=>`@${key}=@${key}`).join(',')}`,args);
    const body=rows[0]?.responseJson?JSON.parse(rows[0].responseJson):null;
    if(body?.unavailableReasons)body.unavailableReasons=body.unavailableReasons.map(row=>typeof row==='string'?row:row.reason);
    return body;
  };
  return Object.freeze({
    facultyPreviewContext:({actorFirebaseUid,sessionId,assignmentId,candidateKey,snapshotToken})=>exec('GetAdfaSwapFacultyPreview',{
      ActorFirebaseUid:actorFirebaseUid,SessionId:sessionId,AssignmentId:assignmentId,CandidateKey:candidateKey||null,ExpectedSnapshot:snapshotToken
    }),
    async context({actorFirebaseUid,sessionId}){
      const body=await exec('GetSessionSwapContext',{ActorFirebaseUid:actorFirebaseUid,SessionId:sessionId});
      if(body&&Array.isArray(body.candidates))body.candidates=body.candidates.map(candidate=>{
        const status=candidate.availabilityStatus==null?(candidate.available===true?'Available':'Unavailable'):
          ['Available','Unavailable','Needs Review'].includes(candidate.availabilityStatus)?candidate.availabilityStatus:'Needs Review';
        return {candidateKey:candidate.candidateKey,displayName:candidate.displayName,availabilityStatus:status,
          available:status==='Available'&&candidate.available===true,notifyAvailable:candidate.notifyAvailable===true,
          notifyUnavailableReason:candidate.notifyUnavailableReason??null};
      });
      return body;
    },
    queue:({actorFirebaseUid})=>exec('GetSessionSwapQueue',{ActorFirebaseUid:actorFirebaseUid}),
    detail:({actorFirebaseUid,requestId})=>exec('GetSessionSwap',{ActorFirebaseUid:actorFirebaseUid,RequestId:requestId}),
    create:({actorFirebaseUid,payload})=>exec('SaveSessionSwap',{ActorFirebaseUid:actorFirebaseUid,PayloadJson:JSON.stringify(payload),Revise:0}),
    revise:({actorFirebaseUid,requestId,payload})=>exec('SaveSessionSwap',{ActorFirebaseUid:actorFirebaseUid,PayloadJson:JSON.stringify({...payload,requestId}),Revise:1}),
    decide:({actorFirebaseUid,requestId,payload,applyEnabled})=>exec('DecideSessionSwap',{ActorFirebaseUid:actorFirebaseUid,RequestId:requestId,ExpectedRevision:payload.expectedRevision,Decision:payload.decision,Comment:payload.comment||null,OverrideReason:payload.overrideReason||null,ApplyEnabled:applyEnabled?1:0}),
    withdraw:({actorFirebaseUid,requestId,payload})=>exec('WithdrawSessionSwap',{ActorFirebaseUid:actorFirebaseUid,RequestId:requestId,ExpectedRevision:payload.expectedRevision,Comment:payload.comment||null})
  });
}
module.exports={createSqlSwapRepository};
