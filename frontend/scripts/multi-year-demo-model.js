(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PAWS_MULTI_YEAR_DEMO_MODEL=api;
})(typeof window==='undefined'?null:window,function(){
  'use strict';
  const STORAGE_KEY='paws-multi-year-demo-v1';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const invalid=message=>{throw new Error(message)};
  const normalized=v=>String(v||'').trim();
  const codeFor=v=>normalized(v).toUpperCase();
  const startOf=year=>year.slice(0,4)+'-05-01';
  const nextOf=year=>String(Number(year.slice(0,4))+1)+'-05-01';
  const endOf=year=>String(Number(year.slice(0,4))+1)+'-04-30';
  const validateYear=year=>{const m=/^(\d{4})-(\d{2})$/.exec(year||'');if(!m||Number(m[2])!==(Number(m[1])+1)%100)invalid('Invalid academic year');return year};
  const currentYear=date=>{const d=date instanceof Date?date:new Date(date),n=d.getUTCFullYear()-(d.getUTCMonth()<4?1:0);return n+'-'+String((n+1)%100).padStart(2,'0')};
  const isFaculty=a=>['faculty','hicc','visc'].includes(normalized(a&&a.role).toLowerCase());
  const canPlan=a=>['owner','developer','adfa_general','adfa_regular','administrator','admin','adc','lab','hicc','visc'].includes(normalized(a&&a.role).toLowerCase());
  const canAdfa=a=>['owner','developer','adfa_general','adfa_regular','administrator','admin'].includes(normalized(a&&a.role).toLowerCase());
  const owner=a=>normalized(a&&a.role).toLowerCase()==='owner';
  function bootstrap(source){
    const faculty=clone(source.faculty||[]).map(f=>({id:f.facultyId,name:f.displayName||f.preferredLastName||f.facultyId,active:f.active!==false,appointmentValid:f.appointmentValid!==false,contractDoe:Number(f.contractTeachingDoe)||0}));
    const users=clone(source.users||[]).map(u=>({uid:u.firebaseUid,role:u.baseRole,facultyId:u.facultyId||null,name:u.displayName||u.firebaseUid}));
    const catalog=clone(source.courses||[]).map(c=>({code:codeFor(c.courseCode),title:c.courseName||c.courseCode,curriculumYear:c.curriculumYear||null}));
    const grouping={};
    for(const raw of source.sessions||[]){
      if(raw.academicYear!=='2026-27')continue;
      const code=codeFor(raw.courseCode);
      if(!grouping[code])grouping[code]=[];
      grouping[code].push({id:raw.id,courseCode:code,date:raw.date,topic:raw.topic||'',sessionType:raw.sessionType||'',startTime:raw.startTime||'',endTime:raw.endTime||'',room:raw.room||'',assignments:clone(raw.assignments||[]).map(a=>({facultyId:a.facultyId,teachingRole:a.teachingRole||'',doeCredit:Number(a.doeCredit)||0}))});
    }
    const annual={'2026-27':{}};
    for(const [code,sessions] of Object.entries(grouping)){
      const item=catalog.find(c=>c.code===code);
      annual['2026-27'][code]={code,title:item?item.title:code,working:clone(sessions),revision:1,finalizedRevision:1,published:[{version:1,revision:1,sessions:clone(sessions),at:'2026-10-29T00:00:00.000Z',by:'demo-initial-migration'}],publishers:[]};
    }
    const roles={'2026-27':clone(source.roles||[]).map(r=>({id:r.roleAssignmentId,facultyId:r.facultyId,roleType:r.roleType,scope:r.courseOrSubjectOrRotation||'',start:r.effectiveDate&&r.effectiveDate>'2026-05-01'?r.effectiveDate:'2026-05-01',end:r.expirationDate&&r.expirationDate<'2027-04-30'?r.expirationDate:'2027-04-30',sourceEnd:r.expirationDate||'',status:'confirmed',sourceId:r.roleAssignmentId}))};
    // Original synthetic role dates span July-June. Add one marked May-Apr sample for rollover testing.
    if(!roles['2026-27'].some(r=>r.start<='2026-05-01'&&r.end>='2027-04-30')){
      const valid=roles['2026-27'].find(r=>r.roleType==='HICC'&&faculty.some(f=>f.id===r.facultyId&&f.active));
      if(valid)roles['2026-27'].push({...clone(valid),id:valid.id+'-full-year-demo',sourceId:valid.id+'-full-year-demo',start:'2026-05-01',end:'2027-04-30',fixture:true});
    }
    const doeRecords={};
    for(const f of faculty){
      const target=(source.targets||[]).find(t=>t.facultyId===f.id&&t.academicYear==='2026-27');
      const base=target&&Number.isFinite(Number(target.effectiveTargetDoe))?Number(target.effectiveTargetDoe):f.contractDoe;
      const override=target&&target.overrideDoe!==null&&target.overrideDoe!==undefined?Number(target.overrideDoe):null;
      doeRecords[f.id]={facultyId:f.id,base,effective:override===null?base:override,override,needsReview:false};
    }
    return {version:1,faculty,users,catalog,afc:clone(source.afcRecords||[]),years:{'2026-27':{status:'active',revision:1}},annual,roles,doe:{'2026-27':{policy:{status:'approved',copiedFrom:null},released:true,records:doeRecords,overrides:{}}},archives:[],audit:[],preferences:{},serial:0};
  }
  function createEngine({source={},storage=null,now=()=>new Date()}={}){
    let state;
    try{const saved=storage&&storage.getItem(STORAGE_KEY);if(saved){const decoded=JSON.parse(saved);if(decoded&&decoded.version===1&&decoded.years&&decoded.annual&&decoded.catalog)state=decoded}}catch(_){/* invalid local demo data; recreate safely */}
    if(!state)state=bootstrap(source);
    const persist=()=>{if(storage)storage.setItem(STORAGE_KEY,JSON.stringify(state))};
    const stamp=()=>now().toISOString();
    const getState=()=>clone(state);
    const logged=(event,actor,year,detail={})=>{state.audit.push({event,actor:actor.uid||'',year,at:stamp(),detail:clone(detail)});persist()};
    const who=a=>{if(!a||!normalized(a.uid)||!normalized(a.role))invalid('Signed-in demo actor required');if(!canPlan(a)&&!isFaculty(a))invalid('Unsupported role permission');return a};
    const inspect=year=>{validateYear(year);const y=state.years[year];if(!y)invalid('Academic year not found');return y};
    const editable=year=>{const y=inspect(year);if(y.status==='archived')invalid('Archived academic year is read-only');return y};
    const staff=a=>{who(a);if(!canPlan(a))invalid('Planning permission required')};
    const adfa=a=>{who(a);if(!canAdfa(a))invalid('ADFAD approval required')};
    const ownerOnly=a=>{who(a);if(!owner(a))invalid('Owner only')};
    const annual=(year,code)=>{inspect(year);const row=state.annual[year]&&state.annual[year][codeFor(code)];if(!row)invalid('Annual Course not found');return row};
    const faculty=fid=>state.faculty.find(f=>f.id===fid);
    const currentRelease=row=>row.published[row.published.length-1]||null;
    const publicationRows=year=>Object.values(state.annual[year]||{}).flatMap(c=>{const release=currentRelease(c);return release?release.sessions.map(s=>({...clone(s),courseCode:c.code,courseName:c.title})):[]});
    function computeCredits(year){
      const values={};for(const f of state.faculty)values[f.id]=0;
      for(const s of publicationRows(year))for(const a of s.assignments||[])if(a.facultyId)values[a.facultyId]=(values[a.facultyId]||0)+(Number(a.doeCredit)||0);
      return values;
    }
    function refreshPublishedDoe(year,afterChange){
      const d=state.doe[year];if(!d.released||d.policy.status!=='approved')return;
      const values=computeCredits(year),records={};
      for(const f of state.faculty){
        const prior=d.records[f.id]||{};
        const override=d.overrides[f.id]!==undefined?Number(d.overrides[f.id]):prior.override??null;
        const base=Math.round((values[f.id]||0)*100)/100;
        records[f.id]={facultyId:f.id,base,override,effective:override===null?base:override,needsReview:Boolean(prior.needsReview||(afterChange&&override!==null&&prior.base!==base))};
      }
      d.records=records;
    }
    function canPublish(a,year,row){if(canAdfa(a))return true;
      const uid=normalized(a&&a.uid),fid=a&&a.facultyId||state.users.find(u=>u.uid===uid)?.facultyId;
      if(row.publishers.includes(uid))return true;
      return (state.roles[year]||[]).some(r=>r.status==='confirmed'&&r.facultyId===fid&&['HICC','Course Coordinator'].includes(r.roleType)&&r.scope.toUpperCase().startsWith(row.code));
    }
    function createYear(a,year){ownerOnly(a);validateYear(year);if(state.years[year])invalid('Academic year already exists');
      const previous=String(Number(year.slice(0,4))-1)+'-'+String(Number(year.slice(0,4))%100).padStart(2,'0');if(!state.years[previous])invalid('Prior academic year required');
      state.years[year]={status:'planning',revision:1};state.annual[year]={};state.doe[year]={policy:{status:'draft',copiedFrom:previous},released:false,records:{},overrides:{}};
      state.roles[year]=(state.roles[previous]||[]).map((r,index)=>{
        const person=faculty(r.facultyId),eligible=Boolean(person?.active&&person?.appointmentValid);
        const full=r.start<=startOf(previous)&&r.end>=endOf(previous);
        return {...clone(r),id:'renew-'+year+'-'+index,sourceId:r.id,start:startOf(year),end:endOf(year),status:full&&eligible?'confirmed':'draft',rolloverReason:!full?'partial year':!person?.active?'inactive Faculty':!person?.appointmentValid?'invalid Appointment':'eligible full year'};
      });
      logged('year_created',a,year,{previous,roles:state.roles[year].length});return getState().years[year];
    }
    function addCourse(a,year,code){staff(a);editable(year);const key=codeFor(code),item=state.catalog.find(c=>c.code===key);if(!item)invalid('Course not found in shared Catalog');
      if(state.annual[year][key])invalid('Annual Course already exists');
      state.annual[year][key]={code:key,title:item.title,working:[],revision:1,finalizedRevision:0,published:[],publishers:[]};
      logged('annual_course_created',a,year,{code:key});return clone(state.annual[year][key]);
    }
    function updateCatalog(a,code,title){adfa(a);const key=codeFor(code),item=state.catalog.find(c=>c.code===key);if(!item)invalid('Catalog Course not found');if(!normalized(title))invalid('Course title required');item.title=normalized(title);logged('catalog_updated',a,'global',{code:key,title:item.title});return clone(item)}
    function addSession(a,year,code,input){staff(a);editable(year);const row=annual(year,code);if(!canPublish(a,year,row))invalid('Course scope permission required');
      const date=normalized(input&&input.date);if(date<startOf(year)||date>=nextOf(year))invalid('Session date outside academic year');
      const id=normalized(input.id)||'demo-session-'+(++state.serial);if(row.working.some(s=>s.id===id))invalid('Session already exists');
      const assignments=clone(input.assignments||[]).map(x=>({facultyId:x.facultyId||null,teachingRole:x.teachingRole||'',doeCredit:Number(x.doeCredit)||0}));
      for(const x of assignments)if(x.facultyId&&!faculty(x.facultyId))invalid('Unknown Faculty');
      row.working.push({id,courseCode:row.code,date,topic:normalized(input.topic),sessionType:normalized(input.sessionType),startTime:normalized(input.startTime),endTime:normalized(input.endTime),room:normalized(input.room),assignments});
      row.revision++;row.finalizedRevision=0;logged('session_added',a,year,{code:row.code,id});return id;
    }
    function editAssignment(a,year,code,id,fid){staff(a);editable(year);const row=annual(year,code);if(!canPublish(a,year,row))invalid('Course scope permission required');const s=row.working.find(x=>x.id===id);if(!s)invalid('Session not found');if(fid&&!faculty(fid))invalid('Unknown Faculty');
      const old=s.assignments[0]||{};s.assignments=[{facultyId:fid||null,teachingRole:old.teachingRole||'Instructor',doeCredit:Number(old.doeCredit)||0}];
      row.revision++;row.finalizedRevision=0;logged('assignment_updated',a,year,{code:row.code,sessionId:id});return clone(s);
    }
    function finalizeCourse(a,year,code){adfa(a);editable(year);const row=annual(year,code);row.finalizedRevision=row.revision;logged('course_finalized',a,year,{code:row.code,revision:row.revision});return row.revision}
    function publishCourse(a,year,code){who(a);editable(year);const row=annual(year,code);if(!canPublish(a,year,row))invalid('Course publisher scope permission required');
      if(row.finalizedRevision!==row.revision)invalid('Current Working revision is not finalized');
      if(currentRelease(row)?.revision===row.revision)invalid('No changes: Working revision already published');
      const release={version:row.published.length+1,revision:row.revision,sessions:clone(row.working),at:stamp(),by:a.uid};row.published.push(release);refreshPublishedDoe(year,true);
      logged('course_published',a,year,{code:row.code,version:release.version});return clone(release);
    }
    function approvePolicy(a,year){adfa(a);editable(year);state.doe[year].policy.status='approved';logged('doe_policy_approved',a,year);return true}
    function publishDoe(a,year){adfa(a);editable(year);const d=state.doe[year];if(d.policy.status!=='approved')invalid('Approved DOE rules required');d.released=true;refreshPublishedDoe(year,false);logged('doe_initial_published',a,year);return clone(d.records)}
    function setOverride(a,year,fid,value){adfa(a);editable(year);if(!faculty(fid))invalid('Unknown Faculty');if(!Number.isFinite(Number(value)))invalid('Invalid override');
      const d=state.doe[year];d.overrides[fid]=Number(value);if(d.released){const row=d.records[fid]||{facultyId:fid,base:0};row.override=Number(value);row.effective=Number(value);row.needsReview=false;d.records[fid]=row}
      logged('doe_override_set',a,year,{facultyId:fid});return true;
    }
    function getTeaching(a,year){who(a);inspect(year);return publicationRows(year).map(s=>({...s,assignments:(s.assignments||[]).filter(x=>!isFaculty(a)||x.facultyId===a.facultyId).map(x=>(isFaculty(a)||canAdfa(a))?x:{facultyId:x.facultyId,teachingRole:x.teachingRole})})).filter(s=>!isFaculty(a)||s.assignments.length)}
    function getCalendar(a,year){who(a);const y=inspect(year);if(isFaculty(a)&&y.status==='archived')invalid('Archived Calendar is hidden from Faculty');
      const rows=isFaculty(a)?publicationRows(year):Object.values(state.annual[year]||{}).flatMap(c=>(y.status==='archived'?(currentRelease(c)?.sessions||[]):c.working).map(s=>({...s,courseName:c.title,courseCode:c.code})));
      return rows.map(s=>({id:s.id,courseCode:s.courseCode,courseName:s.courseName,date:s.date,topic:s.topic,sessionType:s.sessionType,startTime:s.startTime,endTime:s.endTime,room:s.room,
        instructorNames:(s.assignments||[]).map(x=>faculty(x.facultyId)?.name||'Unassigned').join('; ')}));
    }
    function getDoe(a,year){who(a);inspect(year);if(!isFaculty(a)&&!canAdfa(a))invalid('DOE access denied');const d=state.doe[year];if(!d.released)return{status:'pending',items:[]};
      const items=Object.values(d.records).filter(r=>!isFaculty(a)||r.facultyId===a.facultyId).map(clone);return{status:'published',items};
    }
    function getWorkingDoe(a,year){adfa(a);inspect(year);const values={};for(const c of Object.values(state.annual[year]||{}))for(const s of c.working)for(const x of s.assignments||[])values[x.facultyId]=(values[x.facultyId]||0)+(Number(x.doeCredit)||0);
      return state.faculty.map(f=>({facultyId:f.id,base:Math.round((values[f.id]||0)*100)/100}));
    }
    function conflictRows(year){const rows=[];
      for(const s of Object.values(state.annual[year]||{}).flatMap(c=>c.working.map(x=>({...x,courseCode:c.code}))))for(const x of s.assignments||[])for(const afc of state.afc){if(afc.active===false||afc.facultyId!==x.facultyId)continue;if(s.date>=afc.startDate&&s.date<=afc.endDate){rows.push({courseCode:s.courseCode,sessionId:s.id,date:s.date,facultyId:x.facultyId,sourceId:afc.afcRecordId});}}
      return rows;
    }
    function getConflicts(a,year){staff(a);const y=inspect(year);if(y.status==='archived')return clone([...state.archives].reverse().find(v=>v.year===year)?.conflicts||[]);return clone(conflictRows(year));}
    function addAfc(a,input){adfa(a);if(!faculty(input.facultyId))invalid('Unknown Faculty');if(!input.startDate||!input.endDate||input.startDate>input.endDate)invalid('Invalid AFC dates');
      if(state.afc.some(x=>x.afcRecordId===input.afcRecordId))invalid('Duplicate AFC');state.afc.push(clone(input));logged('afc_added',a,'shared',{afcRecordId:input.afcRecordId});return true;
    }
    function retireYear(a,year,confirmed=false){ownerOnly(a);const y=editable(year);if(confirmed!==true)invalid('Retire confirmation required');
      const conflicts=conflictRows(year);const pending=Object.values(state.annual[year]||{}).filter(c=>!currentRelease(c)||c.revision!==currentRelease(c).revision).map(c=>c.code);
      const snapshot={year,at:stamp(),actor:a.uid,conflicts:clone(conflicts),published:Object.fromEntries(Object.entries(state.annual[year]).map(([code,c])=>[code,currentRelease(c)?.version||null])),pending};
      state.archives.push(snapshot);y.status='archived';y.revision++;logged('year_retired',a,year,{pending:pending.length,conflicts:conflicts.length});return clone(snapshot);
    }
    function restoreYear(a,year){ownerOnly(a);const y=inspect(year);if(y.status!=='archived')invalid('Academic year is not archived');y.status='active';y.revision++;const count=conflictRows(year).length;logged('year_restored',a,year,{liveConflicts:count});return{liveConflicts:count};}
    function copyHistorical(a,year,code,sessionId,sourceId){staff(a);editable(year);const row=annual(year,code);if(!canPublish(a,year,row))invalid('Course scope permission required');const s=row.working.find(x=>x.id===sessionId);if(!s)invalid('Target Session not found');
      const previous=String(Number(year.slice(0,4))-1)+'-'+String(Number(year.slice(0,4))%100).padStart(2,'0');const history=publicationRows(previous).find(x=>x.id===sourceId&&x.courseCode===row.code);
      if(!history||!history.assignments.length)invalid('Published historical assignment not found');const chosen=history.assignments.find(x=>faculty(x.facultyId)?.active);if(!chosen)invalid('Historical Faculty no longer eligible');
      s.assignments=clone([chosen]);row.revision++;row.finalizedRevision=0;logged('historical_assignment_copied',a,year,{code:row.code,sourceId,sessionId});return clone(chosen);
    }
    function confirmRole(a,year,id){adfa(a);editable(year);const role=(state.roles[year]||[]).find(r=>r.id===id);if(!role)invalid('Role not found');if(role.status!=='draft')invalid('Role is not draft');role.status='confirmed';logged('annual_role_confirmed',a,year,{roleId:id});return clone(role)}
    function setPreferredYear(a,year){who(a);inspect(year);state.preferences[a.uid]=year;persist()}
    function getPreferredYear(a){who(a);const current=currentYear(now());if(isFaculty(a))return state.years[current]?current:Object.keys(state.years)[0];return state.years[state.preferences[a.uid]]?state.preferences[a.uid]:state.years[current]?current:Object.keys(state.years)[0]}
    function reset(){state=bootstrap(source);persist();return getState()}
    return Object.freeze({getState,createYear,addCourse,updateCatalog,addSession,editAssignment,finalizeCourse,publishCourse,approvePolicy,publishDoe,setOverride,getTeaching,getCalendar,getDoe,getWorkingDoe,getConflicts,addAfc,retireYear,restoreYear,copyHistorical,confirmRole,setPreferredYear,getPreferredYear,reset,currentYear});
  }
  return Object.freeze({createEngine,STORAGE_KEY,currentYear,validateYear});
});
