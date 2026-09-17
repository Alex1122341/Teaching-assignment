'use strict';
window.UCVM_TIMETABLE_SELECTION=(()=>{
 const scheduling=window.UCVM_SCHEDULING;
 if(!scheduling)throw new Error('UCVM scheduling core is required.');
 const text=value=>String(value??'').trim();
 const facultyId=assignment=>text(assignment?.facultyId||assignment?.ucid);
 const facultyIds=row=>[...new Set((Array.isArray(row?.facultyIds)&&row.facultyIds.length?row.facultyIds:(row?.assignments||[]).map(facultyId)).map(text).filter(Boolean))];
 const clone=value=>JSON.parse(JSON.stringify(value??null));
 const canonical=value=>{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value};
 const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 const AUDIT_FIELDS={date:'Date',year:'Year',course:'Course',type:'Type',start:'Start time',end:'End time',topic:'Topic',room:'Room'};
 const assignmentNames=row=>(row?.assignments||[]).map(item=>text(item?.name)||facultyId(item)).filter(Boolean);
 function auditChanges(before,after){
  const out=[];
  for(const [field,label] of Object.entries(AUDIT_FIELDS))if(!equal(before?.[field],after?.[field]))out.push({field,label,before:before?.[field]??null,after:after?.[field]??null});
  const beforeFaculty=assignmentNames(before),afterFaculty=assignmentNames(after);
  if(!equal(beforeFaculty,afterFaculty))out.push({field:'assignments',label:'Faculty',before:beforeFaculty,after:afterFaculty});
  return out;
 }
 function createViewFlow(){
  let origin='week';
  return{
   begin(view){origin=text(view)||'week';return origin},
   review(){return'list'},
   finish(){return origin}
  };
 }
 function editable(row){
  const ids=facultyIds(row),assignments=clone(Array.isArray(row?.assignments)?row.assignments:[]).map((assignment,index)=>{
   const id=facultyId(assignment)||ids[index]||'';
   return{...assignment,ucid:id||null,facultyId:id||null,name:text(assignment.name),role:text(assignment.role||row?.type)};
  });
  return{date:text(row?.date),week:Number(row?.week),semester:text(row?.semester),year:Number(row?.year),course:text(row?.course),courseName:text(row?.courseName),type:text(row?.type),start:text(row?.start),end:text(row?.end),topic:text(row?.topic),room:text(row?.room),timeUnknown:Boolean(row?.timeUnknown),assignments,facultyIds:ids,instructor:assignments.map(item=>item.name).filter(Boolean).join('; '),labDetails:Array.isArray(row?.labDetails)?clone(row.labDetails):[]};
 }
 function create(max=200){
  const selected=new Set();
  return{
   toggle(id){id=text(id);if(!id)throw Error('A session ID is required.');if(selected.has(id)){selected.delete(id);return false}if(selected.size>=max)throw Error(`Select at most ${max} sessions.`);selected.add(id);return true},
   has:id=>selected.has(text(id)),clear:()=>selected.clear(),ids:()=>[...selected],get size(){return selected.size}
  };
 }
 function validateRow(row,rowNumber,facultyById){
  const prefix=`Row ${rowNumber}: `,errors=[],ids=facultyIds(row),timing=scheduling.validateSessionTiming(row);
  if(!scheduling.normalizeDate(row?.date))errors.push(prefix+'date must be a valid YYYY-MM-DD value.');
  if(![1,2,3,4].includes(Number(row?.year)))errors.push(prefix+'year must be 1, 2, 3, or 4.');
  if(!text(row?.course))errors.push(prefix+'course is required.');
  if(!text(row?.type))errors.push(prefix+'type is required.');
  const interval=timing.reason==='invalid_date'?scheduling.validateInterval(row?.start,row?.end,{timeUnknown:row?.timeUnknown===true}):timing;
  if(interval.status==='invalid')errors.push(prefix+'end time must be after start time and use a valid timetable time.');
  const known=id=>typeof facultyById?.has==='function'?facultyById.has(id):Boolean(facultyById?.[id]);
  if(!ids.length||ids.some(id=>!known(id)))errors.push(prefix+'assigned faculty must contain at least one valid faculty record.');
  return errors;
 }
 function selectedRows(source,ids){
  const byId=new Map((source||[]).filter(row=>!row?.isCcc).map(row=>[text(row.id),row]));
  return(ids||[]).map(id=>byId.get(text(id))).filter(Boolean);
 }
 function planChanges(originals,rows,actor,timestamp,facultyById){
  const originalById=new Map((originals||[]).map(row=>[text(row.id),row])),errors=[];
  (rows||[]).forEach((row,index)=>{
   errors.push(...validateRow(row,index+1,facultyById||new Map(facultyIds(row).map(id=>[id,true]))));
   if(!text(row.id)||!originalById.has(text(row.id)))errors.push(`Row ${index+1}: session does not exist.`);
  });
  if(errors.length)return{updates:[],logs:[],errors};
  const updates=[],logs=[];
  for(const [index,row] of (rows||[]).entries()){
   const original=originalById.get(text(row.id)),before=editable(original),after=editable(row);
   if(equal(before,after))continue;
   updates.push({id:text(row.id),data:after});
   logs.push({sessionId:text(row.id),action:'batch_update',changedBy:text(actor?.uid),changedByEmail:text(actor?.email),changedByName:text(actor?.name),changedAt:timestamp,before,after,changes:auditChanges(before,after),course:after.course,date:after.date,topic:after.topic,rowNumber:index+1});
  }
  return{updates,logs,errors:[]};
 }
 async function commitPlan(plan,store){
  if(plan.errors?.length||!plan.updates?.length)return{committed:false,operations:0,errors:[...(plan.errors||[])]};
  if(plan.updates.length!==plan.logs?.length)throw Error('Each session update must have one audit log.');
  const batch=store.batch();
  for(const update of plan.updates)batch.update(store.sessionRef(update.id),update.data);
  for(const log of plan.logs)batch.set(store.logRef(),log);
  await batch.commit();
  try{await store.afterCommit()}catch(error){error.committed=true;throw error}
  return{committed:true,operations:plan.updates.length+plan.logs.length,errors:[]};
 }
 return{create,createViewFlow,validateRow,selectedRows,planChanges,commitPlan};
})();
