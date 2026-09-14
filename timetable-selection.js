'use strict';
window.UCVM_TIMETABLE_SELECTION=(()=>{
 const text=value=>String(value??'').trim();
 const facultyId=assignment=>text(assignment?.facultyId||assignment?.ucid);
 const facultyIds=row=>[...new Set((Array.isArray(row?.facultyIds)&&row.facultyIds.length?row.facultyIds:(row?.assignments||[]).map(facultyId)).map(text).filter(Boolean))];
 const validDate=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(text(value)))return false;const [y,m,d]=text(value).split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d};
 const minutes=value=>{const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(text(value));return match?Number(match[1])*60+Number(match[2]):null};
 const clone=value=>JSON.parse(JSON.stringify(value??null));
 const canonical=value=>{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value};
 const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 function editable(row){
  const ids=facultyIds(row),assignments=clone(Array.isArray(row?.assignments)?row.assignments:[]).map((assignment,index)=>{
   const id=facultyId(assignment)||ids[index]||'';
   return{...assignment,ucid:id||null,facultyId:id||null,name:text(assignment.name),role:text(assignment.role||row?.type)};
  });
  return{date:text(row?.date),year:Number(row?.year),course:text(row?.course),type:text(row?.type),start:text(row?.start),end:text(row?.end),topic:text(row?.topic),room:text(row?.room),assignments,facultyIds:ids,instructor:assignments.map(item=>item.name).filter(Boolean).join('; ')};
 }
 function create(max=200){
  const selected=new Set();
  return{
   toggle(id){id=text(id);if(!id)throw Error('A session ID is required.');if(selected.has(id)){selected.delete(id);return false}if(selected.size>=max)throw Error(`Select at most ${max} sessions.`);selected.add(id);return true},
   has:id=>selected.has(text(id)),clear:()=>selected.clear(),ids:()=>[...selected],get size(){return selected.size}
  };
 }
 function validateRow(row,rowNumber,facultyById){
  const prefix=`Row ${rowNumber}: `,errors=[],ids=facultyIds(row),start=minutes(row?.start),end=minutes(row?.end);
  if(!validDate(row?.date))errors.push(prefix+'date must be a valid YYYY-MM-DD value.');
  if(![1,2,3,4].includes(Number(row?.year)))errors.push(prefix+'year must be 1, 2, 3, or 4.');
  if(!text(row?.course))errors.push(prefix+'course is required.');
  if(!text(row?.type))errors.push(prefix+'type is required.');
  if(start===null)errors.push(prefix+'start time must use HH:MM.');
  if(end===null)errors.push(prefix+'end time must use HH:MM.');
  else if(start!==null&&end<=start)errors.push(prefix+'end time must be after start time.');
  const known=id=>typeof facultyById?.has==='function'?facultyById.has(id):Boolean(facultyById?.[id]);
  if(!ids.length||ids.some(id=>!known(id)))errors.push(prefix+'assigned faculty must contain at least one valid faculty record.');
  return errors;
 }
 function planChanges(originals,rows,actor,timestamp){
  const originalById=new Map((originals||[]).map(row=>[text(row.id),row])),errors=[];
  (rows||[]).forEach((row,index)=>{
   const ids=facultyIds(row),known=new Map(ids.map(id=>[id,true]));
   errors.push(...validateRow(row,index+1,known));
   if(!text(row.id)||!originalById.has(text(row.id)))errors.push(`Row ${index+1}: session does not exist.`);
  });
  if(errors.length)return{updates:[],logs:[],errors};
  const updates=[],logs=[];
  for(const [index,row] of (rows||[]).entries()){
   const original=originalById.get(text(row.id)),before=editable(original),after=editable(row);
   if(equal(before,after))continue;
   updates.push({id:text(row.id),data:after});
   logs.push({sessionId:text(row.id),action:'batch_update',changedBy:text(actor?.uid),changedByEmail:text(actor?.email),changedByName:text(actor?.name),changedAt:timestamp,before,after,course:after.course,date:after.date,topic:after.topic,rowNumber:index+1});
  }
  return{updates,logs,errors:[]};
 }
 return{create,validateRow,planChanges};
})();
