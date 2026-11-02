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
  const nextYear=year=>{const n=Number(year.slice(0,4))+1;return n+'-'+String((n+1)%100).padStart(2,'0')};
  const currentYear=date=>{const d=date instanceof Date?date:new Date(date),n=d.getUTCFullYear()-(d.getUTCMonth()<4?1:0);return n+'-'+String((n+1)%100).padStart(2,'0')};
  const isFaculty=a=>['faculty','hicc','visc'].includes(normalized(a&&a.role).toLowerCase());
  const canPlan=a=>['owner','developer','adfa_general','adfa_regular','administrator','admin','adc','lab','hicc','visc'].includes(normalized(a&&a.role).toLowerCase());
  const canAdfa=a=>['owner','developer','adfa_general','adfa_regular','administrator','admin'].includes(normalized(a&&a.role).toLowerCase());
  const owner=a=>normalized(a&&a.role).toLowerCase()==='owner';
  function bootstrap(source){
    const faculty=clone(source.faculty||[]).map(f=>({id:f.facultyId,name:f.displayName||f.preferredLastName||f.facultyId,active:f.active!==false,activationDate:typeof f.activationDate==='string'?f.activationDate:null,appointmentValid:f.appointmentValid!==false,contractDoe:Number(f.contractTeachingDoe)||0}));
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
    // The historical Demo seed uses July-June appointments. One explicitly labelled
    // synthetic full-year fixture allows testers to verify eligible automatic renewal.
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
    return {version:1,faculty,users,catalog,afc:clone(source.afcRecords||[]),years:{'2026-27':{status:'active',revision:1}},annual,roles,doe:{'2026-27':{policy:{status:'approved',copiedFrom:null},released:true,records:doeRecords,overrides:{}}},archives:[],audit:clone(source.history||[]).map(h=>({event:h.changeType||h.eventType||'legacy_change',actor:h.actorFirebaseUid||h.actorName||'',year:h.academicYear||'2026-27',at:h.changedAtUtc||h.occurredAtUtc||'',legacy:true,detail:{original:h}})),preferences:{},serial:0};
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
    const effectiveOn=(f,date)=>Boolean(f?.active&&f?.appointmentValid&&(!f.activationDate||(date&&date>=f.activationDate)));
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
    function authorizeCourseEditor(a,row){staff(a);if(canAdfa(a))return;
      const identity=state.users.find(u=>u.uid===a.uid);
      const fid=a.facultyId||identity&&identity.facultyId;
      const source=(state.roles[row.year]||[]).filter(r=>r.status==='confirmed'&&r.facultyId===fid&&r.scope.toUpperCase().startsWith(row.course.code));
      if(!row.course.publishers.includes(a.uid)&&!source.length)invalid('Course scope permission required');
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
        const person=faculty(r.facultyId),eligible=effectiveOn(person,startOf(year));
        const full=r.start<=startOf(previous)&&r.end>=endOf(previous);
        return {...clone(r),id:'renew-'+year+'-'+index,sourceId:r.id,start:startOf(year),end:endOf(year),status:full&&eligible?'confirmed':'draft',rolloverReason:!full?'partial year':!person?.active?'inactive Faculty':!person?.appointmentValid?'invalid Appointment':person?.activationDate&&person.activationDate>startOf(year)?'future Faculty activation':'eligible full year'};
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
      for(const x of assignments){
        if(x.facultyId&&!faculty(x.facultyId))invalid('Unknown Faculty');
        if(x.facultyId&&faculty(x.facultyId)?.activationDate&&date<faculty(x.facultyId).activationDate)invalid('Faculty cannot be assigned before activation date');
      }
      row.working.push({id,courseCode:row.code,date,topic:normalized(input.topic),sessionType:normalized(input.sessionType),startTime:normalized(input.startTime),endTime:normalized(input.endTime),room:normalized(input.room),assignments});
      row.revision++;row.finalizedRevision=0;logged('session_added',a,year,{code:row.code,id});return id;
    }
    function editAssignment(a,year,code,id,fid){staff(a);editable(year);const row=annual(year,code);if(!canPublish(a,year,row))invalid('Course scope permission required');const s=row.working.find(x=>x.id===id);if(!s)invalid('Session not found');if(fid&&!faculty(fid))invalid('Unknown Faculty');
      if(fid&&faculty(fid)?.activationDate&&(!s.date||s.date<faculty(fid).activationDate))invalid('Faculty cannot be assigned before activation date');
      const old=s.assignments[0]||{};s.assignments=[{facultyId:fid||null,teachingRole:old.teachingRole||'Instructor',doeCredit:Number(old.doeCredit)||0}];
      row.revision++;row.finalizedRevision=0;logged('assignment_updated',a,year,{code:row.code,sessionId:id});return clone(s);
    }
    function finalizeCourse(a,year,code){adfa(a);editable(year);const row=annual(year,code);row.finalizedRevision=row.revision;logged('course_finalized',a,year,{code:row.code,revision:row.revision});return row.revision}
    function publishCourse(a,year,code){who(a);editable(year);const row=annual(year,code);if(!canPublish(a,year,row))invalid('Course publisher scope permission required');
      if(row.finalizedRevision!==row.revision)invalid('Current Working revision is not finalized');
      if(currentRelease(row)?.revision===row.revision)invalid('No changes: Working revision already published');
      const review=previewPublication(a,year,code);
      if(!review.canPublish)invalid('Course publication validation failed: '+review.issues.filter(x=>x.severity==='block').map(x=>x.code).join(', '));
      const release={version:row.published.length+1,revision:row.revision,sessions:clone(row.working),at:stamp(),by:a.uid};row.published.push(release);refreshPublishedDoe(year,true);
      logged('course_published',a,year,{code:row.code,version:release.version});return clone(release);
    }
    // Selective rollover is opt-in: only the previous year's *last Published*
    // snapshot may seed the new annual Course. Never transfer approvals or DOE.
    function previewRollover(a,request){
      staff(a);
      const fromYear=validateYear(request?.fromYear),toYear=validateYear(request?.toYear),code=codeFor(request?.code);
      editable(toYear);inspect(fromYear);
      const previous=String(Number(toYear.slice(0,4))-1)+'-'+String(Number(toYear.slice(0,4))%100).padStart(2,'0');
      if(fromYear!==previous)invalid('Rollover source must be the previous academic year');
      const source=annual(fromYear,code),release=currentRelease(source);
      if(!release)invalid('Source Course has no Published release');
      if(state.annual[toYear][code])invalid('Target Annual Course already exists; rollover never overwrites');
      if(!state.catalog.some(c=>c.code===code))invalid('Course not found in shared Catalog');
      if(!canPublish(a,toYear,{code,publishers:[]}))invalid('Course scope permission required');
      const opts=request.options||{};
      const options={course:true,sessions:opts.sessions===true,instructors:opts.instructors===true,schedule:opts.schedule===true};
      if(options.instructors&&!options.sessions)invalid('Instructor rollover requires Sessions');
      if(options.schedule&&!options.sessions)invalid('Schedule rollover requires Sessions');
      if(opts.course===false)invalid('Course snapshot is required for rollover');
      const excluded=new Set(),included=new Set();
      for(const session of release.sessions)for(const x of session.assignments||[]){
        const person=faculty(x.facultyId);
        if(person&&person.active&&person.appointmentValid)included.add(x.facultyId);
        else excluded.add(x.facultyId||'missing');
      }
      return {sourceYear:fromYear,destinationYear:toYear,code,title:source.title,sourceReleaseVersion:release.version,
        sessionCount:release.sessions.length,copyCount:options.sessions?release.sessions.length:0,
        eligibleInstructors:included.size,excludedInstructors:excluded.size,options};
    }
    function shiftDate(date,years){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return '';
      const [y,m,d]=date.split('-').map(Number);
      const last=new Date(Date.UTC(y+years,m,0)).getUTCDate();
      return String(y+years)+'-'+String(m).padStart(2,'0')+'-'+String(Math.min(d,last)).padStart(2,'0');
    }
    function rolloverCourse(a,request){
      const preview=previewRollover(a,request),source=annual(preview.sourceYear,preview.code),release=currentRelease(source),options=preview.options;
      const course={code:preview.code,title:source.title,working:[],revision:1,finalizedRevision:0,published:[],publishers:[],
        rollover:{sourceYear:preview.sourceYear,sourceReleaseVersion:release.version,options,at:stamp(),actor:a.uid}};
      if(options.sessions){
        const years=Number(preview.destinationYear.slice(0,4))-Number(preview.sourceYear.slice(0,4));
        course.working=release.sessions.map(session=>({
          id:'demo-rollover-'+(++state.serial),courseCode:preview.code,
          date:options.schedule?shiftDate(session.date,years):'',topic:session.topic||'',sessionType:session.sessionType||'',
          startTime:options.schedule?session.startTime||'':'',endTime:options.schedule?session.endTime||'':'',
          room:options.schedule?session.room||'':'',
          assignments:options.instructors?(session.assignments||[]).filter(x=>{const f=faculty(x.facultyId);return f?.active&&f?.appointmentValid&&(!f.activationDate||(options.schedule&&shiftDate(session.date,years)>=f.activationDate));}).map(clone):[]
        }));
      }
      state.annual[preview.destinationYear][preview.code]=course;
      logged('course_rolled_over',a,preview.destinationYear,{sourceYear:preview.sourceYear,code:preview.code,
        release:preview.sourceReleaseVersion,options,excludedInstructors:preview.excludedInstructors});
      return clone(course);
    }
    function setYearPhase(a,year,phase){
      adfa(a);const item=editable(year),next=normalized(phase).toLowerCase();
      const allowed={planning:['review'],review:['planning','active'],active:['review']};
      if(next===item.status)return clone(item);
      if(!allowed[item.status]?.includes(next))invalid('Invalid year phase transition');
      item.status=next;item.revision++;logged('year_phase_changed',a,year,{phase:next});return clone(item);
    }
    function previewPublication(a,year,code){
      who(a);const y=inspect(year),row=annual(year,code),published=currentRelease(row),issues=[];
      const problem=(severity,code,message,sessionId='')=>issues.push({severity,code,message,sessionId});
      if(y.status==='archived')problem('block','ARCHIVED','The academic year is archived');
      if(!canPublish(a,year,row))problem('block','SCOPE_DENIED','Course publication permission required');
      if(row.finalizedRevision!==row.revision)problem('block','NOT_FINALIZED','Current Working revision is not finalized');
      if(published?.revision===row.revision)problem('block','NO_CHANGES','Working revision already Published');
      const before=published?.sessions||[],after=row.working||[],past=new Map(before.map(x=>[x.id,x])),newMap=new Map(after.map(x=>[x.id,x]));
      const diff={added:after.filter(x=>!past.has(x.id)).length,removed:before.filter(x=>!newMap.has(x.id)).length,modified:0,assignmentChanges:0,changes:[]};
      for(const s of after){
        const old=past.get(s.id);
        if(!old){diff.changes.push({kind:'added',sessionId:s.id,topic:s.topic||''});continue;}
        const beforeAssignments=JSON.stringify(old.assignments||[]),afterAssignments=JSON.stringify(s.assignments||[]);
        const updated=['date','topic','sessionType','startTime','endTime','room'].some(k=>(old[k]||'')!==(s[k]||''))||beforeAssignments!==afterAssignments;
        if(updated){diff.modified++;diff.changes.push({kind:'modified',sessionId:s.id,topic:s.topic||'',instructorChanged:beforeAssignments!==afterAssignments});}
        if(beforeAssignments!==afterAssignments)diff.assignmentChanges++;
      }
      for(const s of before)if(!newMap.has(s.id))diff.changes.push({kind:'removed',sessionId:s.id,topic:s.topic||''});
      const totals=sessions=>{
        const map={};for(const session of sessions)for(const x of session.assignments||[]){if(x.facultyId)map[x.facultyId]=(map[x.facultyId]||0)+(Number(x.doeCredit)||0)}return map;
      };
      const oldDoe=totals(before),newDoe=totals(after),faculties=new Set([...Object.keys(oldDoe),...Object.keys(newDoe)]);
      const doeImpact=[...faculties].map(facultyId=>({facultyId,before:oldDoe[facultyId]||0,after:newDoe[facultyId]||0,
        delta:Math.round(((newDoe[facultyId]||0)-(oldDoe[facultyId]||0))*100)/100})).filter(x=>x.delta!==0);
      const seen=new Map();
      for(const s of after){
        const date=s.date||'';
        if(!date)problem('block','UNSCHEDULED_SESSION','Session needs a scheduled date',s.id);
        else if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date<startOf(year)||date>=nextOf(year))
          problem('block','INVALID_DATE','Session date is outside this academic year',s.id);
        if(s.startTime&&s.endTime&&s.endTime<=s.startTime)problem('block','INVALID_TIME','End time must follow start time',s.id);
        if(Boolean(s.startTime)!==Boolean(s.endTime))problem('block','INVALID_TIME','Both start and end time are required',s.id);
        if(!(s.assignments||[]).some(x=>x.facultyId))problem('warn','UNASSIGNED_INSTRUCTOR','Session has no instructor',s.id);
        if(!s.room)problem('warn','UNASSIGNED_ROOM','Room not selected',s.id);
        for(const x of s.assignments||[]){
          const f=faculty(x.facultyId);
          if(!f||!f.active||!f.appointmentValid)problem('block','INACTIVE_FACULTY','Instructor is inactive or ineligible',s.id);
          if(date&&f?.activationDate&&date<f.activationDate)problem('block','FUTURE_FACULTY_START','Instructor starts after the Session date',s.id);
          if(date)for(const afc of state.afc){
            if(afc.active!==false&&afc.facultyId===x.facultyId&&date>=afc.startDate&&date<=afc.endDate)
              problem('warn','AFC_CONFLICT','Instructor has an AFC overlap',s.id);
          }
        }
        if(date&&s.startTime&&s.endTime){
          const key=date;
          const overlaps=seen.get(key)||[];
          for(const old of overlaps){
            if(s.startTime<old.endTime&&s.endTime>old.startTime){
              if(s.room&&s.room===old.room)problem('warn','ROOM_CONFLICT','Room overlaps another session',s.id);
              if((s.assignments||[]).some(x=>old.facultyIds.includes(x.facultyId)))problem('warn','INSTRUCTOR_CONFLICT','Instructor overlaps another session',s.id);
            }
          }
          overlaps.push({room:s.room,startTime:s.startTime,endTime:s.endTime,facultyIds:(s.assignments||[]).map(x=>x.facultyId)});seen.set(key,overlaps);
        }
      }
      // Check current Working sessions in other Courses of this same year;
      // publication cannot validate room/instructor use in isolation.
      const otherSessions=Object.entries(state.annual[year]||{})
        .filter(([key])=>key!==row.code)
        .flatMap(([courseCode,c])=>(c.working||[]).map(session=>({courseCode,session})));
      for(const session of after){
        if(!session.date||!session.startTime||!session.endTime)continue;
        for(const other of otherSessions){
          const x=other.session;
          if(x.date!==session.date||!x.startTime||!x.endTime||session.startTime>=x.endTime||session.endTime<=x.startTime)continue;
          if(session.room&&session.room===x.room)
            problem('warn','ROOM_CONFLICT','Room overlaps '+other.courseCode+' in the same academic year',session.id);
          const facultyIds=new Set((x.assignments||[]).map(a=>a.facultyId).filter(Boolean));
          if((session.assignments||[]).some(a=>a.facultyId&&facultyIds.has(a.facultyId)))
            problem('warn','INSTRUCTOR_CONFLICT','Instructor overlaps '+other.courseCode+' in the same academic year',session.id);
        }
      }
      return {year,code:row.code,sourceRevision:row.revision,currentPublishedVersion:published?.version||null,
        diff,doeImpact,issues,canPublish:!issues.some(x=>x.severity==='block')};
    }
    function compareYears(a,fromYear,toYear){
      who(a);inspect(fromYear);inspect(toYear);
      const staffView=canAdfa(a),officeView=['adc','lab'].includes(a.role);
      const people=staffView||officeView?state.faculty:state.faculty.filter(f=>f.id===a.facultyId);
      const measure=(year,facultyId)=>{
        const teachingSessions=publicationRows(year).filter(s=>(s.assignments||[]).some(x=>x.facultyId===facultyId)).length;
        const published=state.doe[year];const allowed=staffView||(!officeView&&facultyId===a.facultyId);
        const item=allowed&&published?.released?published.records[facultyId]:null;
        return {teachingSessions,doeStatus:allowed?(published?.released?'published':'pending'):'restricted',doe:item?item.effective:null};
      };
      return {fromYear,toYear,rows:people.map(f=>({facultyId:f.id,name:f.name,
        left:measure(fromYear,f.id),right:measure(toYear,f.id)}))};
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
    function getConflicts(a,year){staff(a);if(!canAdfa(a)&&!['adc','lab'].includes(normalized(a.role).toLowerCase()))invalid('Office scope permission required');const y=inspect(year);if(y.status==='archived')return clone([...state.archives].reverse().find(v=>v.year===year)?.conflicts||[]);return clone(conflictRows(year));}
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
      if(!history||!history.assignments.length)invalid('Published historical assignment not found');const chosen=history.assignments.find(x=>effectiveOn(faculty(x.facultyId),s.date));if(!chosen)invalid('Historical Faculty no longer eligible');
      s.assignments=clone([chosen]);row.revision++;row.finalizedRevision=0;logged('historical_assignment_copied',a,year,{code:row.code,sourceId,sessionId});return clone(chosen);
    }
    function confirmRole(a,year,id){adfa(a);editable(year);const role=(state.roles[year]||[]).find(r=>r.id===id);if(!role)invalid('Role not found');if(role.status!=='draft')invalid('Role is not draft');role.status='confirmed';logged('annual_role_confirmed',a,year,{roleId:id});return clone(role)}
    function setPreferredYear(a,year){who(a);inspect(year);state.preferences[a.uid]=year;persist()}
    function getPreferredYear(a){who(a);const current=currentYear(now());if(isFaculty(a))return state.years[current]?current:Object.keys(state.years)[0];return state.years[state.preferences[a.uid]]?state.preferences[a.uid]:state.years[current]?current:Object.keys(state.years)[0]}
    function reset(){state=bootstrap(source);persist();return getState()}
    return Object.freeze({getState,createYear,addCourse,previewRollover,rolloverCourse,setYearPhase,previewPublication,compareYears,updateCatalog,addSession,editAssignment,finalizeCourse,publishCourse,approvePolicy,publishDoe,setOverride,getTeaching,getCalendar,getDoe,getWorkingDoe,getConflicts,addAfc,retireYear,restoreYear,copyHistorical,confirmRole,setPreferredYear,getPreferredYear,reset,currentYear});
  }
  return Object.freeze({createEngine,STORAGE_KEY,currentYear,validateYear});
});
