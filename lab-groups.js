/* LAB groups and student rosters.
 *
 * Pure logic. No DOM, no Firebase, so the rules below are testable directly.
 *
 * Key invariants:
 *   - A group always has a CODE and a COLOUR KEY. Colour is never the only
 *     signal: every renderer must show the code text (Group A / B / C / D).
 *   - Student IDs live only in the private roster collection. The sanitized
 *     calendar read model may carry group codes, colour keys and student COUNTS,
 *     never student IDs.
 *   - The paste parser never silently discards a row: every rejected row is
 *     reported with its line number and reason.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_LAB_GROUPS=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const GROUP_CODES=['A','B','C','D','E','F','G','H'];
 const COLOR_KEYS=['group-a','group-b','group-c','group-d','group-e','group-f','group-g','group-h'];
 const STUDENT_ID_PATTERN=/^\d{6,12}$/;
 const text=value=>String(value??'').trim();

 function groupCodeForIndex(index){
  const position=Number(index);
  if(!Number.isInteger(position)||position<0)return'';
  if(position<GROUP_CODES.length)return GROUP_CODES[position];
  // Beyond the named codes keep going with a deterministic code rather than
  // silently dropping the group.
  return`G${position+1}`;
 }
 function colorKeyForCode(code){
  const normalized=text(code).toUpperCase(),index=GROUP_CODES.indexOf(normalized);
  if(index>=0)return COLOR_KEYS[index];
  return`group-${normalized.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;
 }
 function isKnownGroupCode(code){return GROUP_CODES.includes(text(code).toUpperCase())}

 /* One lab_groups/{groupId} document. */
 function createGroup({groupId,academicYear='',course='',groupCode='',active=true,updatedAt=null,updatedBy='',updatedByName=''}={}){
  const code=text(groupCode).toUpperCase()||'A';
  return{
   groupId:text(groupId),
   academicYear:text(academicYear),
   course:text(course),
   groupCode:code,
   colorKey:colorKeyForCode(code),
   active:active!==false,
   updatedAt,updatedBy:text(updatedBy),updatedByName:text(updatedByName)
  };
 }

 function validateStudentId(value){
  const raw=text(value);
  if(!raw)return{valid:false,reason:'empty'};
  if(!STUDENT_ID_PATTERN.test(raw))return{valid:false,reason:'invalid_shape'};
  return{valid:true,studentId:raw};
 }

 /* Parse pasted roster text. Supported shapes:
  *   one column   -> 30012345
  *   two columns  -> 30012345 <TAB> A
  * Columns may be separated by a tab or by whitespace. Blank lines are ignored.
  * Returns every rejected row with its 1-based line number.
  */
 function parseRoster(input,{defaultGroupCode='A',existingMembership={}}={}){
  const fallback=text(defaultGroupCode).toUpperCase()||'A';
  const lines=String(input??'').split(/\r?\n/);
  const entries=[],invalid=[],duplicates=[],seen=new Map(),membership=new Map();
  for(const [key,value] of Object.entries(existingMembership||{})){
   const studentId=text(key);if(studentId)membership.set(studentId,text(value).toUpperCase());
  }
  lines.forEach((line,index)=>{
   const lineNumber=index+1;
   const trimmed=line.trim();
   if(!trimmed)return; // blank rows are ignored, not reported
   const columns=trimmed.split(/\t|\s{2,}|\s+/).filter(Boolean);
   const studentId=text(columns[0]);
   const groupCode=(text(columns[1])||fallback).toUpperCase();
   const check=validateStudentId(studentId);
   if(!check.valid){invalid.push({line:lineNumber,value:trimmed,reason:check.reason});return}
   if(seen.has(studentId)){
    duplicates.push({line:lineNumber,value:trimmed,studentId,reason:'duplicate_in_paste',firstLine:seen.get(studentId)});
    return;
   }
   const known=membership.get(studentId);
   if(known&&known!==groupCode){
    duplicates.push({line:lineNumber,value:trimmed,studentId,reason:'already_in_another_group',existingGroupCode:known});
    return;
   }
   seen.set(studentId,lineNumber);
   entries.push({studentId,groupCode,line:lineNumber});
  });
  const countByGroup={};
  for(const entry of entries)countByGroup[entry.groupCode]=(countByGroup[entry.groupCode]||0)+1;
  return{
   entries,
   studentIds:entries.map(entry=>entry.studentId),
   invalid,
   duplicates,
   countByGroup,
   count:entries.length,
   // A paste is only savable when nothing was rejected. Invalid rows are never
   // dropped silently.
   ok:invalid.length===0&&duplicates.length===0
  };
 }

 function rosterFor(groupId,{studentIds=[],updatedAt=null,updatedBy='',updatedByName=''}={}){
  return{
   groupId:text(groupId),
   studentIds:[...new Set((Array.isArray(studentIds)?studentIds:[]).map(text).filter(Boolean))],
   updatedAt,updatedBy:text(updatedBy),updatedByName:text(updatedByName)
  };
 }

 /* Sanitized projection for calendar_sessions. Student IDs are NEVER included. */
 function sanitizedGroups(session={},groups=[],rosters={}){
  const ids=[...new Set((Array.isArray(session?.labGroupIds)?session.labGroupIds:[]).map(text).filter(Boolean))];
  const byId=new Map((Array.isArray(groups)?groups:[]).map(group=>[text(group?.groupId),group]));
  return ids.map(groupId=>{
   const group=byId.get(groupId)||{};
   const roster=rosters?.[groupId];
   return{
    groupId,
    groupCode:text(group.groupCode).toUpperCase(),
    colorKey:text(group.colorKey)||colorKeyForCode(group.groupCode),
    studentCount:Array.isArray(roster?.studentIds)?roster.studentIds.length:0
   };
  });
 }

 /* Strip anything roster-shaped that must never reach a sanitized document. */
 function sanitizeCalendarPayload(payload={}){
  const out={...payload};
  delete out.studentIds;
  delete out.roster;
  delete out.rosters;
  delete out.studentNames;
  if(Array.isArray(out.labGroups))out.labGroups=out.labGroups.map(group=>({groupId:group?.groupId||'',groupCode:text(group?.groupCode).toUpperCase(),colorKey:text(group?.colorKey),studentCount:Number(group?.studentCount)||0}));
  return out;
 }

 /* LAB completion: topic + at least one group + a roster for every required group. */
 function completionState(session={},rosters={}){
  const ids=[...new Set((Array.isArray(session?.labGroupIds)?session.labGroupIds:[]).map(text).filter(Boolean))];
  const missing=[];
  if(!text(session?.topic))missing.push('topic');
  if(!ids.length)missing.push('labGroups');
  else{
   const withoutRoster=ids.filter(groupId=>{
    const roster=rosters?.[groupId];
    return !Array.isArray(roster?.studentIds)||roster.studentIds.filter(id=>text(id)).length===0;
   });
   if(withoutRoster.length)missing.push('labRoster');
  }
  return{required:['topic','labGroups','labRoster'],missing,complete:missing.length===0,groupIds:ids};
 }

 /* Roster permission: student IDs are limited to LAB, Developer and Owner, plus
    an explicit administrative override. Faculty / VISC / HICC / Other Office /
    ADC never receive them through a calendar read. */
 function canReadRoster(role){
  const name=text(role).toLowerCase();
  if(name==='developer'||name==='owner'||name==='adfa_general'||name==='lab')return true;
  return false;
 }

 return Object.freeze({
  GROUP_CODES,COLOR_KEYS,STUDENT_ID_PATTERN,
  groupCodeForIndex,colorKeyForCode,isKnownGroupCode,createGroup,
  validateStudentId,parseRoster,rosterFor,
  sanitizedGroups,sanitizeCalendarPayload,completionState,canReadRoster
 });
});
