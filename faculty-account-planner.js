(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_ACCOUNT_PLANNER=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const SUPPORTED=['Course Coordinator','HICC','VISC','Course Coordinator / HICC','Rotation / Week Lead','CCC','Trainee / Supervision','Special Project','Other'];
 const PRIVILEGED=new Set(['developer','owner','administrator','other_office','adfa_general','adfa_regular','admin']);
 const text=value=>String(value??'').trim();
 const normalize=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 const number=value=>{if(value===null||value===undefined||value==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null};
 const email=value=>text(value).toLowerCase();
 const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(value));
 const facultyId=faculty=>text(faculty?.__id||faculty?.id||faculty?.ucid);
 const facultyName=faculty=>text(faculty?.preferredFullName||faculty?.hrFirstLast||faculty?.hrFullName||faculty?.facultySummary2026_27?.displayName||facultyId(faculty));
 function normalizeType(value){
  const raw=normalize(value);
  if(raw.includes('course coordinator')&&raw.includes('hicc'))return'Course Coordinator / HICC';
  if(raw==='hicc'||raw.includes('health implications course coordinator'))return'HICC';
  if(raw==='visc'||raw.includes('veterinary integrated sciences curriculum'))return'VISC';
  if(raw.includes('course coordinator'))return'Course Coordinator';
  if(raw.includes('rotation')||raw.includes('week lead'))return'Rotation / Week Lead';
  if(raw==='ccc'||raw.includes('clinical communications'))return'CCC';
  if(raw.includes('trainee')||raw.includes('supervision')||raw.includes('student'))return'Trainee / Supervision';
  if(raw.includes('special project'))return'Special Project';
  return SUPPORTED.includes(value)?value:'Other';
 }
 const roleKey=role=>`${normalizeType(role?.type)}|${normalize(role?.assignment)}`;
 function normalizeDoeAssignment(row={}){
  const roleType=normalizeType(row.roleType||row.type),assignment=text(row.courseCode||row.subjectKey||row.assignment);
  const result={academicYear:text(row.academicYear),roleType};
  if(text(row.courseCode))result.courseCode=text(row.courseCode);
  else if(['HICC','Course Coordinator','Course Coordinator / HICC'].includes(roleType)&&assignment)result.courseCode=assignment;
  if(text(row.subjectKey))result.subjectKey=text(row.subjectKey);
  else if(roleType==='VISC'&&assignment)result.subjectKey=assignment;
  if(text(row.notes))result.notes=text(row.notes);
  return result;
 }
 function classifyLegacyManagedRole(row={}){
  const legacyDoeCredit=number(row.doeCredit),facts=normalizeDoeAssignment(row),hasScope=Boolean(facts.courseCode||facts.subjectKey);
  const deterministic=new Set(['HICC','VISC','Course Coordinator','Course Coordinator / HICC','Rotation / Week Lead','Trainee / Supervision']);
  return{classification:deterministic.has(facts.roleType)&&hasScope?'assignment_fact_candidate':'fixed_exception',legacyDoeCredit,facts};
 }
 function workloadCredit(faculty,role){
  const direct=[role?.doeCredit,role?.doe,role?.appliedDOE,role?.operationalDOE].map(number).find(value=>value!==null);
  if(direct!==undefined)return Math.abs(direct);
  const credits=Array.isArray(faculty?.workloadPolicy2026_27?.credits)?faculty.workloadPolicy2026_27.credits:[];
  const type=normalizeType(role?.type),assignment=normalize(role?.assignment);
  const match=credits.find(credit=>normalizeType(credit?.sourceRoleType||credit?.category||credit?.type)===type&&(!assignment||!normalize(credit?.assignment)||normalize(credit.assignment)===assignment||normalize(credit.assignment).includes(assignment)||assignment.includes(normalize(credit.assignment))));
  const value=[match?.appliedDOE,match?.operationalDOE,match?.proratedDOE,match?.rawDOE,match?.doeCredit].map(number).find(item=>item!==null);
  return value===undefined?0:Math.abs(value);
 }
 function sourceRoles(faculty){
  if(Array.isArray(faculty?.facultySummary2026_27?.roles))return faculty.facultySummary2026_27.roles;
  const indexed=Array.isArray(faculty?.roleTypes)?faculty.roleTypes:(Array.isArray(faculty?.__indexRoleTypes)?faculty.__indexRoleTypes:[]);
  return indexed.map(type=>({type}));
 }
 function normalizedManagedRoles(faculty){
  const existing=Array.isArray(faculty?.managedRoles2026_27)?faculty.managedRoles2026_27.map(role=>({...role})):[];
  const seen=new Set(existing.map(roleKey)),output=existing.slice();
  for(const source of sourceRoles(faculty)){
   const type=normalizeType(source?.type);if(!SUPPORTED.includes(type))continue;
   const row={type,assignment:text(source?.assignment),action:'add',doeCredit:workloadCredit(faculty,source),notes:text(source?.details||source?.notes||'Imported from source workbook'),importedFrom:'facultySummary2026_27',sourceRoleType:text(source?.type),sourceKey:roleKey(source)};
   const key=roleKey(row);if(seen.has(key))continue;seen.add(key);output.push(row);
  }
  return output;
 }
 function facultyRoles(faculty){
  const legacy=Array.isArray(faculty?.managedRoles2026_27)?faculty.managedRoles2026_27:[];
  const types=[...sourceRoles(faculty),...legacy].map(role=>normalizeType(role?.type));
  const roles=[];if(types.some(type=>type==='HICC'||type==='Course Coordinator / HICC'))roles.push('hicc');if(types.includes('VISC'))roles.push('visc');roles.push('faculty');return roles;
 }
 function primaryRole(roles){const set=new Set(Array.isArray(roles)?roles:[]);return set.has('hicc')?'hicc':set.has('visc')?'visc':'faculty'}
 function accountRecord(faculty){const roles=facultyRoles(faculty);return{facultyId:facultyId(faculty),name:facultyName(faculty),email:email(faculty?.email),role:primaryRole(roles),facultyRoles:roles,active:true,mustChangePassword:true}}
 function plan(facultyRows,userRows,authEmails){
  const result={create:[],update:[],existing:[],protected:[],missingEmail:[],duplicateEmail:[],inactive:[],orphanedAuth:[],roleUpdates:[]},faculty=Array.isArray(facultyRows)?facultyRows:[],users=Array.isArray(userRows)?userRows:[],authSet=new Set([...(authEmails||[])].map(email));
  const active=faculty.filter(row=>{if(row?.active===false){result.inactive.push(row);return false}return true});
  const counts=new Map();for(const row of active){const value=email(row?.email);if(value)counts.set(value,(counts.get(value)||0)+1)}
  for(const row of active){
   const record=accountRecord(row);if(!validEmail(record.email)){result.missingEmail.push(row);continue}if((counts.get(record.email)||0)>1){result.duplicateEmail.push(row);continue}
   const existing=users.find(user=>text(user?.facultyId)===record.facultyId||email(user?.email)===record.email);
   if(existing){const item={...record,uid:text(existing.uid||existing.__id),existing};if(PRIVILEGED.has(normalize(existing.role))){result.protected.push(item);continue}const changed=normalize(existing.role)!==record.role||JSON.stringify(existing.facultyRoles||[])!==JSON.stringify(record.facultyRoles)||text(existing.facultyId)!==record.facultyId||email(existing.email)!==record.email||text(existing.name)!==record.name;if(changed)result.update.push(item);else result.existing.push(item);continue}
   if(authSet.has(record.email)){result.orphanedAuth.push(record);continue}result.create.push(record);
  }
  return result;
 }
 return{SUPPORTED,normalizedManagedRoles,normalizeDoeAssignment,classifyLegacyManagedRole,facultyRoles,primaryRole,accountRecord,plan,normalizeType};
});
