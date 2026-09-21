'use strict';
window.UCVM_CALENDAR_SESSION_MAINTENANCE=(()=>{
 const sanitizer=window.UCVM_CALENDAR_SESSION;if(!sanitizer)throw Error('UCVM_CALENDAR_SESSION is required.');
 const allowed=new Set(['sessionId','course','courseName','year','semester','week','date','start','end','timeUnknown','type','topic','room','instructorNames','instructor','labGroupIds']);
 const firestoreDocId=Symbol('firestoreDocId');
 const idOf=row=>String(row?.[firestoreDocId]||row?.id||row?.__id||row?.sessionId||'').trim();
 const stable=value=>JSON.stringify(value,Object.keys(value||{}).sort());
 function compare(sourceSessions=[],calendarSessions=[]){
  const source=new Map(sourceSessions.map(row=>[idOf(row),row]).filter(([id])=>id)),calendar=new Map(calendarSessions.map(row=>[idOf(row),row]).filter(([id])=>id)),mismatches=[];
  for(const [id,row] of source){const current=calendar.get(id);if(!current){mismatches.push({id,kind:'missing',field:'document'});continue}const extra=Object.keys(current).filter(key=>!allowed.has(key));if(extra.length){mismatches.push({id,kind:'private_field',field:extra[0]});continue}const expected=sanitizer.fromSource(row,id);for(const key of Object.keys(expected)){if(stable({v:current[key]})!==stable({v:expected[key]})){mismatches.push({id,kind:'mismatch',field:key});break}}}
  for(const id of calendar.keys())if(!source.has(id))mismatches.push({id,kind:'stale',field:'document'});
  return{ok:mismatches.length===0,mismatchCount:mismatches.length,mismatches};
 }
 async function load(db,collection){const snap=await db.collection(collection).get();return snap.docs.map(doc=>{const row={...doc.data()};Object.defineProperty(row,firestoreDocId,{value:String(doc.id),enumerable:false});return row});}
 async function verify(db){const [source,calendar]=await Promise.all([load(db,'sessions'),load(db,'calendar_sessions')]);return compare(source,calendar)}
 async function repair(db,report,actor={}){for(const item of report?.mismatches||[]){await db.runTransaction(async tx=>{const sourceRef=db.collection('sessions').doc(String(item.id)),calendarRef=db.collection('calendar_sessions').doc(String(item.id)),snap=await tx.get(sourceRef);if(!snap.exists)tx.delete(calendarRef);else tx.set(calendarRef,sanitizer.fromSource(snap.data(),item.id));});}return verify(db)}
 return{compare,verify,repair};
})();
