'use strict';
window.UCVM_AUDIT_DETAILS=(()=>{
 const SESSION_FIELDS={date:'Date',year:'Year',course:'Course',type:'Type',start:'Start time',end:'End time',topic:'Topic',room:'Room'};
 const FACULTY_FIELDS={ucid:'UCID',preferredFullName:'Preferred name',hrFullName:'HR full name',firstName:'First name',lastName:'Last name',email:'Email',reportsTo:'Reports to',currentTitle:'Current title',rank:'Rank',teachingArea:'Teaching area',teachingAreaEmphasis:'Teaching emphasis',fte:'FTE',campus:'Campus',office:'Office'};
 const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
 const faculty=value=>(Array.isArray(value)?value:[]).map(item=>String(item?.name||item?.facultyName||item?.ucid||item?.facultyId||'').trim()).filter(Boolean);
 function recovered(entry){
  const before=entry?.before,after=entry?.after;if(!before||!after)return[];
  const out=[];
  for(const [field,label] of Object.entries(SESSION_FIELDS))if(!same(before[field],after[field]))out.push({field,label,before:before[field]??null,after:after[field]??null});
  const beforeFaculty=faculty(before.assignments),afterFaculty=faculty(after.assignments);
  if(!same(beforeFaculty,afterFaculty))out.push({field:'assignments',label:'Faculty',before:beforeFaculty,after:afterFaculty});
  return out;
 }
 function changes(entry){
  const out=Array.isArray(entry?.changes)&&entry.changes.length?[...entry.changes]:entry?.action==='batch_update'?recovered(entry):[],override=entry?.override;
  if(override?.type!=='faculty_time_conflict'||override.confirmed!==true)return out;
  if(!out.length&&entry.action==='swap_faculty')out.push({field:'assignments',label:'Faculty',before:entry.fromFaculty?.name||'',after:entry.toFaculty?.name||''});
  if(!out.length&&['create','delete'].includes(entry.action)){const summary=[entry.course,entry.date,entry.topic].filter(Boolean).join(' - ');out.push({field:'session',label:'Session',before:entry.action==='delete'?summary:null,after:entry.action==='create'?summary:null});}
  const details=(Array.isArray(override.conflicts)?override.conflicts:[]).map(s=>`${s.course||'Course'} ${s.date||''} ${s.start||''}-${s.end||''}`).join('; ');
  out.push({field:'conflictOverride',label:'Faculty timetable conflict override',before:'Conflict detected',after:`Confirmed by ${override.confirmedByName||override.confirmedBy||'administrator'}: ${details}`});
  return out;
 }
 function diff(before,after,kind='session'){
  const fields=kind==='faculty'?FACULTY_FIELDS:SESSION_FIELDS,out=[];
  for(const [field,label] of Object.entries(fields)){const b=before?.[field]??null,a=after?.[field]??null;if(same(b,a))continue;if(before===null&&(a===null||a===''))continue;if(after===null&&(b===null||b===''))continue;out.push({field,label,before:b,after:a})}
  if(kind==='session'){const b=faculty(before?.assignments),a=faculty(after?.assignments);if(!same(b,a))out.push({field:'assignments',label:'Faculty',before:before?b:null,after:after?a:null})}
  return out;
 }
 function group(items,expanded=false){const all=Array.isArray(items)?items:[];return expanded?{visible:all,remaining:0}:{visible:all.slice(0,3),remaining:Math.max(0,all.length-3)}}
 return{changes,diff,group};
})();
