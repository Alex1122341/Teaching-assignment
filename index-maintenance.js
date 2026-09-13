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
 async function writeDerivedIndexes(db,faculty,sessions,actor={}){
  const docs=derivedDocuments(faculty,sessions),stamp=typeof firebase!=='undefined'&&firebase.firestore?.FieldValue?.serverTimestamp?firebase.firestore.FieldValue.serverTimestamp():new Date().toISOString();
  const meta={generatedAt:stamp,generatedBy:String(actor.uid||''),generatedByName:String(actor.name||'')};
  await Promise.all([
   db.collection('settings').doc('faculty_index').set({...docs.facultyIndex,...meta}),
   db.collection('settings').doc('schedule_stats').set({...docs.scheduleStats,...meta})
  ]);
  return docs;
 }
 return{sessionForWrite,replaceSession,removeSession,derivedDocuments,writeDerivedIndexes};
});
