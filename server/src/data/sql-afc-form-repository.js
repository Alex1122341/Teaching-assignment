'use strict';
function createSqlAfcFormRepository(db){
 async function exec(name,params,binary=false){
  const rows=await db.query('EXEC paws_api.'+name+' '+Object.keys(params).map(k=>'@'+k+'=@'+k).join(','),params);
  const metadata=JSON.parse(rows[0]?.responseJson);if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw Error('Invalid AFC form response');
  return binary?{...metadata,pdfBytes:rows[0].pdfBytes}:metadata;
 }
 return Object.freeze({
  upload:({actorFirebaseUid,facultyId,requestId,fileName,pdfBytes,sha256,pageCount})=>exec('UploadAfcForm',{ActorFirebaseUid:actorFirebaseUid,FacultyId:facultyId,RequestId:requestId,FileName:fileName,PdfBytes:pdfBytes,PdfSha256:sha256,PageCount:pageCount}),
  list:({actorFirebaseUid,facultyId,cursor=null,limit=25})=>exec('ListAfcForms',{ActorFirebaseUid:actorFirebaseUid,FacultyId:facultyId,Cursor:cursor,Limit:limit}),
  get:({actorFirebaseUid,documentId})=>exec('GetAfcForm',{ActorFirebaseUid:actorFirebaseUid,DocumentId:documentId},true)
 });
}
module.exports={createSqlAfcFormRepository};
