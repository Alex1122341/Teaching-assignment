'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {toTrustedCccRows}=require('./ccc-master-adapter.cjs');
const {createSqlCccReplacementRepository}=require('../../server/src/data/sql-ccc-replacement-repository');
const {academicBounds}=require('../../server/src/master-refresh/master-source-domain');
const {createWriteGates}=require('../../server/src/data/write-gates');
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/i.test(v);
const invalid=()=>Object.assign(Error('Invalid trusted CCC command.'),{code:'INVALID_MASTER_CLI'});
async function runCcc(o,{open,env=process.env}){
 const mode=o.mode,allowed={CccPlan:['sourcePath'],CccStage:['sourcePath','workbookPath','actorFirebaseUid','requestId'],CccPreview:['batchId','expectedVersion','actorFirebaseUid'],CccApply:['batchId','academicYear','expectedVersion','manifestSha256','sourceSha256','idempotencyKey','actorFirebaseUid','confirm','completeDataset'],CccRecover:['receiptId','actorFirebaseUid','confirm']};
 if(!allowed[mode]||o.domain!=='ccc'||!o.outputPath||Object.keys(o).some(k=>!['mode','domain','outputPath',...allowed[mode]].includes(k)))throw invalid();
 if(mode!=='CccPlan'&&(typeof o.actorFirebaseUid!=='string'||!o.actorFirebaseUid||o.actorFirebaseUid.length>128||/[\x00-\x1f]/.test(o.actorFirebaseUid)))throw invalid();
 if(mode==='CccStage'&&(!id(o.requestId)||!o.workbookPath)||['CccPreview','CccApply'].includes(mode)&&(!id(o.batchId)||typeof o.expectedVersion!=='string'||!/^[0-9a-f]{16}$/i.test(o.expectedVersion))||mode==='CccRecover'&&(!id(o.receiptId)||o.confirm!==true))throw invalid();
 if(mode==='CccApply'){academicBounds(o.academicYear);if(!sha(o.manifestSha256)||!sha(o.sourceSha256)||!id(o.idempotencyKey)||o.confirm!==true||o.completeDataset!==true)throw invalid();}
 const gates=createWriteGates(env);
 if(['CccStage','CccPreview'].includes(mode)&&!gates.cccReplaceStage||['CccApply','CccRecover'].includes(mode)&&!gates.cccReplaceCommit)throw Object.assign(Error('CCC operation gate is closed.'),{code:'WRITE_DISABLED'});
 let parsed,byteLength;
 if(['CccPlan','CccStage'].includes(mode)){
  parsed=toTrustedCccRows(JSON.parse(await fs.readFile(o.sourcePath,'utf8')));
  if(mode==='CccStage'){
   const stat=await fs.stat(o.workbookPath);if(stat.size<1||stat.size>16*1024*1024)throw invalid();
   const bytes=await fs.readFile(o.workbookPath);byteLength=bytes.length;
   if(byteLength!==stat.size||createHash('sha256').update(bytes).digest('hex').toUpperCase()!==parsed.sourceSha256.toUpperCase())throw Object.assign(Error('Original MASTER workbook hash changed.'),{code:'SOURCE_HASH_MISMATCH'});
  }
 }
 const output=await fs.open(o.outputPath,'wx',0o600);let db;
 try{
  let result;
  if(mode==='CccPlan')result={...parsed,mode:'Plan',databaseWrites:false};
  else{
   db=await open();const repository=createSqlCccReplacementRepository(db);
   if(mode==='CccStage')result=await repository.stageTrustedMaster({actorFirebaseUid:o.actorFirebaseUid,requestId:o.requestId,fileName:path.basename(o.workbookPath),byteLength,parsed});
   if(mode==='CccPreview')result=await repository.preview({actorFirebaseUid:o.actorFirebaseUid,batchId:o.batchId,expectedVersion:o.expectedVersion});
   if(mode==='CccApply'){
    const {mode,domain,outputPath,...request}=o;result=await repository.commit({...request,dataset:'ccc-calendar'});
    const [receipt]=await db.query('SELECT ReceiptId receiptId,AcademicYear academicYear,SourceSha256 sourceSha256,ManifestSha256 manifestSha256,BeforeRowsJson beforeRowsJson,AfterScopeJson afterScopeJson,DeletedCount deletedCount,InsertedCount insertedCount FROM paws.CccReplacementReceipt WHERE ReceiptId=@receiptId',{receiptId:result.receiptId});
    if(!receipt||receipt.academicYear!==o.academicYear||receipt.sourceSha256.toUpperCase()!==o.sourceSha256.toUpperCase()||receipt.manifestSha256.toUpperCase()!==o.manifestSha256.toUpperCase())throw Object.assign(Error('CCC receipt export verification failed.'),{code:'CCC_RECEIPT_EXPORT_FAILED'});
    result={...result,privateRecoveryReceipt:receipt};
   }
   if(mode==='CccRecover')result=await repository.recover({actorFirebaseUid:o.actorFirebaseUid,receiptId:o.receiptId,confirm:true});
  }
  await output.writeFile(JSON.stringify(result,null,2));await output.sync();return result;
 }catch(e){await output.writeFile(JSON.stringify({mode,status:'failed',code:e.code||'CCC_COMMAND_FAILED',idempotencyKey:o.idempotencyKey}));throw e;}
 finally{await output.close();if(db)await db.close();}
}
module.exports={runCcc};
