(function(root,factory){
 const api=factory(root&&root.UCVM_DATA_INDEX);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_INDEX_MAINTENANCE=api;
})(typeof window!=='undefined'?window:null,function(indexApi){
 'use strict';
 const index=indexApi||(typeof require==='function'?require('./data-index.js'):null);
 function sessionForWrite(session){return{...(session||{}),facultyIds:index.sessionFacultyIds(session)}}
 function replaceSession(rows,next){return[...(rows||[]).filter(row=>String(row.id)!==String(next.id)),sessionForWrite(next)]}
 function removeSession(rows,id){return(rows||[]).filter(row=>String(row.id)!==String(id))}
 function derivedDocuments(faculty,sessions){return{facultyIndex:index.buildFacultyIndex(faculty,sessions),scheduleStats:index.scheduleStats(sessions)}}
 const number=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0};
 function contribution(session){const rows=new Map();for(const assignment of session?.assignments||[]){const id=String(assignment?.ucid||assignment?.facultyId||'').trim();if(!id)continue;const value=rows.get(id)||{count:0,doe:0};value.count++;value.doe+=number(assignment?.doeCredit);rows.set(id,value)}return rows}
 function applySessionChanges(facultyIndex,scheduleStats,changes){
  const faculty=JSON.parse(JSON.stringify(facultyIndex||{entries:[]})),stats=JSON.parse(JSON.stringify(scheduleStats||{})),entries=Array.isArray(faculty.entries)?faculty.entries:[];
  faculty.entries=entries;stats.sessionCount=number(stats.sessionCount);stats.courseCounts={...(stats.courseCounts||{})};
  const adjustCourse=(course,delta)=>{course=String(course||'').trim();if(!course)return;const next=number(stats.courseCounts[course])+delta;if(next>0)stats.courseCounts[course]=next;else delete stats.courseCounts[course]};
  const adjustFaculty=(session,sign)=>{for(const[id,value]of contribution(session)){const entry=entries.find(row=>String(row.id)===id);if(!entry)continue;entry.sessionCount=Math.max(0,number(entry.sessionCount)+sign*value.count);entry.assignedTeachingDOE=Number((number(entry.assignedTeachingDOE)+sign*value.doe).toFixed(6))}};
  for(const change of changes||[]){const before=change?.before||null,after=change?.after||null;if(before){stats.sessionCount=Math.max(0,stats.sessionCount-1);adjustCourse(before.course,-1);adjustFaculty(before,-1)}if(after){stats.sessionCount++;adjustCourse(after.course,1);adjustFaculty(after,1)}}
  stats.assignedFacultyCount=entries.filter(row=>number(row.sessionCount)>0).length;
  return{facultyIndex:faculty,scheduleStats:stats};
 }
 async function writeDerivedIndexes(db,faculty,sessions,actor={}){
  const docs=derivedDocuments(faculty,sessions),stamp=typeof firebase!=='undefined'&&firebase.firestore?.FieldValue?.serverTimestamp?firebase.firestore.FieldValue.serverTimestamp():new Date().toISOString();
  const meta={generatedAt:stamp,generatedBy:String(actor.uid||''),generatedByName:String(actor.name||'')};
  await Promise.all([
   db.collection('settings').doc('faculty_index').set({...docs.facultyIndex,...meta}),
   db.collection('settings').doc('schedule_stats').set({...docs.scheduleStats,...meta})
  ]);
  return docs;
 }
 async function updateDerivedIndexes(db,changes,actor={}){
  if(!changes?.length)return null;const facultyRef=db.collection('settings').doc('faculty_index'),statsRef=db.collection('settings').doc('schedule_stats');
  return db.runTransaction(async transaction=>{const [facultySnap,statsSnap]=await Promise.all([transaction.get(facultyRef),transaction.get(statsRef)]);if(!facultySnap.exists||!statsSnap.exists)throw Error('Derived indexes are not initialized.');const docs=applySessionChanges(facultySnap.data(),statsSnap.data(),changes),stamp=typeof firebase!=='undefined'&&firebase.firestore?.FieldValue?.serverTimestamp?firebase.firestore.FieldValue.serverTimestamp():new Date().toISOString(),meta={generatedAt:stamp,generatedBy:String(actor.uid||''),generatedByName:String(actor.name||'')};transaction.set(facultyRef,{...docs.facultyIndex,...meta});transaction.set(statsRef,{...docs.scheduleStats,...meta});return docs});
 }
 return{sessionForWrite,replaceSession,removeSession,derivedDocuments,applySessionChanges,writeDerivedIndexes,updateDerivedIndexes};
});
