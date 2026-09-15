'use strict';
window.UCVM_AUDIT_DETAILS=(()=>{
 const FIELD_LABELS={date:'Date',year:'Year',course:'Course',type:'Type',start:'Start time',end:'End time',topic:'Topic',room:'Room'};
 const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
 const faculty=value=>(Array.isArray(value)?value:[]).map(item=>String(item?.name||item?.facultyName||item?.ucid||item?.facultyId||'').trim()).filter(Boolean);
 function recovered(entry){
  const before=entry?.before,after=entry?.after;if(!before||!after)return[];
  const out=[];
  for(const [field,label] of Object.entries(FIELD_LABELS))if(!same(before[field],after[field]))out.push({field,label,before:before[field]??null,after:after[field]??null});
  const beforeFaculty=faculty(before.assignments),afterFaculty=faculty(after.assignments);
  if(!same(beforeFaculty,afterFaculty))out.push({field:'assignments',label:'Faculty',before:beforeFaculty,after:afterFaculty});
  return out;
 }
 function changes(entry){return Array.isArray(entry?.changes)&&entry.changes.length?entry.changes:entry?.action==='batch_update'?recovered(entry):[]}
 function group(items,expanded=false){const all=Array.isArray(items)?items:[];return expanded?{visible:all,remaining:0}:{visible:all.slice(0,3),remaining:Math.max(0,all.length-3)}}
 return{changes,group};
})();
