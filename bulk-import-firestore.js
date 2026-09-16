(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UCVM_BULK_IMPORT_FIRESTORE=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  function create({db,firebase}){
    if(!db)throw Error('Firestore database is required.');
    const FieldValue=firebase?.firestore?.FieldValue;
    if(!FieldValue?.serverTimestamp||!FieldValue?.delete)throw Error('Firebase Firestore FieldValue helpers are required.');
    const stamp=()=>FieldValue.serverTimestamp();
    const fieldDelete=()=>FieldValue.delete();
    const systemRef=()=>db.collection('settings').doc('system_state');
    const jobRef=importId=>db.collection('bulk_import_jobs').doc(String(importId));
    const facultyRef=id=>db.collection('faculty').doc(String(id));
    const sessionRef=id=>db.collection('sessions').doc(String(id));
    const summarySettingsRef=()=>db.collection('settings').doc('faculty_summary_2026_27');
    const staleRef=(importId,index)=>jobRef(importId).collection('stale_batches').doc(String(index).padStart(6,'0'));
    const restoreDeleteRef=(importId,index)=>jobRef(importId).collection('restore_delete_batches').doc(String(index).padStart(6,'0'));
    const eventRef=importId=>jobRef(importId).collection('events').doc();
    const dataOf=snap=>snap&&snap.exists?snap.data():null;

    async function loadSystemState(){const snap=await systemRef().get();return dataOf(snap)}
    async function loadJob(importId){if(!importId)return null;const snap=await jobRef(importId).get();return snap.exists?{importId:String(importId),...snap.data()}:null}
    async function findActiveJob(){const state=await loadSystemState(),importId=String(state?.activeImportId||'').trim();if(!importId)return null;return{state,job:await loadJob(importId)}}

    async function acquireImport({importId,job={},actor={},mode='bulk_import'}){
      importId=String(importId||'').trim();if(!importId)throw Error('Import ID is required.');const now=stamp();
      await db.runTransaction(async transaction=>{
        const stateSnap=await transaction.get(systemRef()),state=stateSnap.exists?stateSnap.data():{};
        if(state?.teachingDataWriteLocked===true)throw Error(`Teaching data maintenance is already active${state.activeImportId?` (${state.activeImportId})`:''}.`);
        transaction.set(jobRef(importId),{...job,importId,status:job.status||'APPLYING',phase:job.phase||'APPLYING_FACULTY',startedBy:String(actor?.uid||job.startedBy||''),startedByName:String(actor?.name||job.startedByName||''),startedAt:job.startedAt||now,lastUpdatedAt:now});
        transaction.set(systemRef(),{teachingDataWriteLocked:true,maintenanceMode:String(mode||'bulk_import'),activeImportId:importId,maintenanceOwnerUid:String(actor?.uid||''),maintenanceOwnerName:String(actor?.name||''),maintenanceStartedAt:now},{merge:true});
      });
      return loadJob(importId);
    }

    function checkpointPatch(phase,field,batchIndex,total){return{status:'APPLYING',phase,[field]:Number(batchIndex)+1,[field.replace('Completed','Total')]:Number(total),lastUpdatedAt:stamp()}}

    async function commitFacultyBatch({importId,batchIndex,total,writes=[]}){const batch=db.batch();for(const write of writes)batch.set(facultyRef(write.id),write.patch||{},{merge:true});batch.set(jobRef(importId),checkpointPatch('APPLYING_FACULTY','facultyBatchCompleted',batchIndex,total),{merge:true});await batch.commit()}
    async function commitSessionBatch({importId,batchIndex,total,writes=[]}){const batch=db.batch();for(const write of writes)batch.set(sessionRef(write.id),write.data||{});batch.set(jobRef(importId),checkpointPatch('APPLYING_SESSIONS','sessionBatchCompleted',batchIndex,total),{merge:true});await batch.commit()}

    async function freezeStaleBatches({importId,batches=[]}){
      const batch=db.batch();let expected=0;
      batches.forEach((ids,index)=>{const clean=(ids||[]).map(String).filter(Boolean);expected+=clean.length;batch.set(staleRef(importId,index),{index,ids:clean,count:clean.length})});
      batch.set(jobRef(importId),{status:'APPLYING',phase:'DELETING_STALE',staleExpected:expected,staleBatchTotal:batches.length,staleBatchCompleted:0,lastUpdatedAt:stamp()},{merge:true});await batch.commit();
    }
    async function loadStaleBatch(importId,index){const snap=await staleRef(importId,index).get();return snap.exists?snap.data():null}
    async function commitStaleDeleteBatch({importId,batchIndex,total,ids=[]}){const batch=db.batch();for(const id of ids)batch.delete(sessionRef(id));batch.set(jobRef(importId),checkpointPatch('DELETING_STALE','staleBatchCompleted',batchIndex,total),{merge:true});await batch.commit()}

    async function commitRestoreFacultyBatch({importId,batchIndex,total,writes=[]}){const batch=db.batch();for(const write of writes)batch.set(facultyRef(write.id),write.patch||{},{merge:true});batch.set(jobRef(importId),checkpointPatch('RESTORING_FACULTY','restoreFacultyBatchCompleted',batchIndex,total),{merge:true});await batch.commit()}
    async function commitRestoreSessionBatch({importId,batchIndex,total,writes=[]}){const batch=db.batch();for(const write of writes)batch.set(sessionRef(write.id),write.data||{});batch.set(jobRef(importId),checkpointPatch('RESTORING_SESSIONS','restoreSessionBatchCompleted',batchIndex,total),{merge:true});await batch.commit()}

    async function freezeRestoreDeleteBatches({importId,batches=[]}){
      const batch=db.batch();let expected=0;
      batches.forEach((ids,index)=>{const clean=(ids||[]).map(String).filter(Boolean);expected+=clean.length;batch.set(restoreDeleteRef(importId,index),{index,ids:clean,count:clean.length})});
      batch.set(jobRef(importId),{status:'APPLYING',phase:'REMOVING_POST_BACKUP_SESSIONS',restoreDeleteExpected:expected,restoreDeleteBatchTotal:batches.length,restoreDeleteBatchCompleted:0,lastUpdatedAt:stamp()},{merge:true});await batch.commit();
    }
    async function loadRestoreDeleteBatch(importId,index){const snap=await restoreDeleteRef(importId,index).get();return snap.exists?snap.data():null}
    async function commitRestoreDeleteBatch({importId,batchIndex,total,ids=[]}){const batch=db.batch();for(const id of ids)batch.delete(sessionRef(id));batch.set(jobRef(importId),checkpointPatch('REMOVING_POST_BACKUP_SESSIONS','restoreDeleteBatchCompleted',batchIndex,total),{merge:true});await batch.commit()}

    async function writeSummarySettings({data={},merge=true}={}){await summarySettingsRef().set(data,{merge})}
    async function restoreSummarySettings(snapshot){if(snapshot?.exists)await summarySettingsRef().set(snapshot.data||{});else await summarySettingsRef().delete()}

    async function patchJob(args,maybePatch){const importId=typeof args==='string'?args:args?.importId,patch=typeof args==='string'?maybePatch:args?.patch;if(!importId)throw Error('Import ID is required.');await jobRef(importId).set({...patch,lastUpdatedAt:stamp()},{merge:true})}

    async function takeOver({importId,actor={},reason}){
      reason=String(reason||'').trim();if(!reason)throw Error('Recovery takeover reason is required.');const now=stamp();
      await db.runTransaction(async transaction=>{
        const [stateSnap,jobSnap]=await Promise.all([transaction.get(systemRef()),transaction.get(jobRef(importId))]),state=stateSnap.exists?stateSnap.data():{};
        if(state.teachingDataWriteLocked!==true||String(state.activeImportId||'')!==String(importId))throw Error('This import is not the active maintenance job.');
        if(!jobSnap.exists)throw Error('Active import job was not found.');const job=jobSnap.data()||{};
        transaction.set(systemRef(),{maintenanceOwnerUid:String(actor?.uid||''),maintenanceOwnerName:String(actor?.name||'')},{merge:true});
        transaction.set(jobRef(importId),{previousMaintenanceOwnerUid:String(state.maintenanceOwnerUid||''),previousMaintenanceOwnerName:String(state.maintenanceOwnerName||''),recoveryTakenOverBy:String(actor?.uid||''),recoveryTakenOverByName:String(actor?.name||''),recoveryTakenOverAt:now,recoveryTakeoverReason:reason,phase:job.phase,lastUpdatedAt:now},{merge:true});
      });
    }

    async function appendEvent({importId,type,payload={},actor={}}){if(!importId||!type)throw Error('Import event requires import ID and type.');await eventRef(importId).set({type:String(type),...payload,changedBy:String(actor?.uid||''),changedByName:String(actor?.name||''),changedAt:stamp()})}

    async function completeAndUnlock({importId,status,event=null}){
      if(!['COMPLETED','RESTORED'].includes(status))throw Error('Only terminal import states may release the maintenance lock.');
      const now=stamp(),batch=db.batch(),terminalPatch={status,phase:status,lastUpdatedAt:now};
      if(status==='COMPLETED')terminalPatch.completedAt=now;else terminalPatch.restoredAt=now;
      batch.set(jobRef(importId),terminalPatch,{merge:true});
      const systemPatch={teachingDataWriteLocked:false,maintenanceMode:'none',activeImportId:'',maintenanceOwnerUid:'',maintenanceOwnerName:'',maintenanceStartedAt:fieldDelete()};
      if(status==='COMPLETED'){systemPatch.lastCompletedImportId=String(importId);systemPatch.lastCompletedImportAt=now}
      batch.set(systemRef(),systemPatch,{merge:true});if(event)batch.set(eventRef(importId),{...event,changedAt:now});await batch.commit();
    }

    async function loadCurrentFaculty(){const snap=await db.collection('faculty').get();return snap.docs.map(doc=>({__id:doc.id,...doc.data()}))}
    async function loadCurrentSessions(){const snap=await db.collection('sessions').get();return snap.docs.map(doc=>({id:doc.id,...doc.data()}))}
    async function loadSummarySettings(){const snap=await summarySettingsRef().get();return snap.exists?{exists:true,data:snap.data()}:{exists:false}}

    return{
      loadSystemState,loadJob,findActiveJob,acquireImport,
      commitFacultyBatch,commitSessionBatch,freezeStaleBatches,loadStaleBatch,commitStaleDeleteBatch,
      commitRestoreFacultyBatch,commitRestoreSessionBatch,freezeRestoreDeleteBatches,loadRestoreDeleteBatch,commitRestoreDeleteBatch,
      patchJob,takeOver,completeAndUnlock,appendEvent,
      loadCurrentFaculty,loadCurrentSessions,loadSummarySettings,writeSummarySettings,restoreSummarySettings,
      fieldDelete,serverTimestamp:()=>stamp()
    };
  }

  return{create};
});
