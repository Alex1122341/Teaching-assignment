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
 const stampValue=()=>typeof firebase!=='undefined'&&firebase.firestore?.FieldValue?.serverTimestamp?firebase.firestore.FieldValue.serverTimestamp():new Date().toISOString();
 const actorMeta=actor=>({generatedBy:String(actor?.uid||''),generatedByName:String(actor?.name||'')});
 function addFacultySwapUnavailableRange(publicIndex,privateMap,facultyId,startDate,endDate){
  const next=JSON.parse(JSON.stringify(publicIndex||{schemaVersion:'ucvm-faculty-swap-index-v1',entries:[]})),mapRows=Array.isArray(privateMap?.entries)?privateMap.entries:[],mapping=mapRows.find(row=>String(row?.facultyId||'')===String(facultyId||''));
  if(!mapping)return next;const row=(Array.isArray(next.entries)?next.entries:[]).find(item=>String(item?.key||'')===String(mapping.key||''));if(!row)return next;
  const start=String(startDate||'').slice(0,10),end=String(endDate||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)return next;
  const ranges=Array.isArray(row.unavailableRanges)?row.unavailableRanges:[],key=`${start}|${end}`;if(!ranges.some(r=>`${r.startDate}|${r.endDate}`===key))ranges.push({startDate:start,endDate:end});row.unavailableRanges=ranges.sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate))||String(a.endDate).localeCompare(String(b.endDate)));return next;
 }
 async function buildFacultySwapIndexesForDb(db,faculty){const mapRef=db.collection('settings').doc('faculty_swap_map'),snap=await mapRef.get(),previous=snap.exists?snap.data():{entries:[]},keyFactory=()=>db.collection('settings').doc().id;return index.buildFacultySwapIndexes(faculty,previous,keyFactory)}
 async function writeFacultySwapIndexes(db,faculty,actor={}){
  const built=await buildFacultySwapIndexesForDb(db,faculty),stamp=stampValue(),privateMeta=actorMeta(actor);
  await Promise.all([db.collection('settings').doc('faculty_swap_index').set({...built.publicIndex,generatedAt:stamp}),db.collection('settings').doc('faculty_swap_map').set({...built.privateMap,generatedAt:stamp,...privateMeta})]);return built;
 }
 async function prepareFacultySwapAfcUpdate(db,facultyId,startDate,endDate){
  const publicRef=db.collection('settings').doc('faculty_swap_index'),mapRef=db.collection('settings').doc('faculty_swap_map'),[publicSnap,mapSnap]=await Promise.all([publicRef.get(),mapRef.get()]);
  if(!publicSnap.exists||!mapSnap.exists)return null;return{ref:publicRef,data:addFacultySwapUnavailableRange(publicSnap.data(),mapSnap.data(),facultyId,startDate,endDate)};
 }
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
  const docs=derivedDocuments(faculty,sessions),swap=await buildFacultySwapIndexesForDb(db,faculty),stamp=stampValue(),meta={generatedAt:stamp,...actorMeta(actor)};
  await Promise.all([
   db.collection('settings').doc('faculty_index').set({...docs.facultyIndex,...meta}),
   db.collection('settings').doc('schedule_stats').set({...docs.scheduleStats,...meta}),
   db.collection('settings').doc('faculty_swap_index').set({...swap.publicIndex,generatedAt:stamp}),
   db.collection('settings').doc('faculty_swap_map').set({...swap.privateMap,...meta})
  ]);
  return{...docs,...swap};
 }
 async function updateDerivedIndexes(db,changes,actor={}){
  if(!changes?.length)return null;const facultyRef=db.collection('settings').doc('faculty_index'),statsRef=db.collection('settings').doc('schedule_stats');
  return db.runTransaction(async transaction=>{const [facultySnap,statsSnap]=await Promise.all([transaction.get(facultyRef),transaction.get(statsRef)]);if(!facultySnap.exists||!statsSnap.exists)throw Error('Derived indexes are not initialized.');const docs=applySessionChanges(facultySnap.data(),statsSnap.data(),changes),stamp=stampValue(),meta={generatedAt:stamp,...actorMeta(actor)};transaction.set(facultyRef,{...docs.facultyIndex,...meta});transaction.set(statsRef,{...docs.scheduleStats,...meta});return docs});
 }
 const canonical=value=>Array.isArray(value)?value.map(canonical):(value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value);
 const sameCanonical=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 const withoutGenerationMeta=value=>{const next={...(value||{})};delete next.generatedAt;delete next.generatedBy;delete next.generatedByName;return next};
 async function verifyDerivedIndexesProvisional(db,faculty,sessions){
  const ids=['faculty_index','schedule_stats','faculty_swap_index','faculty_swap_map'],snaps=await Promise.all(ids.map(id=>db.collection('settings').doc(id).get())),errors=[],byId=new Map(ids.map((id,index)=>[id,snaps[index]])),expected=derivedDocuments(faculty,sessions);
  for(const id of ids)if(!byId.get(id)?.exists)errors.push(`Derived index ${id} is missing.`);
  const facultySnap=byId.get('faculty_index'),statsSnap=byId.get('schedule_stats');
  if(facultySnap?.exists&&!sameCanonical(withoutGenerationMeta(facultySnap.data()),expected.facultyIndex))errors.push('Derived index faculty_index does not match canonical faculty/session data.');
  if(statsSnap?.exists&&!sameCanonical(withoutGenerationMeta(statsSnap.data()),expected.scheduleStats))errors.push('Derived index schedule_stats does not match canonical session data.');
  const publicSnap=byId.get('faculty_swap_index'),privateSnap=byId.get('faculty_swap_map');
  if(publicSnap?.exists&&!Array.isArray(publicSnap.data()?.entries))errors.push('Derived index faculty_swap_index entries are invalid.');
  if(privateSnap?.exists&&!Array.isArray(privateSnap.data()?.entries))errors.push('Derived index faculty_swap_map entries are invalid.');
  if(publicSnap?.exists&&privateSnap?.exists&&Array.isArray(publicSnap.data()?.entries)&&Array.isArray(privateSnap.data()?.entries)&&publicSnap.data().entries.length!==privateSnap.data().entries.length)errors.push('Derived swap indexes have different entry counts.');
  return{ok:errors.length===0,errors};
 }
 return{sessionForWrite,replaceSession,removeSession,derivedDocuments,applySessionChanges,writeDerivedIndexes,updateDerivedIndexes,verifyDerivedIndexesProvisional,writeFacultySwapIndexes,addFacultySwapUnavailableRange,prepareFacultySwapAfcUpdate};
});
