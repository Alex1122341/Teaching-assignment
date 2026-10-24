'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [runtime,evidencePath,out,mode='Plan']=process.argv.slice(2);
if(!runtime||!evidencePath||!out||!['Plan','Apply'].includes(mode))throw Error('Usage: node rationalize-current-doe-rulebook.cjs <server> <MASTER-evidence.json> <output> Plan|Apply');
const input=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
if(input.sourceSha256!=='a834d571a25942a1242c9ae3d4f56f975525dfa48658c76883a92dac6bb1d1b4'||input.gaps.length)throw Error('Accepted MASTER source or exact identity association changed');
const year='2026-27',policyId='ef8506ff-cb21-e5f8-42c0-9fff24327e49',actor='codex:owner-confirmed-master-rulebook:2026-10-11';
const id=k=>{const h=crypto.createHash('sha256').update('paws:source-rationalization:20261011:'+k).digest('hex').slice(0,32);return[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');};
const {createSqlConnection}=require(path.join(runtime,'src/data/sql-connection'));
const {createSqlDoePolicyRepository}=require(path.join(runtime,'src/data/sql-doe-policy-repository'));
const {createDoePolicyService}=require(path.join(runtime,'src/doe/doe-policy-service'));
const sql=require(path.join(runtime,'node_modules/mssql/msnodesqlv8'));
const db=createSqlConnection({connectionString:'Server=ITAPPVETOPSDB01.uc.ucalgary.ca,1433;Database=VetMed-Ops;Encrypt=True;TrustServerCertificate=False;',driver:'msnodesqlv8',sql});
const n=v=>v===null||v===undefined?null:Number(v),round=v=>Number(v.toFixed(6));
const category={HICC:'hicc',VISC:'visc','Course Coordinator':'course_coordination','Rotation Participant':'rotation',CCC:'rotation'};
(async()=>{try{
fs.mkdirSync(out,{recursive:true});
const repo=createSqlDoePolicyRepository(db),service=createDoePolicyService({repository:repo});
const before=await repo.getPolicyVersion(policyId);
if(before.version.status!=='draft'||before.version.revision!==1)throw Error('Expected original revision1 Draft; do not rerun');
const roles=await db.query('SELECT RoleAssignmentId id,FacultyId facultyId,RoleType roleType,CourseOrSubjectOrRotation scope,DoeMappedValue mappedDoe,DoeOverrideValue overrideDoe FROM paws.RoleAssignment WHERE AcademicYear=@year',{year});
for(const row of input.items){const live=roles.find(r=>r.id.toLowerCase()===row.roleId.toLowerCase());
if(!live||live.facultyId.toLowerCase()!==row.facultyId.toLowerCase()||live.roleType!==row.roleType||live.scope!==row.scope||n(live.overrideDoe)!==null||Math.abs(n(live.mappedDoe)-row.recordedDoe)>0.000001)throw Error('Live role changed or overridden; re-audit '+row.roleId);}
const bundle=JSON.parse(JSON.stringify(before)),master=bundle.references.find(r=>r.title===input.sourceName);
if(!master)throw Error('Existing MASTER structured reference unavailable');
master.notes='Exact MASTER course units, literal VISC subject groups, rotation Weeks and recorded allocation fields; owner confirmed MASTER explicit DOE values on 2026-10-11. Preserve row provenance; do not infer missing quantities or automatic prorating.';
const sel=(key,value)=>({selectorId:id(key+':'+value),field:key,operator:'equals',valueType:'text',valueText:value});
for(const mapping of bundle.courseMappings){mapping.mappingFacts={...(mapping.mappingFacts||{}),aliases:[...new Set([...(mapping.mappingFacts?.aliases||[]),mapping.mappingFacts?.sourceCourseLabel].filter(Boolean))]};delete mapping.mappingFactsJson;}
for(const row of input.items.filter(r=>r.units!==null)){
 const label=String(row.sourceScope),code=label.split(':')[0].trim();
 let mapping=bundle.courseMappings.find(m=>m.courseCode===code);
 if(!mapping){mapping={mappingId:id('course:'+code),courseCode:code,unitCount:row.units,curriculumStage:null,hiccEligible:null,referenceId:master.referenceId,reviewStatus:'approved',enabled:true,mappingFacts:{quantity:row.units,sourceCourseLabel:label,aliases:[]}};bundle.courseMappings.push(mapping);}
 if(mapping.unitCount!==row.units)throw Error('Conflicting source units for '+code);
 mapping.mappingFacts={...(mapping.mappingFacts||{}),quantity:row.units,sourceCourseLabel:label,aliases:[...new Set([...(mapping.mappingFacts?.aliases||[]),label,row.scope])]};
 delete mapping.mappingFactsJson;
}
const subjects=new Map();
for(const row of input.items.filter(r=>r.roleType==='VISC')){
 const name=String(row.sourceScope).replace(/\s*\/\s*/g,' / ').replace(/\s+/g,' ').trim();
 const key='VISC-'+crypto.createHash('sha256').update(String(row.sourceScope)).digest('hex').slice(0,12).toUpperCase();
 const existing=subjects.get(key);
 if(existing){existing.mappingFacts.aliases=[...new Set([...existing.mappingFacts.aliases,row.scope,String(row.sourceScope)])];continue;}
 subjects.set(key,{mappingId:id('subject:'+key),subjectKey:key,subjectName:name,curriculumStage:null,developmentPhase:null,referenceId:master.referenceId,enabled:true,reviewStatus:'approved',mappingFacts:{subjectCount:1,aliases:[...new Set([row.scope,String(row.sourceScope)])],groupBasis:'One literal MASTER VISCs Subject Area entry; separators do not split it.',sourceSheet:'VISCs',sourceSha256:input.sourceSha256}});
}
bundle.subjectMappings=[...subjects.values()];
const ccc=bundle.rules.find(r=>r.ruleKey==='ccc_shift_2026_27');
ccc.calculationMode='formula';ccc.formulaText='shifts * rate - halfDayDeduction';ccc.ruleLabel='CCC confirmed shifts minus source half-day deduction';
ccc.inputs=['shifts','halfDayDeduction'].map(inputName=>({inputName,required:true,source:'MASTER CCC Q/S/U and accepted sourceDetails shifts/halfDayDeduction; S already contains the deduction.'}));
for(const row of input.items.filter(r=>r.roleType==='Rotation Participant'&&r.weeks!==null)){
 const ruleId=id('rotation:'+row.roleId);
 bundle.rules.push({ruleId,ruleKey:'rotation_source_'+row.roleId.toLowerCase().replace(/-/g,'_'),category:'rotation',activityType:'Rotation Participant',ruleLabel:('MASTER rotation row '+row.row+': '+row.scope).slice(0,256),priority:200,calculationMode:'formula',formulaText:'sourceWeeks * rate',tierStrategy:null,mappingRequirement:null,resultKind:'credit',referenceId:master.referenceId,enabled:true,reviewStatus:'approved',selectors:[sel('sourceEntityId',row.roleId),sel('roleType','Rotation Participant')].map((s,i)=>({...s,selectorId:id(ruleId+':selector:'+i)})),parameters:[{name:'sourceWeeks',valueNumber:row.weeks},{name:'rate',valueNumber:2.5}],inputs:[],tiers:[]});
}
for(const row of input.items){
 let reference=null;
 if(row.roleType==='VISC')reference=5;
 if(row.roleType==='Rotation Participant')reference=row.weeks===null?null:row.weeks*2.5;
 if(row.roleType==='CCC')reference=row.shifts*.5-row.halfDayDeduction;
 if(row.roleType==='Course Coordinator'&&row.units!==null)reference=row.units<3?1.75:row.units<6?3.5:row.units<10?7:row.units<15?10:15;
 if(row.roleType==='HICC'){const m=bundle.courseMappings.find(m=>m.courseCode===String(row.sourceScope).split(':')[0].trim());reference=m?.hiccEligible===true?row.units*2:m?.hiccEligible===false?0:null;}
 if(row.sourceDoe===null){
  if(reference!==null&&Math.abs(reference-row.recordedDoe)<0.000001)continue;
  throw Error('Source allocation and explicit formula both unavailable for '+row.roleId);
 }
 if(reference===null||Math.abs(reference-row.sourceDoe)>0.000001){
  bundle.exceptions.push({exceptionId:id('allocation:'+row.roleId),category:category[row.roleType],scopeType:'source_entity',scopeKey:row.roleId,facultyId:row.facultyId,fixedDoe:round(row.sourceDoe),resultKind:'credit',reason:('Exact MASTER allocated DOE; '+(row.notes||'Recorded source allocation; no automatic inference.')).slice(0,1900),sourceReference:input.sourceName+' sha256:'+input.sourceSha256+' '+row.sheet+'!row'+row.row+'; owner confirmed explicit MASTER values 2026-10-11',effectiveStart:null,effectiveEnd:null,recurring:false,enabled:true,reviewStatus:'approved'});
 }
}
const corrections=input.items.filter(r=>r.sourceDoe!==null&&Math.abs(r.recordedDoe-r.sourceDoe)>0.000001).map(r=>({...r,newDoe:round(r.sourceDoe)}));
if(corrections.length!==14||corrections.some(r=>!['VISC','Rotation Participant'].includes(r.roleType)))throw Error('Expected exactly owner-confirmed 14 VISC/rotation differences');
bundle.version.versionLabel='2026-27 Guidelines + MASTER allocations';
bundle.version.sourceReference='UCVM Workload Guidelines updated 2025-12-23; '+input.sourceName+' sha256:'+input.sourceSha256+'; owner confirmed explicit MASTER allocations 2026-10-11. Missing targets/history remain unavailable.';
const plan={policyId,expectedRevision:1,bundle,corrections,sourceSha256:input.sourceSha256};
fs.writeFileSync(path.join(out,'before-policy.json'),JSON.stringify(before,null,2));
fs.writeFileSync(path.join(out,'before-roles.json'),JSON.stringify(roles,null,2));
fs.writeFileSync(path.join(out,'rationalization-plan.json'),JSON.stringify(plan,null,2));
console.log(JSON.stringify({mode,rules:bundle.rules.length,courses:bundle.courseMappings.length,subjects:bundle.subjectMappings.length,exceptions:bundle.exceptions.length,roleCorrections:corrections.length}));
if(mode==='Plan')return;
const saved=await service.saveDraft({policyVersionId:policyId,expectedRevision:1,patch:{rules:bundle.rules,references:bundle.references,courseMappings:bundle.courseMappings,subjectMappings:bundle.subjectMappings,exceptions:bundle.exceptions,versionLabel:bundle.version.versionLabel,sourceReference:bundle.version.sourceReference},actorUid:actor});
const validation=await service.validateDraft({policyVersionId:policyId,expectedRevision:saved.version.revision,actorUid:actor});
if(!validation.valid)throw Error('Saved Draft failed validation '+JSON.stringify(validation.errors));
fs.writeFileSync(path.join(out,'after-policy.json'),JSON.stringify(await repo.getPolicyVersion(policyId),null,2));
fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(validation,null,2));
console.log(JSON.stringify({savedDraftRevision:saved.version.revision,validation,roleDataApplied:false,policyPublished:false}));
}finally{await db.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
