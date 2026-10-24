'use strict';
const {createHash}=require('node:crypto');
const text=v=>v==null?'':String(v).normalize('NFKC').trim().replace(/\s+/g,' ');
const key=v=>text(v).toLowerCase();
const error=(code,message)=>Object.assign(new Error(message),{code});
const monthNames=['january','february','march','april','may','june','july','august','september','october','november','december'];
function academicBounds(year){
 const match=/^(\d{4})-(\d{2})$/.exec(text(year));
 if(!match||Number(match[1])<1900||Number(match[1])>9998||(Number(match[1])+1)%100!==Number(match[2]))throw error('INVALID_ACADEMIC_YEAR','A consecutive canonical academic year is required.');
 return {year:Number(match[1]),startDate:match[1]+'-05-01',endDate:String(Number(match[1])+1)+'-04-30'};
}
function isoDate(value){
 const raw=value instanceof Date&&!Number.isNaN(value.valueOf())?value.toISOString().slice(0,10):text(value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;
 const ms=Date.parse(raw);return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===raw?raw:null;
}
function readDate(value,bounds,end){
 if(value==null||value==='')return null;
 const iso=isoDate(value);if(iso)return iso;
 const m=/^([A-Za-z]+)\s+(?:(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?|(\d{4}))$/.exec(text(value));
 if(!m)return null;
 const name=m[1].toLowerCase(),month=monthNames.findIndex(n=>n===name||n.slice(0,3)===name||(n==='september'&&name==='sept'))+1;
 if(!month)return null;
 const year=Number(m[3]||m[4]||(month>=5?bounds.year:bounds.year+1));
 const day=m[2]?Number(m[2]):end?new Date(Date.UTC(year,month,0)).getUTCDate():1;
 return isoDate(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
}
/** Inclusive appointment validity; this never constructs working-session dates. */
function normalizeAppointmentPeriods({academicYear,startCell,endCell,roleDateNotes}={}){
 const bounds=academicBounds(academicYear),issues=[],notes=text(roleDateNotes);
 const clauses=[...notes.matchAll(/\b(Restarts?|Starts?|Ends?)\s+(?:at UCVM\s+)?([A-Za-z]+\s+\d{1,4}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/gi)];
 const extracted={};
 for(const clause of clauses){
  const kind=clause[1].toLowerCase().startsWith('restart')?'restart':clause[1].toLowerCase().startsWith('start')?'start':'end';
  const parsed=readDate(clause[2],bounds,kind==='end');
  if(!parsed){issues.push('INVALID_ROLE_DATE');continue;}
  if(extracted[kind]&&extracted[kind]!==parsed)issues.push('DATE_CONFLICT');
  extracted[kind]=parsed;
 }
 const start=readDate(startCell,bounds,false),end=readDate(endCell,bounds,true);
 if(startCell!=null&&startCell!==''&&!start||endCell!=null&&endCell!==''&&!end)issues.push('INVALID_DATE');
 if(start&&extracted.start&&start!==extracted.start||end&&extracted.end&&end!==extracted.end)issues.push('DATE_CONFLICT');
 const periods=[{startDate:start||extracted.start||bounds.startDate,endDate:end||extracted.end||bounds.endDate}];
 if(extracted.restart){
  if(!end&&!extracted.end)issues.push('RESTART_WITHOUT_END');
  periods.push({startDate:extracted.restart,endDate:bounds.endDate});
 }
 if(periods.some((p,i)=>p.startDate>p.endDate||p.startDate<bounds.startDate||p.endDate>bounds.endDate||i&&periods[i-1].endDate>=p.startDate))issues.push('INVALID_PERIOD_RANGE');
 return {periods,issues:[...new Set(issues)],periodBasis:start||end?'structured_dates':clauses.length?'role_date_notes':'default_year'};
}
/** Keep repository ID spelling intact: policy exception identity matching is exact. */
function createFacultyResolver({faculty=[],roles=[],aliases=[],supervision=[]}={}){
 const names=new Map(),byId=new Map(faculty.map(f=>[key(f.facultyId),f]));
 const add=(name,id)=>{if(!text(name)||!byId.has(key(id)))return;const k=key(name);if(!names.has(k))names.set(k,new Set());names.get(k).add(byId.get(key(id)).facultyId);};
 for(const f of faculty){
  for(const n of [f.displayName,f.hrName,f.firstName&&f.lastName?f.firstName+' '+f.lastName:null,f.firstName&&f.lastName?f.lastName+', '+f.firstName:null])add(n,f.facultyId);
 }
 for(const a of aliases)add(a.aliasName,a.facultyId);
 for(const r of roles)add(r.sourceName,r.facultyId);
 for(const r of supervision){let e;try{e=JSON.parse(r.evidenceJson||'{}');}catch(_){e={};}add(e.sourceName,r.facultyId);}
 return name=>{
  const ids=[...(names.get(key(name))||[])];
  if(ids.length!==1)return {facultyId:null,identityStatus:ids.length?'ambiguous':'unresolved',issueCode:ids.length?'AMBIGUOUS_FACULTY':'UNRESOLVED_FACULTY'};
  const f=byId.get(key(ids[0]));return {facultyId:f.facultyId,identityStatus:f.active===true||f.active===1?'resolved':'inactive',issueCode:f.active===true||f.active===1?null:'INACTIVE_FACULTY'};
 };
}
function manifestHash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex').toUpperCase();}
function reconcileMasterSource(source,snapshot={}){
 const operations=[],heldIssues=[],used=new Set(),roles=snapshot.roles||[];
 const all=[...(source.appointments||[]),...(source.rotations||[]),...(source.cccAllocations||[]).map(r=>({...r,roleType:'CCC',scope:'CCC shifts'}))];
 for(const row of all){
  if(!row.facultyId||row.identityStatus&&row.identityStatus!=='resolved'){heldIssues.push({...row,code:'IDENTITY_REVIEW'});continue;}
  const matches=roles.filter(r=>key(r.facultyId)===key(row.facultyId)&&r.roleType===row.roleType&&key(r.scope)===key(row.scope));
  if(matches.length>1){heldIssues.push({...row,code:'AMBIGUOUS_ROLE'});continue;}
  const old=matches[0],entry={sourceRef:row.sourceRef,facultyId:row.facultyId,roleId:old?.roleId??null,roleType:row.roleType,scope:row.scope,source:row};
  if(old)used.add(old.roleId);
  const existing=old?old.overrideDoe??old.mappedDoe:null;
  if(row.sourceDoe==null){heldIssues.push({...entry,code:'SOURCE_DOE_MISSING',storedDoe:existing});continue;}
  if(old&&(existing==null||Math.abs(existing-row.sourceDoe)>0.000001)){heldIssues.push({...entry,code:'DOE_MISMATCH',storedDoe:existing,sourceDoe:row.sourceDoe});continue;}
  operations.push({...entry,kind:old?'metadata':'new_assignment_candidate',storedDoe:existing});
 }
 const supported=new Set(['HICC','VISC','CCC','Rotation Participant','Designated Rotation Coordinator']);
 for(const old of roles)if(supported.has(old.roleType)&&!used.has(old.roleId))heldIssues.push({roleId:old.roleId,facultyId:old.facultyId,roleType:old.roleType,scope:old.scope,storedDoe:old.overrideDoe??old.mappedDoe,code:'HELD_REMOVAL'});
 return {operations,heldIssues};
}
module.exports={academicBounds,isoDate,normalizeAppointmentPeriods,createFacultyResolver,manifestHash,reconcileMasterSource,text};
