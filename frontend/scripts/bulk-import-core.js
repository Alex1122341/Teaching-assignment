(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UCVM_BULK_IMPORT_CORE=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  const SOURCE_SCHEMA='ucvm-all-faculty-summaries-v8-synced-2026-27';
  const FACULTY_BATCH_SIZE=350;
  const SESSION_BATCH_SIZE=300;
  const STALE_BATCH_SIZE=350;
  const PHASES=Object.freeze({
    APPLYING_FACULTY:'APPLYING_FACULTY',
    APPLYING_SESSIONS:'APPLYING_SESSIONS',
    VERIFYING_SOURCE:'VERIFYING_SOURCE',
    DELETING_STALE:'DELETING_STALE',
    REBUILDING_INDEXES:'REBUILDING_INDEXES',
    VERIFYING_FINAL:'VERIFYING_FINAL',
    RESTORING_FACULTY:'RESTORING_FACULTY',
    RESTORING_SESSIONS:'RESTORING_SESSIONS',
    REMOVING_POST_BACKUP_SESSIONS:'REMOVING_POST_BACKUP_SESSIONS',
    RESTORE_VERIFYING:'RESTORE_VERIFYING',
    RESTORE_FINAL_VERIFY:'RESTORE_FINAL_VERIFY'
  });
  const TERMINAL_STATUSES=Object.freeze(['COMPLETED','RESTORED']);

  const text=value=>String(value??'').trim();

  function duplicateValues(values){
    const seen=new Set(),duplicates=new Set();
    for(const raw of values||[]){
      const value=text(raw);
      if(!value)continue;
      if(seen.has(value))duplicates.add(value);
      else seen.add(value);
    }
    return [...duplicates].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  }

  async function fingerprintBytes(input){
    const bytes=input instanceof ArrayBuffer?new Uint8Array(input):input;
    if(!(bytes instanceof Uint8Array))throw Error('Source bytes are required.');
    const cryptoApi=globalThis.crypto;
    if(!cryptoApi?.subtle?.digest)throw Error('Web Crypto SHA-256 is not available.');
    const digest=await cryptoApi.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  }

  function parseSource(value){
    try{return JSON.parse(String(value))}
    catch(error){throw Error(`Invalid JSON: ${error.message}`)}
  }

  function validateSource(source){
    const errors=[],warnings=[];
    if(!source||typeof source!=='object'||Array.isArray(source))return{errors:['Source JSON must be an object.'],warnings};
    if(source.schemaVersion!==SOURCE_SCHEMA)errors.push(`Unsupported schema: ${text(source.schemaVersion)||'(blank)'}.`);
    if(!Array.isArray(source.faculty))errors.push('Source faculty must be an array.');
    if(!Array.isArray(source.sessions))errors.push('Source sessions must be an array.');
    if(errors.length)return{errors,warnings};

    const facultyIds=source.faculty.map(row=>text(row?.ucid));
    const sessionIds=source.sessions.map(row=>text(row?.id));
    const missingSessionIds=sessionIds.filter(id=>!id).length;
    if(missingSessionIds)errors.push(`${missingSessionIds} session record(s) are missing a stable ID.`);

    const duplicateFaculty=duplicateValues(facultyIds);
    const duplicateSessions=duplicateValues(sessionIds);
    if(duplicateFaculty.length)errors.push(`Duplicate faculty IDs: ${duplicateFaculty.join(', ')}.`);
    if(duplicateSessions.length)errors.push(`Duplicate session IDs: ${duplicateSessions.join(', ')}.`);

    return{errors,warnings};
  }

  function chunkRows(rows,size){
    if(!Number.isInteger(size)||size<1)throw Error('Chunk size must be a positive integer.');
    const values=Array.isArray(rows)?rows:[],out=[];
    for(let index=0;index<values.length;index+=size)out.push(values.slice(index,index+size));
    return out;
  }

  function diffIdSets(expected,current){
    const expectedSet=new Set((expected||[]).map(text).filter(Boolean));
    const currentSet=new Set((current||[]).map(text).filter(Boolean));
    return{
      missing:[...expectedSet].filter(id=>!currentSet.has(id)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),
      unexpected:[...currentSet].filter(id=>!expectedSet.has(id)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
    };
  }

  function analyzeSource({source,currentFaculty,currentSessions}){
    const validation=validateSource(source);
    if(validation.errors.length)return{...validation};

    const facultyRows=Array.isArray(currentFaculty)?currentFaculty:[];
    const sessionRows=Array.isArray(currentSessions)?currentSessions:[];
    const incomingIds=source.sessions.map(row=>text(row?.id)).filter(Boolean);
    const currentSessionIds=sessionRows.map(row=>text(row?.id)).filter(Boolean);
    const incomingSet=new Set(incomingIds),currentSet=new Set(currentSessionIds);
    const staleSessionIds=currentSessionIds.filter(id=>!incomingSet.has(id)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const createdSessionIds=incomingIds.filter(id=>!currentSet.has(id)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const updatedSessionIds=incomingIds.filter(id=>currentSet.has(id)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));

    const sourceFacultyIds=new Set(source.faculty.map(row=>text(row?.ucid)).filter(Boolean));
    const currentFacultyIds=facultyRows.map(row=>text(row?.__id||row?.ucid)).filter(Boolean);
    const noSourceFacultyIds=currentFacultyIds.filter(id=>!sourceFacultyIds.has(id)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));

    const deletedRatio=currentSessionIds.length?staleSessionIds.length/currentSessionIds.length:0;
    const countDeltaRatio=currentSessionIds.length?Math.abs(incomingIds.length-currentSessionIds.length)/currentSessionIds.length:(incomingIds.length?1:0);
    const warnings=[...validation.warnings];
    if(noSourceFacultyIds.length)warnings.push(`${noSourceFacultyIds.length} current faculty record(s) have no source summary.`);
    if(staleSessionIds.length)warnings.push(`${staleSessionIds.length} existing session(s) will be removed after verification.`);
    if(incomingIds.length<currentSessionIds.length)warnings.push(`Source session count decreases from ${currentSessionIds.length} to ${incomingIds.length}.`);

    return{
      errors:[],warnings,
      facultyExpected:sourceFacultyIds.size,
      sessionExpected:incomingIds.length,
      currentFacultyCount:currentFacultyIds.length,
      currentSessionCount:currentSessionIds.length,
      noSourceFacultyIds,
      staleSessionIds,
      createdSessionIds,
      updatedSessionIds,
      requiresTypedImportConfirmation:deletedRatio>0.10||countDeltaRatio>0.20,
      facultyBatches:chunkRows(facultyRows,FACULTY_BATCH_SIZE),
      sessionBatches:chunkRows(source.sessions,SESSION_BATCH_SIZE),
      staleBatches:chunkRows(staleSessionIds,STALE_BATCH_SIZE)
    };
  }

  return{
    SOURCE_SCHEMA,
    FACULTY_BATCH_SIZE,
    SESSION_BATCH_SIZE,
    STALE_BATCH_SIZE,
    PHASES,
    TERMINAL_STATUSES,
    fingerprintBytes,
    parseSource,
    validateSource,
    analyzeSource,
    chunkRows,
    diffIdSets
  };
});
