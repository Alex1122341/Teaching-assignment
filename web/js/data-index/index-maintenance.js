(function(root,factory){
 const api=factory(root&&root.UCVM_DATA_INDEX);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_INDEX_MAINTENANCE=api;
})(typeof window!=='undefined'?window:null,function(indexApi){
 'use strict';
 const index=indexApi||(typeof require==='function'?require('./data-index.js'):null);
 const DERIVED_IDS=Object.freeze(['faculty_index','schedule_stats','faculty_swap_index','faculty_swap_map']);
 const GENERATION_META=new Set(['generatedAt','generatedBy','generatedByName']);
 function sessionForWrite(session){return{...(session||{}),facultyIds:index.sessionFacultyIds(session)}}
 function sessionPatchForWrite(session){const next={...(session||{})};if(Object.prototype.hasOwnProperty.call(next,'assignments')||Object.prototype.hasOwnProperty.call(next,'facultyIds'))next.facultyIds=index.sessionFacultyIds(next);return next}
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
 const finiteOrNull=value=>{if(value===null||value===undefined||value==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null};
 function contribution(session){
  const rows=new Map();
  for(const assignment of session?.assignments||[]){
   const id=String(assignment?.ucid||assignment?.facultyId||'').trim();if(!id)continue;
   const value=rows.get(id)||{count:0,doe:0,missingDoeCount:0,legacyDoeCount:0,policyVersionCounts:{}};value.count++;
   const credit=finiteOrNull(assignment?.doeCredit),version=String(assignment?.doePolicyVersionId||'').trim();
   if(credit===null)value.missingDoeCount++;else{value.doe+=credit;if(version)value.policyVersionCounts[version]=(value.policyVersionCounts[version]||0)+1;else value.legacyDoeCount++}
   rows.set(id,value);
  }
  return rows;
 }
 function applySessionChanges(facultyIndex,scheduleStats,changes){
  const faculty=JSON.parse(JSON.stringify(facultyIndex||{entries:[]})),stats=JSON.parse(JSON.stringify(scheduleStats||{})),entries=Array.isArray(faculty.entries)?faculty.entries:[];
  faculty.entries=entries;stats.sessionCount=number(stats.sessionCount);stats.courseCounts={...(stats.courseCounts||{})};
  const adjustCourse=(course,delta)=>{course=String(course||'').trim();if(!course)return;const next=number(stats.courseCounts[course])+delta;if(next>0)stats.courseCounts[course]=next;else delete stats.courseCounts[course]};
  const adjustFaculty=(session,sign)=>{for(const[id,value]of contribution(session)){const entry=entries.find(row=>String(row.id)===id);if(!entry)continue;entry.sessionCount=Math.max(0,number(entry.sessionCount)+sign*value.count);
   const canonical=Object.prototype.hasOwnProperty.call(entry,'scheduledDOE')||Object.prototype.hasOwnProperty.call(entry,'missingDoeCount')||Object.prototype.hasOwnProperty.call(entry,'policyVersionCounts');
   if(!canonical&&value.missingDoeCount===0){entry.assignedTeachingDOE=Number((number(entry.assignedTeachingDOE)+sign*value.doe).toFixed(6));continue}
   if(!canonical){entry.sourceAssignedTeachingDOE=finiteOrNull(entry.assignedTeachingDOE);entry.sourceScheduledTeachingDOE=0;entry.scheduledDOE=0;entry.managedRoleDOE=0;entry.missingDoeCount=0;entry.legacyDoeCount=0;entry.policyVersionCounts={};entry.effectiveTargetDOE=finiteOrNull(entry.effectiveTargetDOE)}
   entry.scheduledDOE=Number((number(entry.scheduledDOE)+sign*value.doe).toFixed(6));entry.missingDoeCount=Math.max(0,number(entry.missingDoeCount)+sign*value.missingDoeCount);entry.legacyDoeCount=Math.max(0,number(entry.legacyDoeCount)+sign*value.legacyDoeCount);entry.policyVersionCounts={...(entry.policyVersionCounts||{})};
   for(const [version,count] of Object.entries(value.policyVersionCounts||{})){const next=number(entry.policyVersionCounts[version])+sign*count;if(next>0)entry.policyVersionCounts[version]=next;else delete entry.policyVersionCounts[version]}
   Object.assign(entry,index.recomputeFacultyDoe(entry));
  }};
  for(const change of changes||[]){const before=change?.before||null,after=change?.after||null;if(before){stats.sessionCount=Math.max(0,stats.sessionCount-1);adjustCourse(before.course,-1);adjustFaculty(before,-1)}if(after){stats.sessionCount++;adjustCourse(after.course,1);adjustFaculty(after,1)}}
  stats.assignedFacultyCount=entries.filter(row=>number(row.sessionCount)>0).length;
  return{facultyIndex:faculty,scheduleStats:stats};
 }
 async function writeDerivedIndexes(db,faculty,sessions,actor={}){
  const [publicSnap,privateSnap]=await Promise.all([
   db.collection('settings').doc('faculty_swap_index').get(),
   db.collection('settings').doc('faculty_swap_map').get()
  ]);
  const publicIndex=publicSnap.exists?publicSnap.data():{schemaVersion:'ucvm-faculty-swap-index-v1',entries:[]},privateMap=privateSnap.exists?privateSnap.data():{schemaVersion:'ucvm-faculty-swap-map-v1',entries:[]};
  const identity=analyzeSwapIdentity({faculty,publicIndex,privateMap,publicExists:publicSnap.exists,privateExists:privateSnap.exists});
  if(identity.criticalIssues.length){
   const error=Error('Critical swap identity corruption blocks derived-index rebuild.');error.code='critical-derived-index';error.report={ok:false,severity:'critical',mismatchCount:identity.criticalIssues.length,mismatches:identity.criticalIssues};throw error;
  }
  const built=buildExpectedDerivedIndexes({faculty,sessions,privateMap,keyFactory:()=>db.collection('settings').doc().id,allocateMissingKeys:true}),stamp=stampValue(),meta={generatedAt:stamp,...actorMeta(actor)},batch=db.batch();
  batch.set(db.collection('settings').doc('faculty_index'),{...built.documents.faculty_index,...meta});
  batch.set(db.collection('settings').doc('schedule_stats'),{...built.documents.schedule_stats,...meta});
  batch.set(db.collection('settings').doc('faculty_swap_index'),{...built.documents.faculty_swap_index,generatedAt:stamp});
  batch.set(db.collection('settings').doc('faculty_swap_map'),{...built.documents.faculty_swap_map,...meta});
  await batch.commit();
  return{facultyIndex:built.documents.faculty_index,scheduleStats:built.documents.schedule_stats,publicIndex:built.documents.faculty_swap_index,privateMap:built.documents.faculty_swap_map};
 }
 async function updateDerivedIndexes(db,changes,actor={}){
  if(!changes?.length)return null;const facultyRef=db.collection('settings').doc('faculty_index'),statsRef=db.collection('settings').doc('schedule_stats');
  return db.runTransaction(async transaction=>{const [facultySnap,statsSnap]=await Promise.all([transaction.get(facultyRef),transaction.get(statsRef)]);if(!facultySnap.exists||!statsSnap.exists)throw Error('Derived indexes are not initialized.');const docs=applySessionChanges(facultySnap.data(),statsSnap.data(),changes),stamp=stampValue(),meta={generatedAt:stamp,...actorMeta(actor)};transaction.set(facultyRef,{...docs.facultyIndex,...meta});transaction.set(statsRef,{...docs.scheduleStats,...meta});return docs});
 }
 async function refreshCoreDerivedIndexes(db,actor={}){
  const [faculty,sessions]=await Promise.all([loadCollectionRows(db,'faculty'),loadCollectionRows(db,'sessions')]),docs=derivedDocuments(faculty,sessions),stamp=stampValue(),meta={generatedAt:stamp,...actorMeta(actor)},batch=db.batch();
  batch.set(db.collection('settings').doc('faculty_index'),{...docs.facultyIndex,...meta});
  batch.set(db.collection('settings').doc('schedule_stats'),{...docs.scheduleStats,...meta});
  await batch.commit();return docs;
 }
 const canonical=value=>Array.isArray(value)?value.map(canonical):(value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value);
 const sameCanonical=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 const withoutGenerationMeta=value=>{const next={...(value||{})};delete next.generatedAt;delete next.generatedBy;delete next.generatedByName;return next};
 function stripGenerationMeta(value){
  if(Array.isArray(value))return value.map(stripGenerationMeta);
  if(value&&typeof value==='object'){
   const out={};for(const[key,item]of Object.entries(value))if(!GENERATION_META.has(key))out[key]=stripGenerationMeta(item);return out;
  }
  return value;
 }
 function comparableDocument(id,value){
  const doc=stripGenerationMeta(value||{});
  if(id==='faculty_index'&&Array.isArray(doc.entries)){
   doc.entries=Object.fromEntries(doc.entries.map(row=>{const next={...row};if(Array.isArray(next.roleTypes))next.roleTypes=[...next.roleTypes].sort();return[String(row?.id||''),next]}).sort(([a],[b])=>a.localeCompare(b)));
  }
  if(id==='faculty_swap_index'&&Array.isArray(doc.entries)){
   doc.entries=Object.fromEntries(doc.entries.map(row=>{const next={...row};if(Array.isArray(next.aliases))next.aliases=[...next.aliases].sort();if(Array.isArray(next.unavailableRanges))next.unavailableRanges=[...next.unavailableRanges].sort((a,b)=>String(a?.startDate||'').localeCompare(String(b?.startDate||''))||String(a?.endDate||'').localeCompare(String(b?.endDate||'')));return[String(row?.key||''),next]}).sort(([a],[b])=>a.localeCompare(b)));
  }
  if(id==='faculty_swap_map'&&Array.isArray(doc.entries))doc.entries=Object.fromEntries(doc.entries.map(row=>[String(row?.facultyId||''),row]).sort(([a],[b])=>a.localeCompare(b)));
  return canonical(doc);
 }
 function diffValues(document,expected,actual,maxDetails=50){
  const mismatches=[];let count=0;
  const add=(path,expectedValue,actualValue,issue='value-mismatch',severity='mismatch')=>{count++;if(mismatches.length<maxDetails)mismatches.push({document,path,expected:expectedValue,actual:actualValue,issue,severity})};
  const walk=(left,right,path='')=>{
   if(sameCanonical(left,right))return;
   const lo=left&&typeof left==='object'&&!Array.isArray(left),ro=right&&typeof right==='object'&&!Array.isArray(right);
   if(lo&&ro){const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort();for(const key of keys)walk(left[key],right[key],path?`${path}.${key}`:key);return}
   add(path,left,right);
  };
  walk(expected,actual);return{count,mismatches};
 }
 function analyzeSwapIdentity({faculty,publicIndex,privateMap,publicExists=true,privateExists=true}){
  const activeIds=new Set((faculty||[]).filter(row=>row&&row.active!==false).map(row=>String(row.__id||row.id||row.ucid||'').trim()).filter(Boolean));
  const privateRows=Array.isArray(privateMap?.entries)?privateMap.entries:[],publicRows=Array.isArray(publicIndex?.entries)?publicIndex.entries:[],keyOwners=new Map(),facultyKeys=new Map(),criticalIssues=[];
  for(const row of privateRows){
   const facultyId=String(row?.facultyId||'').trim(),key=String(row?.key||'').trim();
   if(!facultyId||!key){criticalIssues.push({document:'faculty_swap_map',path:'entries',issue:'invalid-private-identity',expected:'non-empty facultyId and key',actual:{facultyId,key},severity:'critical'});continue}
   const owners=keyOwners.get(key)||new Set();owners.add(facultyId);keyOwners.set(key,owners);
   const keys=facultyKeys.get(facultyId)||new Set();keys.add(key);facultyKeys.set(facultyId,keys);
  }
  for(const[key,owners]of keyOwners)if(owners.size>1)criticalIssues.push({document:'faculty_swap_map',path:`key.${key}`,issue:'duplicate-key-ownership',expected:'one faculty owner',actual:[...owners].sort(),severity:'critical'});
  for(const[facultyId,keys]of facultyKeys)if(keys.size>1)criticalIssues.push({document:'faculty_swap_map',path:`faculty.${facultyId}`,issue:'conflicting-faculty-keys',expected:'one opaque key',actual:[...keys].sort(),severity:'critical'});
  const privateKeys=new Set(keyOwners.keys());
  if(!privateExists&&publicRows.some(row=>String(row?.key||'').trim()))criticalIssues.push({document:'faculty_swap_map',path:'document',issue:'missing-private-map-with-public-keys',expected:'private ownership map',actual:'missing',severity:'critical'});
  for(const row of publicRows){const key=String(row?.key||'').trim();if(key&&!privateKeys.has(key))criticalIssues.push({document:'faculty_swap_index',path:`entries.${key}`,issue:'public-key-without-private-owner',expected:'matching private ownership',actual:key,severity:'critical'})}
  const missingFacultyIds=[...activeIds].filter(id=>!facultyKeys.has(id)).sort(),staleFacultyIds=[...facultyKeys.keys()].filter(id=>!activeIds.has(id)).sort();
  const knownEntries=privateRows.filter(row=>{const facultyId=String(row?.facultyId||'').trim(),key=String(row?.key||'').trim();return activeIds.has(facultyId)&&key&&keyOwners.get(key)?.size===1&&facultyKeys.get(facultyId)?.size===1});
  return{criticalIssues,missingFacultyIds,staleFacultyIds,knownPrivateMap:{schemaVersion:'ucvm-faculty-swap-map-v1',entries:knownEntries}};
 }
 function buildExpectedDerivedIndexes({faculty,sessions,privateMap,keyFactory,allocateMissingKeys=false}){
  const base=derivedDocuments(faculty,sessions),active=(faculty||[]).filter(row=>row&&row.active!==false),analysis=analyzeSwapIdentity({faculty:active,publicIndex:{entries:[]},privateMap,publicExists:true,privateExists:true});
  const known=new Set((analysis.knownPrivateMap.entries||[]).map(row=>String(row.facultyId))),swapFaculty=allocateMissingKeys?active:active.filter(row=>known.has(String(row.__id||row.id||row.ucid||'')));
  const factory=allocateMissingKeys?keyFactory:()=>{throw Error('Verify cannot allocate opaque swap keys.')};
  const swap=index.buildFacultySwapIndexes(swapFaculty,analysis.knownPrivateMap,factory);
  return{documents:{faculty_index:base.facultyIndex,schedule_stats:base.scheduleStats,faculty_swap_index:swap.publicIndex,faculty_swap_map:swap.privateMap},swapAnalysis:analysis};
 }
 async function loadCollectionRows(db,name){const snap=await db.collection(name).get();return snap.docs.map(doc=>({...doc.data(),__id:doc.id}))}
 async function loadDerivedDocuments(db){
  const snaps=await Promise.all(DERIVED_IDS.map(id=>db.collection('settings').doc(id).get()));
  return Object.fromEntries(DERIVED_IDS.map((id,i)=>[id,{exists:snaps[i].exists,data:snaps[i].exists?snaps[i].data():undefined}]));
 }
 function structureIssues(id,loaded){
  if(!loaded?.exists)return[{document:id,path:'document',issue:'document-missing',expected:'document exists',actual:'missing',severity:'mismatch'}];
  const data=loaded.data;
  if(!data||typeof data!=='object'||Array.isArray(data))return[{document:id,path:'document',issue:'invalid-structure',expected:'object',actual:Array.isArray(data)?'array':typeof data,severity:'mismatch'}];
  if(id==='schedule_stats')return[];
  if(!Array.isArray(data.entries))return[{document:id,path:'entries',issue:'invalid-structure',expected:'array',actual:typeof data.entries,severity:'mismatch'}];
  if(id==='faculty_index'){
   const ids=data.entries.map(row=>String(row?.id||'').trim());if(ids.some(value=>!value)||new Set(ids).size!==ids.length)return[{document:id,path:'entries',issue:'invalid-structure',expected:'unique non-empty entry ids',actual:ids,severity:'mismatch'}];
  }
  if(id==='faculty_swap_index'){
   const keys=data.entries.map(row=>String(row?.key||'').trim());if(keys.some(value=>!value)||new Set(keys).size!==keys.length)return[{document:id,path:'entries',issue:'invalid-structure',expected:'unique non-empty keys',actual:keys,severity:'mismatch'}];
  }
  if(id==='faculty_swap_map'){
   const pairs=data.entries.map(row=>`${String(row?.facultyId||'').trim()}|${String(row?.key||'').trim()}`);if(new Set(pairs).size!==pairs.length)return[{document:id,path:'entries',issue:'invalid-structure',expected:'no duplicate private mapping rows',actual:pairs,severity:'mismatch'}];
  }
  return[];
 }
 function compareDerivedIndexDocuments({expected,actual,swapAnalysis,counts,maxDetails=50}){
  const mismatches=[],documents=Object.fromEntries(DERIVED_IDS.map(id=>[id,'healthy']));let mismatchCount=0;
  const rank={healthy:0,mismatch:1,critical:2};
  const mark=(document,severity)=>{const next=severity||'mismatch';if(rank[next]>rank[documents[document]])documents[document]=next};
  const push=row=>{mismatchCount++;mark(row.document,row.severity);if(mismatches.length<maxDetails)mismatches.push(row)};
  const criticalSwap=(swapAnalysis.criticalIssues||[]).length>0,stale=new Set(swapAnalysis.staleFacultyIds||[]);
  for(const id of DERIVED_IDS){
   const issues=structureIssues(id,actual[id]);if(issues.length){for(const row of issues)push(row);continue}
   if(criticalSwap&&(id==='faculty_swap_index'||id==='faculty_swap_map'))continue;
   let actualData=actual[id].data;
   if(id==='faculty_swap_map'&&stale.size&&Array.isArray(actualData?.entries))actualData={...actualData,entries:actualData.entries.filter(row=>!stale.has(String(row?.facultyId||'').trim()))};
   const remaining=Math.max(0,maxDetails-mismatches.length),diff=diffValues(id,comparableDocument(id,expected[id]),comparableDocument(id,actualData),remaining);
   if(diff.count){mismatchCount+=diff.count;mark(id,'mismatch');mismatches.push(...diff.mismatches)}
  }
  for(const facultyId of swapAnalysis.missingFacultyIds||[])push({document:'faculty_swap_map',path:`faculty.${facultyId}`,issue:'missing-new-faculty-key',expected:'opaque key allocated during rebuild',actual:'missing',severity:'mismatch'});
  for(const facultyId of swapAnalysis.staleFacultyIds||[])push({document:'faculty_swap_map',path:`faculty.${facultyId}`,issue:'stale-private-mapping',expected:'removed for inactive/deleted faculty',actual:'present',severity:'mismatch'});
  for(const row of swapAnalysis.criticalIssues||[])push(row);
  const severity=Object.values(documents).includes('critical')?'critical':Object.values(documents).includes('mismatch')?'mismatch':'healthy';
  return{ok:severity==='healthy',severity,checkedAt:new Date().toISOString(),counts,documents,mismatchCount,mismatches};
 }
 async function verifyDerivedIndexes(db,{faculty,sessions,maxDetails=50}={}){
  const sourceFaculty=faculty===undefined?await loadCollectionRows(db,'faculty'):faculty,sourceSessions=sessions===undefined?await loadCollectionRows(db,'sessions'):sessions,actual=await loadDerivedDocuments(db);
  const privateMap=actual.faculty_swap_map.exists?actual.faculty_swap_map.data:{schemaVersion:'ucvm-faculty-swap-map-v1',entries:[]},publicIndex=actual.faculty_swap_index.exists?actual.faculty_swap_index.data:{schemaVersion:'ucvm-faculty-swap-index-v1',entries:[]};
  const built=buildExpectedDerivedIndexes({faculty:sourceFaculty,sessions:sourceSessions,privateMap,allocateMissingKeys:false}),swapAnalysis=analyzeSwapIdentity({faculty:sourceFaculty,publicIndex,privateMap,publicExists:actual.faculty_swap_index.exists,privateExists:actual.faculty_swap_map.exists});
  return compareDerivedIndexDocuments({expected:built.documents,actual,swapAnalysis,counts:{faculty:sourceFaculty.length,sessions:sourceSessions.length},maxDetails});
 }
 async function rebuildDerivedIndexes(db,actor={}){
  const [faculty,sessions]=await Promise.all([loadCollectionRows(db,'faculty'),loadCollectionRows(db,'sessions')]),before=await verifyDerivedIndexes(db,{faculty,sessions});
  if(before.severity==='critical'){
   const error=Error('Critical swap identity corruption blocks derived-index rebuild.');error.code='critical-derived-index';error.report=before;throw error;
  }
  await writeDerivedIndexes(db,faculty,sessions,actor);
  const after=await verifyDerivedIndexes(db);
  if(!after.ok){const error=Error('Derived indexes were written but post-rebuild verification is not healthy.');error.code='derived-index-post-verify-failed';error.report=after;throw error}
  return after;
 }
 async function verifyDerivedIndexesProvisional(db,faculty,sessions){
  const report=await verifyDerivedIndexes(db,{faculty,sessions});
  const errors=(report.mismatches||[]).map(row=>{
   const location=[String(row?.document||''),String(row?.path||'')].filter(Boolean).join('.');
   return`Derived index ${location||'verification'}: ${String(row?.issue||'mismatch')}.`;
  });
  return{...report,errors};
 }
 return{sessionForWrite,sessionPatchForWrite,replaceSession,removeSession,derivedDocuments,applySessionChanges,writeDerivedIndexes,rebuildDerivedIndexes,updateDerivedIndexes,refreshCoreDerivedIndexes,verifyDerivedIndexes,verifyDerivedIndexesProvisional,analyzeSwapIdentity,buildExpectedDerivedIndexes,compareDerivedIndexDocuments,writeFacultySwapIndexes,addFacultySwapUnavailableRange,prepareFacultySwapAfcUpdate};
});