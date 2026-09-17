(function(root,factory){
  const core=typeof module==='object'&&module.exports?require('./bulk-import-core.js'):root?.UCVM_BULK_IMPORT_CORE;
  const api=factory(core);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UCVM_BULK_IMPORT_BACKUP=api;
})(typeof window!=='undefined'?window:null,function(core){
  'use strict';

  if(!core||typeof core.fingerprintBytes!=='function')throw Error('UCVM_BULK_IMPORT_CORE must load before bulk-import-backup.js.');

  const BACKUP_SCHEMA='ucvm-teaching-recovery-v1';
  const TYPE_KEY='__ucvmFirestoreType';
  const FACULTY_FIELDS=Object.freeze([
    'teachingDoeModel2026_27',
    'assignedTeachingDOE',
    'doeAssignedTeachingDOE',
    'teachingSummary2026_27',
    'facultySummary2026_27',
    'facultySummaryStatus2026_27',
    'facultySummarySource2026_27',
    'facultySummaryImportedAt',
    'facultySummaryImportedBy'
  ]);

  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const isPlainObject=value=>{
    if(!value||typeof value!=='object')return false;
    const proto=Object.getPrototypeOf(value);
    return proto===Object.prototype||proto===null;
  };
  const timestampLike=value=>value&&typeof value==='object'&&Number.isInteger(value.seconds)&&Number.isInteger(value.nanoseconds)&&typeof value.toDate==='function';

  function encodeValue(value){
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'){
      if(Number.isFinite(value))return value;
      if(Number.isNaN(value))return{[TYPE_KEY]:'number',value:'NaN'};
      return{[TYPE_KEY]:'number',value:value===Infinity?'Infinity':'-Infinity'};
    }
    if(timestampLike(value))return{[TYPE_KEY]:'timestamp',seconds:value.seconds,nanoseconds:value.nanoseconds};
    if(Array.isArray(value))return value.map(encodeValue);
    if(isPlainObject(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encodeValue(item)]));
    throw Error(`Unsupported Firestore value in recovery backup: ${Object.prototype.toString.call(value)}.`);
  }

  function decodeValue(value,{Timestamp}={}){
    if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return value;
    if(Array.isArray(value))return value.map(item=>decodeValue(item,{Timestamp}));
    if(!isPlainObject(value))throw Error('Unsupported encoded recovery value.');
    if(value[TYPE_KEY]==='timestamp'){
      if(typeof Timestamp!=='function')throw Error('Firestore Timestamp constructor is required to restore this backup.');
      return new Timestamp(value.seconds,value.nanoseconds);
    }
    if(value[TYPE_KEY]==='number'){
      if(value.value==='NaN')return NaN;
      if(value.value==='Infinity')return Infinity;
      if(value.value==='-Infinity')return-Infinity;
      throw Error('Unsupported encoded numeric recovery value.');
    }
    if(own(value,TYPE_KEY))throw Error(`Unsupported encoded recovery type: ${String(value[TYPE_KEY])}.`);
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,decodeValue(item,{Timestamp})]));
  }

  function canonical(value){
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
    return value;
  }

  const canonicalString=value=>JSON.stringify(canonical(value));
  const cloneJson=value=>JSON.parse(JSON.stringify(value));

  async function fingerprintPayload(payload){
    const copy=cloneJson(payload);
    if(copy?.metadata)delete copy.metadata.backupFingerprint;
    return core.fingerprintBytes(new TextEncoder().encode(canonicalString(copy)));
  }

  function facultyBackupRow(row){
    const id=String(row?.__id||row?.id||row?.ucid||'').trim();
    if(!id)throw Error('Cannot create recovery backup for faculty record without an ID.');
    const fields={};
    for(const field of FACULTY_FIELDS){
      if(own(row,field))fields[field]={exists:true,value:encodeValue(row[field])};
      else fields[field]={exists:false};
    }
    return{id,fields};
  }

  function sessionBackupRow(row){
    const id=String(row?.id||row?.__id||'').trim();
    if(!id)throw Error('Cannot create recovery backup for session without an ID.');
    const raw=row?.data&&isPlainObject(row.data)?row.data:{...row};
    if(raw===row?.data)return{id,data:encodeValue(raw)};
    delete raw.id;
    delete raw.__id;
    return{id,data:encodeValue(raw)};
  }

  function settingsBackupRow(summarySettings){
    if(!summarySettings)return{exists:false};
    if(typeof summarySettings.exists==='boolean')return summarySettings.exists?{exists:true,data:encodeValue(summarySettings.data||{})}:{exists:false};
    return{exists:true,data:encodeValue(summarySettings)};
  }

  function makeBackupId(importId,createdAt){
    const stamp=String(createdAt||'').replace(/[^0-9]/g,'').slice(0,14)||'undated';
    return`backup-${String(importId||'').trim()}-${stamp}`;
  }

  async function buildBackup({projectId,importId,sourceFingerprint,actor,faculty,sessions,summarySettings,createdAt}){
    projectId=String(projectId||'').trim();
    importId=String(importId||'').trim();
    sourceFingerprint=String(sourceFingerprint||'').trim();
    if(!projectId||!importId||!sourceFingerprint)throw Error('Recovery backup requires project, import ID, and source fingerprint.');
    const created=String(createdAt||new Date().toISOString());
    const facultyRows=(faculty||[]).map(facultyBackupRow);
    const sessionRows=(sessions||[]).map(sessionBackupRow);
    const payload={
      schemaVersion:BACKUP_SCHEMA,
      metadata:{
        backupId:makeBackupId(importId,created),
        projectId,
        importId,
        sourceFingerprint,
        createdAt:created,
        createdBy:String(actor?.uid||''),
        createdByName:String(actor?.name||''),
        facultyCount:facultyRows.length,
        sessionCount:sessionRows.length,
        backupFingerprint:''
      },
      faculty:facultyRows,
      sessions:sessionRows,
      settings:{faculty_summary_2026_27:settingsBackupRow(summarySettings)}
    };
    payload.metadata.backupFingerprint=await fingerprintPayload(payload);
    return payload;
  }

  function serializeBackup(backup){return JSON.stringify(backup,null,2)}

  async function parseAndValidateBackup(text,{projectId,importId,sourceFingerprint}={}){
    let payload;
    try{payload=JSON.parse(String(text))}catch(error){throw Error(`Invalid recovery backup JSON: ${error.message}`)}
    if(!payload||payload.schemaVersion!==BACKUP_SCHEMA)throw Error('Unsupported recovery backup schema.');
    if(!payload.metadata||!Array.isArray(payload.faculty)||!Array.isArray(payload.sessions))throw Error('Recovery backup is structurally incomplete.');
    const expected={projectId:String(projectId||''),importId:String(importId||''),sourceFingerprint:String(sourceFingerprint||'')};
    if((expected.projectId&&payload.metadata.projectId!==expected.projectId)||(expected.importId&&payload.metadata.importId!==expected.importId)||(expected.sourceFingerprint&&payload.metadata.sourceFingerprint!==expected.sourceFingerprint))throw Error('This recovery backup does not belong to the interrupted import.');
    if(payload.metadata.facultyCount!==payload.faculty.length||payload.metadata.sessionCount!==payload.sessions.length)throw Error('Recovery backup count verification failed.');
    const actual=String(payload.metadata.backupFingerprint||'');
    const calculated=await fingerprintPayload(payload);
    if(!actual||actual!==calculated)throw Error('Recovery backup fingerprint verification failed.');
    return payload;
  }

  return{BACKUP_SCHEMA,FACULTY_FIELDS,encodeValue,decodeValue,buildBackup,serializeBackup,parseAndValidateBackup};
});
