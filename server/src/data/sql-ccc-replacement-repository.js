'use strict';
function createSqlCccReplacementRepository(db,{importDb=db}={}){
 async function exec(name,params){
  const rows=await importDb.query('EXEC paws_api.'+name+' '+Object.keys(params).map(key=>'@'+key+'=@'+key).join(','),params);
  const result=JSON.parse(rows[0]?.responseJson);if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid CCC response');return result;
 }
 return Object.freeze({
  stage:({actorFirebaseUid,requestId,fileName,byteLength,parsed})=>exec('StageCccReplacement',{ActorFirebaseUid:actorFirebaseUid,RequestId:requestId,SourceSha256:parsed.sourceSha256,AcademicYear:parsed.academicYear,FileName:fileName,ByteLength:byteLength,RowsJson:JSON.stringify(parsed.rows)}),
  stageTrustedMaster:({actorFirebaseUid,requestId,fileName,byteLength,parsed})=>exec('StageMasterCccReplacement',{ActorFirebaseUid:actorFirebaseUid,RequestId:requestId,FileName:fileName,ByteLength:byteLength,PayloadJson:JSON.stringify(parsed)}),
  get:({actorFirebaseUid,batchId})=>exec('GetCccReplacement',{ActorFirebaseUid:actorFirebaseUid,ImportBatchId:batchId}),
  preview:({actorFirebaseUid,batchId,expectedVersion})=>exec('PreviewCccReplacement',{ActorFirebaseUid:actorFirebaseUid,ImportBatchId:batchId,ExpectedVersion:expectedVersion}),
  recover:({actorFirebaseUid,receiptId,confirm})=>exec('RecoverCccReplacement',{ActorFirebaseUid:actorFirebaseUid,ReceiptId:receiptId,Confirm:confirm}),
  commit:({actorFirebaseUid,batchId,academicYear,dataset,expectedVersion,manifestSha256,sourceSha256,idempotencyKey,confirm,completeDataset})=>exec('CommitCccReplacement',{ActorFirebaseUid:actorFirebaseUid,ImportBatchId:batchId,AcademicYear:academicYear,Dataset:dataset,ExpectedVersion:expectedVersion,ManifestSha256:manifestSha256,SourceSha256:sourceSha256,IdempotencyKey:idempotencyKey,Confirm:confirm,CompleteDataset:completeDataset})
 });
}
module.exports={createSqlCccReplacementRepository};
