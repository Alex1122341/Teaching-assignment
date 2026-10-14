/* Multi-Faculty assignment on a session.
 *
 * `assignments[]` is the canonical representation. A session may carry several
 * Faculty members, so this module never collapses them to a single string:
 * `facultyIds[]` and the display-only `instructor` line are always DERIVED from
 * `assignments[]`, never edited directly.
 *
 * Pure logic: no DOM, no Firebase.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_FACULTY_ASSIGNMENT=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const text=value=>String(value??'').trim();

 function facultyKey(entry){return text(entry?.facultyId||entry?.ucid)}
 function displayName(entry){return text(entry?.name||entry?.preferredFullName||entry?.hrFullName||facultyKey(entry))}
 function normalizeAssignments(value){return Array.isArray(value)?value.filter(row=>row&&facultyKey(row)):[]}

 /* Display names in assignment order. Multi-Faculty is preserved in full. */
 function assignmentNames(assignments){
  return normalizeAssignments(assignments).map(displayName).filter(Boolean);
 }
 /* The derived, display-only instructor line. */
 function instructorLine(assignments){
  return assignmentNames(assignments).join('; ');
 }
 function facultyIds(assignments){
  return [...new Set(normalizeAssignments(assignments).map(facultyKey))];
 }

 /* Recompute the derived fields from the canonical assignments list. */
 function syncSession(session={},assignments){
  const next=normalizeAssignments(assignments===undefined?session.assignments:assignments);
  return{...session,assignments:next,facultyIds:facultyIds(next),instructor:instructorLine(next)};
 }

 /* Add one Faculty member. A duplicate is refused rather than silently merged. */
 function addFaculty(session={},faculty={},options={}){
  const current=normalizeAssignments(session.assignments),key=facultyKey(faculty);
  if(!key)return{session,added:false,reason:'missing_faculty_id'};
  if(current.some(entry=>facultyKey(entry)===key))return{session,added:false,reason:'duplicate_faculty'};
  const entry={
   ...(faculty||{}),
   facultyId:key,
   ucid:text(faculty.ucid||key),
   name:displayName(faculty),
   role:text(faculty.role||options.role||''),
   topic:text(faculty.topic??options.topic??session.topic),
   creditedHours:faculty.creditedHours??options.creditedHours??null,
   source:text(faculty.source||options.source||'Faculty assignment')
  };
  const next=[...current,entry];
  return{session:syncSession(session,next),added:true,reason:'',entry};
 }

 /* Remove one Faculty member, keeping every other assignment intact. */
 function removeFaculty(session={},key){
  const target=text(key),current=normalizeAssignments(session.assignments);
  const next=current.filter(entry=>facultyKey(entry)!==target);
  if(next.length===current.length)return{session,removed:false,reason:'not_assigned'};
  return{session:syncSession(session,next),removed:true,reason:''};
 }

 /* Ordered before/after change records. Never reduces a multi-Faculty change to
    the first name. */
 function facultyChanges(before={},after={}){
  const from=normalizeAssignments(before?.assignments),to=normalizeAssignments(after?.assignments);
  const beforeNames=assignmentNames(from),afterNames=assignmentNames(to);
  if(JSON.stringify(beforeNames)===JSON.stringify(afterNames))return[];
  const beforeKeys=facultyIds(from),afterKeys=facultyIds(to);
  const added=afterKeys.filter(key=>!beforeKeys.includes(key));
  const removed=beforeKeys.filter(key=>!afterKeys.includes(key));
  const changes=[{field:'assignments',label:'Faculty',before:beforeNames,after:afterNames}];
  if(added.length)changes.push({field:'facultyAdded',label:'Faculty added',before:null,after:added.map(key=>displayName(to.find(entry=>facultyKey(entry)===key)||{facultyId:key}))});
  if(removed.length)changes.push({field:'facultyRemoved',label:'Faculty removed',before:removed.map(key=>displayName(from.find(entry=>facultyKey(entry)===key)||{facultyId:key})),after:null});
  return changes;
 }

 /* Human-readable summary, e.g. "Dr A; Dr B → Dr A; Dr C". */
 function describeFacultyChange(before={},after={}){
  const from=assignmentNames(before?.assignments).join('; ')||'None';
  const to=assignmentNames(after?.assignments).join('; ')||'None';
  return from===to?'':`${from} → ${to}`;
 }

 /* Conflict / availability checks must consider every assigned Faculty member,
    not just the first. */
 function assignedFacultyKeys(session={}){return facultyIds(session.assignments)}

 return Object.freeze({
  facultyKey,displayName,normalizeAssignments,assignmentNames,instructorLine,facultyIds,
  syncSession,addFaculty,removeFaculty,facultyChanges,describeFacultyChange,assignedFacultyKeys
 });
});
