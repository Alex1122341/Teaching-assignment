(function(root,factory){
  const defaultCore=typeof module==='object'&&module.exports?require('./bulk-import-core.js'):root?.UCVM_BULK_IMPORT_CORE;
  const defaultBackup=typeof module==='object'&&module.exports?require('./bulk-import-backup.js'):root?.UCVM_BULK_IMPORT_BACKUP;
  const api=factory(defaultCore,defaultBackup);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UCVM_BULK_IMPORT_CONTROLLER=api;
})(typeof window!=='undefined'?window:null,function(defaultCore,defaultBackup){
  'use strict';

  const text=value=>String(value??'').trim();
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const canonical=value=>{
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
    return value;
  };
  const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

  function create(options={}){
    const core=options.core||defaultCore;
    const backup=options.backup||defaultBackup;
    const store=options.store;
    const actor=options.actor||{};
    const projectId=text(options.projectId);
    const rebuildIndexes=options.rebuildIndexes||(async()=>{});
    const verifyIndexes=options.verifyIndexes||(async()=>({ok:true,errors:[]}));
    const prepareSession=options.prepareSession||((row)=>({...row}));
    const onProgress=typeof options.onProgress==='function'?options.onProgress:()=>{};

    if(!core||!backup||!store)throw Error('Bulk import controller requires core, backup, and store dependencies.');
    if(!projectId)throw Error('Bulk import controller requires a Firebase project ID.');

    const timestamp=()=>typeof store.serverTimestamp==='function'?store.serverTimestamp():new Date().toISOString();
    const deleted=()=>typeof store.fieldDelete==='function'?store.fieldDelete():undefined;
    const importIdForFingerprint=fingerprint=>`import-${text(fingerprint).slice(0,32)}`;
    const progress=(status,phase,completed,total,message)=>onProgress({status,phase,completed,total,message});

    function parseFile(file){
      if(!file||file.bytes==null)throw Error('Source file bytes are required.');
      return core.parseSource(file.text);
    }

    async function preflight(file){
      if(!file||file.bytes==null)throw Error('Source file bytes are required.');
      const fingerprint=await core.fingerprintBytes(file.bytes);
      let source;
      try{source=parseFile(file)}catch(error){return{errors:[error.message],warnings:[],fingerprint,importId:importIdForFingerprint(fingerprint)}}
      const validation=core.validateSource(source),importId=importIdForFingerprint(fingerprint);
      if(validation.errors.length)return{source,fingerprint,importId,...validation};
      const [currentFaculty,currentSessions,summarySettings,active,existingJob]=await Promise.all([
        store.loadCurrentFaculty(),store.loadCurrentSessions(),store.loadSummarySettings(),store.findActiveJob(),store.loadJob(importId)
      ]);
      const analysis=core.analyzeSource({source,currentFaculty,currentSessions});
      const errors=[...(analysis.errors||[])],warnings=[...(analysis.warnings||[])];
      if(active?.job&&!['COMPLETED','RESTORED'].includes(active.job.status))errors.push(`An incomplete teaching-data import is already active (${active.job.importId||active.state?.activeImportId||'unknown'}). Resume or restore it before starting a new import.`);
      if(existingJob?.status==='COMPLETED')errors.push('This source file has already been successfully imported.');
      return{source,fingerprint,importId,analysis,currentFaculty,currentSessions,summarySettings,errors,warnings};
    }

    async function createRecoveryBackup(preflightResult){
      if(!preflightResult||preflightResult.errors?.length)throw Error('Preflight must pass before creating a recovery backup.');
      const built=await backup.buildBackup({
        projectId,importId:preflightResult.importId,sourceFingerprint:preflightResult.fingerprint,actor,
        faculty:preflightResult.currentFaculty,sessions:preflightResult.currentSessions,summarySettings:preflightResult.summarySettings,
        createdAt:new Date().toISOString()
      });
      const compact=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,13);
      return{backup:built,text:backup.serializeBackup(built),filename:`UCVM-pre-import-backup-${compact}.json`};
    }

    function facultyWrites(source,currentFaculty){
      const byId=new Map((source.faculty||[]).map(row=>[text(row?.ucid),row]).filter(([id])=>id));
      return(currentFaculty||[]).map(row=>{
        const id=text(row?.__id||row?.ucid||row?.id),src=byId.get(id),del=deleted();
        if(!id)throw Error('Current faculty record is missing an ID.');
        const patch={
          updatedBy:text(actor.uid),updatedByName:text(actor.name),
          teachingDoeModel2026_27:del,assignedTeachingDOE:del,doeAssignedTeachingDOE:del,teachingSummary2026_27:del,
          facultySummarySource2026_27:text(source.sourceWorkbook),facultySummaryImportedAt:timestamp(),facultySummaryImportedBy:text(actor.uid)
        };
        if(src){patch.facultySummary2026_27=src;patch.facultySummaryStatus2026_27='Loaded'}
        else{patch.facultySummary2026_27=del;patch.facultySummaryStatus2026_27='No source summary'}
        return{id,patch};
      });
    }

    function sessionWrites(source){
      return(source.sessions||[]).map(raw=>{
        const id=text(raw?.id);
        if(!id)throw Error('Source session is missing an ID.');
        const rec=JSON.parse(JSON.stringify(raw));delete rec.id;
        const prepared=prepareSession(rec)||{};
        return{id,data:{...prepared,sourceWorkbook:text(source.sourceWorkbook),sourceSchema:text(source.schemaVersion),bulkImportedAt:timestamp(),bulkImportedBy:text(actor.uid),updatedBy:text(actor.uid),updatedByName:text(actor.name),updatedAt:timestamp()}};
      });
    }

    async function verifyIncomingSource(source){
      await store.failpoint?.('verify-source');
      const [currentFaculty,currentSessions]=await Promise.all([store.loadCurrentFaculty(),store.loadCurrentSessions()]);
      const incomingIds=(source.sessions||[]).map(row=>text(row?.id)),currentIds=currentSessions.map(row=>text(row?.id));
      const missing=core.diffIdSets(incomingIds,currentIds).missing;
      if(missing.length)throw Error(`Source verification failed: ${missing.length} incoming session(s) are missing (${missing.slice(0,10).join(', ')}).`);
      const sourceFaculty=new Map((source.faculty||[]).map(row=>[text(row?.ucid),row]).filter(([id])=>id));
      for(const row of currentFaculty){
        const id=text(row?.__id||row?.ucid||row?.id),src=sourceFaculty.get(id);
        if(src){
          if(!own(row,'facultySummary2026_27')||!equal(row.facultySummary2026_27,src))throw Error(`Source verification failed for faculty ${id}: summary does not match the source.`);
          if(row.facultySummaryStatus2026_27!=='Loaded')throw Error(`Source verification failed for faculty ${id}: status is not Loaded.`);
        }else{
          if(own(row,'facultySummary2026_27'))throw Error(`Source verification failed for faculty ${id}: stale summary remains.`);
          if(row.facultySummaryStatus2026_27!=='No source summary')throw Error(`Source verification failed for faculty ${id}: no-source status is missing.`);
        }
      }
      return{currentFaculty,currentSessions};
    }

    async function transition(importId,phase,extra={}){
      await store.patchJob({importId,patch:{status:'APPLYING',phase,...extra}});
    }

    async function runUntilTerminal({source,job}){
      let current={...job},currentPhase=current.phase||core.PHASES.APPLYING_FACULTY;
      const importId=current.importId;
      try{
        if(currentPhase===core.PHASES.APPLYING_FACULTY){
          const currentFaculty=await store.loadCurrentFaculty();
          const batches=core.chunkRows(facultyWrites(source,currentFaculty),core.FACULTY_BATCH_SIZE),startAt=Number(current.facultyBatchCompleted)||0;
          for(let index=startAt;index<batches.length;index++){
            await store.commitFacultyBatch({importId,batchIndex:index,total:batches.length,writes:batches[index]});
            current.facultyBatchCompleted=index+1;current.facultyBatchTotal=batches.length;
            progress('APPLYING',currentPhase,index+1,batches.length,'Applying faculty teaching summaries');
          }
          currentPhase=core.PHASES.APPLYING_SESSIONS;
          await transition(importId,currentPhase,{facultyBatchCompleted:batches.length,facultyBatchTotal:batches.length});current.phase=currentPhase;
        }
        if(currentPhase===core.PHASES.APPLYING_SESSIONS){
          const batches=core.chunkRows(sessionWrites(source),core.SESSION_BATCH_SIZE),startAt=Number(current.sessionBatchCompleted)||0;
          for(let index=startAt;index<batches.length;index++){
            await store.commitSessionBatch({importId,batchIndex:index,total:batches.length,writes:batches[index]});
            current.sessionBatchCompleted=index+1;current.sessionBatchTotal=batches.length;
            progress('APPLYING',currentPhase,index+1,batches.length,'Applying timetable sessions');
          }
          currentPhase=core.PHASES.VERIFYING_SOURCE;
          await transition(importId,currentPhase,{sessionBatchCompleted:batches.length,sessionBatchTotal:batches.length});current.phase=currentPhase;
        }
        if(currentPhase===core.PHASES.VERIFYING_SOURCE){
          const verified=await verifyIncomingSource(source),incoming=new Set((source.sessions||[]).map(row=>text(row?.id)).filter(Boolean));
          const staleIds=verified.currentSessions.map(row=>text(row?.id)).filter(id=>id&&!incoming.has(id));
          const staleBatches=core.chunkRows(staleIds,core.STALE_BATCH_SIZE);
          await store.freezeStaleBatches({importId,batches:staleBatches});
          currentPhase=core.PHASES.DELETING_STALE;
          Object.assign(current,{phase:currentPhase,staleBatchCompleted:0,staleBatchTotal:staleBatches.length,staleExpected:staleIds.length});
          progress('APPLYING',core.PHASES.VERIFYING_SOURCE,1,1,'Source data verified before stale deletion');
        }
        if(currentPhase===core.PHASES.DELETING_STALE){
          const total=Number(current.staleBatchTotal)||0,startAt=Number(current.staleBatchCompleted)||0;
          for(let index=startAt;index<total;index++){
            const stale=await store.loadStaleBatch(importId,index);if(!stale)throw Error(`Stale-session batch ${index} is missing.`);
            await store.commitStaleDeleteBatch({importId,batchIndex:index,total,ids:stale.ids||[]});current.staleBatchCompleted=index+1;
            progress('APPLYING',currentPhase,index+1,total,'Removing stale timetable sessions');
          }
          currentPhase=core.PHASES.REBUILDING_INDEXES;
          await transition(importId,currentPhase,{staleBatchCompleted:total,staleBatchTotal:total});current.phase=currentPhase;
        }
        if(currentPhase===core.PHASES.REBUILDING_INDEXES){
          const [currentFaculty,currentSessions]=await Promise.all([store.loadCurrentFaculty(),store.loadCurrentSessions()]);
          const finalDiff=core.diffIdSets((source.sessions||[]).map(row=>row.id),currentSessions.map(row=>row.id));
          if(finalDiff.missing.length||finalDiff.unexpected.length)throw Error(`Final session ID verification failed. Missing: ${finalDiff.missing.join(', ')||'none'}; unexpected: ${finalDiff.unexpected.join(', ')||'none'}.`);
          await rebuildIndexes({faculty:currentFaculty,sessions:currentSessions,actor});
          currentPhase=core.PHASES.VERIFYING_FINAL;await transition(importId,currentPhase);current.phase=currentPhase;
          progress('APPLYING',core.PHASES.REBUILDING_INDEXES,1,1,'Derived indexes rebuilt');
        }
        if(currentPhase===core.PHASES.VERIFYING_FINAL){
          await store.failpoint?.('verify-final');
          const [currentFaculty,currentSessions]=await Promise.all([store.loadCurrentFaculty(),store.loadCurrentSessions()]);
          const finalDiff=core.diffIdSets((source.sessions||[]).map(row=>row.id),currentSessions.map(row=>row.id));
          if(finalDiff.missing.length||finalDiff.unexpected.length)throw Error('Final session ID verification failed.');
          const indexCheck=await verifyIndexes({faculty:currentFaculty,sessions:currentSessions});
          if(!indexCheck?.ok)throw Error(`Derived index verification failed: ${(indexCheck?.errors||['unknown error']).join('; ')}`);
          await store.completeAndUnlock({importId,status:'COMPLETED',event:{type:'BULK_IMPORT_COMPLETED',changedBy:text(actor.uid),changedByName:text(actor.name),sourceWorkbook:text(source.sourceWorkbook),sessionCount:(source.sessions||[]).length,facultyCount:(source.faculty||[]).length}});
          progress('COMPLETED','COMPLETED',1,1,'Teaching-data synchronization completed');
          return{status:'COMPLETED',importId};
        }
        throw Error(`Unsupported import phase: ${currentPhase}.`);
      }catch(error){
        try{
          await store.patchJob({importId,patch:{status:'FAILED',phase:currentPhase,failedPhase:currentPhase,lastError:String(error?.message||error),failedAt:timestamp()}});
          await store.appendEvent?.({importId,type:'BULK_IMPORT_FAILED',actor,payload:{failedPhase:currentPhase,error:String(error?.message||error)}});
        }catch(logError){console.error?.('[bulk import failure state]',logError)}
        throw error;
      }
    }

    async function start({preflight:preflightResult,recoveryBackup,backupConfirmed,typedConfirmation}={}){
      if(!preflightResult||preflightResult.errors?.length)throw Error('Bulk import cannot start until preflight passes.');
      if(backupConfirmed!==true)throw Error('Confirm that the recovery backup has been saved before starting the import.');
      if(preflightResult.analysis?.requiresTypedImportConfirmation&&text(typedConfirmation)!=='IMPORT')throw Error('Type IMPORT to confirm this large teaching-data change.');
      if(!recoveryBackup)throw Error('A recovery backup is required before starting the import.');
      await backup.parseAndValidateBackup(backup.serializeBackup(recoveryBackup),{projectId,importId:preflightResult.importId,sourceFingerprint:preflightResult.fingerprint});
      const source=preflightResult.source,analysis=preflightResult.analysis||{};
      const facultyBatchTotal=core.chunkRows(facultyWrites(source,preflightResult.currentFaculty||[]),core.FACULTY_BATCH_SIZE).length;
      const sessionBatchTotal=core.chunkRows(sessionWrites(source),core.SESSION_BATCH_SIZE).length;
      const job=await store.acquireImport({importId:preflightResult.importId,actor,mode:'bulk_import',job:{status:'APPLYING',phase:core.PHASES.APPLYING_FACULTY,sourceFingerprint:preflightResult.fingerprint,sourceWorkbook:text(source.sourceWorkbook),schemaVersion:text(source.schemaVersion),facultyExpected:Number(analysis.facultyExpected)||0,sessionExpected:Number(analysis.sessionExpected)||0,facultyBatchTotal,facultyBatchCompleted:0,sessionBatchTotal,sessionBatchCompleted:0,staleExpected:Number((analysis.staleSessionIds||[]).length)||0,staleBatchTotal:0,staleBatchCompleted:0,backupFingerprint:text(recoveryBackup.metadata?.backupFingerprint),backupCreatedAt:text(recoveryBackup.metadata?.createdAt)}});
      await store.appendEvent?.({importId:job.importId,type:'BULK_IMPORT_STARTED',actor,payload:{sourceWorkbook:text(source.sourceWorkbook),sourceFingerprint:preflightResult.fingerprint,facultyCount:(source.faculty||[]).length,sessionCount:(source.sessions||[]).length}});
      return runUntilTerminal({source,job});
    }

    async function resume(file){
      const active=await store.findActiveJob();if(!active?.job)throw Error('No incomplete bulk import is available to resume.');
      const job=active.job,fingerprint=await core.fingerprintBytes(file?.bytes);
      if(fingerprint!==text(job.sourceFingerprint))throw Error('The selected source file does not match the interrupted import.');
      const source=parseFile(file),validation=core.validateSource(source);if(validation.errors.length)throw Error(validation.errors.join(' '));
      await store.patchJob({importId:job.importId,patch:{status:'APPLYING',failedPhase:'',lastError:'',failedAt:null,resumedBy:text(actor.uid),resumedByName:text(actor.name),resumedAt:timestamp()}});
      await store.appendEvent?.({importId:job.importId,type:'BULK_IMPORT_RESUMED',actor,payload:{phase:job.phase}});
      return runUntilTerminal({source,job:{...job,status:'APPLYING',failedPhase:'',lastError:'',failedAt:null}});
    }

    async function loadRecoveryState(){return store.findActiveJob()}
    return{preflight,createRecoveryBackup,start,resume,loadRecoveryState,runUntilTerminal};
  }
  return{create};
});
