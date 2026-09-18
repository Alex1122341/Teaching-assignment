'use strict';
window.UCVM_APPROVAL_FINALIZER=(()=>{
  const calendarApi=window.UCVM_CALENDAR_SESSION,scheduling=window.UCVM_SCHEDULING;
  if(!calendarApi||!scheduling)throw Error('UCVM calendar session sanitizer and scheduling core are required.');
  const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
  const text=value=>String(value??'').trim();
  const ymd=value=>text(value).slice(0,10);
  const publicFields=['course','courseName','year','semester','week','date','start','end','timeUnknown','type','topic','room','instructor'];
  const publicValue=(object,field)=>field==='date'?ymd(object?.[field]):object?.[field];
  function assertTimingPatch(base,patch){
    const check=scheduling.validateSessionTimingChange(base,patch);
    if(check.status==='invalid')throw Error(`Invalid session timing (${check.reason}).`);
    return check;
  }

  function changedFields(request={}){
    const base=request.basePublic||{},patch=request.patchPublic||{};
    return Object.keys(patch).filter(field=>publicFields.includes(field)&&!same(publicValue(base,field),publicValue(patch,field)));
  }
  function assertPublicBase(current,request,fields=changedFields(request)){
    const base=request.basePublic||{};
    for(const field of fields)if(!same(publicValue(current,field),publicValue(base,field)))throw Error(`The session changed after the request was submitted (${field}).`);
  }
  function planPublicApply({request={},calendar={}}={}){
    if(!request.sessionId)throw Error('Request session is required.');
    const fields=changedFields(request).filter(field=>field!=='instructor');
    assertPublicBase(calendar,request,fields);
    const sourcePatch={};for(const field of fields)sourcePatch[field]=request.patchPublic[field];
    assertTimingPatch(calendar,sourcePatch);
    const next={...calendar,...sourcePatch,sessionId:text(request.sessionId||calendar.sessionId)};
    return{changedFields:fields,sourcePatch,calendar:calendarApi.fromSource(next,next.sessionId)};
  }
  function assignedArray(source={}){
    if(Array.isArray(source.assignments)&&source.assignments.length)return source.assignments.map(item=>({...item}));
    return text(source.instructor).split(';').map(name=>name.trim()).filter(Boolean).map(name=>({name,ucid:''}));
  }
  function facultyIds(assignments=[]){return [...new Set(assignments.map(a=>text(a?.ucid||a?.facultyId)).filter(Boolean))];}
  function planFacultySwap({request={},source={},privateRecord={},resolved={}}={}){
    assertPublicBase(source,request,publicFields.filter(field=>Object.prototype.hasOwnProperty.call(request.basePublic||{},field)));
    const publicChanged=changedFields(request).filter(field=>field!=='instructor'),publicPatch={};
    for(const field of publicChanged)publicPatch[field]=request.patchPublic[field];
    assertTimingPatch(source,publicPatch);
    const change=privateRecord.assignmentChange||{},index=Number(change.assignmentIndex);
    if(!Number.isInteger(index)||index<0)throw Error('The private assignment reference is invalid.');
    const assignments=assignedArray(source);if(index>=assignments.length)throw Error('The outgoing instructor is no longer assigned.');
    const outgoing=assignments[index]||{},fromId=text(change.from?.facultyId),fromName=text(request.currentFacultyName);
    if((fromId&&text(outgoing.ucid||outgoing.facultyId)!==fromId)||(fromName&&text(outgoing.name)!==fromName))throw Error('The outgoing instructor is no longer assigned.');
    const name=text(resolved.name||request.proposedFacultyName);if(!name)throw Error('The replacement Faculty display name is required.');
    const incoming={...outgoing,name,source:'Approved routed request'};
    const kind=text(resolved.kind).toLowerCase();
    if(kind==='sessional'||kind==='other'||resolved.special===true){incoming.ucid='';delete incoming.facultyId;incoming.category=kind==='sessional'?'Sessional':'Other';}
    else{const id=text(resolved.facultyId);if(!id)throw Error('The replacement Faculty identity could not be resolved.');incoming.ucid=id;delete incoming.facultyId;incoming.category='Faculty';}
    assignments[index]=incoming;
    const instructor=assignments.map(a=>text(a.name)).filter(Boolean).join('; '),sourcePatch={...publicPatch,assignments,facultyIds:facultyIds(assignments),instructor};
    const next={...source,...sourcePatch};
    return{changedFields:[...new Set([...publicChanged,'assignments','facultyIds','instructor'])],sourcePatch,calendar:calendarApi.fromSource(next,text(request.sessionId||source.id))};
  }
  return{changedFields,assertPublicBase,planPublicApply,planFacultySwap};
})();
