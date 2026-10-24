'use strict';
// A Dashboard History operation is a user submission, not a database row or a changed field.
// Keep all underlying AuditEvent rows immutable. Group only with a server-written, explicit
// AFC batch request identifier; otherwise a single event is one operation.
const {publicHistoryRow}=require('./change-history-projection');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function metadataOf(event){
 if(!event||typeof event.metadataJson!=='string')return {};
 try{const parsed=JSON.parse(event.metadataJson);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch(_){return {};}
}
function operationKey(event){
 // Calendar activity import projections share one immutable receipt audit event:
 // ListChangeHistoryEvents exposes it as audit-id:activity-id for each item.
 const work=typeof event?.eventId==='string'&&event.eventId.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
 if(event.source==='work'&&['calendar_activity_import_committed','calendar_activity_import_recovered'].includes(event.eventType)&&work)
  return 'work-import:'+work[1].toLowerCase();
 const meta=metadataOf(event);
 // Only CreateAfcManualBatch creates this metadata shape. Do not group unrelated
 // user actions that happen close together or happen to change the same record.
 if(event.source==='audit'&&event.eventType==='afc_record_created'&&event.entityType==='afc_record'&&
    meta.source==='multi_input'&&typeof meta.batchRequestId==='string'&&UUID.test(meta.batchRequestId)&&
    Number.isInteger(meta.batchRowNumber)&&meta.batchRowNumber>=0&&Number.isInteger(meta.batchRowCount)&&
    meta.batchRowCount>=1&&meta.batchRowCount<=20&&meta.batchRowNumber<meta.batchRowCount){
  return 'afc-batch:'+meta.batchRequestId.toLowerCase();
 }
 return 'event:'+String(event.source||'audit')+':'+String(event.eventId);
}
function groupDashboardHistory(entries){
 const groups=new Map();
 for(const item of entries){
  if(!item||!item.event||!Array.isArray(item.rows)||!item.rows.length)continue;
  const key=operationKey(item.event),rows=item.rows.map(publicHistoryRow);
  if(!rows.length)continue;
  const first=rows[0];
  let group=groups.get(key);
  if(!group){
   group={rowId:key,changeDate:first.changeDate,changeType:first.changeType,domain:first.domain,
    title:'',actor:first.actor||null,affectedFaculty:null,recordCount:0,changeCount:0,
    startDate:null,endDate:null,records:[],_batch:key.startsWith('afc-batch:')};
   groups.set(key,group);
  }
  const record={affectedFaculty:first.affectedFaculty||null,course:first.course||null,session:first.session||null,
   startDate:first.startDate||null,endDate:first.endDate||null,
   changes:rows.map(row=>({field:row.field,previousValue:row.previousValue,updatedValue:row.updatedValue}))};
  const meta=metadataOf(item.event);
  group.records.push({...record,_position:group._batch?meta.batchRowNumber:group.records.length});
  group.changeCount+=record.changes.length;
  if(first.changeDate>group.changeDate)group.changeDate=first.changeDate;
 }
 const output=[];
 for(const group of groups.values()){
  group.records.sort((a,b)=>a._position-b._position);
  group.records=group.records.map(({_position,...record})=>record);
  group.recordCount=group.records.length;
  const faculty=[...new Set(group.records.map(record=>record.affectedFaculty).filter(Boolean))];
  group.affectedFaculty=faculty.length?faculty.join('; '):null;
  const starts=group.records.map(record=>record.startDate).filter(Boolean).sort();
  const ends=group.records.map(record=>record.endDate).filter(Boolean).sort();
  group.startDate=starts.length?starts[0]:null;
  group.endDate=ends.length?ends[ends.length-1]:null;
  group.title=group._batch?group.recordCount+' AFC Record'+(group.recordCount===1?'':'s')+' Created':
   String(group.changeType||'Recorded change').replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
  delete group._batch;
  output.push(group);
 }
 return output.sort((a,b)=>b.changeDate.localeCompare(a.changeDate)||a.rowId.localeCompare(b.rowId));
}
module.exports={operationKey,groupDashboardHistory};
